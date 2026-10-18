import React from "react";
import {
  BarChart as RechartsBarChart,
  Bar as RechartsBar,
  CartesianGrid,
  XAxis as RechartsXAxis,
  YAxis as RechartsYAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import type { BarProps, XAxisProps, YAxisProps, TooltipProps } from "recharts";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Compass,
  Eye,
  Layers3,
  PackageOpen,
  Search,
  ShoppingBag,
  TriangleAlert,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export type StorefrontAnalyticsSummary = {
  pageViews: {
    total: number;
    previousTotal: number;
    byDay: Array<{
      date: string;
      home: number;
      catalog: number;
      product: number;
      checkout: number;
      other: number;
    }>;
    byType: Array<{ pageType: string; count: number }>;
  };
  topProducts: Array<{ name: string; views: number; group: "travel" | "other" | "unknown" }>;
  groups: Array<{
    group: "travel" | "other" | "all" | "unknown";
    selections: number;
    productOpens: number;
    searches: number;
    checkoutStarts: number;
  }>;
  totals: { productOpens: number; searches: number; checkoutStarts: number };
};

export interface StorefrontAnalyticsSectionProps {
  data?: StorefrontAnalyticsSummary;
  loading: boolean;
  error: boolean;
  periodDays: 7 | 30 | 90;
  onRetry: () => void;
}

type ChartValue = number | string | (number | string)[];
type ChartName = number | string;
const BarChart = RechartsBarChart as unknown as React.ComponentType<React.ComponentProps<typeof RechartsBarChart>>;
const Bar = RechartsBar as unknown as React.ComponentType<BarProps>;
const XAxis = RechartsXAxis as unknown as React.ComponentType<XAxisProps>;
const YAxis = RechartsYAxis as unknown as React.ComponentType<YAxisProps>;
const Tooltip = RechartsTooltip as unknown as React.ComponentType<TooltipProps<ChartValue, ChartName>>;

const numberFormat = new Intl.NumberFormat("pt-BR");
const pageLabels: Record<string, string> = {
  home: "Início",
  catalog: "Catálogo",
  product: "Produto",
  checkout: "Checkout",
  other: "Outras páginas",
};
const pageColors: Record<string, string> = {
  home: "#247c75",
  catalog: "#79aaa0",
  product: "#d4a750",
  checkout: "#bd7658",
  other: "#b8c7c1",
};
const groupLabels: Record<StorefrontAnalyticsSummary["groups"][number]["group"], string> = {
  travel: "Viagens",
  other: "Outros produtos",
  all: "Todos os grupos",
  unknown: "Não identificado",
};

function pageTypeLabel(pageType: string) {
  return pageLabels[pageType] ?? "Outras páginas";
}

function safeCount(value: number | undefined) {
  return numberFormat.format(Number.isFinite(value) ? Math.max(0, value ?? 0) : 0);
}

function shortDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

function percentChange(current: number, previous: number) {
  if (previous === 0) return current > 0 ? null : 0;
  return ((current - previous) / previous) * 100;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  detail: string;
  accent: string;
}) {
  return (
    <Card className="overflow-hidden border-border/70 shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.11em] text-muted-foreground">{label}</p>
            <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-foreground tabular-nums sm:text-[1.8rem]">
              {safeCount(value)}
            </p>
          </div>
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${accent}`}>
            <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-5" role="status" aria-live="polite" aria-label="Carregando análise da vitrine">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="border-border/70">
            <CardContent className="space-y-3 p-5">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-3 w-36" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Card><CardContent className="p-5"><Skeleton className="mb-5 h-5 w-48" /><Skeleton className="h-[250px] w-full" /></CardContent></Card>
        <Card><CardContent className="p-5"><Skeleton className="mb-5 h-5 w-40" /><Skeleton className="h-[250px] w-full" /></CardContent></Card>
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="border-rose-200 bg-rose-50/60">
      <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-700">
            <TriangleAlert className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="font-semibold text-rose-950">Não foi possível carregar os dados da vitrine</p>
            <p className="mt-1 text-sm text-rose-800">Tente novamente. Nenhuma informação de visitante individual é exibida aqui.</p>
          </div>
        </div>
        <Button onClick={onRetry} variant="outline" className="border-rose-300 bg-white text-rose-900 hover:bg-rose-100">
          Tentar novamente
        </Button>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <Card className="border-dashed border-border bg-card/70">
      <CardContent className="flex min-h-[240px] flex-col items-center justify-center px-6 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[#e6f0ec] text-[#367b70]">
          <Compass className="h-7 w-7" aria-hidden="true" />
        </span>
        <h3 className="mt-4 text-base font-semibold">Sua vitrine ainda está sem atividade</h3>
        <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground">
          Quando páginas forem visualizadas, buscas realizadas ou produtos abertos, os sinais agregados aparecerão aqui.
        </p>
      </CardContent>
    </Card>
  );
}

function GroupFunnel({ groups }: { groups: StorefrontAnalyticsSummary["groups"] }) {
  const displayGroups = groups.filter((item) => item.group !== "all");
  const max = Math.max(1, ...displayGroups.flatMap((item) => [item.selections, item.productOpens, item.searches, item.checkoutStarts]));
  const columns = [
    { key: "selections" as const, label: "Seleções", color: "#8caea3" },
    { key: "productOpens" as const, label: "Aberturas de produto", color: "#d4a750" },
    { key: "searches" as const, label: "Buscas", color: "#6f9e96" },
    { key: "checkoutStarts" as const, label: "Inícios de checkout", color: "#bd7658" },
  ];

  if (!displayGroups.length) {
    return <div className="flex h-44 items-center justify-center text-center text-sm text-muted-foreground">Sem atividade de grupos neste período.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="hidden grid-cols-[minmax(115px,1fr)_repeat(4,minmax(60px,1fr))] gap-3 border-b border-border/70 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
        <span>Grupo</span>
        {columns.map((column) => <span key={column.key} className="text-right">{column.label}</span>)}
      </div>
      {displayGroups.map((group) => (
        <div key={group.group} className="space-y-2">
          <div className="grid grid-cols-2 items-center gap-x-3 gap-y-2 sm:grid-cols-[minmax(115px,1fr)_repeat(4,minmax(60px,1fr))]">
            <span className="col-span-2 truncate text-sm font-semibold sm:col-span-1">{groupLabels[group.group]}</span>
            {columns.map((column) => (
              <div key={column.key} className="flex min-w-0 items-center justify-between gap-2 sm:justify-end">
                <span className="truncate text-[11px] text-muted-foreground sm:hidden">{column.label}</span>
                <span className="font-mono text-sm font-medium tabular-nums">{safeCount(group[column.key])}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-1.5" aria-hidden="true">
            {columns.map((column) => (
              <div key={column.key} className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(group[column.key] > 0 ? 4 : 0, (group[column.key] / max) * 100)}%`, backgroundColor: column.color }} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
        Eventos agregados por grupo. A sequência não representa pessoas únicas nem uma taxa individual de conversão.
      </p>
    </div>
  );
}

