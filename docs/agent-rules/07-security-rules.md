# 07 — Security Rules

Security rules that apply across the entire project. Violating any of these is a blocker for production deployment.

---

## Rule S1: Never Commit Secrets

- No API keys, tokens, passwords, or credentials in source files.
- Check `.env` files for secrets — `.env*` is in `.gitignore` but verify before committing.
- `pb_data/` contains SQLite databases with user password hashes — must be gitignored.
- `pocketbase.exe` is a binary — must be gitignored.
- If you accidentally commit a secret, rotate it immediately and rewrite git history.

## Rule S2: Server/Client Data Separation

- `NEXT_PUBLIC_*` env vars are visible to the browser. Never prefix secrets with `NEXT_PUBLIC_`.
- `POCKETBASE_URL` (internal Docker URL) must NEVER be exposed to the browser.
- Server-only files (`"server-only"` import) must never be imported by client components.

## Rule S3: Validate All Input at Boundaries

Every entry point into the application must validate input:

| Boundary | How |
|---|---|
| API route body | Zod schema (`safeParse`) before any processing |
| API route params | Zod or explicit type narrowing |
| URL query params | Parse with `new URLSearchParams()`, validate values |
| PocketBase filters | `escapeFilter()` on all user-originated values |
| Worker playlist data | Check `playlist` exists, has required fields |

Never trust `request.json()` or `searchParams.get()` to return valid data.

## Rule S4: Authentication Checks on Every Protected Route

API routes that require auth must check `pb.authStore.isValid` and `pb.authStore.record` before doing anything else. Return 401 immediately if not authenticated.

Order of operations in every API route:
1. Create server client
2. Check auth → 401 if not authed
3. Parse and validate input → 400 if invalid
4. Verify ownership of referenced resources → 403 if not owner
5. Execute the operation

## Rule S5: CSRF Awareness

API routes that use cookie-based auth (`pb_auth` cookie) are vulnerable to cross-site request forgery. For mutation endpoints (`POST`, `PATCH`, `DELETE`):

- The `pb_auth` cookie uses `SameSite: Lax` (already configured) — this prevents most CSRF.
- For additional defense-in-depth, verify `Origin` or `Referer` headers match the expected domain for sensitive operations.
- This project does NOT currently implement CSRF tokens — this is acceptable given `SameSite: Lax` + no banking/financial data.

## Rule S6: Error Responses Must Not Leak Internals

For API routes:
- **4xx errors:** Can return the specific validation error (user needs to fix their input).
- **5xx errors:** Return a generic message. Log the full error server-side with `logError()` but never send stack traces or internal paths to the client.

Current violation: `api/sync/route.ts` passes `pbErr.message` through in 5xx responses — fix this.

## Rule S7: OAuth Tokens — Encrypt at Rest

The `user_connections.access_token` and `user_connections.refresh_token` fields store plain-text OAuth tokens. A database compromise exposes these. Mitigations (in priority order):

1. Mark fields as `secret: true` in PocketBase schema if supported
2. Encrypt at the application layer before storing
3. Never log token values (already followed — but verify)

## Rule S8: Rate Limiting on Sync Endpoint

`POST /api/sync` must not allow unlimited job creation. At minimum:

- One pending/running job per playlist at a time (return 409 Conflict if one exists)
- Consider a cooldown period (5 minutes) between syncs of the same playlist

## Rule S9: Dependency Audit

Run `npm audit` regularly. The project has few dependencies which helps, but `pocketbase`, `next`, and build tooling all have security surface area. Do not add dependencies without a clear need.

## Rule S10: Container Security

- The worker image runs `spotdl` and `yt-dlp` — tools downloaded from PyPI. Pin versions in the Dockerfile (`spotdl==X.Y.Z`, `yt-dlp==X.Y.Z`).
- The PocketBase container uses a health check — this must not be removed.
- Docker containers should NOT run as root. The Next.js image uses `USER nextjs` and the worker uses `USER node` — keep this.

## Rule S11: Content Security Policy

The CSP in `nginx-musicsync.conf` allows `unsafe-inline` for scripts and styles (needed by Next.js). This is acceptable for a self-hosted app. Do not add `unsafe-eval` without understanding the implications.

If you add external image sources (new platform cover art domains), add them to the `img-src` CSP directive.

## Rule S12: SQLite Injection via PocketBase Filters

PocketBase filter strings are vulnerable to injection if user input is concatenated raw. Always use `escapeFilter()` (worker) or avoid user input in filters on the server side (the proxy route already filters by `user = "${userId}"` where `userId` comes from the auth store, not user input).
