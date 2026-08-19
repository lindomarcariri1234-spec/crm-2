import { useQuery } from "@tanstack/react-query";
import { formatCurrency } from "@/lib/utils";
import { useGetAdminStats, useGetSystemHealth, getGetSystemHealthQueryKey } from "@workspace/api-client-react";
import { TENANT_STATUS } from "@workspace/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, Building2, CheckCircle2, Clock, XCircle, TrendingUp, History } from "lucide-react";

const PLAN_LABELS: Record<string, string> = {
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
};

const STATUS_LABELS: Record<string, string> = {
  [TENANT_STATUS.ACTIVE]: "Ativos",
  [TENANT_STATUS.TRIAL]: "Em Trial",
  [TENANT_STATUS.SUSPENDED]: "Suspensos",
};

const STATUS_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  [TENANT_STATUS.ACTIVE]: CheckCircle2,
  [TENANT_STATUS.TRIAL]: Clock,
  [TENANT_STATUS.SUSPENDED]: XCircle,
};

const STATUS_COLORS: Record<string, string> = {
  [TENANT_STATUS.ACTIVE]: "text-green-600",
  [TENANT_STATUS.TRIAL]: "text-amber-600",
  [TENANT_STATUS.SUSPENDED]: "text-red-600",
};

const REDIS_STATUS_CONFIG = {
  degraded: {
    label: "Redis degradado",
    description:
      "O Redis está recebendo erros transitórios consecutivos. Filas de e-mail, PDF e lembretes podem estar lentas ou paradas.",
    classes: "bg-amber-50 border-amber-300 text-amber-800",
    iconClasses: "text-amber-500",
  },
  unavailable: {
    label: "Redis indisponível",
    description:
      "O limite diário de requisições do Redis (Upstash free tier) foi atingido ou o serviço está inacessível. E-mails, PDFs e lembretes automáticos estão parados até a conexão ser restabelecida.",
    classes: "bg-red-50 border-red-300 text-red-800",
    iconClasses: "text-red-500",
  },
};

function buildDailyUsageAlert(
  usagePct: number,
  commandCount: number,
  maxCommands: number,
  warningThresholdPct: number,
): { label: string; description: string; classes: string; iconClasses: string } | null {
  if (usagePct < warningThresholdPct) return null;
  const pctLabel = usagePct.toFixed(1);
  const usedLabel = commandCount.toLocaleString("pt-BR");
  const maxLabel = maxCommands.toLocaleString("pt-BR");
  const isCritical = usagePct >= 90;
  return {
    label: isCritical
      ? `Redis: uso crítico (${pctLabel}% do limite diário)`
      : `Redis: uso elevado (${pctLabel}% do limite diário)`,
    description: `${usedLabel} de ${maxLabel} requisições usadas hoje. ${
      isCritical
        ? "O serviço pode ser interrompido em breve. Reduza o polling ou atualize o plano."
        : "Considere reduzir a frequência de polling ou atualizar o plano Upstash."
    }`,
    classes: isCritical
      ? "bg-red-50 border-red-300 text-red-800"
      : "bg-amber-50 border-amber-300 text-amber-800",
    iconClasses: isCritical ? "text-red-500" : "text-amber-500",
  };
}

