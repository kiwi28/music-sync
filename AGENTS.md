<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:agent-coding-rules -->
# Agent Coding Rules — MANDATORY

Before writing ANY code in this project, read and follow these rules:

📁 **Rule files:** `docs/agent-rules/`
📋 **Index:** [`docs/agent-rules/README.md`](./docs/agent-rules/README.md)

## Quick Reference (top violations to avoid)

1. **Never break the build** — every commit must pass `npm run build`
2. **No `window.location.reload()`** — use `router.refresh()` or `refetch()`
3. **No dangling imports** — if you import it, the file must exist (fix `worker/src/metadata.js` first)
4. **Server/client boundary** — `"server-only"` modules must never be imported by client components
5. **Validate all inputs** — Zod schemas at every API boundary
6. **Three states always** — loading, empty, error in every data component
7. **Mobile-first** — every layout must work at 320px width
8. **Never commit secrets or binaries** — `pb_data/` and `pocketbase.exe` must stay out of git
9. **Auth check first** — every API route checks `pb.authStore.isValid` before anything else
10. **One source of truth** — platform domains defined once in `url-utils.ts`, types in `types.ts`

## Critical Issues to Fix First

See [`docs/agent-rules/AUDIT-PLAN.md`](./docs/agent-rules/AUDIT-PLAN.md) for the full list. Top priority:
- 🔴 Missing `worker/src/metadata.js` — worker crashes on start
- 🔴 `generateNonce()` in `utils.ts` uses Node.js `Buffer` — breaks client build
- 🔴 `pb_data/` committed to git — security leak
- 🔴 `pocketbase.exe` committed to git — binary bloat
<!-- END:agent-coding-rules -->
