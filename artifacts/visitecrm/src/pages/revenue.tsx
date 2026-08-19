import { useState, useMemo, useEffect } from "react";
import { localToday } from "@workspace/shared";
import { useLocation, useSearch } from "wouter";
import {
  useGetDashboardRevenueChart,
  useGetPaymentsSummary,
  useListPayments,
  useListTrips,
  useListReservations,
  useListCommissions,
  useListUsers,
  useGetDashboardSummary,
} from "@workspace/api-client-react";
import type { GetDashboardRevenueChartPeriod } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingUp, DollarSign, ArrowUpRight, ArrowDownRight, BarChart2, Target,
  Users, CalendarCheck, Repeat, UserPlus, BarChart, Filter,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { ROLES, RESERVATION_STATUS, PAYMENT_STATUS, PAYMENT_TYPE, COMMISSION_STATUS } from "@workspace/permissions";

const fmt = (v: number) => formatCurrency(v);
const fmtCompact = (v: number) => {
  if (v >= 1000000) return `R$ ${(v / 1000000).toFixed(1)}M`;
  if (v >= 1000) return `R$ ${(v / 1000).toFixed(1)}k`;
  return fmt(v);
};

function KpiCard({ icon: Icon, label, value, sub, color, loading }: { icon: React.ElementType; label: string; value: string; sub?: string; color: string; loading?: boolean }) {
  return (
    <Card>
      <CardContent className="p-5 flex items-start gap-3">
        <div className={`mt-1 p-2 rounded-md bg-muted ${color}`}><Icon className="w-5 h-5" /></div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          {loading ? <Skeleton className="h-8 w-28 mt-1" /> : <p className="text-2xl font-bold truncate">{value}</p>}
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function RevenueLineChart({ data, goal }: { data: Array<{ label: string; revenue: number; expenses: number }>; goal?: number }) {
  const max = Math.max(...data.map(d => Math.max(d.revenue, d.expenses, goal ?? 0)), 1);
  const h = 180;
  const w = 100 / data.length;
  const points = data.map((d, i) => ({ x: i * w + w / 2, y: h - (d.revenue / max) * h }));
  const expPoints = data.map((d, i) => ({ x: i * w + w / 2, y: h - (d.expenses / max) * h }));
  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 100 ${h + 10}`} className="w-full" style={{ height: "200px" }} preserveAspectRatio="none">
        {goal && (
          <line x1="0" y1={(h - (goal / max) * h).toFixed(1)} x2="100" y2={(h - (goal / max) * h).toFixed(1)} stroke="#F59E0B" strokeWidth="0.5" strokeDasharray="2,1" />
        )}
        <path d={toPath(points)} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" />
        <path d={toPath(expPoints)} fill="none" stroke="hsl(var(--destructive))" strokeWidth="1" strokeDasharray="3,1.5" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="1.5" fill="hsl(var(--primary))" />
        ))}
      </svg>
      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-primary inline-block" /> Receita</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-destructive inline-block rounded" style={{ borderTop: "1px dashed" }} /> Despesas</span>
        {goal && <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-amber-500 inline-block" style={{ borderTop: "1px dashed" }} /> Meta</span>}
      </div>
      <div className="flex items-center gap-1 mt-2 overflow-x-auto">
        {data.map((d, i) => (
          <span key={i} className="text-[9px] text-muted-foreground flex-1 text-center shrink-0 min-w-0 truncate">{d.label}</span>
        ))}
      </div>
    </div>
  );
}

function CategoryPieChart({ data }: { data: Array<{ label: string; value: number; color: string }> }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  let offset = 0;
  const slices = data.map(d => {
    const pct = total > 0 ? d.value / total : 0;
    const slice = { ...d, pct, offset };
    offset += pct * 360;
    return slice;
  });
  const polarToXY = (deg: number, r: number) => ({
    x: 50 + r * Math.cos((deg - 90) * Math.PI / 180),
    y: 50 + r * Math.sin((deg - 90) * Math.PI / 180),
  });
  return (
    <div className="flex items-center gap-6">
      <svg viewBox="0 0 100 100" className="w-28 h-28 shrink-0">
        {slices.map((s, i) => {
          const deg = s.pct * 360;
          if (deg < 0.1) return null;
          const start = polarToXY(s.offset, 40);
          const end = polarToXY(s.offset + deg, 40);
          const largeArc = deg > 180 ? 1 : 0;
          return (
            <path
              key={i}
              d={`M 50 50 L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A 40 40 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`}
              fill={s.color}
              opacity="0.85"
            />
          );
        })}
        <circle cx="50" cy="50" r="22" fill="white" className="fill-card" />
      </svg>
      <div className="space-y-1.5 flex-1 min-w-0">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-xs text-muted-foreground flex-1 truncate">{s.label}</span>
            <span className="text-xs font-medium">{(s.pct * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HeatmapChart({ data }: { data: Record<string, Record<string, number>> }) {
  const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}h`);
  const allVals = days.flatMap(d => hours.map(h => data[d]?.[h] ?? 0));
  const max = Math.max(...allVals, 1);
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        <div className="flex flex-col gap-1">
          <div className="h-5" />
          {days.map(d => <div key={d} className="h-5 flex items-center text-xs text-muted-foreground w-8 text-right pr-1">{d}</div>)}
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            {hours.map(h => <div key={h} className="w-5 h-5 flex items-end justify-center text-[8px] text-muted-foreground">{h.replace("h", "")}</div>)}
          </div>
          {days.map(d => (
            <div key={d} className="flex gap-1">
              {hours.map(h => {
                const v = data[d]?.[h] ?? 0;
                const intensity = max > 0 ? v / max : 0;
                return (
                  <div
                    key={h}
                    className="w-5 h-5 rounded-sm"
                    style={{ backgroundColor: intensity > 0 ? `rgba(59,130,246,${0.1 + intensity * 0.9})` : "hsl(var(--muted))" }}
                    title={`${d} ${h}: ${v} reservas`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SalesFunnel({ stages }: { stages: Array<{ label: string; value: number; color: string }> }) {
  const max = Math.max(...stages.map(s => s.value), 1);
  return (
    <div className="space-y-2">
      {stages.map((stage, i) => {
        const pct = (stage.value / max) * 100;
        const conversion = i > 0 && stages[i - 1].value > 0 ? ((stage.value / stages[i - 1].value) * 100).toFixed(1) : null;
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-28 shrink-0">{stage.label}</span>
            <div className="flex-1">
              <div className="bg-muted rounded h-7 relative overflow-hidden">
                <div className="h-7 rounded flex items-center pl-3" style={{ width: `${pct}%`, backgroundColor: stage.color, minWidth: "40px" }}>
                  <span className="text-white text-xs font-semibold truncate">{stage.value.toLocaleString("pt-BR")}</span>
                </div>
              </div>
            </div>
            {conversion && (
              <span className="text-xs text-muted-foreground w-14 text-right">{conversion}% conv.</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function BarChartHoriz({ data, valueKey, labelKey, colorFn }: {
  data: Array<Record<string, string | number>>;
  valueKey: string;
  labelKey: string;
  colorFn?: (i: number) => string;
}) {
  const max = Math.max(...data.map(d => Number(d[valueKey])), 1);
  const COLORS = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444", "#6366F1", "#14B8A6", "#F97316"];
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => {
        const pct = (Number(d[valueKey]) / max) * 100;
        const color = colorFn ? colorFn(i) : COLORS[i % COLORS.length];
        return (
          <div key={i} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground truncate w-28 shrink-0">{String(d[labelKey])}</span>
            <div className="flex-1 bg-muted rounded-full h-2">
              <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
            <span className="text-xs font-medium w-20 text-right">{fmtCompact(Number(d[valueKey]))}</span>
          </div>
        );
      })}
    </div>
  );
}

const PAYMENT_METHOD_COLORS: Record<string, string> = {
  pix: "#10B981", credit_card: "#8B5CF6", debit_card: "#6366F1", bank_transfer: "#3B82F6", cash: "#F59E0B", boleto: "#EF4444",
};

const VALID_REVENUE_TABS = ["charts", "funnel", "sellers", "heatmap", "trips"];

export default function Revenue() {
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(searchStr).get("tab");
    return VALID_REVENUE_TABS.includes(t ?? "") ? t! : "charts";
  });

  useEffect(() => {
    const t = new URLSearchParams(searchStr).get("tab");
    if (t && VALID_REVENUE_TABS.includes(t)) setTab(t);
  }, [searchStr]);

  function handleTabChange(value: string) {
    setTab(value);
  }

  const [period, setPeriod] = useState<GetDashboardRevenueChartPeriod>(() => {
    const p = new URLSearchParams(searchStr).get("period");
    return (["7d", "30d", "90d", "12m"].includes(p ?? "") ? p : "12m") as GetDashboardRevenueChartPeriod;
  });
  const [dateFrom, setDateFrom] = useState(() => new URLSearchParams(searchStr).get("dateFrom") ?? "");
  const [dateTo, setDateTo] = useState(() => new URLSearchParams(searchStr).get("dateTo") ?? "");
  const [showFilters, setShowFilters] = useState(false);
  const [filterStatus, setFilterStatus] = useState(() => new URLSearchParams(searchStr).get("status") ?? "");
  const [filterSeller, setFilterSeller] = useState(() => new URLSearchParams(searchStr).get("seller") ?? "");
  const [filterPaymentMethod, setFilterPaymentMethod] = useState(() => new URLSearchParams(searchStr).get("method") ?? "");

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("tab", tab);
    if (period !== "12m") params.set("period", period);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (filterStatus) params.set("status", filterStatus);
    if (filterSeller) params.set("seller", filterSeller);
    if (filterPaymentMethod) params.set("method", filterPaymentMethod);
    navigate(`?${params.toString()}`, { replace: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, period, dateFrom, dateTo, filterStatus, filterSeller, filterPaymentMethod]);

  const { data: chartData, isLoading: loadingChart } = useGetDashboardRevenueChart({ period });
  const { data: paymentSummary } = useGetPaymentsSummary();
  const { data: paymentsData } = useListPayments({ type: PAYMENT_TYPE.RECEIVABLE, status: PAYMENT_STATUS.PAID, limit: 500 });
  const { data: tripsData } = useListTrips({ limit: 50 });
  const { data: reservationsData } = useListReservations({ limit: 500 });
  const { data: commissionsRaw } = useListCommissions();
  const { data: usersRaw } = useListUsers();
  const { data: summary } = useGetDashboardSummary();

  const filteredChart = useMemo(() => {
    if (!chartData || chartData.length === 0) return [];
    if (!dateFrom && !dateTo) return chartData;
    const now = new Date();
    const [brYear, brMonth1] = localToday().split("-").map(Number);
    const n = chartData.length;
    return chartData.filter((_, idx) => {
      let pointDate: Date;
      if (period === "12m") {
        // Derive point month from Brazil calendar so filter boundary is correct at night
        pointDate = new Date(brYear, brMonth1 - 1 - (n - 1 - idx), 1);
      } else {
        const daysBack = period === "7d" ? 7 : period === "90d" ? 90 : 30;
        const msPerPoint = (daysBack * 86400000) / n;
        pointDate = new Date(now.getTime() - (n - 1 - idx) * msPerPoint);
      }
      // For 12m, the key is "YYYY-MM-01"; avoid toISOString() which would be UTC
      const pointISO = period === "12m"
        ? `${pointDate.getFullYear()}-${String(pointDate.getMonth() + 1).padStart(2, "0")}-01`
        : new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(pointDate);
      if (dateFrom && pointISO < dateFrom) return false;
      if (dateTo && pointISO > dateTo) return false;
      return true;
    });
  }, [chartData, dateFrom, dateTo, period]);

  const totalRevenue = filteredChart.reduce((s, d) => s + d.revenue, 0);
  const totalExpenses = filteredChart.reduce((s, d) => s + d.expenses, 0);
  const goalRevenue = totalRevenue * 1.2;

  const reservations = reservationsData?.data ?? [];
  const confirmedReservations = reservations.filter(r => r.status === RESERVATION_STATUS.CONFIRMED || r.status === RESERVATION_STATUS.COMPLETED);
  const avgTicket = confirmedReservations.length > 0 ? confirmedReservations.reduce((s, r) => s + r.totalValue, 0) / confirmedReservations.length : 0;
  const conversionRate = (summary?.totalReservations ?? 0) > 0 && (summary?.totalClients ?? 0) > 0
    ? (((summary?.confirmedReservations ?? 0) / (summary?.totalReservations ?? 1)) * 100) : 0;
  const newClients = summary?.newClientsThisMonth ?? 0;
  const recurringClients = Math.max(0, (summary?.totalClients ?? 0) - newClients);

  const reservationSellerMap = useMemo(() => {
    const commissions = Array.isArray(commissionsRaw) ? commissionsRaw : [];
    const map: Record<string, string> = {};
    for (const c of commissions) {
      if (c.reservationId) map[c.reservationId] = c.userId;
    }
    return map;
  }, [commissionsRaw]);

  const filteredReservations = useMemo(() => {
    let items = reservations;
    if (filterStatus) items = items.filter(r => r.status === filterStatus);
    if (filterPaymentMethod) items = items.filter(r => r.paymentMethod === filterPaymentMethod);
    if (filterSeller) items = items.filter(r => reservationSellerMap[r.id] === filterSeller);
    return items;
  }, [reservations, filterStatus, filterPaymentMethod, filterSeller, reservationSellerMap]);

  const paymentMethodTotals = useMemo(() => {
    const payments = paymentsData?.data ?? [];
    const map: Record<string, number> = {};
    for (const p of payments) {
      if (!p.paymentMethod) continue;
      map[p.paymentMethod] = (map[p.paymentMethod] ?? 0) + parseFloat(String(p.amount));
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([method, amount]) => ({
      label: PAYMENT_METHOD_LABELS[method] ?? method,
      value: amount,
      color: PAYMENT_METHOD_COLORS[method] ?? "#94A3B8",
    }));
  }, [paymentsData]);

  const categoryColors: Record<string, string> = {
    national: "#3B82F6", international: "#8B5CF6", adventure: "#F59E0B",
    cultural: "#10B981", religious: "#EC4899", gastronomic: "#F97316", other: "#94A3B8",
  };
  const categoryLabels: Record<string, string> = {
    national: "Nacional", international: "Internacional", adventure: "Aventura",
    cultural: "Cultural", religious: "Religioso", gastronomic: "Gastronômico", other: "Outro",
  };

  const categoryByRevenue = useMemo(() => {
    const trips = tripsData?.data ?? [];
    const map: Record<string, number> = {};
    for (const r of filteredReservations) {
      const trip = trips.find(t => t.id === r.tripId);
      const cat = trip?.category ?? "other";
      map[cat] = (map[cat] ?? 0) + r.paidValue;
    }
    return Object.entries(map)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, value]) => ({
        label: categoryLabels[cat] ?? cat,
        value,
        color: categoryColors[cat] ?? "#94A3B8",
      }));
  }, [filteredReservations, tripsData]);

  const topTrips = useMemo(() => {
    const trips = tripsData?.data ?? [];
    return trips
      .map(t => ({
        ...t,
        revenue: reservations.filter(r => r.tripId === t.id).reduce((s, r) => s + r.paidValue, 0),
        count: reservations.filter(r => r.tripId === t.id).length,
        occupancy: t.totalCapacity > 0 ? ((t.totalCapacity - t.availableSeats) / t.totalCapacity * 100) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [tripsData, reservations]);

  const sellersRanking = useMemo(() => {
    const commissions = Array.isArray(commissionsRaw) ? commissionsRaw : [];
    const users = usersRaw ?? [];
    const map: Record<string, { total: number; paid: number; count: number }> = {};
    for (const c of commissions) {
      if (!map[c.userId]) map[c.userId] = { total: 0, paid: 0, count: 0 };
      map[c.userId].total += parseFloat(c.commissionAmount);
      if (c.status === COMMISSION_STATUS.PAID) map[c.userId].paid += parseFloat(c.commissionAmount);
      map[c.userId].count += 1;
    }
    return Object.entries(map)
      .map(([userId, stats]) => ({
        userId,
        name: users.find(u => u.id === userId)?.name ?? userId.slice(0, 12) + "…",
        ...stats,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [commissionsRaw, usersRaw]);

  const heatmapData = useMemo(() => {
    const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const result: Record<string, Record<string, number>> = {};
    for (const d of days) result[d] = {};
    for (const r of reservations) {
      const date = new Date(r.createdAt);
      const day = days[date.getDay()];
      const hour = `${String(date.getHours()).padStart(2, "0")}h`;
      if (!result[day][hour]) result[day][hour] = 0;
      result[day][hour]++;
    }
    return result;
  }, [reservations]);

  const funnelStages = useMemo(() => {
    const total = reservations.length;
    const pending = reservations.filter(r => r.status === RESERVATION_STATUS.PENDING).length;
    const confirmed = reservations.filter(r => r.status === RESERVATION_STATUS.CONFIRMED || r.status === RESERVATION_STATUS.COMPLETED).length;
    const withPayment = reservations.filter(r => r.paidValue > 0).length;
    const fullPaid = reservations.filter(r => r.balance === 0 && r.paidValue > 0).length;
    return [
      { label: "Total de reservas", value: total, color: "#3B82F6" },
      { label: "Pendentes", value: pending, color: "#F59E0B" },
      { label: "Confirmadas", value: confirmed, color: "#10B981" },
      { label: "Com pagamento", value: withPayment, color: "#8B5CF6" },
      { label: "Quitadas", value: fullPaid, color: "#22C55E" },
    ];
  }, [reservations]);

  const originData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of reservations) {
      const origin = (r as { origin?: string }).origin ?? "direto";
      map[origin] = (map[origin] ?? 0) + r.paidValue;
    }
    return Object.entries(map)
      .map(([label, value]) => ({ label: label === "direto" ? "Direto" : label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
  }, [reservations]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Análise de Receita</h1>
          <p className="text-muted-foreground text-sm">Visão completa do desempenho financeiro e vendas</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setShowFilters(f => !f)}>
            <Filter className="w-4 h-4 mr-1.5" /> Filtros
          </Button>
          <Select value={period} onValueChange={v => setPeriod(v as GetDashboardRevenueChartPeriod)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Últimos 7 dias</SelectItem>
              <SelectItem value="30d">Últimos 30 dias</SelectItem>
              <SelectItem value="90d">Últimos 90 dias</SelectItem>
              <SelectItem value="12m">Últimos 12 meses</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {showFilters && (
        <div className="bg-card p-4 rounded-lg border space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">Data de:</span>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36" />
              <span className="text-muted-foreground text-sm">até</span>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36" />
            </div>
            <Select value={filterStatus || "all"} onValueChange={v => setFilterStatus(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[150px] h-9 text-sm"><SelectValue placeholder="Status da Reserva" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Status</SelectItem>
                <SelectItem value={RESERVATION_STATUS.PENDING}>Pendente</SelectItem>
                <SelectItem value={RESERVATION_STATUS.CONFIRMED}>Confirmada</SelectItem>
                <SelectItem value={RESERVATION_STATUS.COMPLETED}>Concluída</SelectItem>
                <SelectItem value={RESERVATION_STATUS.CANCELLED}>Cancelada</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterPaymentMethod || "all"} onValueChange={v => setFilterPaymentMethod(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[160px] h-9 text-sm"><SelectValue placeholder="Forma de Pagamento" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as Formas</SelectItem>
                <SelectItem value="pix">PIX</SelectItem>
                <SelectItem value="credit_card">Cartão de Crédito</SelectItem>
                <SelectItem value="debit_card">Cartão de Débito</SelectItem>
                <SelectItem value="bank_transfer">Transferência</SelectItem>
                <SelectItem value="cash">Dinheiro</SelectItem>
                <SelectItem value="boleto">Boleto</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterSeller || "all"} onValueChange={v => setFilterSeller(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[150px] h-9 text-sm"><SelectValue placeholder="Vendedor" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Vendedores</SelectItem>
                {(usersRaw ?? []).filter(u => u.role === ROLES.SALES || u.role === ROLES.AGENCY_ADMIN).map(u => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(dateFrom || dateTo || filterStatus || filterPaymentMethod || filterSeller) && (
              <Button variant="ghost" size="sm" onClick={() => { setDateFrom(""); setDateTo(""); setFilterStatus(""); setFilterPaymentMethod(""); setFilterSeller(""); }}>
                Limpar filtros
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 grid-cols-2 md:grid-cols-3">
        <KpiCard icon={TrendingUp} label="Receita Total" value={fmtCompact(totalRevenue)} sub={`Meta: ${fmtCompact(goalRevenue)}`} color="text-green-600" loading={loadingChart} />
        <KpiCard icon={CalendarCheck} label="Total de Reservas" value={String(reservations.length)} sub={`${confirmedReservations.length} confirmadas`} color="text-blue-600" />
        <KpiCard icon={Target} label="Ticket Médio" value={fmtCompact(avgTicket)} sub="por reserva confirmada" color="text-purple-600" />
        <KpiCard icon={BarChart2} label="Taxa de Conversão" value={`${conversionRate.toFixed(1)}%`} sub="confirmadas / total" color="text-orange-600" />
        <KpiCard icon={UserPlus} label="Novos Clientes" value={String(newClients)} sub="este mês" color="text-teal-600" />
        <KpiCard icon={Repeat} label="Clientes Recorrentes" value={String(recurringClients)} sub="com mais de 1 reserva (estimado)" color="text-indigo-600" />
      </div>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="charts">Evolução</TabsTrigger>
          <TabsTrigger value="funnel">Funil</TabsTrigger>
          <TabsTrigger value="sellers">Vendedores</TabsTrigger>
          <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
          <TabsTrigger value="trips">Top Viagens</TabsTrigger>
        </TabsList>

        <TabsContent value="charts" className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart2 className="w-4 h-4" /> Evolução de Receita vs Despesas
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingChart ? <Skeleton className="h-52 w-full" /> : !filteredChart.length ? (
                  <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">Sem dados disponíveis</div>
                ) : <RevenueLineChart data={filteredChart} goal={goalRevenue > 0 ? goalRevenue / filteredChart.length : undefined} />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Vendas por Categoria</CardTitle>
              </CardHeader>
              <CardContent>
                {categoryByRevenue.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">Sem dados de categoria disponíveis.</div>
                ) : <CategoryPieChart data={categoryByRevenue} />}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Formas de Pagamento</CardTitle>
              </CardHeader>
              <CardContent>
                {paymentMethodTotals.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">Nenhum pagamento recebido ainda.</div>
                ) : <CategoryPieChart data={paymentMethodTotals} />}
              </CardContent>
            </Card>
            {originData.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <BarChart className="w-4 h-4" /> Vendas por Origem
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <BarChartHoriz data={originData} valueKey="value" labelKey="label" />
                </CardContent>
              </Card>
            )}
          </div>

          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Receita Líquida</p>
              <p className="text-xl font-bold text-green-600 mt-1">{fmtCompact(totalRevenue - totalExpenses)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Despesas</p>
              <p className="text-xl font-bold text-red-600 mt-1">{fmtCompact(totalExpenses)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">A Receber</p>
              <p className="text-xl font-bold mt-1">{fmtCompact(paymentSummary?.totalReceivable ?? 0)}</p>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Média Mensal</p>
              <p className="text-xl font-bold mt-1">{fmtCompact(filteredChart.length > 0 ? totalRevenue / filteredChart.length : 0)}</p>
            </CardContent></Card>
          </div>
        </TabsContent>

        <TabsContent value="funnel" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Funil de Vendas</CardTitle>
            </CardHeader>
            <CardContent>
              <SalesFunnel stages={funnelStages} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sellers" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4" /> Ranking de Vendedores
              </CardTitle>
            </CardHeader>
            <CardContent>
              {sellersRanking.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground text-sm">Nenhum dado de comissões disponível.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Vendedor</TableHead>
                      <TableHead>Comissões</TableHead>
                      <TableHead>Total Comissão</TableHead>
                      <TableHead>Pagas</TableHead>
                      <TableHead>Pendentes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sellersRanking.map((s, i) => (
                      <TableRow key={s.userId}>
                        <TableCell className="font-medium text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="text-sm">{s.count}</TableCell>
                        <TableCell className="font-semibold text-green-700">{fmt(s.total)}</TableCell>
                        <TableCell className="text-sm text-green-600">{fmt(s.paid)}</TableCell>
                        <TableCell className="text-sm text-yellow-700">{fmt(s.total - s.paid)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="heatmap" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Concentração de Reservas por Horário</CardTitle>
            </CardHeader>
            <CardContent>
              <HeatmapChart data={heatmapData} />
              <p className="text-xs text-muted-foreground mt-3">Cores mais intensas indicam maior concentração de reservas naquele dia e hora.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trips" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top 10 Viagens por Receita</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Viagem</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead>Reservas</TableHead>
                    <TableHead>Ocupação</TableHead>
                    <TableHead>Receita</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topTrips.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhuma viagem encontrada.</TableCell></TableRow>
                  ) : topTrips.map((t, i) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-muted-foreground font-medium">{i + 1}</TableCell>
                      <TableCell className="font-medium text-sm">{t.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{t.destination}</TableCell>
                      <TableCell className="text-sm">{t.count}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-muted rounded-full h-1.5 max-w-[80px]">
                            <div className="bg-primary h-1.5 rounded-full" style={{ width: `${Math.min(t.occupancy, 100)}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{t.occupancy.toFixed(0)}%</span>
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
      </Tabs>
    </div>
  );
}
