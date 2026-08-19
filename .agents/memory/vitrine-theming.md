---
name: Vitrine per-tenant theming
description: How the public storefront re-skins per agency, the Cariri fallback rule, and how to add themed colors without breaking it.
---

# Per-tenant storefront theming

The public storefront (Vitrine: `pages/vitrine/**`) re-skins to each agency's
brand colors via a CSS-variable provider, NOT by threading `store.*Color` props
through every component.

- `src/lib/vitrineTheme.ts` — React-free theme math (hex normalize, rgb, WCAG
  luminance/contrast readable-foreground, mix/darken/lighten, withAlpha,
  hexToHslTriplet) + `buildVitrineTheme(store)` → `{ colors, cssVars, isFallback }`.
- `src/contexts/VitrineThemeContext.tsx` — `VitrineThemeProvider` sets CSS vars
  on a `data-vitrine-theme` wrapper. It overrides ONLY the shadcn tokens
  `--primary` / `--primary-foreground` / `--ring`, plus custom `--vitrine-*`
  brand vars. `useVitrineTheme()` exposes `{ colors, cssVars, isFallback }`.
- Provider is mounted around `VitrineLayout` in `pages/vitrine/index.tsx`, so the
  admin CRM (outside that subtree) is unaffected — scope is the storefront only.

## Cariri fallback rule
When a store still carries the raw DB default colors
(`#3b82f6` / `#10b981` / `#f59e0b` = never customized) OR colors are
missing/invalid, `buildVitrineTheme` falls back to the "Visite Cariri" palette:
Marrom `#5D3E2A`, Azul `#1E5B8C` (→ primary), Verde `#4C8B5F` (→ secondary),
Dourado `#D8A646` (→ accent). Customized stores keep their own colors.
**Why:** the default trio looks generic/unbranded; Cariri is the house default.

## How to apply
- For any inline `style={{ color/background }}` in storefront components, use
  `useVitrineTheme().colors.{primary,secondary,accent}` — NEVER raw
  `store.primaryColor/accentColor`. Raw refs skip the Cariri fallback, so
  default-color stores render the old generic blue/orange (this exact bug hit
  `ProductQuickView` and was fixed by binding it to the hook).
- Tailwind classes that read `--primary` (e.g. `bg-primary`) auto-pick up the
  themed value because the provider overrides that token on the wrapper.