export default function AdminDashboard() {
  const { data: stats, isLoading } = useGetAdminStats();
  const { data: systemHealth } = useGetSystemHealth({
    query: { queryKey: getGetSystemHealthQueryKey(), refetchInterval: 60_000 },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">Carregando métricas...</div>
      </div>
    );
  }

  const statusKeys = [TENANT_STATUS.ACTIVE, TENANT_STATUS.TRIAL, TENANT_STATUS.SUSPENDED];
  const planKeys = Object.keys(stats?.byPlan ?? {});
  const redisStatus = systemHealth?.redis?.status;
  const redisAlert = redisStatus && redisStatus !== "ok" ? REDIS_STATUS_CONFIG[redisStatus] : null;
  const workersEnabled = systemHealth?.workers?.enabled ?? true;

  const redisDailyUsage = systemHealth?.redis?.dailyUsage ?? null;
  const dailyUsageAlert = redisDailyUsage
    ? buildDailyUsageAlert(
        redisDailyUsage.usagePct,
        redisDailyUsage.commandCount,
        redisDailyUsage.maxCommands,
        redisDailyUsage.warningThresholdPct,
      )
    : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Visão Geral da Plataforma</h1>
        <p className="text-muted-foreground text-sm mt-1">Métricas globais de todos os tenants cadastrados</p>
      </div>

      {redisAlert && (
        <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${redisAlert.classes}`}>
          <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${redisAlert.iconClasses}`} />
          <div>
            <p className="font-semibold text-sm">{redisAlert.label}</p>
            <p className="text-sm mt-0.5">{redisAlert.description}</p>
          </div>
        </div>
      )}

      {dailyUsageAlert && !redisAlert && (
        <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${dailyUsageAlert.classes}`}>
          <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${dailyUsageAlert.iconClasses}`} />
          <div>
            <p className="font-semibold text-sm">{dailyUsageAlert.label}</p>
            <p className="text-sm mt-0.5">{dailyUsageAlert.description}</p>
          </div>
        </div>
      )}

      {!workersEnabled && (
        <div className="flex items-start gap-3 rounded-lg border px-4 py-3 bg-amber-50 border-amber-300 text-amber-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="font-semibold text-sm">Workers em segundo plano desativados</p>
            <p className="text-sm mt-0.5">
              A variável <code className="font-mono text-xs bg-amber-100 px-1 rounded">ENABLE_WORKERS</code> está como <code className="font-mono text-xs bg-amber-100 px-1 rounded">false</code>.
              E-mails, PDFs e lembretes automáticos serão processados de forma síncrona. Defina{" "}
              <code className="font-mono text-xs bg-amber-100 px-1 rounded">ENABLE_WORKERS=true</code> para ativar o processamento assíncrono via filas.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total de Tenants</CardTitle>
            <Building2 className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.totalTenants ?? 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">MRR Estimado</CardTitle>
            <TrendingUp className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-600">{formatCurrency(stats?.mrr ?? 0)}</div>
            <p className="text-xs text-muted-foreground mt-1">Apenas tenants ativos</p>
          </CardContent>
        </Card>

        {statusKeys.map((key) => {
          const Icon = STATUS_ICONS[key] ?? Building2;
          const count = stats?.byStatus?.[key] ?? 0;
          return (
            <Card key={key}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {STATUS_LABELS[key] ?? key}
                </CardTitle>
                <Icon className={`w-4 h-4 ${STATUS_COLORS[key] ?? ""}`} />
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${STATUS_COLORS[key] ?? ""}`}>{count}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Distribuição por Plano</CardTitle>
        </CardHeader>
        <CardContent>
          {planKeys.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum dado disponível</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {["starter", "pro", "enterprise"].map((plan) => {
                const count = stats?.byPlan?.[plan] ?? 0;
                const total = stats?.totalTenants ?? 1;
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <div key={plan} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{PLAN_LABELS[plan] ?? plan}</span>
                      <span className="text-muted-foreground">{count} tenants</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          plan === "enterprise"
                            ? "bg-indigo-500"
                            : plan === "pro"
                            ? "bg-blue-500"
                            : "bg-slate-400"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{pct}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <RedisAlertLogCard />
    </div>
  );
}

interface RedisAlertLogEntry {
  id: string;
  eventType: string;
  alertStatus: string | null;
  emailTo: string | null;
  triggeredAt: string;
}

const EVENT_LABELS: Record<string, string> = {
  alert: "Alerta enviado",
  recovery: "Recuperação",
  daily_limit: "Limite diário",
};

const STATUS_BADGE: Record<string, string> = {
  degraded: "bg-amber-100 text-amber-700",
  unavailable: "bg-red-100 text-red-700",
};

function RedisAlertLogCard() {
  const { data: logs, isLoading } = useQuery<RedisAlertLogEntry[]>({
    queryKey: ["/admin/redis-alert-log"],
    queryFn: async () => {
      const res = await fetch("/api/admin/redis-alert-log");
      if (!res.ok) return [];
      return res.json() as Promise<RedisAlertLogEntry[]>;
    },
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <History className="w-4 h-4 text-muted-foreground" />
        <CardTitle className="text-base">Histórico de Alertas Redis</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : !logs || logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum alerta registrado.</p>
        ) : (
          <div className="divide-y">
            {logs.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="font-medium w-36 shrink-0">{EVENT_LABELS[entry.eventType] ?? entry.eventType}</span>
                {entry.alertStatus && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[entry.alertStatus] ?? "bg-muted text-muted-foreground"}`}>
                    {entry.alertStatus}
                  </span>
                )}
                <span className="text-muted-foreground truncate flex-1">{entry.emailTo ?? "—"}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {new Date(entry.triggeredAt).toLocaleString("pt-BR")}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
