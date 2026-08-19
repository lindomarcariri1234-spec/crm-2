import { useMemo, useState } from "react";
import type { PublicStore } from "@/lib/storeApi";
import { formatCurrency } from "@/lib/utils";
import { useVitrineTheme } from "@/contexts/VitrineThemeContext";
import { CreditCard } from "lucide-react";

/**
 * Display-only installment ("parcelamento") simulator for the public storefront.
 *
 * It NEVER mutates payment state — it only previews how a price could be split
 * into 1..N installments using the store's own configuration:
 *   - minInstallments / maxInstallments (defaults 1 / 12, clamped so max >= min)
 *   - installmentFee: interpreted as a flat percentage surcharge applied to the
 *     financed total for any plan with more than one installment (the column is
 *     ambiguous, so we treat it as a single flat acréscimo and label it clearly).
 *
 * Fail-safe: renders nothing when the price is not a positive finite number.
 */
export function InstallmentSimulator({
  price,
  store,
}: {
  price: number;
  store: Pick<PublicStore, "minInstallments" | "maxInstallments" | "installmentFee">;
}) {
  const { colors } = useVitrineTheme();

  const { min, max, feePct } = useMemo(() => {
    const rawMin = Number(store.minInstallments);
    const rawMax = Number(store.maxInstallments);
    const safeMin = Number.isFinite(rawMin) && rawMin >= 1 ? Math.floor(rawMin) : 1;
    const safeMaxBase = Number.isFinite(rawMax) && rawMax >= 1 ? Math.floor(rawMax) : 2;
    const safeMax = Math.min(Math.max(safeMin, safeMaxBase), 2);
    const rawFee = parseFloat(store.installmentFee ?? "0");
    const safeFee = Number.isFinite(rawFee) && rawFee > 0 ? rawFee : 0;
    return { min: safeMin, max: safeMax, feePct: safeFee };
  }, [store.minInstallments, store.maxInstallments, store.installmentFee]);

  const options = useMemo(() => {
    const list: number[] = [];
    for (let n = min; n <= max; n++) list.push(n);
    return list;
  }, [min, max]);

  const [installments, setInstallments] = useState(max);

  if (!Number.isFinite(price) || price <= 0) return null;

  const selected = Math.min(Math.max(installments, min), max);
  const hasFee = feePct > 0 && selected > 1;
  const financedTotal = hasFee ? price * (1 + feePct / 100) : price;
  const perInstallment = financedTotal / selected;

  return (
    <div className="mt-1 rounded-lg border border-black/5 bg-white/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <CreditCard className="h-3.5 w-3.5" style={{ color: colors.primary }} />
        Simule seu parcelamento
      </div>

      {options.length > 1 && (
        <label className="mb-2 block">
          <span className="sr-only">Número de parcelas</span>
          <select
            value={selected}
            onChange={(e) => setInstallments(Number(e.target.value))}
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm font-medium focus:outline-none focus:ring-2"
            style={{ ["--tw-ring-color" as string]: colors.primary }}
          >
            {options.map((n) => (
              <option key={n} value={n}>
                {n}x
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex items-baseline gap-1">
        <span className="text-lg font-bold leading-tight" style={{ color: colors.primary }}>
          {selected}x de {formatCurrency(perInstallment)}
        </span>
      </div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {selected === 1
          ? "à vista"
          : hasFee
            ? `Total ${formatCurrency(financedTotal)} · acréscimo de ${feePct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`
            : `Total ${formatCurrency(financedTotal)} · sem juros`}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground/80">
        Simulação ilustrativa. Os valores e condições finais são confirmados no checkout.
      </p>
    </div>
  );
}
