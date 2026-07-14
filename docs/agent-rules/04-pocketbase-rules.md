# 04 — PocketBase Rules

This project uses **PocketBase 0.28.x** as the backend. The JS SDK is `pocketbase@^0.27.0`.

---

## Rule P1: Two Client Types — Know Which to Use

| Client | File | Auth | Environment |
|---|---|---|---|
| **Browser client** | `src/lib/pocketbase.ts` | Current user (cookie) | Client components only |
| **Server client** | `src/lib/pocketbase-server.ts` | Current user (cookie) | Server Components, API routes |
| **Admin client** | `worker/src/pb-client.js` | Superuser | Worker only |

- Browser: uses `NEXT_PUBLIC_POCKETBASE_URL` (public URL via nginx)
- Server: uses `POCKETBASE_URL` (internal Docker network URL)
- Worker/Admin: uses `POCKETBASE_URL`, authenticates as superuser

NEVER mix them. The admin client must never be used in Next.js code. The browser client must never be used in API routes.

## Rule P2: Always Handle Auth Refresh Failures Gracefully

PocketBase token refresh can fail for transient reasons (network blip, PB restart). Do NOT clear the auth store on network errors — only on explicit 401/403:

```ts
// ✅ CORRECT — current pattern in pocketbase-server.ts
try {
  await pb.collection("users").authRefresh();
} catch (err) {
  const status = err.status;
  if (status === 401 || status === 403) {
    pb.authStore.clear(); // Token actually invalid
  } else {
    // Network error — keep the existing token
    console.warn("authRefresh network error — keeping session");
  }
}
```

## Rule P3: Escape Filter Values to Prevent Injection

PocketBase filter strings are vulnerable to injection if user input is interpolated raw:

```js
// ❌ WRONG — SQL-like injection
const filter = `title = "${userInput}"`;

// ✅ CORRECT — use escapeFilter
import { escapeFilter } from "../utils.js";
const filter = `title = "${escapeFilter(userInput)}"`;
```

The `escapeFilter` function escapes `\` and `"`. For additional safety, also escape single quotes and limit string length (see Issue #15 in AUDIT-PLAN.md).

## Rule P4: Use `getFullList()` for < 500 Records, `getList()` for Pagination

- `getFullList()` fetches all records (auto-paginates). Use for collections you know are small (user's playlists, sync jobs).
- `getList(page, perPage)` for paginated queries. Use when showing data that could grow large.
- Current code correctly uses `getFullList` for playlists and `getList` for sync jobs.

## Rule P5: Collection Access Rules Are Already Configured

The PocketBase migration sets collection-level access rules:

```
playlists:    listRule: "user = @request.auth.id"
sync_jobs:    listRule: "user = @request.auth.id"
tracks:       listRule: "" (public read by default, create requires auth)
```

When adding queries, you don't need to manually add `user = "${userId}"` filters for `playlists` and `sync_jobs` — PocketBase enforces them. BUT the PocketBase proxy route adds them anyway as defense-in-depth. Don't remove the proxy's user filter without understanding this.

## Rule P6: `expand` for Relations

Use PocketBase's `expand` parameter to populate relations in one query:

```ts
// Expand playlist on sync jobs
const jobs = await pb.collection("sync_jobs").getList(1, 10, {
  expand: "playlist",
});
// Access: job.expand?.playlist?.name

// Expand nested: playlist_tracks → track
const playlist = await pb.collection("playlists").getOne(id, {
  expand: "playlist_tracks_via_playlist.track",
});
// Access: playlist.expand?.playlist_tracks_via_playlist?.[0].expand?.track
```

**Known bug:** `expand=playlist` on `sync_jobs` returns 400 in PocketBase 0.28.x. Do not use it. See `use-playlists.ts` for the workaround comment.

## Rule P7: Filter Syntax Reference

PocketBase filter syntax (subset of SQL-like):

| Operator | Meaning | Example |
|---|---|---|
| `=` | Equal | `status = "pending"` |
| `!=` | Not equal | `status != "completed"` |
| `>` `<` `>=` `<=` | Comparison | `created > "2024-01-01"` |
| `~` | Like/contains | `title ~ "search term"` |
| `&&` | AND | `a = 1 && b = 2` |
| `\|\|` | OR | `a = 1 \|\| b = 2` |
| `()` | Grouping | `(a = 1 \|\| b = 2) && c = 3` |

## Rule P8: Never Commit `pb_data/`

The `pb_data/` directory contains SQLite databases with user data and credentials. It's currently committed (see Issue #3 in AUDIT-PLAN.md). Add to `.gitignore` immediately.

The auto-generated `pb_data/types.d.ts` is useful for TypeScript types but is 724KB. Consider generating it in CI instead of committing it.

## Rule P9: Migrations Are JavaScript

PocketBase migrations are `.js` files in `pb_migrations/` that run inside a Go JSVM (not Node.js). Key limitations:

- `fields.addMarshaledJSON(JSON.stringify({...}))` — required for adding fields in PocketBase 0.28+ (NOT `fields.push()`)
- `fields.getByName("name")` — required for looking up fields (NOT `fields.find()`)
- No `async/await` — the JSVM is synchronous
- `$app` is the global PocketBase app instance

## Rule P10: Superuser Auth in Worker Has No Auto-Refresh

The worker's `getAdminClient()` checks `pb.authStore.isValid` but doesn't handle mid-operation token expiry. Add retry logic or set a long admin token TTL in PocketBase settings.

## Rule P11: Don't Duplicate PocketBase Auth in Proxy

The `api/pocketbase/[...path]/route.ts` proxy re-checks ownership that PocketBase collection rules already enforce. When modifying access control:

1. Set the rule in the PocketBase migration (canonical source)
2. The proxy adds defense-in-depth (keep it)
3. If they diverge, fix the proxy to match the migration rules
