# Project Audit — Issues & Remediation Plan

**Date:** 2026-07-14
**Auditor:** Claude (senior-dev code review)
**Branch:** `testing`
**Scope:** Full codebase — Next.js app, worker, Docker config, nginx, PocketBase schema

---

## Severity Key

| Label | Meaning |
|---|---|
| 🔴 **Critical** | Crash-on-start, data loss, security breach |
| 🟠 **High** | Wrong behavior, major UX degradation, fragile in production |
| 🟡 **Medium** | Code quality, maintainability, inconsistency |
| 🟢 **Low** | Nitpicks, style, future-proofing |

---

## 🔴 Critical Issues

### 1. Missing `worker/src/metadata.js` — CRASH ON START

**Files:** `worker/src/downloads/spotdl.js:15`, `worker/src/downloads/ytdlp.js:15`

Both download handlers import `{ parseFileMetadata } from "../metadata.js"`. This file **does not exist** in the repository. The worker will crash with `ERR_MODULE_NOT_FOUND` the moment it tries to process any job.

```js
// spotdl.js line 15
import { parseFileMetadata } from "../metadata.js";
// ytdlp.js line 16
import { parseFileMetadata } from "../metadata.js";
```

**Fix:** Create `worker/src/metadata.js` with a `parseFileMetadata(filePath)` function that shells out to `ffprobe` (already available in the Docker image). The function should return `{ title, artist, album, durationMs, isrc }`.

**Priority:** Immediate — blocks all sync functionality.

---

### 2. `generateNonce()` in `src/lib/utils.ts` uses Node.js `Buffer` without server-only guard

**File:** `src/lib/utils.ts:52-54`

```ts
export function generateNonce(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
}
```

`Buffer` is a Node.js-only global. If any client component imports from `utils.ts` (which currently happens — `cn()`, `formatDuration()`, `timeAgo()` are all used client-side), the build will fail with `Buffer is not defined` or, if it somehow leaks to the browser bundle, it will crash.

**Fix:** Extract `generateNonce()` into a separate `src/lib/nonce.ts` file with `import "server-only"`, OR use `btoa(String.fromCharCode(...array))` which works in both environments.

**Priority:** Immediate — blocks production build.

---

### 3. `pb_data/` committed to git — data leakage

**Files:** `pb_data/auxiliary.db`, `pb_data/data.db`, `pb_data/types.d.ts`

The PocketBase SQLite databases are tracked in git. These contain user credentials (hashed), auth tokens, and all application data. The `.gitignore` has `.env*` but does NOT exclude `pb_data/`.

```gitignore
# Missing:
/pb_data/
```

**Fix:** Add `/pb_data/` to `.gitignore`, verify `pb_data/` is not in the remote, and run `git rm --cached pb_data/auxiliary.db pb_data/data.db` (keep `types.d.ts` if needed for type generation).

**Priority:** Immediate — security and privacy.

---

### 4. `pocketbase.exe` committed to git

**File:** `pocketbase.exe` (binary, 44MB+)

A compiled Go binary is in the repo root. This bloats the repo, is platform-specific, and will cause conflicts.

**Fix:** Add `pocketbase.exe` to `.gitignore` and `git rm --cached pocketbase.exe`.

---

## 🟠 High-Priority Issues

### 5. `window.location.reload()` used as state management

**Files:** `src/app/page.tsx:115`, `src/app/playlists/page.tsx:107`, `src/app/playlists/[id]/page.tsx:49`

Three pages force a full browser reload after mutations instead of using React state:

```tsx
// page.tsx (dashboard)
onCreated={() => { window.location.reload(); }}

// playlists/page.tsx
onCreated={() => window.location.reload()}

// playlists/[id]/page.tsx
router.refresh();
window.location.reload(); // router.refresh() is immediately overridden
```

This is an anti-pattern in React. It destroys all client state, loses scroll position, re-fetches everything, and causes a white flash. The hooks already return `refetch()` functions.

