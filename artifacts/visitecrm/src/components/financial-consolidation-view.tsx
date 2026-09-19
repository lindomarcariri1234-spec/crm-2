import { useMemo } from "react";
import { Banknote, Info, PiggyBank, Receipt } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

export type FinancialActualRow = {
  id: string;
  category: string;
  amount: number;
  status: string;
  source?: string;
};

export type FinancialPlannedRow = {
  id: string;
  category: string;
  description?: string;
  amount: number;
  kind?: "fixed" | "variable" | string;
};

export type FinancialPricing = {
  adult: number;
  child: number | null;
  senior: number | null;
};

export type FinancialActualSummary = {
  total?: number;
  paid?: number;
  pending?: number;
  overdue?: number;
  totalRealCosts?: number;
  totalPaidCosts?: number;
  totalPendingCosts?: number;
};

type CategoryRow = {
  category: string;
  planned: number;
  actual: number;
  paid: number;
  open: number;
};

const AGENCY_CATEGORY_LABELS: Record<string, string> = {
  transport: "Transporte",
  accommodation: "Hospedagem",
  food: "Alimentação",
  marketing: "Marketing",
  administrative: "Taxas",
  commission: "Marketing",
  other: "Outros",
};

export function normalizeFinancialCategory(category: string | null | undefined): string {
  const value = category?.trim() ?? "";
  return AGENCY_CATEGORY_LABELS[value.toLowerCase()] ?? (value || "Outros");
}

function isCancelled(status: string): boolean {
  return status.toLowerCase() === "cancelled";
}

function isPaid(status: string): boolean {
  return status.toLowerCase() === "paid";
}

export function buildFinancialCategoryRows(
  actualRows: readonly FinancialActualRow[],
  plannedRows: readonly FinancialPlannedRow[] = [],
  actualCategoryTotals?: ReadonlyArray<{ category: string; total: number }>,
): CategoryRow[] {
  const rows = new Map<string, CategoryRow>();
  const getRow = (category: string) => {
    const normalized = normalizeFinancialCategory(category);
    const existing = rows.get(normalized);
    if (existing) return existing;
    const created = { category: normalized, planned: 0, actual: 0, paid: 0, open: 0 };
    rows.set(normalized, created);
    return created;
  };

  for (const planned of plannedRows) {
    getRow(planned.category).planned += Number(planned.amount) || 0;
  }

  if (actualCategoryTotals) {
    for (const actual of actualCategoryTotals) {
      getRow(actual.category).actual += Number(actual.total) || 0;
    }
  } else {
    for (const actual of actualRows) {
      if (isCancelled(actual.status)) continue;
      const row = getRow(actual.category);
      const amount = Number(actual.amount) || 0;
      row.actual += amount;
      if (isPaid(actual.status)) row.paid += amount;
      else row.open += amount;
    }
  }

  return [...rows.values()]
    .filter(row => row.planned > 0 || row.actual > 0)
    .sort((a, b) => Math.max(b.planned, b.actual) - Math.max(a.planned, a.actual));
}

function resolveActualTotal(actualRows: readonly FinancialActualRow[], summary?: FinancialActualSummary): number {
  if (summary?.totalRealCosts != null) return summary.totalRealCosts;
  if (summary?.total != null) return summary.total;
  return actualRows.filter(row => !isCancelled(row.status)).reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
}

function resolvePaidTotal(actualRows: readonly FinancialActualRow[], summary?: FinancialActualSummary): number {
  if (summary?.totalPaidCosts != null) return summary.totalPaidCosts;
  if (summary?.paid != null) return summary.paid;
  return actualRows
    .filter(row => !isCancelled(row.status) && isPaid(row.status))
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
}

function resolveOpenTotal(actualRows: readonly FinancialActualRow[], summary?: FinancialActualSummary): number {
  if (summary?.totalPendingCosts != null) return summary.totalPendingCosts;
  if (summary?.pending != null || summary?.overdue != null) return (summary.pending ?? 0) + (summary.overdue ?? 0);
  return actualRows
    .filter(row => !isCancelled(row.status) && !isPaid(row.status))
    .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
}

