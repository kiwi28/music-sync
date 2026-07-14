# 08 — Zod Validation Rules

This project uses **Zod 4** (`zod@^4.4.3`) for runtime validation. Zod 4 has API differences from Zod 3.

---

## Rule Z1: Zod 4 API — `z.string().email()` Not `z.string().email()`

Zod 4 changed some method signatures. Always verify against the installed version. Key APIs used in this project:

```ts
z.object({ ... })
z.string().email("message").min(8, "message").max(200).regex(/.../, "message")
z.number().min(0).int()
z.infer<typeof schema>  // extract TypeScript type
schema.safeParse(data)  // returns { success, data } | { success, error }
schema.parse(data)      // throws ZodError on failure
parsed.error.flatten()  // human-readable error format
```

## Rule Z2: `safeParse` in API Routes, `parse` in Client Forms

```ts
// API routes: use safeParse for structured error responses
const parsed = schema.safeParse(body);
if (!parsed.success) {
  return NextResponse.json(
    { error: "Invalid input", details: parsed.error.flatten() },
    { status: 400 }
  );
}

// Client forms: use parse with try/catch for ZodError
try {
  const data = schema.parse({ email, password });
} catch (err) {
  if (err instanceof ZodError) {
    // Extract field errors
  }
}
```

## Rule Z3: `z.infer` to Export Input Types

Always export inferred types alongside schemas:

```ts
export const addPlaylistSchema = z.object({ ... });
export type AddPlaylistInput = z.infer<typeof addPlaylistSchema>;
```

This keeps types and validation in sync — the type is always what the schema validates.

## Rule Z4: `.refine()` for Cross-Field Validation

Use `.refine()` on the schema object (not individual fields) for validations that span multiple fields:

```ts
export const registerSchema = z.object({
  password: z.string().min(8),
  passwordConfirm: z.string(),
}).refine((data) => data.password === data.passwordConfirm, {
  message: "Passwords do not match",
  path: ["passwordConfirm"],  // attach error to the confirm field
});
```

## Rule Z5: Every API Route Body Must Have a Schema

Every API route that accepts a request body must define and use a Zod schema. Even simple ones:

```ts
// Even for a single field — define a schema
const syncPlaylistSchema = z.object({
  playlistId: z.string().min(1),
});
```

This documents the API contract and prevents malformed requests from reaching business logic.

## Rule Z6: Custom Validation Messages

All Zod validations should have human-readable error messages. These appear in the UI next to form fields:

```ts
z.string().min(8, "Password must be at least 8 characters")
z.string().email("Invalid email address")
z.string().url("Must be a valid URL")
```

## Rule Z7: Keep Schemas in `validators.ts`

All Zod schemas belong in `src/lib/validators.ts`. Don't define schemas inline in API routes or components — it scatters validation logic and makes it hard to find what the API accepts.

Exception: Highly route-specific schemas that are NOT reused can live in the route file. But the default is `validators.ts`.

## Rule Z8: URL Validation Uses `new URL()` Inside `.refine()`

The `addPlaylistSchema` validates URLs by parsing them and checking the hostname against known platforms:

```ts
z.string().url("Must be a valid URL").refine(
  (url) => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      return PLATFORM_HOSTS.some((h) => host === h);
    } catch {
      return false;
    }
  },
  { message: "URL must be from a supported music platform" }
)
```

Follow this pattern — `z.string().url()` first (checks format), then `.refine()` for business logic.

## Rule Z9: `ZodError.flatten()` for Field Errors

When catching `ZodError` in forms, extract field-level errors with `.flatten()` or by iterating `.issues`:

```ts
catch (err) {
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const field = issue.path[0] as string;
      fieldErrors[field] = issue.message;
    }
    setErrors(fieldErrors);
  }
}
```

The `Input` component expects per-field error strings — match this pattern.

## Rule Z10: Validate Query Params Too

Not just request bodies — validate query parameters in API routes when they're used in PocketBase queries:

```ts
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  filter: z.string().optional(),
});
const query = querySchema.safeParse(Object.fromEntries(searchParams));
```
