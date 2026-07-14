# Agent Coding Rules — Music Sync

These rules constrain agentic development to prevent chaos. Every agent working on this codebase must follow every rule in every file below. Rules are numbered for easy reference in code review (e.g., "violates Rule R3").

## Files

| # | File | Scope |
|---|---|---|
| 00 | [`00-core-rules.md`](./00-core-rules.md) | Universal — applies to every file |
| 01 | [`01-nextjs-rules.md`](./01-nextjs-rules.md) | Next.js 16 App Router specifics |
| 02 | [`02-react-rules.md`](./02-react-rules.md) | React 19 component patterns |
| 03 | [`03-tailwind-rules.md`](./03-tailwind-rules.md) | Tailwind CSS 4 design system |
| 04 | [`04-pocketbase-rules.md`](./04-pocketbase-rules.md) | PocketBase SDK, queries, migrations |
| 05 | [`05-typescript-rules.md`](./05-typescript-rules.md) | TypeScript strict mode, types, Zod |
| 06 | [`06-worker-rules.md`](./06-worker-rules.md) | Background worker, download handlers |
| 07 | [`07-security-rules.md`](./07-security-rules.md) | Auth, CSRF, secrets, CSP |
| 08 | [`08-zod-validation-rules.md`](./08-zod-validation-rules.md) | Zod 4 validation patterns |
| 09 | [`09-docker-infra-rules.md`](./09-docker-infra-rules.md) | Docker, nginx, docker-compose, volumes |

## How to Use

1. **Before writing any code:** Read `00-core-rules.md` — it applies universally.
2. **Before working on a specific layer:** Read the corresponding rule file.
3. **Code review:** Reference rules by number (e.g., "violates Rule W3 — handler contract not followed").
4. **New agent sessions:** The agent must read these rules before making changes. Link them from CLAUDE.md.

## Issue Tracking

All known issues are documented in [`AUDIT-PLAN.md`](./AUDIT-PLAN.md) with severity ratings and remediation steps. Fix critical issues before adding new features.

## Rule Hierarchy

If rules conflict, the more specific rule wins:
1. Security rules (07) override everything
2. Core rules (00) override library-specific rules
3. Library-specific rules (01-06, 08-09) override general best practices
4. CLAUDE.md / AGENTS.md (user instructions) override all rules