**Fix:** Pass `refetch` as the `onCreated` callback in dashboard and playlists pages. In the detail page, use `router.refresh()` alone (which re-renders server components) and lift sync state into the hook.

---

### 6. No React Error Boundary

**Files:** None — missing entirely.

If any component throws during render, the entire app shows a blank white screen. There's no `error.tsx` at the root layout level, and no React error boundary wrapping the client tree.

**Fix:** Create `src/app/error.tsx` (Next.js App Router error boundary). Wrap the `<AppShell>` in `providers.tsx` with a custom `ErrorBoundary` class component for client-side render errors.

---

### 7. Hardcoded fallback domains

**Files:** `src/lib/url-utils.ts:16`, `nginx-musicsync.conf` (all `server_name` directives)

```ts
// url-utils.ts
const host = request.headers.get("x-forwarded-host") ||
  request.headers.get("host") ||
  "musicsync.kiw.ro"; // ← hardcoded
```

The nginx config hardcodes `musicsync.kiw.ro`, `pb.musicsync.kiw.ro`, `spoty.kiw.ro` across all server blocks. This means the project cannot be reconfigured for a different domain without editing multiple files.

**Fix:** Use environment variables (`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_PB_URL`, `NEXT_PUBLIC_NAVIDROME_URL`) and reference them. In nginx, use `set $domain` variables or document the domain with a clear placeholder.

---

### 8. Zero test coverage

**Files:** No `*.test.*` or `*.spec.*` files anywhere.

No unit tests, integration tests, or E2E tests. The worker has complex dedup logic, URL parsing has multiple regex patterns, and the API has auth flows — all untested.

**Fix:** Add at minimum:
- `vitest` for unit tests (`url-utils.ts`, `utils.ts`, `dedup.js`, `utils.js`)
- API route tests for auth gating
- Worker integration tests for the job lifecycle

---

### 9. Worker `getAdminClient()` — no mid-operation token refresh

**File:** `worker/src/pb-client.js:14-32`

```js
export async function getAdminClient() {
  if (pb && pb.authStore.isValid) return pb;
  // re-auth...
}
```

If a download takes 30 minutes (common for large playlists), the admin token will expire before the `processJob` function finishes creating track records in Phase 4. The `pb.collection().create()` calls will fail with 401.

**Fix:** Either set a very long admin token expiry in PocketBase, or add a retry-with-reauth wrapper around PB calls in the worker.

---

### 10. No API rate limiting

**File:** `src/app/api/sync/route.ts`

A user (or attacker) can hammer `POST /api/sync` to create thousands of pending jobs, exhausting worker resources and filling the database. There's also no per-user concurrency limit — the worker processes one at a time but unlimited jobs can be queued.

