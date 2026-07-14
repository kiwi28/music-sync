# 01 — Next.js 16 Rules

This project uses **Next.js 16.2** with the App Router. This version has breaking changes from earlier Next.js. Always consult `node_modules/next/dist/docs/` before implementing unfamiliar patterns.

---

## Rule N1: Async `params` — Always `Promise`

In Next.js 16, `params` is ALWAYS a `Promise`. You must `await` it:

```tsx
// ✅ CORRECT — Next.js 16
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // ...
}

// ❌ WRONG — pre-16 pattern, will fail typecheck
export default function Page({ params }: { params: { id: string } }) {
```

This applies to `page.tsx`, `layout.tsx`, `generateMetadata`, and `generateStaticParams`.

## Rule N2: API Route Params Are Also Promises

```tsx
// ✅ CORRECT
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  // ...
}
```

## Rule N3: Use `"use client"` Only at Leaf Components

- Server Components are the DEFAULT. Only add `"use client"` when you need hooks, event handlers, or browser APIs.
- Do NOT make an entire page `"use client"` — lift interactivity into leaf components.
- Current violation: `page.tsx` (dashboard), `playlists/page.tsx`, `playlists/[id]/page.tsx`, `settings/page.tsx`, `login/page.tsx` are ALL `"use client"`. Future work should split these into server component shells with client islands.

## Rule N4: `next.config.ts` Must Have Production Settings

When modifying `next.config.ts`, ensure it includes:

```ts
const nextConfig: NextConfig = {
  output: "standalone",           // Required: Docker optimization
  poweredByHeader: false,         // Security: hide framework
  images: {
    remotePatterns: [             // If using next/image
      { protocol: "https", hostname: "i.scdn.co" },
    ],
  },
};
```

## Rule N5: `error.tsx` Per Route Segment

Every route segment that fetches data should have an `error.tsx`:

```tsx
"use client";
export default function Error({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div>
      <h2>Something went wrong</h2>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

Create `src/app/error.tsx` (root level) as the catch-all.

## Rule N6: `loading.tsx` for Route-Level Suspense

Use `loading.tsx` files for route-level loading states instead of inline spinners in page components. This enables streaming — the layout renders immediately while page content loads.

## Rule N7: Server Actions for Mutations (Preferred)

Prefer Server Actions over `fetch("/api/...")` for form submissions and mutations. They are:
- Type-safe (share types between client and server)
- Progressively enhanced (work without JS)
- Simpler (no manual fetch + error handling boilerplate)

Exception: The sync API route is fine as-is because it's called from the worker and from programmatic button clicks.

Current violation: `add-playlist-dialog.tsx` manually calls `fetch("/api/sync")` — this should be a Server Action.

## Rule N8: `router.refresh()` Not `window.location.reload()`

`router.refresh()` from `next/navigation` re-renders the current route's server components without a full page reload. Use it after mutations. Never use `window.location.reload()`.

## Rule N9: Metadata API

Use the Metadata API (`generateMetadata`, `metadata` export) for page titles/descriptions. Don't set `document.title` in effects.

## Rule N10: No `getServerSideProps` or `getStaticProps`

These Pages Router APIs don't exist in App Router. Use async Server Components, `fetch()` with `cache` options, or `generateStaticParams`.

## Rule N11: Environment Variables

- `NEXT_PUBLIC_*` — available in browser AND server. Use for PocketBase URL (browser needs it).
- Everything else — server-only. Use for PocketBase internal URL, API keys.
- Never expose `POCKETBASE_URL` (internal Docker network URL) to the browser.
