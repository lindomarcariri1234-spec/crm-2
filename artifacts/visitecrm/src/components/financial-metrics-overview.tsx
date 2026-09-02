import { AlertCircle, ArrowUpRight, Info, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrency } from "@/lib/utils";
import { type FinancialMetricTotals, useFinancialMetrics } from "@/lib/financial-metrics-api";

type MetricCard = {
  key: string;
  label: string;
  href: string;
  value: (totals: FinancialMetricTotals) => number | null;
  detail: string;
  tone?: string;
  suffix?: string;
};

export const financialMetricCards: MetricCard[] = [
  { key: "received", label: "Receita recebida", href: "/financeiro", value: (t) => t.receivedRevenue, detail: "Pagamentos a receber quitados no período, sem duplicar IDs.", tone: "text-emerald-600" },
  { key: "booked", label: "Receita contratada", href: "/reservations", value: (t) => t.bookedRevenue, detail: "Valor líquido de reservas elegíveis criadas no período.", tone: "text-primary" },
  { key: "receivable", label: "A receber", href: "/financeiro", value: (t) => t.receivable, detail: "Parcelas abertas com vencimento no período (pendente, aprovada ou vencida).", tone: "text-blue-600" },
  { key: "overdue", label: "A receber vencido", href: "/financeiro", value: (t) => t.overdueReceivable, detail: "Parcelas a receber ainda abertas com vencimento anterior à atualização do resumo.", tone: "text-amber-600" },
  { key: "user-debt", label: "Dívidas com usuários", href: "/financeiro/commissions", value: (t) => t.userDebt, detail: "Saldo atual de indicação dos usuários mais comissões de vendedor e indicação ainda não pagas.", tone: "text-rose-600" },
  { key: "costs", label: "Custos operacionais pagos", href: "/financeiro/expenses", value: (t) => t.operatingCostsPaid, detail: "Despesas gerais pagas mais custos de viagem pagos no período; fontes semelhantes são sinalizadas, não mescladas por aproximação.", tone: "text-red-600" },
  { key: "commissions", label: "Comissões", href: "/financeiro/commissions", value: (t) => t.sellerCommissions + t.referralCommissions, detail: "Comissões de vendedores e de indicação; campos de comissão da reserva não são somados.", tone: "text-violet-600" },
  { key: "bonuses", label: "Bônus a clientes", href: "/indicacoes", value: (t) => t.clientReferralBonuses, detail: "Bônus de indicação não revertidos pagos no período.", tone: "text-orange-600" },
  { key: "profit", label: "Lucro líquido", href: "/financeiro", value: (t) => t.profit, detail: "Receita recebida menos custos, despesas, comissões e bônus de indicação.", tone: "text-emerald-600" },
  { key: "margin", label: "Margem líquida", href: "/financeiro", value: (t) => t.margin, detail: "Lucro líquido dividido pela receita recebida; é zero quando não há receita recebida.", tone: "text-emerald-600", suffix: "%" },
];

export function hasFinancialMetricData(totals: FinancialMetricTotals): boolean {
  return Object.values(totals).some((value) => typeof value === "number" && value !== 0);
}

function displayMetric(card: MetricCard, totals: FinancialMetricTotals): string {
  const value = card.value(totals);
  if (value === null) return "—";
  return card.suffix ? `${value.toFixed(2)}${card.suffix}` : formatCurrency(value);
}

export function FinancialMetricsOverview() {
  const { data, isLoading, isError, error } = useFinancialMetrics();

  return (
    <section className="rounded-lg border bg-card p-4" data-testid="section-financial-metrics-overview">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">Visão financeira consolidada</h2>
          {data && <p className="mt-1 text-xs text-muted-foreground" data-testid="text-financial-metrics-period">Período: {data.period.label} · Fuso: {data.timezone}</p>}
        </div>
        <Link href="/financeiro" className="inline-flex items-center text-xs font-medium text-primary hover:underline" data-testid="link-financial-metrics-financial">
          Ver financeiro <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
        </Link>
      </div>

      {isLoading ? (
        <div className="flex min-h-24 items-center gap-2 text-sm text-muted-foreground" data-testid="status-financial-metrics-loading">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando indicadores financeiros…
        </div>
      ) : isError ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="status-financial-metrics-error">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error instanceof Error ? error.message : "Não foi possível carregar os indicadores financeiros."}
        </div>
      ) : data && !hasFinancialMetricData(data.totals) ? (
        <p className="py-5 text-sm text-muted-foreground" data-testid="status-financial-metrics-empty">Não há movimentações financeiras elegíveis neste período.</p>
      ) : data ? (
        <TooltipProvider>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {financialMetricCards.map((card) => (
              <Link key={card.key} href={card.href} className="rounded-md border p-3 transition-colors hover:bg-muted/60" data-testid={`link-financial-metric-${card.key}`}>
                <div className="flex items-start justify-between gap-1">
                  <span className="text-xs text-muted-foreground">{card.label}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-help text-muted-foreground" aria-label={`Detalhe de ${card.label}`} data-testid={`tooltip-financial-metric-${card.key}`}>
                        <Info className="h-3.5 w-3.5" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-xs">{card.detail}</TooltipContent>
                  </Tooltip>
                </div>
                <p className={`mt-1 text-lg font-semibold ${card.tone ?? ""}`} data-testid={`text-financial-metric-${card.key}`}>{displayMetric(card, data.totals)}</p>
              </Link>
            ))}
          </div>
        </TooltipProvider>
      ) : null}
    </section>
  );
}