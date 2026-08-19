import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  DollarSign,
  CalendarCheck,
  Star,
  Target,
  Users,
  Map,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  X,
  ArrowRight,
  RefreshCw,
  Bot,
  Zap,
  BarChart3,
  ShieldAlert,
  Minus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useGetGemeoMetrics,
  useGetGemeoAlerts,
  useGetGemeoOpportunities,
  useDismissGemeoAlert,
  useDismissGemeoOpportunity,
} from "@workspace/api-client-react";
import type {
  GemeoMetrics,
  GemeoAlertItem,
  GemeoOpportunityItem,
} from "@workspace/api-client-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtBRL(v: number): string {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(v);
}

function timeAgo(isoString: string): string {
  const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60) return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  return `${Math.floor(diff / 3600)}h atrás`;
}

type HealthStatus = "good" | "warn" | "bad";

function healthBadge(status: HealthStatus) {
  if (status === "good")
    return (
      <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-0 text-xs">
        <CheckCircle2 className="w-3 h-3 mr-1" /> Saudável
      </Badge>
    );
  if (status === "warn")
    return (
      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-0 text-xs">
        <AlertTriangle className="w-3 h-3 mr-1" /> Atenção
      </Badge>
    );
  return (
    <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-0 text-xs">
      <XCircle className="w-3 h-3 mr-1" /> Crítico
    </Badge>
  );
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

interface KPICardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  trend?: number | null;
  color: string;
}