export function StorefrontAnalyticsSection({
  data,
  loading,
  error,
  periodDays,
  onRetry,
}: StorefrontAnalyticsSectionProps) {
  if (loading) return <LoadingState />;
  if (error) return <ErrorState onRetry={onRetry} />;
  if (!data) return <EmptyState />;

  const pageViews = data.pageViews ?? { total: 0, previousTotal: 0, byDay: [], byType: [] };
  const totals = data.totals ?? { productOpens: 0, searches: 0, checkoutStarts: 0 };
  const byDay = pageViews.byDay ?? [];
  const pageTypes = pageViews.byType ?? [];
  const products = data.topProducts ?? [];
  const allZero = pageViews.total === 0 && pageViews.previousTotal === 0 && totals.productOpens === 0 && totals.searches === 0 && totals.checkoutStarts === 0 &&
    byDay.every((day) => day.home + day.catalog + day.product + day.checkout + day.other === 0) &&
    products.every((product) => product.views === 0) &&
    pageTypes.every((item) => item.count === 0) &&
    (data.groups ?? []).every((group) => group.selections === 0 && group.productOpens === 0 && group.searches === 0 && group.checkoutStarts === 0);
  if (allZero) return <EmptyState />;

  const change = percentChange(pageViews.total, pageViews.previousTotal);
  const periodLabel = `últimos ${periodDays} dias`;
  const chartData = byDay.map((day) => ({
    ...day,
    label: shortDate(day.date),
  }));
  const totalByType = pageTypes.reduce((sum, item) => sum + item.count, 0);
  const sortedPageTypes = [...pageTypes].sort((a, b) => b.count - a.count);
  const topPageType = sortedPageTypes[0];

  return (
    <section className="space-y-5" aria-label="Análise de comportamento da vitrine">
      <div className="flex flex-col gap-2 border-l-[3px] border-[#367b70] pl-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#367b70]">Vitrine pública · comportamento agregado</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">O que chama atenção na sua vitrine</h2>
          <p className="mt-1 text-sm text-muted-foreground">Leitura anônima de navegação, interesse e intenção — sem identificar visitantes.</p>
        </div>
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
          <Activity className="h-3.5 w-3.5 text-[#367b70]" aria-hidden="true" />
          Período: {periodLabel}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="overflow-hidden border-[#b9d0c8] bg-[#f0f6f2] shadow-sm sm:col-span-2 xl:col-span-1">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.11em] text-[#50756d]">Visualizações de página</p>
                <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-[#244d46] tabular-nums sm:text-[1.8rem]">{safeCount(pageViews.total)}</p>
              </div>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#dcebe4] text-[#367b70]">
                <Eye className="h-[18px] w-[18px]" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-2 flex items-center gap-1 text-xs text-[#50756d]">
              {change === null ? (
                <>Sem base no período anterior</>
              ) : (
                <>
                  {change >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden="true" />}
                  {Math.abs(change).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. período anterior
                </>
              )}
            </p>
          </CardContent>
        </Card>
        <MetricCard icon={PackageOpen} label="Aberturas de produto" value={totals.productOpens} detail={`Eventos no período de ${periodDays} dias`} accent="bg-[#f6edd9] text-[#9a7125]" />
        <MetricCard icon={Search} label="Buscas realizadas" value={totals.searches} detail="Volume agregado; termos de busca não são exibidos" accent="bg-[#e4efed] text-[#367b70]" />
        <MetricCard icon={ShoppingBag} label="Inícios de checkout" value={totals.checkoutStarts} detail="Inícios registrados, não compras concluídas" accent="bg-[#f4e7df] text-[#a86242]" />
      </div>

      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(310px,0.9fr)]">
        <Card className="min-w-0 border-border/70 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">Ritmo de navegação</CardTitle>
                <CardDescription className="mt-1">Visualizações diárias por tipo de página · {periodLabel}</CardDescription>
              </div>
              <span className="rounded-lg bg-[#edf3ef] px-2.5 py-1.5 font-mono text-xs font-medium text-[#416a60] tabular-nums">
                {safeCount(pageViews.total)} no período
              </span>
            </div>
          </CardHeader>
          <CardContent className="pt-3">
            {chartData.length ? (
              <>
                <div className="h-[230px] min-w-0 sm:h-[270px]" role="img" aria-label={`Gráfico de visualizações de página nos últimos ${periodDays} dias`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }} barGap={1}>
                      <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e7ece8" />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#788982" }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={22} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#788982" }} axisLine={false} tickLine={false} />
                      <Tooltip
                        cursor={{ fill: "#edf3ef", opacity: 0.65 }}
                        contentStyle={{ borderRadius: 10, border: "1px solid #dce5df", fontSize: 12, boxShadow: "0 8px 24px rgba(34,66,55,.09)" }}
                        labelStyle={{ color: "#344c42", fontWeight: 600, marginBottom: 4 }}
                        formatter={(value: number, name: string) => [safeCount(value), pageLabels[name] ?? name]}
                      />
                      <Bar dataKey="home" name="home" stackId="pageviews" fill={pageColors.home} maxBarSize={22} />
                      <Bar dataKey="catalog" name="catalog" stackId="pageviews" fill={pageColors.catalog} maxBarSize={22} />
                      <Bar dataKey="product" name="product" stackId="pageviews" fill={pageColors.product} maxBarSize={22} />
                      <Bar dataKey="checkout" name="checkout" stackId="pageviews" fill={pageColors.checkout} maxBarSize={22} />
                      <Bar dataKey="other" name="other" stackId="pageviews" fill={pageColors.other} radius={[3, 3, 0, 0]} maxBarSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-border/60 pt-3">
                  {Object.entries(pageLabels).map(([key, label]) => (
                    <span key={key} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: pageColors[key] }} />
                      {label}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-[250px] flex-col items-center justify-center text-center">
                <Activity className="h-8 w-8 text-[#8caea3]" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">Sem série diária disponível</p>
                <p className="mt-1 text-xs text-muted-foreground">Os totais do período continuam disponíveis acima.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Páginas mais acessadas</CardTitle>
            <CardDescription className="mt-1">Distribuição no período selecionado</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-3">
            {sortedPageTypes.length ? sortedPageTypes.slice(0, 6).map((item) => {
              const label = pageTypeLabel(item.pageType);
              const share = totalByType > 0 ? (item.count / totalByType) * 100 : 0;
              return (
                <div key={item.pageType}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate font-medium">{label}</span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{safeCount(item.count)} <span className="text-muted-foreground/70">· {share.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span></span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#edf1ee]">
                    <div className="h-full rounded-full bg-[#508b7e]" style={{ width: `${Math.min(100, Math.max(item.count > 0 ? 1.5 : 0, share))}%` }} />
                  </div>
                </div>
              );
            }) : (
              <div className="flex h-40 items-center justify-center text-center text-sm text-muted-foreground">Sem detalhamento por tipo de página.</div>
            )}
            {topPageType && (
              <div className="mt-2 rounded-xl bg-[#f0f5f1] p-3.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#50756d]">Maior atenção</p>
                <p className="mt-1 text-sm font-semibold text-[#294e45]">{pageTypeLabel(topPageType.pageType)}</p>
                <p className="mt-1 text-xs leading-relaxed text-[#627970]">
                  {topPageType.count > 0 && totalByType > 0
                    ? `${(topPageType.count / totalByType * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% das visualizações detalhadas.`
                    : "Ainda sem visualizações detalhadas."}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-2">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f6edd9] text-[#9a7125]"><Layers3 className="h-4 w-4" aria-hidden="true" /></span>
              <div>
                <CardTitle className="text-base">Interesse por grupo</CardTitle>
                <CardDescription className="mt-1">Seleções, aberturas, buscas e inícios de checkout · {periodLabel}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <GroupFunnel groups={data.groups ?? []} />
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Produtos em destaque</CardTitle>
            <CardDescription className="mt-1">Ranking por visualizações totais registradas</CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            {products.length ? (
              <div className="divide-y divide-border/60">
                {products.slice(0, 6).map((product, index) => (
                  <div key={`${product.name}-${index}`} className="flex items-center gap-3 py-3 first:pt-1 last:pb-1">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f2f4f1] font-mono text-xs font-semibold text-[#6b8076] tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={product.name}>{product.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{product.group === "travel" ? "Viagens" : "Outros produtos"}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono text-sm font-semibold tabular-nums">{safeCount(product.views)}</p>
                      <p className="text-[10px] text-muted-foreground">visualizações</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[190px] flex-col items-center justify-center text-center">
                <PackageOpen className="h-8 w-8 text-[#8caea3]" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">Nenhum produto em destaque</p>
                <p className="mt-1 text-xs text-muted-foreground">O ranking aparecerá conforme houver visualizações.</p>
              </div>
            )}
            <p className="mt-4 border-t border-border/60 pt-3 text-[11px] leading-relaxed text-muted-foreground">
              Totais de visualizações de produto acumulados; este ranking não acompanha o filtro de período.
            </p>
          </CardContent>
        </Card>
      </div>

      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        Dados apresentados em volume agregado. Visualizações, buscas, aberturas e inícios de checkout são eventos — não representam visitantes únicos, pessoas identificadas ou conversões individuais.
      </p>
    </section>
  );
}

export default StorefrontAnalyticsSection;
