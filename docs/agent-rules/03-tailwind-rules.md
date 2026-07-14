# 03 — Tailwind CSS 4 Rules

This project uses **Tailwind CSS 4** with the `@tailwindcss/postcss` PostCSS plugin. The configuration is in `postcss.config.mjs` (NOT a `tailwind.config.ts` file).

---

## Rule T1: Tailwind v4 Import Syntax

In `globals.css`, use Tailwind v4 syntax:

```css
@import "tailwindcss";
```

Do NOT use `@tailwind base; @tailwind components; @tailwind utilities;` — that's Tailwind v3 syntax and will not work.

## Rule T2: Theme Customization in CSS, Not Config File

Tailwind v4 moves theme customization from `tailwind.config.ts` to CSS. Theme values go in `globals.css` using `@theme`:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

For new colors/spacing/fonts, add them to the `@theme` block. Do NOT create a `tailwind.config.ts` file.

## Rule T3: Dark-Only Design System

This app is dark-only. Use fixed colors — never conditional dark/light variants:

```tsx
// ✅ CORRECT — explicit dark colors
className="bg-neutral-900 text-white border-white/10"

// ❌ WRONG — this app has no light mode
className="bg-white dark:bg-neutral-900 text-black dark:text-white"
```

The `<html>` element has `class="dark"` hardcoded. Theme provider uses `defaultTheme="dark"` with `enableSystem={false}`.

## Rule T4: Color Palette

Use Tailwind's built-in color scale, primarily from `neutral`, `white` (with alpha), and semantic colors:

| Usage | Classes |
|---|---|
| Page background | `bg-black` or `bg-neutral-950` |
| Card background | `bg-white/5` (5% white overlay) |
| Card border | `border-white/10` |
| Primary text | `text-white` |
| Secondary text | `text-white/60` or `text-white/40` |
| Muted text | `text-white/30` or `text-white/25` |
| Success | `text-green-400`, `bg-green-500/20` |
| Warning | `text-yellow-400`, `bg-yellow-500/20` |
| Error/Danger | `text-red-400`, `bg-red-500/10`, `border-red-500/20` |
| Platform Spotify | `bg-green-500` |
| Platform YouTube | `bg-red-600` |
| Platform Apple | `bg-red-500` |

Never introduce arbitrary colors outside this palette without explicit justification.

## Rule T5: Opacity Modifiers, Not Opacity Utilities

Use Tailwind's opacity modifier syntax for transparency, NOT `opacity-*` classes:

```tsx
// ✅ CORRECT — color opacity modifier
text-white/60     // white at 60% opacity
bg-white/5        // white at 5% opacity
border-white/10   // white at 10% opacity

// ❌ WRONG
text-white opacity-60
```

## Rule T6: Responsive Breakpoints

Use mobile-first responsive prefixes:

| Prefix | Min Width | Target |
|---|---|---|
| (none) | 320px | Mobile (default) |
| `sm:` | 640px | Large phone / small tablet |
| `md:` | 768px | Tablet |
| `lg:` | 1024px | Desktop |
| `xl:` | 1280px | Large desktop |

All layouts must work at 320px first, then scale up.

## Rule T7: No `@apply` in Component Styles

Tailwind v4 discourages `@apply`. Use the `cn()` utility function and compose classes in JSX. The only `@apply`-like usage allowed is in `globals.css` for truly global styles (scrollbar, selection).

## Rule T8: Skeleton Loading Pattern

Use this exact pattern for loading skeletons:

```tsx
<div className="h-4 w-2/3 animate-pulse rounded bg-white/5" />
```

`animate-pulse` + `bg-white/5` — consistent across all components. Use `rounded`, not `rounded-lg`, for skeleton bars.

## Rule T9: Focus-Visible Ring

Interactive elements (buttons, inputs, selects) must have a focus-visible ring using this pattern:

```tsx
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-1 focus-visible:ring-offset-black
```

This is already applied in `button.tsx`, `input.tsx`, and `select.tsx`. Do not change the ring style.

## Rule T10: Layout Patterns

- **Sidebar layout:** `fixed left-0 top-0 h-full w-56` sidebar + `ml-56` main content. Already established.
- **Page content:** `space-y-6` or `space-y-8` for vertical rhythm.
- **Grid cards:** `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4`.
- **Card list:** `space-y-3` stacked cards.
- **Dialog overlay:** `fixed inset-0 z-50 bg-black/60 backdrop-blur-sm` + centered content.