function KPICard({ icon, label, value, sub, trend, color }: KPICardProps) {
  return (
    <Card className="relative overflow-hidden">
      <div className={`absolute inset-0 opacity-5 ${color}`} />
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className={`p-2 rounded-lg ${color} bg-opacity-10`}>{icon}</div>
          {trend !== null && trend !== undefined && (
            <div
              className={`flex items-center gap-1 text-xs font-medium ${trend >= 0 ? "text-emerald-600" : "text-red-500"}`}
            >
              {trend >= 0 ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              {trend >= 0 ? "+" : ""}
              {trend.toFixed(1)}%
            </div>
          )}
        </div>
        <div className="mt-3">
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          <p className="text-sm text-gray-500 mt-0.5">{label}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Quadrant Card ───────────────────────────────────────────────────────────

interface MetricRow {
  label: string;
  value: string;
  sub?: string;
}

interface QuadrantCardProps {
  title: string;
  icon: React.ReactNode;
  color: string;
  health: HealthStatus;
  metrics: MetricRow[];
  extra?: React.ReactNode;
}

function QuadrantCard({ title, icon, color, health, metrics, extra }: QuadrantCardProps) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-md ${color}`}>{icon}</div>
            <CardTitle className="text-sm font-semibold text-gray-700">{title}</CardTitle>
          </div>
          {healthBadge(health)}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="space-y-2.5">
          {metrics.map((m, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-xs text-gray-500">{m.label}</span>
              <div className="text-right">
                <span className="text-sm font-semibold text-gray-800">{m.value}</span>
                {m.sub && <span className="text-xs text-gray-400 ml-1">{m.sub}</span>}
              </div>
            </div>
          ))}
        </div>
        {extra && <div className="mt-3">{extra}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Alert Card ──────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  occupancy: { label: "Ocupação", color: "bg-blue-100 text-blue-700" },
  churn: { label: "Churn", color: "bg-red-100 text-red-700" },
  revenue: { label: "Receita", color: "bg-emerald-100 text-emerald-700" },
  opportunity: { label: "Oportunidade", color: "bg-purple-100 text-purple-700" },
};

const SEVERITY_DOT: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-blue-400",
};

interface AlertCardProps {
  alert: GemeoAlertItem;
  onDismiss: (id: string) => void;
  dismissing: boolean;
}

function AlertCard({ alert, onDismiss, dismissing }: AlertCardProps) {
  const cat = CATEGORY_LABELS[alert.category] ?? { label: alert.category, color: "bg-gray-100 text-gray-600" };
  const [, navigate] = useLocation();

  return (
    <div className="flex items-start gap-2.5 p-3 rounded-lg bg-gray-50 border border-gray-100 group">
      <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${SEVERITY_DOT[alert.severity] ?? "bg-gray-400"}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${cat.color}`}>{cat.label}</span>
        </div>
        <p className="text-xs text-gray-700 leading-relaxed">{alert.message}</p>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-xs text-gray-400">{timeAgo(alert.generatedAt)}</span>
          {alert.actionUrl && (
            <button
              onClick={() => navigate(alert.actionUrl!)}
              className="text-xs text-blue-600 hover:underline flex items-center gap-0.5"
            >
              Ver <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      <button
        onClick={() => onDismiss(alert.id)}
        disabled={dismissing}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-gray-200 flex-shrink-0"
        title="Dispensar"
      >
        <X className="w-3.5 h-3.5 text-gray-400" />
      </button>
    </div>
  );
}

// ─── Opportunity Card ────────────────────────────────────────────────────────

interface OpportunityCardProps {
  opp: GemeoOpportunityItem;
  onDismiss: (id: string) => void;
  dismissing: boolean;
  index: number;
}

function OpportunityCard({ opp, onDismiss, dismissing, index }: OpportunityCardProps) {
  const [, navigate] = useLocation();

  return (
    <div className="p-3 rounded-lg bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-100">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-600 text-white text-xs flex items-center justify-center font-bold">
            {index + 1}
          </span>
          <p className="text-xs font-semibold text-gray-800">{opp.title}</p>
        </div>
        <button
          onClick={() => onDismiss(opp.id)}
          disabled={dismissing}
          className="p-0.5 rounded hover:bg-violet-100 flex-shrink-0"
          title="Dispensar"
        >
          <X className="w-3 h-3 text-gray-400" />
        </button>
      </div>
      {opp.description && (
        <p className="text-xs text-gray-600 mt-1.5 ml-7 leading-relaxed">{opp.description}</p>
      )}
      {opp.actionUrl && (
        <button
          onClick={() => navigate(opp.actionUrl!)}
          className="mt-2 ml-7 flex items-center gap-1 text-xs text-violet-700 font-medium hover:underline"
        >
          Ir para ação <ArrowRight className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ─── Skeletons ───────────────────────────────────────────────────────────────

function KPISkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <Skeleton className="h-6 w-24 mt-3" />
        <Skeleton className="h-4 w-32 mt-1" />
      </CardContent>
    </Card>
  );
}

function QuadrantSkeleton() {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2 pt-4 px-4">
        <Skeleton className="h-5 w-28" />
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2.5">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-5/6" />
      </CardContent>
    </Card>
  );
}

// ─── Health computation ───────────────────────────────────────────────────────

function computeGrowthHealth(metrics: GemeoMetrics): HealthStatus {
  const cr = metrics.growth.conversionRate;
  if (cr >= 50) return "good";
  if (cr >= 25) return "warn";
  return "bad";
}

function computeRevenueHealth(metrics: GemeoMetrics): HealthStatus {
  const change = metrics.kpis.revenueMTDChangePct;
  if (change === null) return "warn";
  if (change >= 0) return "good";
  if (change >= -15) return "warn";
  return "bad";
}

function computeOperationHealth(metrics: GemeoMetrics): HealthStatus {
  const occ = metrics.operation.avgOccupancy;
  if (occ >= 65) return "good";
  if (occ >= 35) return "warn";
  return "bad";
}

function computeRetentionHealth(metrics: GemeoMetrics): HealthStatus {
  const nps = metrics.retention.npsAvg30d;
  const churn = metrics.retention.churnSignals;
  if (nps !== null && nps >= 8 && churn < 10) return "good";
  if (nps !== null && nps >= 6) return "warn";
  if (churn > 20) return "bad";
  return "warn";
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function GemeoDigital() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(t);
  }, []);

  const {
    data: metrics,
    isLoading: metricsLoading,
    refetch: refetchMetrics,
    isFetching: metricsFetching,
  } = useGetGemeoMetrics();

  const { data: alertsData, isLoading: alertsLoading } = useGetGemeoAlerts();
  const { data: oppsData, isLoading: oppsLoading } = useGetGemeoOpportunities();

  const { mutate: dismissAlert, isPending: dismissingAlert } = useDismissGemeoAlert();
  const { mutate: dismissOpp, isPending: dismissingOpp } = useDismissGemeoOpportunity();

  const handleRefresh = useCallback(() => {
    void refetchMetrics();
  }, [refetchMetrics]);

  const alerts = alertsData?.alerts ?? [];
  const opportunities = oppsData?.opportunities ?? [];

  const cachedAt = metrics?.cachedAt ? new Date(metrics.cachedAt) : null;
  const secAgo = cachedAt ? Math.floor((now.getTime() - cachedAt.getTime()) / 1000) : null;
  const updatedLabel =
    secAgo === null
      ? "—"
      : secAgo < 5
        ? "agora mesmo"
        : secAgo < 60
          ? `${secAgo}s atrás`
          : `${Math.floor(secAgo / 60)}min atrás`;

  return (
    <div className="flex flex-col gap-5 p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-violet-100">
              <Activity className="w-5 h-5 text-violet-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Gêmeo Digital do Negócio</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1 ml-10">
            Visão executiva em tempo real · Atualizado {updatedLabel}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={metricsFetching}
          className="gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${metricsFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {metricsLoading ? (
          <>
            <KPISkeleton />
            <KPISkeleton />
            <KPISkeleton />
            <KPISkeleton />
          </>
        ) : metrics ? (
          <>
            <KPICard
              icon={<DollarSign className="w-4 h-4 text-emerald-600" />}
              label="Receita MTD"
              value={fmtBRL(metrics.kpis.revenueMTD)}
              sub={`Mês anterior: ${fmtBRL(metrics.kpis.revenueMTDPrev)}`}
              trend={metrics.kpis.revenueMTDChangePct}
              color="bg-emerald-500"
            />
            <KPICard
              icon={<CalendarCheck className="w-4 h-4 text-blue-600" />}
              label="Reservas esta semana"
              value={String(metrics.kpis.reservationsThisWeek)}
              sub={`Hoje: ${metrics.kpis.reservationsToday}`}
              trend={null}
              color="bg-blue-500"
            />
            <KPICard
              icon={<Star className="w-4 h-4 text-amber-500" />}
              label="NPS médio 30d"
              value={
                metrics.kpis.npsAvg30d !== null
                  ? `${metrics.kpis.npsAvg30d.toFixed(1)} / 10`
                  : "—"
              }
              sub={`${metrics.kpis.npsCount30d} resposta${metrics.kpis.npsCount30d !== 1 ? "s" : ""}`}
              trend={null}
              color="bg-amber-500"
            />
            <KPICard
              icon={<Target className="w-4 h-4 text-violet-600" />}
              label="Oportunidades de compra"
              value={String(metrics.kpis.opportunitySignals)}
              sub="Clientes com score alto, idle 90d"
              trend={null}
              color="bg-violet-500"
            />
          </>
        ) : null}
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Health Quadrants */}
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {metricsLoading ? (
            <>
              <QuadrantSkeleton />
              <QuadrantSkeleton />
              <QuadrantSkeleton />
              <QuadrantSkeleton />
            </>
          ) : metrics ? (
            <>
              {/* Crescimento */}
              <QuadrantCard
                title="Crescimento"
                icon={<TrendingUp className="w-3.5 h-3.5 text-blue-600" />}
                color="bg-blue-50"
                health={computeGrowthHealth(metrics)}
                metrics={[
                  {
                    label: "Novas reservas (mês)",
                    value: String(metrics.growth.newLeadsThisMonth),
                  },
                  {
                    label: "Taxa de conversão",
                    value: `${metrics.growth.conversionRate.toFixed(1)}%`,
                    sub: `(ant: ${metrics.growth.conversionRatePrev.toFixed(1)}%)`,
                  },
                  {
                    label: "Pipeline em aberto",
                    value: fmtBRL(metrics.growth.pipelineValue),
                  },
                ]}
              />

              {/* Receita */}
              <QuadrantCard
                title="Receita"
                icon={<DollarSign className="w-3.5 h-3.5 text-emerald-600" />}
                color="bg-emerald-50"
                health={computeRevenueHealth(metrics)}
                metrics={[
                  {
                    label: "Receita MTD",
                    value: fmtBRL(metrics.revenue.mtd),
                    sub:
                      metrics.kpis.revenueMTDChangePct !== null
                        ? `${metrics.kpis.revenueMTDChangePct >= 0 ? "+" : ""}${metrics.kpis.revenueMTDChangePct.toFixed(1)}%`
                        : undefined,
                  },
                  {
                    label: "Lucro líquido (est.)",
                    value: fmtBRL(metrics.revenue.netProfit),
                  },
                  {
                    label: "A receber (pendente)",
                    value: fmtBRL(metrics.revenue.receivablePending),
                  },
                ]}
              />

              {/* Operação */}
              <QuadrantCard
                title="Operação"
                icon={<Map className="w-3.5 h-3.5 text-amber-600" />}
                color="bg-amber-50"
                health={computeOperationHealth(metrics)}
                metrics={[
                  {
                    label: "Viagens ativas",
                    value: String(metrics.operation.activeTrips),
                  },
                  {
                    label: "Ocupação média",
                    value: `${metrics.operation.avgOccupancy}%`,
                  },
                  {
                    label: "Viagens em risco",
                    value: String(metrics.operation.tripsAtRisk),
                    sub: "(<30d, <50%)",
                  },
                ]}
                extra={
                  metrics.operation.avgOccupancy > 0 ? (
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-gray-400 mb-0.5">
                        <span>Ocupação média</span>
                        <span>{metrics.operation.avgOccupancy}%</span>
                      </div>
                      <Progress value={metrics.operation.avgOccupancy} className="h-1.5" />
                    </div>
                  ) : undefined
                }
              />

              {/* Retenção */}
              <QuadrantCard
                title="Retenção"
                icon={<Users className="w-3.5 h-3.5 text-purple-600" />}
                color="bg-purple-50"
                health={computeRetentionHealth(metrics)}
                metrics={[
                  {
                    label: "NPS médio (30d)",
                    value:
                      metrics.retention.npsAvg30d !== null
                        ? `${metrics.retention.npsAvg30d.toFixed(1)} / 10`
                        : "—",
                  },
                  {
                    label: "Sinais de churn",
                    value: String(metrics.retention.churnSignals),
                    sub: "clientes score >70",
                  },
                  {
                    label: "Prontos p/ comprar",
                    value: String(metrics.retention.opportunitySignals),
                    sub: "idle 90d",
                  },
                ]}
              />
            </>
          ) : null}
        </div>

        {/* Right Sidebar */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          {/* AI Alerts */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-md bg-red-50">
                    <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-gray-700">
                    Alertas da IA
                  </CardTitle>
                </div>
                {alerts.length > 0 && (
                  <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-0 text-xs">
                    {alerts.length}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">Gerado diariamente · Clique X para dispensar</p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {alertsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : alerts.length === 0 ? (
                <div className="text-center py-6">
                  <Bot className="w-7 h-7 text-gray-300 mx-auto mb-2" />
                  <p className="text-xs text-gray-400">
                    Nenhum alerta ativo.
                    <br />
                    O cron gera alertas diariamente.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {alerts.map((alert) => (
                    <AlertCard
                      key={alert.id}
                      alert={alert}
                      onDismiss={(id) => dismissAlert(id)}
                      dismissing={dismissingAlert}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Opportunities */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center gap-2">
                <div className="p-1 rounded-md bg-violet-50">
                  <Zap className="w-3.5 h-3.5 text-violet-500" />
                </div>
                <CardTitle className="text-sm font-semibold text-gray-700">
                  Oportunidades da Semana
                </CardTitle>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">Gerado toda segunda-feira pela IA</p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {oppsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              ) : opportunities.length === 0 ? (
                <div className="text-center py-6">
                  <BarChart3 className="w-7 h-7 text-gray-300 mx-auto mb-2" />
                  <p className="text-xs text-gray-400">
                    Nenhuma oportunidade ativa.
                    <br />
                    O cron gera recomendações às segundas.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {opportunities.map((opp, i) => (
                    <OpportunityCard
                      key={opp.id}
                      opp={opp}
                      onDismiss={(id) => dismissOpp(id)}
                      dismissing={dismissingOpp}
                      index={i}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Future Trips at Risk */}
          {metrics && metrics.operation.futureTrips.filter((t) => t.atRisk).length > 0 && (
            <Card>
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center gap-2">
                  <div className="p-1 rounded-md bg-amber-50">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  </div>
                  <CardTitle className="text-sm font-semibold text-gray-700">
                    Viagens em Risco
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <div className="space-y-2">
                  {metrics.operation.futureTrips
                    .filter((t) => t.atRisk)
                    .slice(0, 4)
                    .map((trip) => (
                      <div key={trip.id} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-700 truncate max-w-[140px]">
                            {trip.name}
                          </span>
                          <span className="text-xs text-amber-600 font-semibold">
                            {trip.fillRate}%
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Progress value={trip.fillRate} className="h-1.5 flex-1" />
                          <span className="text-xs text-gray-400 flex-shrink-0">
                            {trip.daysUntil}d
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
