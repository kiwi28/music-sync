# 02 — React 19 Rules

This project uses **React 19.2**. Components follow a shadcn-style pattern with thin UI wrappers.

---

## Rule R1: Components Must Handle Three States

Every data-displaying component must render differently for:

1. **Loading** — Skeleton placeholders. Use the project's `Skeleton` component or `animate-pulse` divs.
2. **Empty** — Descriptive message + CTA button. See `playlist-card.tsx` empty state as reference.
3. **Error** — Error text in a red-tinted box + retry button.

Missing any of these is a bug.

## Rule R2: Use `forwardRef` for UI Primitives

All components in `src/components/ui/` must use `forwardRef` and spread `...props` to the underlying DOM element. Follow the pattern in `button.tsx`:

```tsx
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => {
    return <button ref={ref} className={cn(...)} {...props} />;
  }
);
Button.displayName = "Button";
```

## Rule R3: `cn()` for All Class Merging

Always use the `cn()` utility (clsx + tailwind-merge) for combining Tailwind classes. Never use template literals for conditional classes:

```tsx
// ✅ CORRECT
className={cn("base-class", isActive && "active-class", className)}

// ❌ WRONG
className={`base-class ${isActive ? "active-class" : ""} ${className}`}
```

## Rule R4: No Inline Style Objects

Use Tailwind classes exclusively. The ONLY exception is dynamic values that Tailwind cannot express (e.g., a dynamic `background-image: url(...)`). If you need a dynamic color, use a Tailwind arbitrary value: `bg-[#ff0000]`.

## Rule R5: Event Handlers Are `async`

In React 19, event handlers can be `async` directly. No need for `.then()` chains:

```tsx
// ✅ CORRECT — React 19
async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  setSubmitting(true);
  try {
    await doSomething();
  } finally {
    setSubmitting(false);
  }
}

// ❌ AVOID — unnecessary wrapper
function handleSubmit(e: React.FormEvent) {
  e.preventDefault();
  doSomething()
    .then(() => setSubmitting(false))
    .catch(...);
}
```

## Rule R6: Use `useCallback` for Stable Refs, Not Premature Optimization

- Use `useCallback` when the function is a dependency of another hook (`useEffect`, `useMemo`) or passed to a memoized child.
- Do NOT wrap every handler in `useCallback` "just in case."
- Current code does this correctly in `providers.tsx` — follow that pattern.

## Rule R7: Auth State via Context

The `useAuth()` hook provides `{ pb, user, loading, login, register, logout }`. Always use this hook — never create a new PocketBase client or read auth state directly.

## Rule R8: Forms Use Controlled Inputs + Zod

- All form inputs are controlled (`value` + `onChange`).
- Validate with Zod schemas from `src/lib/validators.ts` before submission.
- Show field-level errors inline (the `Input` component supports an `error` prop).
- Show server-level errors at the top of the form.

Reference: `login-page.tsx` shows the correct pattern.

## Rule R9: `useEffect` Cleanup Required

Every `useEffect` that creates a subscription, event listener, or timer MUST return a cleanup function:

```tsx
useEffect(() => {
  const unsubscribe = pb.authStore.onChange(...);
  return unsubscribe; // ← required
}, [pb]);
```

## Rule R10: No Prop Drilling Past 2 Levels

If a value is passed through more than 2 component levels, use context or colocate the data fetching with the consumer. The current codebase uses `useAuth()` context for auth and `usePlaylists()` / `usePlaylist(id)` hooks for data — follow this pattern.

## Rule R11: Forward `ref` in UI Components

All components in `src/components/ui/` must use `forwardRef`. Set `displayName` for better DevTools experience.
