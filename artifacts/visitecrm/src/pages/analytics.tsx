import { useState, useMemo } from "react";
import { localToday } from "@workspace/shared";
import {
  useGetDashboardSummary,
  useGetDashboardRevenueChart,
  useGetPaymentsSummary,
  useListTrips,
  useListReservations,
  useListCommissions,
  useListExpenses,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { GetDashboardRevenueChartPeriod } from "@workspace/api-client-react";
import { Link } from "wouter";
import {
  DollarSign, Users, MapPin, BarChart2, TrendingUp, CalendarCheck,
  Target, Award, ArrowUpRight, ExternalLink,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { EXPENSE_CATEGORY_LABELS } from "@/lib/labels";
import { ACTIVE_RESERVATION_STATUSES, COMMISSION_STATUS, EXPENSE_STATUS, TRIP_STATUS } from "@workspace/permissions";
import { PageHeader } from "@/components/page-header";
import { QueryErrorState } from "@/components/query-error-state";
import { FinancialMetricsOverview } from "@/components/financial-metrics-overview";
import { useFinancialMetrics } from "@/lib/financial-metrics-api";

const fmt = (v: number) => formatCurrency(v);
const fmtCompact = (v: number) => {
  if (v >= 1000000) return `R$ ${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(1)}k`;
  return fmt(v);
};

function KpiCard({ icon: Icon, label, value, sub, color, loading }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color: string; loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-start gap-4">
        <div className={`mt-1 p-2 rounded-md bg-muted ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          {loading ? <Skeleton className="h-8 w-28 mt-1" /> : <p className="text-2xl font-bold">{value}</p>}
          {sub && !loading && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function RevenueLineChart({ data }: { data: Array<{ label: string; revenue: number; expenses: number }> }) {
  const max = Math.max(...data.map(d => Math.max(d.revenue, d.expenses)), 1);
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - (d.revenue / max) * 90;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const expPts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - (d.expenses / max) * 90;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <div className="w-full">
      <svg viewBox="0 0 100 110" className="w-full h-48" preserveAspectRatio="none">
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.0" />
          </linearGradient>
        </defs>
        <polyline points={pts} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <polyline points={expPts} fill="none" stroke="hsl(var(--destructive))" strokeWidth="1.5" strokeDasharray="3,2" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const x = (i / (data.length - 1)) * 100;
          const y = 100 - (d.revenue / max) * 90;
          return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="1.5" fill="hsl(var(--primary))" vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      <div className="flex justify-between mt-1">
        {data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 6)) === 0).map((d, i) => (
          <span key={i} className="text-[10px] text-muted-foreground">{d.label}</span>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-primary inline-block" /> Receita</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-destructive inline-block" style={{ backgroundImage: "repeating-linear-gradient(90deg, currentColor 0, currentColor 4px, transparent 4px, transparent 6px)" }} /> Despesas</span>
      </div>
    </div>
  );
}

function CategoryPieChart({ data }: { data: Array<{ label: string; value: number; color: string }> }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let currentAngle = -90;
  const slices = data.map(d => {
    const angle = (d.value / total) * 360;
    const start = currentAngle;
    currentAngle += angle;
    return { ...d, angle, start };
  });

  const polarToCartesian = (cx: number, cy: number, r: number, angleDeg: number) => {
    const angleRad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
  };

  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 100 100" className="w-32 h-32 shrink-0">
        {slices.map((slice, i) => {
          if (slice.angle < 0.1) return null;
          const startPt = polarToCartesian(50, 50, 40, slice.start);
          const endPt = polarToCartesian(50, 50, 40, slice.start + slice.angle);
          const largeArc = slice.angle > 180 ? 1 : 0;
          const d = `M50,50 L${startPt.x.toFixed(2)},${startPt.y.toFixed(2)} A40,40 0 ${largeArc},1 ${endPt.x.toFixed(2)},${endPt.y.toFixed(2)} Z`;
          return <path key={i} d={d} fill={slice.color} stroke="white" strokeWidth="1" />;
        })}
      </svg>
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: d.color }} />
            <span className="text-muted-foreground">{d.label}</span>
            <span className="font-medium ml-auto pl-4">{((d.value / total) * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SalesFunnel({ data }: { data: Array<{ label: string; count: number; color: string }> }) {
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="space-y-2">
      {data.map((item, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground w-28 shrink-0">{item.label}</span>
          <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden">
            <div
              className="h-6 rounded-full flex items-center justify-end pr-2"
              style={{ width: `${(item.count / max) * 100}%`, backgroundColor: item.color }}
            >
              <span className="text-xs font-medium text-white">{item.count}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const EXPENSE_CATEGORY_COLORS: Record<string, string> = {
  transport: "#3B82F6",
  accommodation: "#8B5CF6",
  food: "#10B981",
  marketing: "#F59E0B",
  administrative: "#6366F1",
  commission: "#EF4444",
  other: "#94A3B8",
};

export default function Analytics() {
  const {
    data: financialMetrics,
    isLoading: financialMetricsLoading,
    isError: financialMetricsError,
    error: financialMetricsQueryError,
    refetch: refetchFinancialMetrics,
  } = useFinancialMetrics();
  const [period, setPeriod] = useState<GetDashboardRevenueChartPeriod>("12m");
  const { data: summary, isLoading, isError: summaryError, error: summaryQueryError, refetch: refetchSummary } = useGetDashboardSummary();
  const { data: chartData, isError: chartError, error: chartQueryError, refetch: refetchChart } = useGetDashboardRevenueChart({ period });
  const { data: paymentSummary, isError: paymentError, error: paymentQueryError, refetch: refetchPayments } = useGetPaymentsSummary();
  const { data: tripsData, isError: tripsError, error: tripsQueryError, refetch: refetchTrips } = useListTrips({ limit: 20, status: TRIP_STATUS.PUBLISHED });
  const { data: reservationsData, isError: reservationsError, error: reservationsQueryError, refetch: refetchReservations } = useListReservations({ limit: 100 });
  const { data: commissionsRaw, isError: commissionsError, error: commissionsQueryError, refetch: refetchCommissions } = useListCommissions();
  const { data: expensesAllData, isError: expensesError, error: expensesQueryError, refetch: refetchExpenses } = useListExpenses({ limit: 500 });
  const commissions = Array.isArray(commissionsRaw) ? commissionsRaw : [];
  const analyticsError = summaryError || chartError || paymentError || tripsError || reservationsError || commissionsError || expensesError || financialMetricsError;
  const analyticsQueryError = summaryQueryError ?? chartQueryError ?? paymentQueryError ?? tripsQueryError ?? reservationsQueryError ?? commissionsQueryError ?? expensesQueryError ?? financialMetricsQueryError;

  const topTrips = useMemo(() => {
    const trips = tripsData?.data ?? [];
    const reservations = reservationsData?.data ?? [];
    return trips
      .map(t => ({
        ...t,
        reservationCount: reservations.filter(r => r.tripId === t.id && ACTIVE_RESERVATION_STATUSES.includes(r.status as typeof ACTIVE_RESERVATION_STATUSES[number])).length,
        revenue: reservations
          .filter(r => r.tripId === t.id && ACTIVE_RESERVATION_STATUSES.includes(r.status as typeof ACTIVE_RESERVATION_STATUSES[number]))
          .reduce((s, r) => s + r.paidValue, 0),
        occupancy: t.totalCapacity > 0 ? ((t.totalCapacity - t.availableSeats) / t.totalCapacity * 100) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [tripsData, reservationsData]);

  const sellersRanking = useMemo(() => {
    const map = new Map<string, { userId: string; total: number; paid: number }>();
    commissions.forEach(c => {
      const entry = map.get(c.userId) ?? { userId: c.userId, total: 0, paid: 0 };
      entry.total += parseFloat(c.commissionAmount);
      if (c.status === COMMISSION_STATUS.PAID) entry.paid += parseFloat(c.commissionAmount);
      map.set(c.userId, entry);
    });
    return Array.from(map.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [commissions]);

  const totalRevenue = chartData?.reduce((s, d) => s + d.revenue, 0) ?? 0;
  const totalExpenses = chartData?.reduce((s, d) => s + d.expenses, 0) ?? 0;
  const avgTicket = (summary?.totalReservations ?? 0) > 0 ? totalRevenue / (summary?.totalReservations ?? 1) : 0;
  const conversionRate = (summary?.openDeals ?? 0) > 0 ? ((summary?.confirmedReservations ?? 0) / (summary?.openDeals ?? 1) * 100) : 0;

  const expenseCategoryData = useMemo(() => {
    const all = expensesAllData?.data ?? [];
    const map: Record<string, number> = {};
    for (const e of all) {
      map[e.category] = (map[e.category] ?? 0) + parseFloat(String(e.amount));
    }
    return Object.entries(map)
      .map(([cat, total]) => ({ category: cat, total }))
      .sort((a, b) => b.total - a.total);
  }, [expensesAllData]);

  const expenseTotalFromList = useMemo(() =>
    (expensesAllData?.data ?? []).reduce((s, e) => s + parseFloat(String(e.amount)), 0),
    [expensesAllData]
  );

  const categoryData = useMemo(() => {
    const trips = tripsData?.data ?? [];
    const countByCategory: Record<string, number> = {};
    trips.forEach(t => {
      countByCategory[t.category] = (countByCategory[t.category] ?? 0) + 1;
    });
    const colors = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444", "#06B6D4"];
    return Object.entries(countByCategory).map(([label, value], i) => ({
      label,
      value,
      color: colors[i % colors.length],
    }));
  }, [tripsData]);

  if (analyticsError) {
    return (
      <QueryErrorState
        resourceLabel="os dados analíticos"
        error={analyticsQueryError}
        onRetry={() => {
          void Promise.all([
            refetchSummary(),
            refetchChart(),
            refetchPayments(),
            refetchTrips(),
            refetchReservations(),
            refetchCommissions(),
            refetchExpenses(),
            refetchFinancialMetrics(),
          ]);
        }}
      />
    );
  }

  const funnelData = [
    { label: "Leads", count: (summary?.openDeals ?? 0) + (summary?.totalReservations ?? 0), color: "#3B82F6" },
    { label: "Neg. Abertas", count: summary?.openDeals ?? 0, color: "#8B5CF6" },
    { label: "Reservas", count: summary?.totalReservations ?? 0, color: "#F59E0B" },
    { label: "Confirmadas", count: summary?.confirmedReservations ?? 0, color: "#10B981" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analíticos"
        description={`Vendido, recebido e a receber · período ${financialMetrics?.period.label ?? "selecionado"} · fonte: núcleo financeiro`}
        actions={
          <>
          <Link href="/analytics/revenue">
            <Button variant="ghost" size="sm">
              <ExternalLink className="w-4 h-4 mr-1.5" /> Analise de Receita
            </Button>
          </Link>
          <Select value={period} onValueChange={v => setPeriod(v as GetDashboardRevenueChartPeriod)}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Últimos 7 dias</SelectItem>
            <SelectItem value="30d">Últimos 30 dias</SelectItem>
            <SelectItem value="90d">Últimos 90 dias</SelectItem>
            <SelectItem value="12m">Últimos 12 meses</SelectItem>
          </SelectContent>
          </Select>
          </>
        }
      />

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <KpiCard icon={DollarSign} label="Recebido no período" value={fmtCompact(financialMetrics?.totals.receivedRevenue ?? 0)} sub={`Pagamentos confirmados · ${financialMetrics?.period.label ?? "período selecionado"} (BRT)`} color="text-green-600" loading={isLoading || financialMetricsLoading} />
        <KpiCard icon={TrendingUp} label="Lucro Líquido" value={fmtCompact(financialMetrics?.totals.profit ?? 0)} sub={`Custos pagos: ${fmtCompact(financialMetrics?.totals.operatingCostsPaid ?? 0)}`} color={(financialMetrics?.totals.profit ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"} loading={isLoading || financialMetricsLoading} />
        <KpiCard icon={CalendarCheck} label="Total de Reservas" value={String(summary?.totalReservations ?? 0)} sub={`${summary?.confirmedReservations ?? 0} confirmadas`} color="text-blue-600" loading={isLoading} />
        <KpiCard icon={Target} label="Vendido no período" value={fmtCompact(financialMetrics?.totals.bookedRevenue ?? 0)} sub={`Total líquido contratado · ${financialMetrics?.period.label ?? "período selecionado"}`} color="text-purple-600" loading={isLoading || financialMetricsLoading} />
        <KpiCard icon={TrendingUp} label="Taxa de Conversao" value={`${conversionRate.toFixed(1)}%`} sub="Reservas / Negocios" color="text-orange-600" loading={isLoading} />
        <KpiCard icon={Users} label="Total de Clientes" value={String(summary?.totalClients ?? 0)} sub={`+${summary?.newClientsThisMonth ?? 0} este mes`} color="text-teal-600" loading={isLoading} />
        <KpiCard icon={MapPin} label="Viagens Ativas" value={String(summary?.activeTrips ?? 0)} sub={`${summary?.occupancyRate?.toFixed(1) ?? 0}% ocupacao media`} color="text-indigo-600" loading={isLoading} />
        <KpiCard icon={BarChart2} label="A receber no período" value={fmtCompact(financialMetrics?.totals.receivable ?? 0)} sub={`Recebíveis com vencimento no período · vencido: ${fmtCompact(financialMetrics?.totals.overdueReceivable ?? 0)}`} color="text-blue-600" loading={isLoading || financialMetricsLoading} />
      </div>

      <FinancialMetricsOverview />

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Visao Geral</TabsTrigger>
          <TabsTrigger value="trips">Top Viagens</TabsTrigger>
          <TabsTrigger value="sellers">Ranking Vendedores</TabsTrigger>
          <TabsTrigger value="funnel">Funil de Vendas</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" /> Evolução de valor vendido
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!chartData?.length ? (
                  <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">Sem dados disponíveis</div>
                ) : (
                  <RevenueLineChart data={chartData} />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Vendas por Categoria</CardTitle>
              </CardHeader>
              <CardContent>
                {categoryData.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-muted-foreground text-sm">Sem dados</div>
                ) : (
                  <CategoryPieChart data={categoryData} />
                )}
              </CardContent>
            </Card>
          </div>

          {expenseCategoryData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart2 className="w-4 h-4" /> Despesas por Categoria
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {expenseCategoryData.map(d => {
                    const maxVal = expenseCategoryData[0]?.total ?? 1;
                    const pct = (d.total / maxVal) * 100;
                    return (
                      <div key={d.category} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-28 shrink-0">{EXPENSE_CATEGORY_LABELS[d.category] ?? d.category}</span>
                        <div className="flex-1 bg-muted rounded-full h-2.5">
                          <div className="h-2.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: EXPENSE_CATEGORY_COLORS[d.category] ?? "#94A3B8" }} />
                        </div>
                        <span className="text-xs font-semibold w-28 text-right">{fmt(d.total)}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 pt-3 border-t flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Total dos lançamentos exibidos</span>
                  <span className="font-bold text-red-600">{fmt(expenseTotalFromList)}</span>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Resumo Financeiro</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">A Receber</span>
                  <span className="font-semibold text-green-600">{fmt(financialMetrics?.totals.receivable ?? 0)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">A Pagar</span>
                  <span className="font-semibold text-red-600">{fmt(financialMetrics?.totals.payable ?? 0)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Recebido no Mes</span>
                  <span className="font-semibold">{fmt(financialMetrics?.totals.receivedRevenue ?? 0)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Vencidos (Receber)</span>
                  <span className="font-semibold text-yellow-600">{fmt(financialMetrics?.totals.overdueReceivable ?? 0)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b">
                  <span className="text-sm text-muted-foreground">Despesas Pagas (Mês)</span>
                  <span className="font-semibold text-red-500">{fmt(financialMetrics?.totals.operatingCostsPaid ?? 0)}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-sm font-medium">Resultado Líquido</span>
                  <span className={`font-bold text-base ${(financialMetrics?.totals.profit ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {(financialMetrics?.totals.profit ?? 0) >= 0 ? "+" : ""}{fmt(financialMetrics?.totals.profit ?? 0)}
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">NPS e Satisfacao</CardTitle>
              </CardHeader>
              <CardContent>
                {summary?.averageNps != null ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-4xl font-bold">{Number(summary.averageNps).toFixed(1)}</p>
                      <p className={`text-sm font-medium mt-1 ${
                        Number(summary.averageNps) >= 70 ? "text-green-600" :
                        Number(summary.averageNps) >= 50 ? "text-yellow-600" : "text-red-600"
                      }`}>
                        {Number(summary.averageNps) >= 70 ? "Excelente" : Number(summary.averageNps) >= 50 ? "Bom" : "A melhorar"}
                      </p>
                    </div>
                    <div className="w-full bg-muted rounded-full h-3">
                      <div
                        className={`h-3 rounded-full ${Number(summary.averageNps) >= 70 ? "bg-green-500" : Number(summary.averageNps) >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                        style={{ width: `${Math.min(Number(summary.averageNps), 100)}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Escala: 0 a 100 pontos</p>
                  </div>
                ) : (
                  <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">
                    Nenhuma avaliacao registrada ainda
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="trips" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Award className="w-4 h-4" /> Top 10 Viagens por Receita
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Viagem</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead>Reservas</TableHead>
                    <TableHead>Ocupacao</TableHead>
                    <TableHead>Receita</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topTrips.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sem dados disponíveis.</TableCell></TableRow>
                  ) : topTrips.map((t, i) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium text-sm">{t.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.destination}</TableCell>
                      <TableCell className="text-sm">{t.reservationCount}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-muted rounded-full h-1.5 max-w-[80px]">
                            <div className="bg-primary h-1.5 rounded-full" style={{ width: `${Math.min(t.occupancy, 100)}%` }} />
                          </div>
                          <span className="text-xs">{t.occupancy.toFixed(0)}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-semibold text-sm">{fmt(t.revenue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sellers" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart2 className="w-4 h-4" /> Ranking de Vendedores por Comissoes
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sellersRanking.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">
                  Nenhuma comissao registrada ainda.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Vendedor</TableHead>
                      <TableHead>Total Comissoes</TableHead>
                      <TableHead>Pagas</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sellersRanking.map((seller, i) => (
                      <TableRow key={seller.userId}>
                        <TableCell>
                          <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted font-bold text-xs">
                            {i + 1}
                          </div>
                        </TableCell>
                        <TableCell className="font-medium text-sm">{seller.userId.slice(0, 8)}...</TableCell>
                        <TableCell className="font-semibold">{fmt(seller.total)}</TableCell>
                        <TableCell className="text-green-600">{fmt(seller.paid)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-muted rounded-full h-1.5 max-w-[80px]">
                              <div
                                className="bg-green-500 h-1.5 rounded-full"
                                style={{ width: `${seller.total > 0 ? (seller.paid / seller.total) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {seller.total > 0 ? ((seller.paid / seller.total) * 100).toFixed(0) : 0}%
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="funnel" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Funil de Vendas</CardTitle>
              </CardHeader>
              <CardContent>
                <SalesFunnel data={funnelData} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Metricas de Conversao</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: "Leads para Negocios", value: `${Math.min(100, ((summary?.openDeals ?? 0) / Math.max((summary?.openDeals ?? 0) + (summary?.totalReservations ?? 0), 1) * 100)).toFixed(1)}%`, color: "bg-blue-500" },
                  { label: "Negocios para Reservas", value: `${Math.min(100, ((summary?.totalReservations ?? 0) / Math.max(summary?.openDeals ?? 1, 1) * 100)).toFixed(1)}%`, color: "bg-purple-500" },
                  { label: "Reservas Confirmadas", value: `${Math.min(100, ((summary?.confirmedReservations ?? 0) / Math.max(summary?.totalReservations ?? 1, 1) * 100)).toFixed(1)}%`, color: "bg-green-500" },
                  { label: "Taxa de Ocupacao Media", value: `${Number(summary?.occupancyRate ?? 0).toFixed(1)}%`, color: "bg-orange-500" },
                ].map((item, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-muted-foreground">{item.label}</span>
                      <span className="font-semibold">{item.value}</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div className={`${item.color} h-2 rounded-full`} style={{ width: item.value }} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