export function FinancialConsolidationView({
  actualRows,
  plannedRows = [],
  pricing,
  actualSummary,
  actualCategoryTotals,
  title = "Visão financeira consolidada",
  description = "Preços, orçamento planejado e custos realizados conciliados sem duplicidade.",
  showPaymentBreakdown = true,
}: {
  actualRows: readonly FinancialActualRow[];
  plannedRows?: readonly FinancialPlannedRow[];
  pricing?: FinancialPricing | null;
  actualSummary?: FinancialActualSummary;
  actualCategoryTotals?: ReadonlyArray<{ category: string; total: number }>;
  title?: string;
  description?: string;
  showPaymentBreakdown?: boolean;
}) {
  const categoryRows = useMemo(
    () => buildFinancialCategoryRows(actualRows, plannedRows, actualCategoryTotals),
    [actualRows, plannedRows, actualCategoryTotals],
  );
  const plannedTotal = plannedRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const actualTotal = resolveActualTotal(actualRows, actualSummary);
  const paidTotal = resolvePaidTotal(actualRows, actualSummary);
  const openTotal = resolveOpenTotal(actualRows, actualSummary);
  const variance = actualTotal - plannedTotal;
  const hasPlanning = plannedRows.length > 0 || !!pricing;
  const hasActual = actualTotal > 0 || categoryRows.some(row => row.actual > 0);

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" />
            <h3 className="font-semibold text-sm">{title}</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
          {categoryRows.length} categorias conciliadas
        </span>
      </div>

      {pricing && (
        <div className="border-b px-5 py-4">
          <div className="mb-3 flex items-center gap-2">
            <Banknote className="h-4 w-4 text-blue-600" />
            <div>
              <p className="text-xs font-semibold">Preços por categoria</p>
              <p className="text-[11px] text-muted-foreground">Valores de venda usados na receita da viagem</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Adulto", value: pricing.adult },
              { label: "Criança", value: pricing.child },
              { label: "Idoso", value: pricing.senior },
            ].map(price => (
              <div key={price.label} className="rounded-lg bg-muted/40 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">{price.label}</p>
                <p className="mt-0.5 text-sm font-semibold">{price.value == null ? "—" : formatCurrency(price.value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px border-b bg-border sm:grid-cols-4">
        {[
          { label: "Orçamento planejado", value: plannedTotal, icon: PiggyBank, tone: "text-amber-700" },
          { label: "Custo realizado", value: actualTotal, icon: Receipt, tone: "text-red-700" },
          { label: "Pago", value: paidTotal, icon: Banknote, tone: "text-green-700" },
          { label: "Em aberto", value: openTotal, icon: Receipt, tone: "text-blue-700" },
        ].map(item => (
          <div key={item.label} className="bg-card px-4 py-3">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <item.icon className={`h-3.5 w-3.5 ${item.tone}`} />
              {item.label}
            </div>
            <p className={`mt-1 text-sm font-bold ${item.tone}`}>{formatCurrency(item.value)}</p>
          </div>
        ))}
      </div>

      {categoryRows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Categoria</th>
                {hasPlanning && <th className="px-3 py-3 text-right font-medium">Planejado</th>}
                <th className="px-3 py-3 text-right font-medium">Realizado</th>
                {showPaymentBreakdown && <th className="px-3 py-3 text-right font-medium">Pago</th>}
                {showPaymentBreakdown && <th className="px-5 py-3 text-right font-medium">Em aberto</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {categoryRows.map(row => (
                <tr key={row.category} className="hover:bg-muted/20">
                  <td className="px-5 py-3 font-medium">{row.category}</td>
                  {hasPlanning && (
                    <td className="px-3 py-3 text-right text-muted-foreground">
                      {row.planned > 0 ? formatCurrency(row.planned) : "—"}
                    </td>
                  )}
                  <td className="px-3 py-3 text-right font-semibold">
                    {row.actual > 0 ? formatCurrency(row.actual) : "—"}
                  </td>
                  {showPaymentBreakdown && (
                    <td className="px-3 py-3 text-right text-green-700">
                      {row.paid > 0 ? formatCurrency(row.paid) : "—"}
                    </td>
                  )}
                  {showPaymentBreakdown && (
                    <td className="px-5 py-3 text-right text-blue-700">
                      {row.open > 0 ? formatCurrency(row.open) : "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-5 py-8 text-center text-sm text-muted-foreground">
          Nenhuma informação financeira para consolidar.
        </div>
      )}

      {!hasPlanning && (
        <div className="flex items-start gap-2 border-t bg-blue-50/60 px-5 py-3 text-xs text-blue-800">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Selecione uma viagem para cruzar estes custos com os preços por categoria e o orçamento planejado.</span>
        </div>
      )}
      {hasPlanning && plannedTotal > 0 && (
        <div className={`border-t px-5 py-3 text-xs ${variance <= 0 ? "text-green-700" : "text-amber-700"}`}>
          {variance <= 0
            ? `${formatCurrency(Math.abs(variance))} abaixo do orçamento planejado.`
            : `${formatCurrency(variance)} acima do orçamento planejado.`}
        </div>
      )}
      {hasPlanning && !pricing && (
        <div className="flex items-start gap-2 border-t bg-blue-50/60 px-5 py-3 text-xs text-blue-800">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Os preços de venda são específicos de cada viagem. Selecione uma viagem para comparar as faixas adulto, criança e idoso.</span>
        </div>
      )}
      {!hasActual && plannedTotal > 0 && (
        <div className="border-t px-5 py-3 text-xs text-muted-foreground">
          O realizado será preenchido conforme custos da viagem e despesas da agência forem registrados.
        </div>
      )}
    </section>
  );
}