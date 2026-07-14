# 00 — Core Coding Rules (Universal)

These rules apply to **every file, every language, every context** in this project. No exceptions without explicit user approval and a comment explaining why.

---

## Rule 1: Never Break the Build

- Every commit must produce a working `npm run build` (Next.js) and `docker compose build` (worker).
- Before committing, run the build. If it fails, fix it first.
- If you create a new file that another file imports, you MUST create it in the same commit. No dangling imports.

## Rule 2: Never Leave Dangling Imports

- If you `import { X } from "./Y"`, the file `Y` must exist and must export `X`.
- This applies to both TypeScript and JavaScript (worker).
- **This project currently has a violation:** `worker/src/metadata.js` is imported but missing. Fix this first.

## Rule 3: Server/Client Boundary Is Sacred

- Files importing `"server-only"` MUST NOT be imported by client components. The build will fail.
- Files using `"use client"` MUST NOT import Node.js APIs (`fs`, `path`, `Buffer`, `crypto` without prefix).
- `src/lib/utils.ts` is a shared file — it currently has a `Buffer` call (`generateNonce`) that will crash client bundles. Do NOT add Node-only code to shared utility files.
- Use `src/lib/*-server.ts` naming convention for server-only variants.

## Rule 4: State Over Page Reloads

- **NEVER use `window.location.reload()`** to refresh data after a mutation. This is an anti-pattern for SPAs.
- Use React state updates, `router.refresh()` (Next.js), or the `refetch()` function from data hooks.
- If you find `window.location.reload()` in the codebase, it's a bug — fix it.

## Rule 5: Error Boundaries Required

- Every route segment should have an `error.tsx` boundary.
- The root layout must have a global error fallback.
- Any `"use client"` component that does data fetching should be wrapped in error handling — either try/catch with UI fallback or a parent error boundary.

## Rule 6: No Secrets in Code or Git

- Never hardcode URLs, API keys, tokens, or credentials.
- Use environment variables (`.env.example` documents them).
- `pb_data/` must be in `.gitignore`. Never commit database files.
- Binaries (`pocketbase.exe`, `.exe`, compiled output) must be in `.gitignore`.

## Rule 7: One Source of Truth

- Define data once, derive everywhere else.
- Platform domains, constants, types — if they appear in two files, they need a single canonical definition.
- The `PLATFORM_DOMAINS` map in `url-utils.ts` is the canonical source for platform↔domain mapping. `validators.ts` should import from it, not redefine it.

## Rule 8: Structured Error Logging

- In API routes and server code: use `logError()` from `src/lib/api-errors.ts`. Do NOT use raw `console.error`.
- In the worker: use a consistent log format: `[module] message { key: value }`.
- Every caught error must be logged before being re-thrown or handled.
- Include enough context to debug: what was called, with what inputs, what came back.

## Rule 9: Input Validation at Every Boundary

- API routes: validate all inputs with Zod schemas BEFORE processing. Never trust `request.json()`.
- Worker: validate PocketBase record shapes before using them. The `playlist` object from `expand` may be null.
- Client: validate URL inputs before submitting.
- PocketBase filter strings: always use `escapeFilter()` (worker/utils.js) or the equivalent. Never interpolate raw user input into filter queries.

## Rule 10: Mobile-First, Dark-Only

- Every UI change must work on 320px width screens. Use responsive prefixes (`sm:`, `md:`, `lg:`).
- The app is dark-only. Never add light-theme styles or conditional theme colors.
- Test with `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` — never hardcode desktop column counts.

## Rule 11: Add Loading + Empty + Error States

Every data-displaying component must handle three states:
1. **Loading** — skeleton/spinner while data fetches
2. **Empty** — helpful message with action prompt when data is `[]`
3. **Error** — error message with retry button when fetch fails

No component should render nothing or crash when data is missing.

## Rule 12: DRY — No Copy-Paste

- If you're about to copy-paste more than 3 lines, extract a shared function/component instead.
- Platform handler files (`spotdl.js`, `ytdlp.js`) MUST share dedup logic, track creation logic, and metadata parsing. If you add a new platform, refactor the shared logic first.
- UI variants (button, badge, card) belong in `src/components/ui/`. Don't inline style combinations that could be a variant.

## Rule 13: Document Workarounds

- If you write code that works around a bug in a dependency (e.g., the PocketBase expand bug), add a comment with:
  - What the bug is
  - What version it affects
  - The workaround
  - When to revisit (e.g., `// FIXME(pocketbase>=0.29): re-enable expand`)

## Rule 14: No Silent Failures

- Every `catch` block must either: log the error, show it to the user, or re-throw it.
- Empty catch blocks (`catch {}` or `catch { /* ignore */ }`) are forbidden unless accompanied by a comment explaining why the error is intentionally swallowed.
- In the worker, a failed download must update the sync_job to "failed" with the error message. Never leave a job stuck in "running" or "pending".

## Rule 15: Tests Required for Business Logic

- URL parsing (`detectPlatformFromUrl`, `extractPlatformIdFromUrl`) — MUST have unit tests for each platform.
- Dedup logic (`findExistingTrack`) — MUST have tests for ISRC match, platform_id match, and fuzzy match.
- Auth flows — MUST have tests verifying 401/403 responses.
- Use `vitest` for testing.
