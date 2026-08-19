import type { PublicStore } from "@/lib/storeApi";

/**
 * Per-tenant storefront (Vitrine) theming.
 *
 * Every storefront re-skins automatically from the agency's
 * primaryColor / secondaryColor / accentColor. When a store still carries the
 * raw DB defaults (i.e. was never customized), we fall back to the
 * "Visite Cariri" reference palette so the template always looks polished.
 *
 * This module is React-free and unit-tested. The provider in
 * `contexts/VitrineThemeContext.tsx` turns the result into CSS variables.
 */

/** Visite Cariri reference palette (default fallback). */
export const CARIRI = {
  marrom: "#5D3E2A",
  azul: "#1E5B8C",
  verde: "#4C8B5F",
  dourado: "#D8A646",
  branco: "#FFFFFF",
  cinza: "#F5F7FA",
} as const;

/** The literal defaults stored in the DB when a tenant never picks colors. */
const DB_DEFAULTS = {
  primary: "#3b82f6",
  secondary: "#10b981",
  accent: "#f59e0b",
} as const;

const DARK_FG = "#1f2937";
const LIGHT_FG = "#ffffff";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Normalize a hex string to lowercase `#rrggbb`, or null when invalid. */
export function normalizeHex(input?: string | null): string | null {
  if (!input || typeof input !== "string") return null;
  let hex = input.trim().toLowerCase();
  if (!hex.startsWith("#")) hex = `#${hex}`;
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : null;
}

export function hexToRgb(hex: string): Rgb {
  const norm = normalizeHex(hex) ?? "#000000";
  return {
    r: parseInt(norm.slice(1, 3), 16),
    g: parseInt(norm.slice(3, 5), 16),
    b: parseInt(norm.slice(5, 7), 16),
  };
}

function clamp(n: number, min = 0, max = 255): number {
  return Math.min(max, Math.max(min, n));
}

function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (n: number) => clamp(Math.round(n)).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Relative luminance per WCAG (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Pick the foreground (dark or white) with the best WCAG contrast against the
 * given background hex. Comparing actual contrast ratios is more robust than a
 * fixed luminance threshold (e.g. gold/amber correctly gets dark text).
 */
export function readableForeground(hex: string): string {
  const bg = relativeLuminance(hex);
  const darkContrast = contrastRatio(bg, relativeLuminance(DARK_FG));
  const lightContrast = contrastRatio(bg, relativeLuminance(LIGHT_FG));
  return darkContrast >= lightContrast ? DARK_FG : LIGHT_FG;
}

/** Linear blend of two hex colors. weight = share of `b` (0..1). */
export function mix(a: string, b: string, weight: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const w = Math.min(1, Math.max(0, weight));
  return rgbToHex({
    r: ca.r + (cb.r - ca.r) * w,
    g: ca.g + (cb.g - ca.g) * w,
    b: ca.b + (cb.b - ca.b) * w,
  });
}

export function darken(hex: string, amount: number): string {
  return mix(hex, "#000000", amount);
}

export function lighten(hex: string, amount: number): string {
  return mix(hex, "#ffffff", amount);
}

/** rgba() string from a hex color and alpha 0..1. */
export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Convert hex to an `H S% L%` triplet for shadcn `hsl(var(--x))` tokens. */
export function hexToHslTriplet(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export interface VitrineColors {
  primary: string;
  secondary: string;
  accent: string;
  primaryForeground: string;
  secondaryForeground: string;
  accentForeground: string;
  primaryHover: string;
  accentHover: string;
  primarySoft: string;
  secondarySoft: string;
  accentSoft: string;
  primaryBorder: string;
  surface: string;
  mutedSurface: string;
  gradientHero: string;
  gradientCta: string;
}

export interface VitrineTheme {
  colors: VitrineColors;
  /** Inline-style CSS custom properties to spread onto the themed wrapper. */
  cssVars: Record<string, string>;
  /** True when the store had no custom colors and the Cariri palette is used. */
  isFallback: boolean;
}

function resolveBrand(store: Pick<PublicStore, "primaryColor" | "secondaryColor" | "accentColor">) {
  const p = normalizeHex(store?.primaryColor);
  const s = normalizeHex(store?.secondaryColor);
  const a = normalizeHex(store?.accentColor);
  const isDefault =
    p === DB_DEFAULTS.primary && s === DB_DEFAULTS.secondary && a === DB_DEFAULTS.accent;
  if (!p || !s || !a || isDefault) {
    return {
      primary: CARIRI.azul,
      secondary: CARIRI.verde,
      accent: CARIRI.dourado,
      isFallback: true,
    };
  }
  return { primary: p, secondary: s, accent: a, isFallback: false };
}

/** Build the full theme (colors + CSS vars) for a store. */
export function buildVitrineTheme(
  store: Pick<PublicStore, "primaryColor" | "secondaryColor" | "accentColor">,
): VitrineTheme {
  const { primary, secondary, accent, isFallback } = resolveBrand(store);

  const colors: VitrineColors = {
    primary,
    secondary,
    accent,
    primaryForeground: readableForeground(primary),
    secondaryForeground: readableForeground(secondary),
    accentForeground: readableForeground(accent),
    primaryHover: darken(primary, 0.12),
    accentHover: darken(accent, 0.12),
    primarySoft: withAlpha(primary, 0.1),
    secondarySoft: withAlpha(secondary, 0.1),
    accentSoft: withAlpha(accent, 0.12),
    primaryBorder: withAlpha(primary, 0.25),
    surface: CARIRI.branco,
    mutedSurface: CARIRI.cinza,
    gradientHero: `linear-gradient(135deg, ${primary} 0%, ${darken(primary, 0.18)} 55%, ${mix(primary, secondary, 0.45)} 100%)`,
    gradientCta: `linear-gradient(135deg, ${primary} 0%, ${mix(primary, accent, 0.55)} 100%)`,
  };

  const cssVars: Record<string, string> = {
    // Override only the shadcn tokens that should adopt the brand primary.
    // (secondary/accent shadcn tokens stay neutral so hover/menu surfaces
    // don't turn brand-colored.)
    "--primary": hexToHslTriplet(primary),
    "--primary-foreground": hexToHslTriplet(colors.primaryForeground),
    "--ring": hexToHslTriplet(primary),
    // Brand tokens consumed via var() / arbitrary Tailwind classes.
    "--vitrine-primary": primary,
    "--vitrine-secondary": secondary,
    "--vitrine-accent": accent,
    "--vitrine-primary-fg": colors.primaryForeground,
    "--vitrine-secondary-fg": colors.secondaryForeground,
    "--vitrine-accent-fg": colors.accentForeground,
    "--vitrine-primary-hover": colors.primaryHover,
    "--vitrine-accent-hover": colors.accentHover,
    "--vitrine-primary-soft": colors.primarySoft,
    "--vitrine-secondary-soft": colors.secondarySoft,
    "--vitrine-accent-soft": colors.accentSoft,
    "--vitrine-primary-border": colors.primaryBorder,
    "--vitrine-surface": colors.surface,
    "--vitrine-muted-surface": colors.mutedSurface,
    "--vitrine-gradient-hero": colors.gradientHero,
    "--vitrine-gradient-cta": colors.gradientCta,
  };

  return { colors, cssVars, isFallback };
}