**Fix:** Add a check before creating a sync job: if the playlist already has a `pending` or `running` job, return 409 Conflict. Consider adding a cooldown (e.g., don't allow re-sync within 5 minutes of the last sync).

---

## 🟡 Medium-Priority Issues

### 11. Duplicate platform domain definitions

**Files:** `src/lib/validators.ts:7-13`, `src/lib/url-utils.ts:28-39`

Both files define the same platform→hostname mapping. A new platform added in one place won't be recognized by the other.

**Fix:** Define the canonical `PLATFORM_DOMAINS` map once in `url-utils.ts`. Have `validators.ts` import and derive its `PLATFORM_HOSTS` array from it.

---

### 12. Worker has no TypeScript

**Files:** All `worker/src/*.js` files

The worker is plain JavaScript with JSDoc annotations. No type checking means the `playlist` object shape, return types from handlers, and PocketBase record shapes are all unchecked. This is how the missing `metadata.js` import went unnoticed.

**Fix:** Convert worker to TypeScript, or at minimum add a `jsconfig.json` with `checkJs: true` and generate PocketBase types for the worker.

---

### 13. Inconsistent error logging

Some code uses `logApiError()` / `logError()` (the structured logger), while other code uses raw `console.error()` and `console.warn()`:

- `src/lib/pocketbase-server.ts` — uses `console.warn` AND `logError` (inconsistent within the same file)
- `src/hooks/use-playlists.ts` — raw `console.error`
- `worker/src/worker.js` — raw `console.error` with ad-hoc formatting

**Fix:** Standardize on `logError()` everywhere. For the worker, create a lightweight structured logger that matches the API.

---

### 14. No CSRF protection on API routes

**File:** `src/app/api/sync/route.ts`

The API routes don't check `Origin` or `Referer` headers, nor do they require a CSRF token. Since auth is cookie-based (`pb_auth` cookie), these routes are vulnerable to cross-site request forgery.

**Fix:** For the sync route specifically, verify the `Origin` header matches the expected domain. Consider using the `SameSite: Lax` cookie attribute (already set) plus an origin check as defense-in-depth.

---

### 15. `escapeFilter()` insufficient for PocketBase filter injection

**File:** `worker/src/utils.js:14-16`

```js
export function escapeFilter(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
```

This only escapes `\` and `"`. PocketBase filter syntax also interprets single quotes. There's no length limit, and very long strings could cause query issues.

**Fix:** Also escape single quotes. Add a length cap. Consider using PocketBase's `$` parameterized filter syntax if available in the SDK version.

---

### 16. `user_connections.access_token` stored in plain text

**File:** `pb_migrations/1783699980_init_all_collections.js:16`

The `access_token` field in `user_connections` stores OAuth tokens without encryption. A PocketBase admin UI compromise (or accidental `pb_data/` leak) exposes these tokens.

**Fix:** At minimum, mark `access_token` and `refresh_token` fields with `secret: true` (if PocketBase supports it). Ideally, encrypt them at the application layer.

---

### 17. Missing `worker/src/metadata.js` also means no `ffprobe` integration

The download handlers call `parseFileMetadata()` to read artist/title/album/duration from downloaded MP3s. Without this, the artist normalization fallback name-matching by partial filename substring (`f.includes(meta._artist?.slice(0, 10))`) is unreliable.

This is covered by Issue #1 but worth calling out separately — even once the file exists, the filename-matching heuristic is fragile.

---

### 18. `next.config.ts` is empty — no production hardening

**File:** `next.config.ts`

```ts
const nextConfig: NextConfig = {
  /* config options here */
};
```

Missing:
- `output: "standalone"` — would reduce Docker image size
- Image `remotePatterns` — if the app serves external images via `next/image`
- `poweredByHeader: false` — removes the `X-Powered-By: Next.js` header
- `experimental.serverSourceMaps` — disabled in production

---

### 19. `Promise<params>` type mismatch in `layout.tsx`

**File:** `src/app/layout.tsx:27`

```tsx
children: React.ReactNode;  // correct
```

The layout doesn't receive `params`, so this is fine. But the page components use `params: Promise<{ id: string }>` (the new Next.js 16 API), while the layout uses the old pattern. This is consistent for now but worth noting for future layout params usage.

Actually, looking again — the `layout.tsx` type is fine. But this is a reminder that Next.js 16 made `params` a Promise everywhere.

---

### 20. PocketBase proxy re-implements auth that PocketBase already enforces

**File:** `src/app/api/pocketbase/[...path]/route.ts`

The proxy manually checks `record.user !== userId` on PATCH/DELETE. But the collection access rules in the migration already enforce `updateRule: "user = @request.auth.id"`. This means the auth is checked twice — once by PocketBase (correct) and once by the proxy (redundant). If they ever disagree, debugging is confusing.

**Fix:** Either use the proxy (removing PocketBase collection rules) OR use PocketBase directly via `/pb/` nginx proxy (removing the API proxy route). The current hybrid adds complexity with no security benefit.

---

### 21. Dashboard hardcodes stat grid at 4 columns on mobile

**File:** `src/app/page.tsx:45`

```tsx
<div className="grid grid-cols-4 gap-4">
```

On mobile (< 640px), a 4-column grid renders each stat card at ~80px wide with text overflowing. The layout should collapse to 2 columns on small screens.

**Fix:** `grid-cols-2 sm:grid-cols-4` or `grid-cols-2 lg:grid-cols-4`.

---

## 🟢 Low-Priority / Nitpicks

### 22. Inline SVG icons instead of using `lucide-react`

**File:** `src/components/layout/sidebar.tsx:76-99`

The project already has `lucide-react` as a dependency (package.json) but the sidebar hand-codes SVG paths. Lucide has `House`, `Music`, `Settings` icons.

**Fix:** Replace with Lucide icons for consistency and smaller bundle (tree-shakeable).

---

### 23. `playlist_tracks` relation cascade behavior

**File:** `pb_migrations/1783699980_init_all_collections.js:81`

```js
{ name: "track", cascadeDelete: false }, // ← doesn't cascade
```

When a playlist is deleted, `playlist_tracks` records are cascade-deleted (correct), but the `tracks` remain as orphans. Over time, the `tracks` collection accumulates entries not linked to any playlist.

**Fix:** Either enable cascade (but that could delete shared tracks), or add a periodic cleanup job that deletes tracks with no playlist_tracks references.

---

### 24. `timeout` values are magic numbers

- `120_000` (2 min) — spotdl metadata fetch
- `1_800_000` (30 min) — spotdl/yt-dlp download
- `10_000` (10s) — PocketBase API timeout
- `300` (5 min) — token refresh margin

These should be named constants or environment variables.

---

### 25. Sync history doesn't show playlist names without expand

**File:** `src/hooks/use-playlists.ts:85-88`

```ts
// NOTE: expand=playlist is omitted — PocketBase 0.28.x returns 400
```

This is a known PocketBase bug worked around with a code comment. When the PocketBase bug is fixed, the expand should be re-enabled. There should be a `// FIXME(pocketbase>=0.29): ...` comment with a version check.

---

### 26. `.dockerignore` doesn't exclude `.claude/`

**File:** `.dockerignore`

The `.claude/` directory (including worktrees with full copies of the repo!) is copied into the Docker build context. This adds significant size and could leak configuration.

**Fix:** Add `.claude/` to `.dockerignore`.

---

### 27. `settings/page.tsx` delete-all-data iterates sequentially

**File:** `src/app/settings/page.tsx:93-101`

```ts
for (const p of playlists) {
  await pb.collection("playlists").delete(p.id);
}
```

Serial deletes with no progress indicator. If a user has 100+ playlists, this takes a long time with no feedback. Could use `Promise.all` for concurrency or batch deletes.

---

### 28. `add-playlist-dialog.tsx` doesn't reset form state on close

**File:** `src/components/playlists/add-playlist-dialog.tsx`

`setUrl("")` and `setName("")` are only called on successful submission. If the user opens the dialog, types something, closes it, and reopens — the stale values remain.

**Fix:** Reset state in a `useEffect` that fires when `open` transitions to `true`.

---

## Summary

| Severity | Count |
|---|---|
| 🔴 Critical | 4 |
| 🟠 High | 6 |
| 🟡 Medium | 10 |
| 🟢 Low | 8 |
| **Total** | **28** |

## Remediation Order

1. **Right now:** Fix missing `metadata.js` (crash), `Buffer` in client bundle (crash), remove `pb_data/` from git (security)
2. **This week:** Add error boundary, replace `window.location.reload()`, add API rate limiting, fix worker token expiry
3. **This sprint:** Add tests for critical paths, deduplicate platform definitions, standardize error logging
4. **Backlog:** Worker TypeScript conversion, CSRF hardening, inline SVG → Lucide, remaining nits
