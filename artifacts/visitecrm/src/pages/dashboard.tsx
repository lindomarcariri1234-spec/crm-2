import { useMemo, useState, useEffect, useRef, type ElementType } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useGetDashboardSummary, useGetDashboardUpcomingTrips,
  useGetDashboardCharts, useGetDashboardFunnel,
  useGetDashboardTopCustomers,
  useListPayments, useGetMe, useListReservations,
  useGetPaymentsSummary,
} from "@workspace/api-client-react";
import type { Reservation, PaymentListResponse } from "@workspace/api-client-react";
import { GetDashboardChartsPeriod } from "@workspace/api-client-react";
import { PAYMENT_STATUS, PAYMENT_TYPE, ROLES, RESERVATION_STATUS } from "@workspace/permissions";
import { VoucherModal } from "./reservations";
import { ReservationCardVisual } from "@/components/reservation-card-visual";
import {
  Users, Map, DollarSign, Star, Briefcase, CalendarCheck, AlertTriangle, ArrowUpRight,
  Plus, Clock, Check, Trash2, TrendingDown, TrendingUp, AlertCircle, Percent,
  Target, Activity, BarChart2, Lightbulb, ChevronRight, UserCheck, Zap,
  X, Settings,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, Redirect } from "wouter";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, PieChart, Pie, Cell, LineChart, Line,
} from "@/lib/recharts-compat";
import { format, parseISO, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";

import { formatCurrency } from "@/lib/utils";

const TASKS_KEY = "visite-crm-tasks";

interface Task { id: string; text: string; done: boolean; createdAt: number; }

function TasksCard() {
  const [tasks, setTasks] = useState<Task[]>(() => {
    try { return JSON.parse(localStorage.getItem(TASKS_KEY) ?? "[]") as Task[]; } catch { return []; }
  });
  const [newText, setNewText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  }, [tasks]);

  const addTask = () => {
    const text = newText.trim();
    if (!text) return;
    setTasks(prev => [{ id: crypto.randomUUID(), text, done: false, createdAt: Date.now() }, ...prev]);
    setNewText("");
    inputRef.current?.focus();
  };

  const toggle = (id: string) => setTasks(prev => prev.map(t => t.id === id ? { ...t, done: !t.done } : t));
  const remove = (id: string) => setTasks(prev => prev.filter(t => t.id !== id));
  const pending = tasks.filter(t => !t.done).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Tarefas do Dia</CardTitle>
          {pending > 0 && <Badge variant="secondary" className="text-xs">{pending} pendente{pending !== 1 ? "s" : ""}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={newText}
            onChange={e => setNewText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") addTask(); }}
            placeholder="Nova tarefa..."
            className="h-8 text-sm"
          />
          <Button size="icon" className="h-8 w-8 shrink-0" onClick={addTask} disabled={!newText.trim()}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3">Nenhuma tarefa. Adicione uma acima!</p>
        ) : (
          <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
            {tasks.map(task => (
              <div key={task.id} className="flex items-center gap-2 group rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors">
                <button
                  onClick={() => toggle(task.id)}
                  className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${task.done ? "bg-primary border-primary" : "border-muted-foreground/40 hover:border-primary"}`}
                >
                  {task.done && <Check className="w-3 h-3 text-primary-foreground" />}
                </button>
                <span className={`text-sm flex-1 min-w-0 truncate ${task.done ? "line-through text-muted-foreground" : ""}`}>{task.text}</span>
                <button
                  onClick={() => remove(task.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const DONUT_COLORS = ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444", "#6B7280", "#EC4899", "#14B8A6"];

function KpiCard({ title, value, sub, icon: Icon, loading, color = "text-primary", highlight }: {
  title: string; value: string | number; sub?: string; icon: ElementType; loading: boolean; color?: string; highlight?: "green" | "red" | "yellow";
}) {
  const highlightClass = highlight === "green" ? "border-green-200 bg-green-50/50 dark:bg-green-950/20" :
    highlight === "red" ? "border-red-200 bg-red-50/50 dark:bg-red-950/20" :
    highlight === "yellow" ? "border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950/20" : "";

  return (
    <Card className={highlightClass}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${color}`} />
      </CardHeader>
      <CardContent>
        {loading ? (
          <><Skeleton className="h-8 w-24 mb-1" /><Skeleton className="h-4 w-36" /></>
        ) : (
          <>
            <div className="text-2xl font-bold">{value}</div>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}

const STATUS_LABELS: Record<string, string> = {
  [RESERVATION_STATUS.CONFIRMED]: "Confirmada",
  [RESERVATION_STATUS.PENDING]: "Pendente",
  [RESERVATION_STATUS.CANCELLED]: "Cancelada",
  [RESERVATION_STATUS.COMPLETED]: "Concluída",
};

function SectionTitle({ icon: Icon, title, description }: { icon: ElementType; title: string; description?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="p-2 rounded-lg bg-primary/10">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    </div>
  );
}

const SETUP_BANNER_KEY = "visite-crm-setup-banner-dismissed";
const AUTO_SLUG_RE = /^agencia-[a-z0-9]{6}(-\d+)?$/;

function AgencyDashboard() {
  const [chartPeriod, setChartPeriod] = useState<"3m" | "6m" | "12m">("12m");
  const [bannerDismissed, setBannerDismissed] = useState(() => localStorage.getItem(SETUP_BANNER_KEY) === "1");
  const { data: me } = useGetMe();

  const showSetupBanner =
    !bannerDismissed &&
    !!me?.tenant &&
    (me.tenant.name === "Minha Agência" || AUTO_SLUG_RE.test(me.tenant.slug ?? ""));

  function dismissBanner() {
    localStorage.setItem(SETUP_BANNER_KEY, "1");
    setBannerDismissed(true);
  }

  const { data: summary, isLoading: loadingSummary } = useGetDashboardSummary();
  const { data: charts, isLoading: loadingCharts } = useGetDashboardCharts({ period: chartPeriod as GetDashboardChartsPeriod });
  const { data: funnel, isLoading: loadingFunnel } = useGetDashboardFunnel();
  const { data: upcomingTrips, isLoading: loadingTrips } = useGetDashboardUpcomingTrips();
  const { data: paymentSummary, isLoading: loadingPaySummary } = useGetPaymentsSummary();
  const { data: pendingPaymentsList, isLoading: loadingPendingPayments } = useListPayments({ status: PAYMENT_STATUS.PENDING, limit: 5, type: PAYMENT_TYPE.RECEIVABLE });
  const { data: topCustomers, isLoading: loadingTopCustomers } = useGetDashboardTopCustomers();

  const npsLabel = summary?.averageNps != null ? `${summary.averageNps.toFixed(1)} / 10` : "—";
  const totalRevenue = summary?.totalRevenue ?? 0;
  const totalExpenses = summary?.totalExpenses ?? 0;
  const netProfit = totalRevenue - totalExpenses;
  const margin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

  // Revenue vs Expenses merged data from charts endpoint
  const revExpChartData = useMemo(() => {
    const rev = charts?.revenueByMonth ?? [];
    const exp = charts?.expensesByMonth ?? [];
    return rev.map((r, i) => ({ label: r.label, revenue: r.value, expenses: exp[i]?.value ?? 0 }));
  }, [charts]);

  // Client origin data comes from charts endpoint (originBreakdown)
  const clientOriginData = useMemo(() => {
    return (charts?.originBreakdown ?? []).map(item => ({ name: item.name, value: item.count }));
  }, [charts]);

  // Integration health check — polls once per 5 min; shows banner if essential integration is failing
  const { data: integrationStatuses } = useQuery({
    queryKey: ["integration-alerts"],
    queryFn: async () => {
      const resp = await fetch("/api/integrations");
      if (!resp.ok) return [] as Array<{ type: string; label: string; status: string; enabled: boolean }>;
      return resp.json() as Promise<Array<{ type: string; label: string; status: string; enabled: boolean }>>;
    },
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const ESSENTIAL_INTEGRATION_TYPES = ["whatsapp_evolution", "stripe_account", "mercadopago"];
  const integrationIssues = (integrationStatuses ?? []).filter(
    (i) => ESSENTIAL_INTEGRATION_TYPES.includes(i.type) && i.enabled && (i.status === "error" || i.status === "disconnected"),
  );

  // Diagnostic engine
  const diagnostics = useMemo(() => {
    if (!summary || !charts) return [];
    const tips: Array<{ type: "warning" | "success" | "info"; title: string; desc: string }> = [];

    if ((summary.occupancyRate ?? 0) < 60)
      tips.push({ type: "warning", title: "Ocupação abaixo do ideal", desc: `Taxa atual de ${summary.occupancyRate?.toFixed(1)}%. Considere campanhas de captação para preencher as vagas restantes.` });
    else if ((summary.occupancyRate ?? 0) >= 85)
      tips.push({ type: "success", title: "Excelente ocupação", desc: `Taxa de ${summary.occupancyRate?.toFixed(1)}%! Considere abrir novas viagens para aproveitar a demanda.` });

    if (summary.averageNps != null && summary.averageNps < 7)
      tips.push({ type: "warning", title: "NPS precisa de atenção", desc: `NPS médio de ${summary.averageNps.toFixed(1)}. Revise a qualidade do serviço e colete feedback detalhado dos clientes.` });
    else if (summary.averageNps != null && summary.averageNps >= 9)
      tips.push({ type: "success", title: "Clientes muito satisfeitos", desc: `NPS de ${summary.averageNps.toFixed(1)} — ótimo momento para solicitar indicações e depoimentos.` });

    if (charts.cancellationRate > 15)
      tips.push({ type: "warning", title: "Taxa de cancelamento elevada", desc: `${charts.cancellationRate.toFixed(1)}% das reservas são canceladas. Revise políticas de cancelamento e comunicação com clientes.` });

    if (margin < 15 && totalRevenue > 0)
      tips.push({ type: "warning", title: "Margem de lucro baixa", desc: `Margem de ${margin.toFixed(1)}%. Analise as despesas por viagem e negocie melhores tarifas com fornecedores.` });
    else if (margin >= 30 && totalRevenue > 0)
      tips.push({ type: "success", title: "Margem saudável", desc: `Margem de ${margin.toFixed(1)}% — continue monitorando custos para manter essa performance.` });

    if ((summary.newClientsThisMonth ?? 0) === 0)
      tips.push({ type: "info", title: "Nenhum cliente novo este mês", desc: "Invista em campanhas de captação via WhatsApp, Instagram ou indicações de clientes existentes." });

    if (charts.avgReservationsPerTrip < 5 && summary.activeTrips > 0)
      tips.push({ type: "info", title: "Poucas reservas por viagem", desc: `Média de ${charts.avgReservationsPerTrip.toFixed(1)} reservas/viagem. Avalie otimizar o número de viagens ou intensificar a divulgação.` });

    if (tips.length === 0)
      tips.push({ type: "success", title: "Operação saudável", desc: "Todos os indicadores estão dentro dos parâmetros ideais. Continue monitorando e buscando oportunidades de crescimento." });

    return tips;
  }, [summary, charts, margin, totalRevenue]);

  return (
    <div className="space-y-8">
      {/* Setup reminder banner — shown only for agencies that skipped onboarding */}
      {showSetupBanner && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <p className="flex-1">
            <span className="font-medium">Perfil da agência incompleto.</span>{" "}
            Complete o perfil para ativar a sua vitrine pública e personalizar o CRM.
          </p>
          <Link href="/configuracoes">
            <Button size="sm" variant="outline" className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-transparent dark:text-amber-200 h-7 px-3 text-xs shrink-0">
              <Settings className="h-3 w-3 mr-1.5" />
              Configurar agora
            </Button>
          </Link>
          <button
            onClick={dismissBanner}
            aria-label="Dispensar aviso"
            className="ml-1 rounded p-0.5 text-amber-500 hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-900 shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Visão analítica completa da sua agência de turismo.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border overflow-hidden text-xs">
            {(["3m", "6m", "12m"] as const).map(p => (
              <button
                key={p}
                onClick={() => setChartPeriod(p)}
                className={`px-3 py-1.5 font-medium transition-colors ${chartPeriod === p ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {p === "3m" ? "3M" : p === "6m" ? "6M" : "12M"}
              </button>
            ))}
          </div>
          <Link href="/clients"><Button variant="outline" size="sm"><Plus className="w-4 h-4 mr-1" /> Novo Cliente</Button></Link>
          <Link href="/trips"><Button size="sm"><Plus className="w-4 h-4 mr-1" /> Nova Viagem</Button></Link>
        </div>
      </div>

      {/* Overdue expenses alert */}
      {(paymentSummary?.overdueReceivable ?? 0) > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
          <p className="text-sm font-medium text-destructive">
            Atenção: <strong>{formatCurrency(paymentSummary!.overdueReceivable)}</strong> em recebimentos vencidos.
          </p>
          <Link href="/financial" className="ml-auto text-sm font-medium text-destructive underline underline-offset-2">Ver detalhes</Link>
        </div>
      )}

      {/* Integration health alert */}
      {integrationIssues.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm dark:border-orange-800 dark:bg-orange-950/40">
          <Zap className="w-5 h-5 text-orange-500 shrink-0" />
          <p className="flex-1 text-orange-900 dark:text-orange-200">
            <span className="font-medium">Integração com problema: </span>
            {integrationIssues.map((i) => i.label).join(", ")}{" "}
            {integrationIssues.length === 1 ? "está" : "estão"} com falha de conexão.
          </p>
          <Link href="/configuracoes?tab=integrations">
            <Button size="sm" variant="outline" className="border-orange-300 bg-white text-orange-900 hover:bg-orange-100 dark:border-orange-700 dark:bg-transparent dark:text-orange-200 h-7 px-3 text-xs shrink-0">
              <Settings className="h-3 w-3 mr-1.5" />
              Verificar
            </Button>
          </Link>
        </div>
      )}

      {/* ═══ SEÇÃO 1: KPIs em 4 grupos ═══ */}
      <div className="space-y-6">
        {/* FINANCEIRO */}
        <section className="rounded-xl border border-emerald-100 bg-gradient-to-br from-emerald-50/60 to-teal-50/30 dark:from-emerald-950/20 dark:to-teal-950/10 dark:border-emerald-900/30 p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-5 rounded-full bg-emerald-500" />
            <h2 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 uppercase tracking-wide">Financeiro</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <KpiCard title="Receita Total" value={formatCurrency(totalRevenue)} sub={`${formatCurrency(summary?.revenueThisMonth ?? 0)} este mês`} icon={TrendingUp} loading={loadingSummary} color="text-emerald-600" highlight="green" />
            <KpiCard title="Despesas" value={formatCurrency(totalExpenses)} sub="Total de despesas registradas" icon={TrendingDown} loading={loadingSummary} color="text-red-500" />
            <KpiCard
              title="Lucro Líquido"
              value={formatCurrency(summary?.profit ?? netProfit)}
              sub={`Margem: ${(summary?.profitMargin ?? margin).toFixed(1)}%`}
              icon={DollarSign}
              loading={loadingSummary}
              color={(summary?.profit ?? netProfit) >= 0 ? "text-emerald-600" : "text-red-600"}
              highlight={(summary?.profit ?? netProfit) >= 0 ? "green" : "red"}
            />
            <KpiCard
              title="Margem de Lucro"
              value={`${(summary?.profitMargin ?? margin).toFixed(1)}%`}
              sub={(summary?.profit ?? netProfit) >= 0 ? "Resultado positivo" : "Resultado negativo"}
              icon={Percent}
              loading={loadingSummary}
              color={(summary?.profitMargin ?? margin) >= 20 ? "text-emerald-600" : (summary?.profitMargin ?? margin) >= 10 ? "text-yellow-600" : "text-red-600"}
            />
            <KpiCard title="Ticket Médio" value={formatCurrency(summary?.avgTicket ?? 0)} sub="Por reserva confirmada" icon={Target} loading={loadingSummary} color="text-purple-600" />
            <KpiCard
              title="Contas Vencidas"
              value={formatCurrency(summary?.overduePayments ?? 0)}
              sub={`${summary?.overduePaymentsCount ?? 0} cobranças em atraso`}
              icon={AlertTriangle}
              loading={loadingSummary}
              color={(summary?.overduePaymentsCount ?? 0) > 0 ? "text-red-600" : "text-muted-foreground"}
              highlight={(summary?.overduePaymentsCount ?? 0) > 0 ? "red" : undefined}
            />
          </div>
        </section>

        {/* VENDAS */}
        <section className="rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50/60 to-indigo-50/30 dark:from-blue-950/20 dark:to-indigo-950/10 dark:border-blue-900/30 p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-5 rounded-full bg-blue-500" />
            <h2 className="text-sm font-semibold text-blue-700 dark:text-blue-400 uppercase tracking-wide">Vendas</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard title="Total de Reservas" value={summary?.totalReservations ?? 0} sub={`${summary?.cancelledReservations ?? 0} canceladas`} icon={CalendarCheck} loading={loadingSummary} color="text-blue-600" />
            <KpiCard title="Reservas Confirmadas" value={summary?.confirmedReservations ?? 0} sub="Com pagamento aprovado" icon={Check} loading={loadingSummary} color="text-blue-700" highlight="green" />
            <KpiCard
              title="Taxa de Conversão"
              value={`${(summary?.conversionRate ?? 0).toFixed(1)}%`}
              sub="Leads → Pagantes"
              icon={TrendingUp}
              loading={loadingSummary}
              color={(summary?.conversionRate ?? 0) >= 30 ? "text-emerald-600" : "text-blue-600"}
            />
            <KpiCard title="Leads no Pipeline" value={summary?.pipelineLeads ?? summary?.openDeals ?? 0} sub={`Valor: ${formatCurrency(summary?.dealsPipelineValue ?? 0)}`} icon={Briefcase} loading={loadingSummary} color="text-indigo-600" />
            <KpiCard title="Vendas Este Mês" value={summary?.salesThisMonth ?? 0} sub="Reservas confirmadas no mês" icon={Zap} loading={loadingSummary} color="text-emerald-600" highlight={(summary?.salesThisMonth ?? 0) > 0 ? "green" : undefined} />
          </div>
        </section>

        {/* CLIENTES */}
        <section className="rounded-xl border border-purple-100 bg-gradient-to-br from-purple-50/60 to-violet-50/30 dark:from-purple-950/20 dark:to-violet-950/10 dark:border-purple-900/30 p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-5 rounded-full bg-purple-500" />
            <h2 className="text-sm font-semibold text-purple-700 dark:text-purple-400 uppercase tracking-wide">Clientes</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard title="Total de Clientes" value={summary?.totalClients ?? 0} sub="Base total cadastrada" icon={Users} loading={loadingSummary} color="text-purple-600" />
            <KpiCard title="Novos Este Mês" value={summary?.newClientsThisMonth ?? 0} sub="Cadastrados no mês atual" icon={Users} loading={loadingSummary} color="text-purple-500" highlight={(summary?.newClientsThisMonth ?? 0) > 0 ? "green" : undefined} />
            <KpiCard
              title="Taxa de Retenção"
              value={`${(summary?.retentionRate ?? 0).toFixed(1)}%`}
              sub="Clientes com 2+ compras"
              icon={UserCheck}
              loading={loadingSummary}
              color={(summary?.retentionRate ?? 0) >= 30 ? "text-emerald-600" : (summary?.retentionRate ?? 0) >= 15 ? "text-yellow-600" : "text-muted-foreground"}
            />
            <KpiCard
              title="Pontos de Fidelidade"
              value={(summary?.loyaltyPointsIssued ?? 0).toLocaleString("pt-BR")}
              sub="Total emitido aos clientes"
              icon={Star}
              loading={loadingSummary}
              color="text-yellow-600"
            />
            <KpiCard
              title="NPS Médio"
              value={npsLabel}
              sub="Satisfação dos clientes"
              icon={Star}
              loading={loadingSummary}
              color={(summary?.avgNps ?? summary?.averageNps ?? 0) >= 9 ? "text-emerald-600" : (summary?.avgNps ?? summary?.averageNps ?? 0) >= 7 ? "text-yellow-600" : "text-muted-foreground"}
            />
          </div>
        </section>

        {/* OPERACIONAL */}
        <section className="rounded-xl border border-orange-100 bg-gradient-to-br from-orange-50/60 to-amber-50/30 dark:from-orange-950/20 dark:to-amber-950/10 dark:border-orange-900/30 p-4">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-5 rounded-full bg-orange-500" />
            <h2 className="text-sm font-semibold text-orange-700 dark:text-orange-400 uppercase tracking-wide">Operacional</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard title="Viagens Ativas" value={summary?.activeTrips ?? 0} sub={`${summary?.totalTrips ?? 0} viagens no total`} icon={Map} loading={loadingSummary} color="text-orange-600" />
            <KpiCard
              title="Taxa de Ocupação"
              value={`${(summary?.occupancyRate ?? 0).toFixed(1)}%`}
              sub="Vagas preenchidas nas viagens ativas"
              icon={Activity}
              loading={loadingSummary}
              color={(summary?.occupancyRate ?? 0) >= 85 ? "text-emerald-600" : (summary?.occupancyRate ?? 0) >= 60 ? "text-yellow-600" : "text-red-500"}
            />
            <KpiCard title="Viagens Este Mês" value={summary?.tripsThisMonth ?? 0} sub="Criadas no mês atual" icon={Map} loading={loadingSummary} color="text-orange-500" highlight={(summary?.tripsThisMonth ?? 0) > 0 ? "green" : undefined} />
            <KpiCard
              title="Reservas Pendentes"
              value={summary?.pendingReservations ?? 0}
              sub="Aguardando confirmação"
              icon={Clock}
              loading={loadingSummary}
              color={(summary?.pendingReservations ?? 0) > 0 ? "text-amber-600" : "text-muted-foreground"}
              highlight={(summary?.pendingReservations ?? 0) > 0 ? "yellow" : undefined}
            />
          </div>
        </section>
      </div>

      {/* ═══ SEÇÃO 2: 10 GRÁFICOS ═══ */}
      <section>
        <SectionTitle icon={Activity} title="Gráficos e Análises" description="Dados históricos e comparativos dos últimos 12 meses" />

        {/* Chart 1 & 2: Revenue vs Expenses + Client Origin */}
        <div className="grid gap-4 lg:grid-cols-7 mb-4">
          <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle className="text-base">Receita vs Despesas</CardTitle>
              <CardDescription>Últimos {chartPeriod === "3m" ? "3" : chartPeriod === "6m" ? "6" : "12"} meses</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCharts ? <Skeleton className="h-[260px] w-full" /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={revExpChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2} /><stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="expenses" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#EF4444" stopOpacity={0.2} /><stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Legend />
                    <Area type="monotone" dataKey="revenue" name="Receita" stroke="#3B82F6" fill="url(#revenue)" strokeWidth={2} />
                    <Area type="monotone" dataKey="expenses" name="Despesas" stroke="#EF4444" fill="url(#expenses)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Origem dos Clientes</CardTitle>
              <CardDescription>Por canal de captação</CardDescription>
            </CardHeader>
            <CardContent>
              {clientOriginData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Sem dados de origem.</p>
              ) : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="55%" height={200}>
                    <PieChart>
                      <Pie data={clientOriginData} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                        {clientOriginData.map((_, index) => (
                          <Cell key={index} fill={DONUT_COLORS[index % DONUT_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: unknown, name: string) => [String(v), name]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-1.5">
                    {clientOriginData.map((item, i) => (
                      <div key={item.name} className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                        <span className="text-xs truncate flex-1">{item.name}</span>
                        <span className="text-xs font-semibold">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Chart 3 & 4: Top Destinations + Status pie */}
        <div className="grid gap-4 lg:grid-cols-7 mb-4">
          <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle className="text-base">Top Destinos</CardTitle>
              <CardDescription>Por número de reservas</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCharts ? <Skeleton className="h-[220px] w-full" /> : !charts?.topDestinations.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">Sem dados de destinos.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={charts.topDestinations.slice(0, 5)} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={90} />
                    <Tooltip formatter={(v: unknown, name: string) => [String(v), name]} />
                    <Bar dataKey="count" name="Reservas" fill="#8B5CF6" radius={[0, 4, 4, 0]}>
                      {charts.topDestinations.slice(0, 5).map((_, i) => (
                        <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Status das Reservas</CardTitle>
              <CardDescription>Distribuição atual</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCharts ? <Skeleton className="h-[200px] w-full" /> : !charts?.reservationsByStatus.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">Sem dados.</p>
              ) : (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="55%" height={200}>
                    <PieChart>
                      <Pie data={charts.reservationsByStatus} dataKey="count" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                        {charts.reservationsByStatus.map((_, i) => (
                          <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: unknown, n: string) => [v, STATUS_LABELS[n] ?? n]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-2">
                    {charts.reservationsByStatus.map((item, i) => (
                      <div key={item.status} className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                        <span className="text-xs flex-1">{STATUS_LABELS[item.status] ?? item.status}</span>
                        <span className="text-xs font-semibold">{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Chart 5 & 6: Reservations/Month + Trips/Month */}
        <div className="grid gap-4 lg:grid-cols-2 mb-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reservas por Mês</CardTitle>
              <CardDescription>Total e cancelamentos</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCharts ? <Skeleton className="h-[220px] w-full" /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={charts?.reservationsByMonth ?? []} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: unknown, name: string) => [String(v), name]} />
                    <Legend />
                    <Bar dataKey="count" name="Total" fill="#3B82F6" radius={[4, 4, 0, 0]} stackId="a" />
                    <Bar dataKey="cancelled" name="Canceladas" fill="#EF4444" radius={[4, 4, 0, 0]} stackId="b" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Viagens Criadas por Mês</CardTitle>
              <CardDescription>Histórico de criação</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCharts ? <Skeleton className="h-[220px] w-full" /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={charts?.tripsByMonth ?? []} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: unknown, name: string) => [String(v), name]} />
                    <Bar dataKey="count" name="Viagens" fill="#10B981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Chart 7 & 8: Passengers/Month + Avg Ticket/Month */}
        <div className="grid gap-4 lg:grid-cols-2 mb-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Passageiros Embarcados</CardTitle>
              <CardDescription>Check-ins por mês</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCharts ? <Skeleton className="h-[220px] w-full" /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={charts?.passengersByMonth ?? []} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="passengers" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.2} /><stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: unknown, name: string) => [String(v), name]} />
                    <Area type="monotone" dataKey="count" name="Passageiros" stroke="#8B5CF6" fill="url(#passengers)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ticket Médio por Mês</CardTitle>
              <CardDescription>Valor médio das reservas confirmadas</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCharts ? <Skeleton className="h-[220px] w-full" /> : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={charts?.avgTicketByMonth ?? []} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v: number) => `R$${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                    <Line type="monotone" dataKey="value" name="Ticket Médio" stroke="#F59E0B" strokeWidth={2} dot={{ fill: "#F59E0B", r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Chart 9 & 10: Top Boarding Points + Cancellation Donut + Avg Reservations Highlight */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top Pontos de Embarque</CardTitle>
              <CardDescription>Por número de passageiros</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCharts ? <Skeleton className="h-[220px] w-full" /> : !charts?.topBoardingPoints.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">Sem dados de embarque.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={charts.topBoardingPoints} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => [v, "Passageiros"]} />
                    <Bar dataKey="count" name="Passageiros" fill="#14B8A6" radius={[4, 4, 0, 0]}>
                      {charts.topBoardingPoints.map((_, i) => (
                        <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Taxa de Cancelamento</CardTitle>
              <CardDescription>Viagens e Reservas</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingCharts || loadingSummary ? <Skeleton className="h-[220px] w-full" /> : (
                <div className="space-y-3">
                  <div className="flex justify-around text-center">
                    <div>
                      <p className={`text-2xl font-bold ${(charts?.tripCancellationRate ?? 0) > 15 ? "text-red-600" : "text-green-600"}`}>
                        {(charts?.tripCancellationRate ?? 0).toFixed(1)}%
                      </p>
                      <p className="text-xs text-muted-foreground">Viagens cancel.</p>
                    </div>
                    <div className="w-px bg-border" />
                    <div>
                      <p className={`text-2xl font-bold ${(charts?.cancellationRate ?? 0) > 15 ? "text-red-600" : "text-green-600"}`}>
                        {(charts?.cancellationRate ?? 0).toFixed(1)}%
                      </p>
                      <p className="text-xs text-muted-foreground">Reservas cancel.</p>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={130}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: "Reservas Canceladas", value: summary?.cancelledReservations ?? 0 },
                          { name: "Reservas Ativas", value: Math.max(0, (summary?.totalReservations ?? 0) - (summary?.cancelledReservations ?? 0)) },
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={55}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        <Cell fill="#EF4444" />
                        <Cell fill="#10B981" />
                      </Pie>
                      <Tooltip formatter={(v: unknown, name: string) => [String(v), name]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex gap-3 justify-center">
                    <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-red-500"/><span className="text-xs">{summary?.cancelledReservations ?? 0} cancel.</span></div>
                    <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-green-500"/><span className="text-xs">{Math.max(0, (summary?.totalReservations ?? 0) - (summary?.cancelledReservations ?? 0))} ativas</span></div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Média de Reservas por Viagem</CardTitle>
              <CardDescription>Eficiência operacional</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingSummary ? <Skeleton className="h-[220px] w-full" /> : (
                <div className="flex flex-col items-center justify-center h-[220px] gap-4">
                  <div className="text-center">
                    <p className="text-6xl font-bold text-primary">{summary?.avgReservationsPerTrip ?? 0}</p>
                    <p className="text-sm text-muted-foreground mt-2">reservas / viagem</p>
                  </div>
                  <div className="w-full space-y-2 px-2">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Total viagens</span><span className="font-medium text-foreground">{summary?.totalTrips ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Total reservas</span><span className="font-medium text-foreground">{summary?.totalReservations ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Confirmadas</span><span className="font-medium text-green-600">{summary?.confirmedReservations ?? 0}</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Ticket médio</span><span className="font-medium text-foreground">{formatCurrency(summary?.avgTicket ?? 0)}</span>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ═══ SEÇÃO 3: FUNIL DE CONVERSÃO ═══ */}
      <section>
        <SectionTitle icon={Target} title="Funil de Conversão" description="Jornada do lead à compra efetiva" />

        <div className="grid gap-4 lg:grid-cols-7">
          {/* Funnel visual */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Visão Geral</CardTitle>
              <CardDescription>Conversão de leads em pagantes</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFunnel ? <Skeleton className="h-[240px] w-full" /> : funnel ? (
                <div className="space-y-3">
                  {[
                    { label: "Total Leads", value: funnel.totalLeads, color: "#3B82F6", pct: 100 },
                    { label: "Com Reserva", value: funnel.withReservation, color: "#8B5CF6", pct: funnel.totalLeads > 0 ? (funnel.withReservation / funnel.totalLeads) * 100 : 0 },
                    { label: "Confirmados", value: funnel.withConfirmed, color: "#10B981", pct: funnel.totalLeads > 0 ? (funnel.withConfirmed / funnel.totalLeads) * 100 : 0 },
                    { label: "Pagantes", value: funnel.withPayment, color: "#F59E0B", pct: funnel.totalLeads > 0 ? (funnel.withPayment / funnel.totalLeads) * 100 : 0 },
                  ].map((step, i) => (
                    <div key={step.label}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: step.color }} />
                          <span className="text-sm font-medium">{step.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold">{step.value}</span>
                          <Badge variant="outline" className="text-xs">{step.pct.toFixed(1)}%</Badge>
                        </div>
                      </div>
                      <div className="w-full bg-muted rounded-full h-3">
                        <div
                          className="h-3 rounded-full transition-all"
                          style={{ width: `${step.pct}%`, backgroundColor: step.color }}
                        />
                      </div>
                      {i < 3 && (
                        <div className="flex justify-center my-1">
                          <ChevronRight className="w-4 h-4 text-muted-foreground rotate-90" />
                        </div>
                      )}
                    </div>
                  ))}
                  <div className="mt-4 p-3 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground">Taxa de conversão geral</p>
                    <p className="text-2xl font-bold text-primary">
                      {funnel.totalLeads > 0 ? ((funnel.withPayment / funnel.totalLeads) * 100).toFixed(1) : 0}%
                    </p>
                    <p className="text-xs text-muted-foreground">leads → pagantes</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">Sem dados de funil.</p>
              )}
            </CardContent>
          </Card>

          {/* By origin */}
          <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle className="text-base">Conversão por Canal de Origem</CardTitle>
              <CardDescription>Comparativo por fonte de captação</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFunnel ? <Skeleton className="h-[300px] w-full" /> : !funnel?.byOrigin.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">Sem dados de origem.</p>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 text-muted-foreground font-medium text-xs">Canal</th>
                        <th className="text-right py-2 text-muted-foreground font-medium text-xs">Leads</th>
                        <th className="text-right py-2 text-muted-foreground font-medium text-xs">C/ Reserva</th>
                        <th className="text-right py-2 text-muted-foreground font-medium text-xs">Confirmados</th>
                        <th className="text-right py-2 text-muted-foreground font-medium text-xs">Pagantes</th>
                        <th className="text-right py-2 text-muted-foreground font-medium text-xs">Ticket Médio</th>
                        <th className="text-right py-2 text-muted-foreground font-medium text-xs">Conversão</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funnel.byOrigin.map((row) => {
                        const convNum = row.conversionPct ?? 0;
                        return (
                          <tr key={row.origin} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="py-2.5 font-medium">{row.origin}</td>
                            <td className="py-2.5 text-right">{row.totalLeads}</td>
                            <td className="py-2.5 text-right text-blue-600">{row.withReservation}</td>
                            <td className="py-2.5 text-right text-purple-600">{row.withConfirmed}</td>
                            <td className="py-2.5 text-right text-green-600 font-semibold">{row.withPayment}</td>
                            <td className="py-2.5 text-right text-amber-700 font-semibold">{row.avgTicket > 0 ? formatCurrency(row.avgTicket) : "—"}</td>
                            <td className="py-2.5 text-right">
                              <Badge variant={convNum >= 50 ? "default" : convNum >= 25 ? "secondary" : "outline"} className="text-xs">
                                {convNum.toFixed(1)}%
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ═══ SEÇÃO 4: DIAGNÓSTICO EMPRESARIAL ═══ */}
      <section>
        <SectionTitle icon={Lightbulb} title="Diagnóstico do Negócio" description="Análise automatizada com recomendações estratégicas" />

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Card 1: Resumo do Negócio */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/50">
                  <BarChart2 className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-base">Resumo do Negócio</CardTitle>
                  <CardDescription>Situação atual consolidada</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {(loadingSummary || loadingCharts) ? <Skeleton className="h-[200px] w-full" /> : (
                <div className="space-y-3">
                  {[
                    {
                      label: "Receita Total",
                      value: formatCurrency(totalRevenue),
                      color: "text-green-600",
                      sub: `${formatCurrency(summary?.revenueThisMonth ?? 0)} este mês`,
                    },
                    {
                      label: "Total Despesas + A Pagar",
                      value: formatCurrency(totalExpenses + (summary?.totalPayable ?? 0)),
                      color: "text-red-500",
                      sub: `Despesas: ${formatCurrency(totalExpenses)} · A pagar: ${formatCurrency(summary?.totalPayable ?? 0)}`,
                    },
                    {
                      label: "Lucro Líquido",
                      value: formatCurrency(netProfit),
                      color: netProfit >= 0 ? "text-emerald-600" : "text-red-600",
                      sub: `Margem: ${margin.toFixed(1)}%`,
                    },
                    {
                      label: "Taxa de Cancelamento",
                      value: `${(charts?.cancellationRate ?? 0).toFixed(1)}%`,
                      color: (charts?.cancellationRate ?? 0) > 15 ? "text-red-600" : "text-green-600",
                      sub: `${summary?.cancelledReservations ?? 0} reservas canceladas`,
                    },
                    {
                      label: "Clientes Ativos",
                      value: String(summary?.activeClientsCount ?? 0),
                      color: "text-indigo-600",
                      sub: `de ${summary?.totalClients ?? 0} clientes no total`,
                    },
                    {
                      label: "Viagens Ativas",
                      value: String(summary?.activeTrips ?? 0),
                      color: "text-blue-600",
                      sub: `NPS médio: ${npsLabel}`,
                    },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between py-1.5 border-b last:border-0">
                      <div>
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-muted-foreground">{item.sub}</p>
                      </div>
                      <p className={`text-sm font-bold ${item.color}`}>{item.value}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Card 2: Estratégia de Crescimento */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/50">
                  <Lightbulb className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <CardTitle className="text-base">Estratégia de Crescimento</CardTitle>
                  <CardDescription>Recomendações baseadas nos dados</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {(loadingSummary || loadingCharts) ? <Skeleton className="h-[200px] w-full" /> : (
                <div className="space-y-3">
                  {diagnostics.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">Nenhuma recomendação disponível. Cadastre mais dados.</p>
                  ) : diagnostics.map((tip, i) => (
                    <div
                      key={i}
                      className={`flex gap-3 p-3 rounded-lg border ${
                        tip.type === "warning" ? "border-yellow-200 bg-yellow-50/50 dark:bg-yellow-950/20" :
                        tip.type === "success" ? "border-green-200 bg-green-50/50 dark:bg-green-950/20" :
                        "border-blue-200 bg-blue-50/50 dark:bg-blue-950/20"
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">
                        {tip.type === "warning" ? <AlertTriangle className="w-4 h-4 text-yellow-600" /> :
                         tip.type === "success" ? <TrendingUp className="w-4 h-4 text-green-600" /> :
                         <Lightbulb className="w-4 h-4 text-blue-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`font-semibold text-xs ${
                          tip.type === "warning" ? "text-yellow-800 dark:text-yellow-200" :
                          tip.type === "success" ? "text-green-800 dark:text-green-200" :
                          "text-blue-800 dark:text-blue-200"
                        }`}>{tip.title}</p>
                        <p className={`text-xs mt-0.5 leading-relaxed ${
                          tip.type === "warning" ? "text-yellow-700 dark:text-yellow-300" :
                          tip.type === "success" ? "text-green-700 dark:text-green-300" :
                          "text-blue-700 dark:text-blue-300"
                        }`}>{tip.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ═══ SEÇÃO EXTRA: Visão Rápida ═══ */}
      <section>
        <SectionTitle icon={CalendarCheck} title="Visão Rápida" description="Próximas viagens, pagamentos pendentes e pipeline" />

        <div className="grid gap-4 lg:grid-cols-3">
          {/* Column 1: Próximas Viagens */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Próximas Viagens</CardTitle>
                <Link href="/trips"><Button variant="ghost" size="sm">Ver todas</Button></Link>
              </div>
            </CardHeader>
            <CardContent>
              {loadingTrips ? (
                <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
              ) : !upcomingTrips?.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhuma viagem próxima.</p>
              ) : (
                <div className="space-y-3">
                  {upcomingTrips.slice(0, 5).map(trip => {
                    const days = differenceInDays(parseISO(trip.departureDate), new Date());
                    const occupancy = Math.round(((trip.totalCapacity - trip.availableSeats) / trip.totalCapacity) * 100);
                    return (
                      <div key={trip.id} className="flex items-center justify-between p-2 rounded-lg border hover:bg-muted/50">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{trip.name}</p>
                          <p className="text-xs text-muted-foreground">{format(parseISO(trip.departureDate), "dd/MM/yyyy", { locale: ptBR })}</p>
                        </div>
                        <div className="flex items-center gap-2 ml-2">
                          <span className="text-xs text-muted-foreground">{occupancy}% ocup.</span>
                          <Badge variant={days <= 7 ? "destructive" : days <= 30 ? "default" : "secondary"} className="text-xs">
                            {days <= 0 ? "Hoje" : `${days}d`}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Column 2: Pagamentos Pendentes */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Pagamentos Pendentes</CardTitle>
                <Link href="/financial"><Button variant="ghost" size="sm">Ver todos <ArrowUpRight className="w-3 h-3 ml-1" /></Button></Link>
              </div>
            </CardHeader>
            <CardContent>
              {loadingPendingPayments ? (
                <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : !(pendingPaymentsList as PaymentListResponse | undefined)?.data?.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">Nenhum pagamento pendente.</p>
              ) : (
                <div className="space-y-2">
                  {((pendingPaymentsList as PaymentListResponse | undefined)?.data ?? []).slice(0, 5).map(payment => {
                    const due = new Date(payment.dueDate);
                    const daysUntil = differenceInDays(due, new Date());
                    const isOverdue = daysUntil < 0;
                    return (
                      <div key={payment.id} className={`flex items-center justify-between p-2 rounded-lg border ${isOverdue ? "border-red-200 bg-red-50/30 dark:bg-red-950/10" : ""}`}>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{payment.description ?? "Pagamento"}</p>
                          <p className={`text-xs ${isOverdue ? "text-red-500 font-medium" : "text-muted-foreground"}`}>
                            {isOverdue ? `Vencido há ${Math.abs(daysUntil)}d` : `Vence em ${daysUntil}d`}
                          </p>
                        </div>
                        <span className={`text-sm font-bold ml-2 ${isOverdue ? "text-red-600" : "text-blue-600"}`}>
                          {formatCurrency(payment.amount)}
                        </span>
                      </div>
                    );
                  })}
                  {(summary?.pendingFromActiveTrips ?? 0) > 0 && (
                    <div className="mt-3 pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
                      <span>Total pendente (viagens ativas)</span>
                      <span className="font-semibold text-blue-600">{formatCurrency(summary?.pendingFromActiveTrips ?? 0)}</span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Column 3: Funil por Canal */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Funil por Canal</CardTitle>
                <Link href="/pipeline"><Button variant="ghost" size="sm">Pipeline <ArrowUpRight className="w-3 h-3 ml-1" /></Button></Link>
              </div>
              <CardDescription className="text-xs">Leads → Reserva → Confirmado → Pagante</CardDescription>
            </CardHeader>
            <CardContent>
              {loadingFunnel ? (
                <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
              ) : !funnel?.byOrigin?.length ? (
                <p className="text-sm text-muted-foreground text-center py-8">Sem dados de funil.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={funnel.byOrigin.slice(0, 5).map(r => ({
                      origin: r.origin,
                      pagantes: r.withPayment,
                      confirmados: Math.max(0, r.withConfirmed - r.withPayment),
                      reservados: Math.max(0, r.withReservation - r.withConfirmed),
                      naoConvertidos: Math.max(0, r.totalLeads - r.withReservation),
                      totalLeads: r.totalLeads,
                      convPct: r.conversionPct ?? 0,
                      avgTicket: r.avgTicket,
                    }))}
                    layout="vertical"
                    margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
                    barSize={14}
                    barCategoryGap="25%"
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                    <YAxis dataKey="origin" type="category" tick={{ fontSize: 10 }} width={72} />
                    <Tooltip
                      content={({ payload, label }: { payload?: Array<unknown>; label?: string }) => {
                        if (!payload?.length) return null;
                        const row = funnel.byOrigin.find(r => r.origin === label);
                        return (
                          <div className="bg-background border rounded-lg p-2 text-xs shadow-md">
                            <p className="font-semibold mb-1">{label}</p>
                            <p className="flex justify-between gap-3 text-blue-300"><span>Total leads</span><span className="font-bold">{row?.totalLeads ?? 0}</span></p>
                            <p className="flex justify-between gap-3 text-blue-400"><span>C/ reserva</span><span className="font-bold">{row?.withReservation ?? 0}</span></p>
                            <p className="flex justify-between gap-3 text-blue-600"><span>Confirmados</span><span className="font-bold">{row?.withConfirmed ?? 0}</span></p>
                            <p className="flex justify-between gap-3 text-blue-800"><span>Pagantes</span><span className="font-bold">{row?.withPayment ?? 0}</span></p>
                            <p className="flex justify-between gap-3 mt-1 pt-1 border-t text-muted-foreground">
                              <span>Conversão</span><span className="font-bold">{(row?.conversionPct ?? 0).toFixed(1)}%</span>
                            </p>
                            {row && row.avgTicket > 0 && (
                              <p className="flex justify-between gap-3 text-amber-600">
                                <span>Ticket médio</span><span className="font-bold">{formatCurrency(row.avgTicket)}</span>
                              </p>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="naoConvertidos" name="Não convertidos" stackId="f" fill="#DBEAFE" />
                    <Bar dataKey="reservados" name="C/ reserva" stackId="f" fill="#93C5FD" />
                    <Bar dataKey="confirmados" name="Confirmados" stackId="f" fill="#3B82F6" />
                    <Bar dataKey="pagantes" name="Pagantes" stackId="f" fill="#1D4ED8" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ═══ SEÇÃO 4: TOP CLIENTES ═══ */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <SectionTitle icon={UserCheck} title="Top 5 Clientes" description="Clientes com maior volume de compras" />
          <Link href="/analytics/historico-comparativo">
            <Button variant="outline" size="sm" className="text-xs">
              <BarChart2 className="w-3.5 h-3.5 mr-1.5" />
              Histórico Comparativo
              <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </Link>
        </div>
        <Card>
          <CardContent className="p-0">
            {loadingTopCustomers ? (
              <div className="space-y-0 divide-y">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-4">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-1.5"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-24" /></div>
                    <Skeleton className="h-5 w-24" />
                  </div>
                ))}
              </div>
            ) : !topCustomers?.length ? (
              <p className="text-sm text-muted-foreground text-center py-10">Nenhum cliente encontrado.</p>
            ) : (
              <div className="divide-y">
                {topCustomers.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-4 px-5 py-4 hover:bg-muted/40 transition-colors">
                    <span className="text-lg font-bold text-muted-foreground w-5 shrink-0">{i + 1}</span>
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
                      {c.photoUrl ? (
                        <img src={c.photoUrl} alt={c.name} className="h-10 w-10 object-cover rounded-full" />
                      ) : (
                        <span className="text-sm font-semibold text-primary">{c.name.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-emerald-600">{formatCurrency(c.totalSpent)}</p>
                      <p className="text-xs text-muted-foreground">{c.reservationCount} reservas</p>
                    </div>
                    <Link href={`/clients/${c.id}`}>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}


function ClientDashboard() {
  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: upcomingTrips, isLoading: loadingTrips } = useGetDashboardUpcomingTrips();
  const { data: pendingPayments, isLoading: loadingPayments } = useListPayments({ status: PAYMENT_STATUS.PENDING, limit: 5 });
  const { data: me } = useGetMe();
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherAutoDownload, setVoucherAutoDownload] = useState(false);
  const [voucherReservation, setVoucherReservation] = useState<Reservation | null>(null);

  const nextTrip = upcomingTrips?.[0];
  const daysToTrip = nextTrip ? differenceInDays(parseISO(nextTrip.departureDate), new Date()) : null;

  const { data: nextTripReservations } = useListReservations(
    { tripId: nextTrip?.id ?? "", limit: 1 },
    { query: { queryKey: ["dashboard-reservation", nextTrip?.id], enabled: !!nextTrip?.id } }
  );
  const myReservation = (nextTripReservations?.data?.[0] ?? null) as Reservation | null;

  const referralLink = `https://visitecrm.com.br/ref/${me?.referralCode ?? "—"}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Minha Área</h1>
        <p className="text-muted-foreground text-sm">Suas viagens e informações pessoais.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Próxima Viagem" value={daysToTrip != null ? `${daysToTrip} dias` : "—"} sub={nextTrip?.name ?? "Sem viagem agendada"} icon={Map} loading={loadingTrips} color="text-blue-600" />
        <KpiCard title="Pontos de Fidelidade" value="0 pts" sub="Acumule pontos viajando" icon={Star} loading={isLoading} color="text-yellow-500" />
        <KpiCard title="Viagens Realizadas" value={summary?.totalReservations ?? 0} sub="Total de reservas" icon={CalendarCheck} loading={isLoading} />
        <KpiCard title="Saldo de Indicação" value={formatCurrency(me?.referralBalance ?? 0)} sub="Indique amigos e ganhe" icon={DollarSign} loading={isLoading} color="text-green-600" />
      </div>

      {nextTrip && myReservation && myReservation.reservationNumber ? (
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              Sua Próxima Viagem
              {daysToTrip != null && daysToTrip > 0 && (
                <Badge variant="outline">Faltam {daysToTrip} dias</Badge>
              )}
              {daysToTrip === 0 && <Badge className="bg-green-600">Hoje!</Badge>}
            </CardTitle>
            <CardDescription>{nextTrip.name} · {nextTrip.destination}</CardDescription>
          </CardHeader>
          <CardContent>
            <ReservationCardVisual
              reservation={myReservation}
              clientName={me?.name ?? myReservation.client.name}
              agencyName={me?.tenant?.name ?? "Agência"}
              agencyLogo={me?.tenant?.logoUrl}
              departureDate={format(parseISO(nextTrip.departureDate), "dd/MM/yyyy")}
              onViewVoucher={() => { setVoucherReservation(myReservation); setVoucherAutoDownload(false); setVoucherOpen(true); }}
              onDownloadPdf={() => { setVoucherReservation(myReservation); setVoucherAutoDownload(true); setVoucherOpen(true); }}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Sua Próxima Viagem</CardTitle>
          </CardHeader>
          <CardContent>
            {nextTrip ? (
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold">{nextTrip.name}</h3>
                  <p className="text-muted-foreground">{nextTrip.destination}</p>
                  <p className="text-sm mt-1">
                    <span className="font-medium">{format(parseISO(nextTrip.departureDate), "dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</span>
                    {daysToTrip != null && daysToTrip > 0 && <Badge className="ml-2" variant="outline">Faltam {daysToTrip} dias</Badge>}
                  </p>
                </div>
                {myReservation && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setVoucherReservation(myReservation); setVoucherAutoDownload(false); setVoucherOpen(true); }}>
                      Ver Voucher
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => { setVoucherReservation(myReservation); setVoucherAutoDownload(true); setVoucherOpen(true); }}>
                      Baixar PDF
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">Nenhuma viagem agendada no momento.</p>
            )}
          </CardContent>
        </Card>
      )}

      <VoucherModal reservation={voucherReservation} open={voucherOpen} onClose={() => { setVoucherOpen(false); setVoucherAutoDownload(false); }} autoDownload={voucherAutoDownload} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pagamentos Pendentes</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingPayments ? <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              : !pendingPayments?.data.length ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum pagamento pendente.</p>
              ) : (
                <div className="space-y-2">
                  {pendingPayments.data.map(p => (
                    <div key={p.id} className="flex items-center justify-between p-2 rounded-lg border">
                      <div>
                        <p className="text-sm font-medium">{p.description ?? p.category}</p>
                        <p className="text-xs text-muted-foreground">Vence {format(parseISO(p.dueDate), "dd/MM/yyyy", { locale: ptBR })}</p>
                      </div>
                      <span className="font-semibold">{formatCurrency(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Indicar Amigos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">Indique amigos e ganhe bônus em sua próxima viagem!</p>
            <div className="flex gap-2">
              <Input readOnly value={referralLink} className="text-xs bg-muted/50" />
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(referralLink)}>Copiar</Button>
            </div>
            <div className="flex items-center gap-2 p-3 bg-green-50 rounded-lg border border-green-100">
              <DollarSign className="w-5 h-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-700">Saldo disponível</p>
                <p className="text-xs text-green-600">{formatCurrency(me?.referralBalance ?? 0)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Minhas Avaliações</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">Nenhuma avaliação enviada ainda.</p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Dashboard() {
  const { data: me } = useGetMe();
  const role = me?.role;

  if (role === ROLES.CLIENT) return <ClientDashboard />;
  if (role === ROLES.SALES) return <Redirect to="/meu-painel" />;
  return <AgencyDashboard />;
}
