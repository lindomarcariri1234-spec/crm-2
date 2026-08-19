import { createContext, useContext, useMemo, ReactNode, CSSProperties } from "react";
import type { PublicStore } from "@/lib/storeApi";
import { buildVitrineTheme, VitrineTheme } from "@/lib/vitrineTheme";

const VitrineThemeContext = createContext<VitrineTheme | null>(null);

/**
 * Scopes per-tenant brand theming to the storefront subtree only.
 *
 * It computes a theme from the store's colors and applies it as CSS custom
 * properties on a wrapper `<div data-vitrine-theme>`. Because custom properties
 * inherit, every descendant (Tailwind utilities resolving `hsl(var(--primary))`,
 * shadcn components, and raw `var(--vitrine-*)` usage) re-skins automatically,
 * while the admin CRM (outside this wrapper) keeps the default tokens.
 */
export function VitrineThemeProvider({
  store,
  children,
}: {
  store: PublicStore;
  children: ReactNode;
}) {
  const theme = useMemo(() => buildVitrineTheme(store), [store]);

  return (
    <VitrineThemeContext.Provider value={theme}>
      <div data-vitrine-theme style={theme.cssVars as CSSProperties}>
        {children}
      </div>
    </VitrineThemeContext.Provider>
  );
}

export function useVitrineTheme(): VitrineTheme {
  const ctx = useContext(VitrineThemeContext);
  if (!ctx) {
    throw new Error("useVitrineTheme must be used within a VitrineThemeProvider");
  }
  return ctx;
}
