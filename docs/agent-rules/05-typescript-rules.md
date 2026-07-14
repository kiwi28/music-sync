# 05 — TypeScript Rules

This project uses **TypeScript 5** with `strict: true`. The worker is plain JavaScript but should follow these rules via JSDoc.

---

## Rule TS1: Source of Truth — `src/lib/types.ts`

Domain types (`Playlist`, `Track`, `PlaylistTrack`, `SyncJob`, `Platform`, `SyncStatus`) are defined in `src/lib/types.ts`. All code — client, server, API routes, hooks — must use these types. Never define ad-hoc interfaces for the same PocketBase collections.

```ts
// ✅ Use the canonical types
import type { Playlist, SyncJob } from "@/lib/types";

// ❌ Don't redefine
interface Playlist { id: string; name: string; ... }
```

## Rule TS2: Zod Schemas Mirror Types

`src/lib/validators.ts` contains Zod schemas that validate at runtime what the types describe at compile time. Keep them in sync:

- Add a type → add a Zod schema for it
- Change a type field → update the corresponding Zod schema
- Export `z.infer<typeof schema>` types alongside schemas

## Rule TS3: `Platform` Union Is Exhaustive

The `Platform` type is a union of 5 string literals:

```ts
type Platform = "spotify" | "apple_music" | "youtube_music" | "tidal" | "deezer";
```

When adding a new platform, you must update:
1. `types.ts` — add the literal to the union
2. `validators.ts` — add to `PLATFORMS` array and `PLATFORM_HOSTS` array (import from `url-utils.ts`!)
3. `url-utils.ts` — add domain→platform mapping and ID extraction regex
4. `utils.ts` — add platform metadata (label, color, icon)
5. Worker: add handler and register in `HANDLERS` map

Use `switch(platform)` with a `default: never` to get compile-time exhaustiveness checks.

## Rule TS4: `strict: true` — No Escape Hatches

The `tsconfig.json` has `strict: true`. This means:
- No implicit `any` (use `unknown` and narrow)
- Strict null checks (use optional chaining `?.` and nullish coalescing `??`)
- No implicit `this`

Do not add `// @ts-ignore` or `// @ts-expect-error` without a comment explaining why it's necessary and when to remove it.

## Rule TS5: `import type` for Type-Only Imports

Use `import type` when importing types that are only used for type annotations:

```ts
// ✅ Type-only import — erased at compile time
import type { Playlist, Track } from "@/lib/types";

// ✅ Value import — stays in the bundle
import { cn } from "@/lib/utils";
```

This prevents accidental runtime dependencies on type files.

## Rule TS6: `as const` for Literal Arrays

When defining arrays that should be treated as readonly tuples with literal types:

```ts
// ✅ Use as const
const PLATFORM_HOSTS = [
  "open.spotify.com", "spotify.com", ...
] as const;
// Type: readonly ["open.spotify.com", "spotify.com", ...]

// ❌ Without as const
const PLATFORM_HOSTS = ["open.spotify.com", ...];
// Type: string[]
```

## Rule TS7: PocketBase Relation Typing

PocketBase relations are typed with `expand?` for populated joins:

```ts
interface PlaylistTrack {
  track: string | Track;  // string ID when not expanded, Track object when expanded
  expand?: {
    track?: Track;         // Populated when using expand=track
  };
}
```

When accessing an expanded relation, always handle both cases:

```ts
const track = pt.expand?.track ?? (typeof pt.track === "object" ? pt.track : null);
if (!track || typeof track === "string") return null;
```

## Rule TS8: `Record` for Maps, Not `{}`

Use `Record<K, V>` for dictionary/map types, not `{ [key: string]: V }`:

```ts
// ✅ CORRECT
const meta: Record<string, { label: string; color: string }> = { ... };

// ❌ AVOID
const meta: { [key: string]: { label: string; color: string } } = { ... };
```

## Rule TS9: `unknown` Over `any` in Catch Blocks

```ts
// ✅ CORRECT — narrow the error
catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
}

// ❌ AVOID — unsafe access
catch (err: any) {
  console.error(err.message); // could crash if err is not an Error
}
```

## Rule TS10: Worker JSDoc Types

The worker is plain JS but still documents types via JSDoc. Follow the pattern in `dedup.js`:

```js
/**
 * @param {object} pb - Authenticated PocketBase client
 * @param {object} params
 * @param {string} [params.isrc]
 * @returns {Promise<object|null>}
 */
export async function findExistingTrack(pb, { isrc, title, artist }) { ... }
```

All worker functions must have JSDoc `@param` and `@returns` annotations.
