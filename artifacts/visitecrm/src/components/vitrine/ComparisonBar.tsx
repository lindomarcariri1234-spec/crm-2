import { useLocation } from "wouter";
import { useComparison } from "@/contexts/ComparisonContext";
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";
import { Scale, X, ArrowRight } from "lucide-react";

/**
 * Floating "Comparar (n)" pill shown on the storefront listing pages (home,
 * catalog, calendar) whenever the visitor has selected at least one item to
 * compare. Hidden elsewhere to avoid clashing with page-level sticky bars.
 */
export function ComparisonBar({ slug }: { slug: string }) {
  const [location, navigate] = useLocation();
  const { count, clear } = useComparison();
  const { colors } = useVitrineTheme();

  const allowed = new Set([
    `/loja/${slug}`,
    `/loja/${slug}/produtos`,
    `/loja/${slug}/calendario`,
  ]);

  if (count === 0 || !allowed.has(location)) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-40 w-full max-w-md -translate-x-1/2 px-4">
      <div className="flex items-center gap-2 rounded-full border border-black/5 bg-white px-3 py-2 shadow-xl">
        <button
          type="button"
          aria-label="Limpar comparação"
          onClick={clear}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <Scale className="h-4 w-4 shrink-0" style={{ color: colors.primary }} />
          <span className="truncate font-medium text-foreground">
            {count} {count === 1 ? "item selecionado" : "itens selecionados"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/loja/${slug}/comparar`)}
          className="flex shrink-0 items-center gap-1 rounded-full px-4 py-1.5 text-sm font-semibold shadow"
          style={{ background: colors.primary, color: colors.primaryForeground }}
        >
          Comparar
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
