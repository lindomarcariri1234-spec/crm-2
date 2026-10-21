import { useState } from "react";
import { useGetSystemHealth, getGetSystemHealthQueryKey, useRepairSystemHealth, useRepairSeatDrift } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Activity,
  Database,
  GitMerge,
  Loader2,
  Info,
  DollarSign,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type StatusLevel = "ok" | "drift_detected" | "orphans_detected" | "degraded" | "unavailable" | "loading" | "unknown";

function StatusDot({ status }: { status: StatusLevel }) {
  if (status === "loading") return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />;
  if (status === "ok") return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
  if (status === "drift_detected" || status === "orphans_detected" || status === "degraded")
    return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
  if (status === "unavailable") return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
  return <Info className="w-4 h-4 text-muted-foreground shrink-0" />;
}

function StatusBadge({ status }: { status: StatusLevel }) {
  if (status === "ok") return <Badge variant="secondary" className="text-green-700 bg-green-100 border-green-200">OK</Badge>;
  if (status === "drift_detected") return <Badge variant="secondary" className="text-amber-700 bg-amber-100 border-amber-200">Divergência</Badge>;
  if (status === "orphans_detected") return <Badge variant="secondary" className="text-amber-700 bg-amber-100 border-amber-200">Órfãos</Badge>;
  if (status === "degraded") return <Badge variant="secondary" className="text-amber-700 bg-amber-100 border-amber-200">Degradado</Badge>;
  if (status === "unavailable") return <Badge variant="destructive">Indisponível</Badge>;
  if (status === "loading") return <Badge variant="outline">Carregando...</Badge>;
  return <Badge variant="outline">Desconhecido</Badge>;
}

function MetricRow({
  icon: Icon,
  label,
  description,
  status,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description?: string;
  status: StatusLevel;
  value?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {value && <span className="text-xs text-muted-foreground font-mono">{value}</span>}
      <div className="flex items-center gap-2">
        <StatusDot status={status} />
        <StatusBadge status={status} />
      </div>
    </div>
  );
}

function formatReminderTime(value: string | null, timezone: string) {
  if (!value) return "sem registro";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "horário inválido";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleString("pt-BR");
  }
}

export default function SystemHealthPage() {
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [isRepairingSeatDrift, setIsRepairingSeatDrift] = useState(false);

  const { data, isLoading, dataUpdatedAt, refetch } = useGetSystemHealth({
    query: { queryKey: getGetSystemHealthQueryKey(), refetchInterval: 60_000 },
  });

  const repairMutation = useRepairSystemHealth();
  const repairSeatDriftMutation = useRepairSeatDrift();

  async function handleRefresh() {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }

  async function handleRepairSeatDrift() {
    setIsRepairingSeatDrift(true);
    try {
      const result = await repairSeatDriftMutation.mutateAsync();
      toast({
        title: "Correção concluída",
        description:
          result.fixed === 0
            ? "Nenhuma viagem com divergência encontrada."
            : `${result.fixed} viagem(ns) corrigida(s).${result.skipped > 0 ? ` ${result.skipped} ignorada(s).` : ""}`,
      });
      await refetch();
    } catch {
      toast({
        title: "Erro ao corrigir",
        description: "Não foi possível corrigir a divergência de assentos. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsRepairingSeatDrift(false);
    }
  }

  async function handleRepair() {
    setIsRepairing(true);
    try {
      const result = await repairMutation.mutateAsync();
      toast({
        title: "Correção concluída",
        description:
          result.orphansFixed === 0 && result.tripsCorrected === 0
            ? "Nenhum problema encontrado."
            : [
                result.orphansFixed > 0 ? `${result.orphansFixed} negócio(s) órfão(s) corrigido(s).` : "",
                result.tripsCorrected > 0 ? `${result.tripsCorrected} viagem(ns) com divergência de assentos corrigida(s).` : "",
              ]
                .filter(Boolean)
                .join(" "),
      });
      await refetch();
    } catch {
      toast({
        title: "Erro ao corrigir",
        description: "Não foi possível corrigir os negócios órfãos. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setIsRepairing(false);
    }
  }

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  const seatDrift = data?.seatDrift;
  const orphans = data?.pipelineOrphans;
  const clientDrift = data?.clientFinancialDrift;
  const stripeSyncTables = data?.stripeSyncTables;
  const queueCutover = data?.redis?.queueCutover;
  const reminderSchedulers = data?.reminderSchedulers;
  const reminderSchedulerStatus: StatusLevel = isLoading
    ? "loading"
    : reminderSchedulers?.status === "ok"
    ? "ok"
    : reminderSchedulers?.status === "degraded"
    ? "degraded"
    : "unknown";

  const seatStatus: StatusLevel = isLoading
    ? "loading"
    : seatDrift
    ? (seatDrift.status as StatusLevel)
    : "unknown";

  const orphanStatus: StatusLevel = isLoading
    ? "loading"
    : orphans
    ? (orphans.status as StatusLevel)
    : "unknown";

  const clientDriftStatus: StatusLevel = isLoading
    ? "loading"
    : clientDrift
    ? (clientDrift.status as StatusLevel)
    : "unknown";

  const stripeSyncTablesStatus: StatusLevel = isLoading
    ? "loading"
    : stripeSyncTables?.ok === true
    ? "ok"
    : stripeSyncTables?.ok === false
    ? "degraded"
    : "unknown";
  const queueCutoverStatus: StatusLevel = isLoading
    ? "loading"
    : queueCutover?.outcome === "verified" || queueCutover?.outcome === "same_resource"
    ? "ok"
    : queueCutover?.outcome === "blocked" || queueCutover?.outcome === "reverted"
    ? "degraded"
    : "unknown";
  const queueCutoverOutcomeLabel = queueCutover
    ? ({
        not_checked: "Ainda não verificado",
        checking: "Verificando",
        not_configured: "Redis separado não configurado",
        workers_disabled: "Workers desativados",
        blocked: "Troca bloqueada com segurança",
        approved: "Aprovado, aguardando teste",
        verified: "Redis separado confirmado",
        reverted: "Retornado ao Redis anterior",
        same_resource: "Mesmo recurso Redis",
      }[queueCutover.outcome] ?? queueCutover.outcome)
    : undefined;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Saúde dos Dados</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monitoramento de consistência dos dados críticos da plataforma.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              Atualizado: {lastUpdated.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing || isLoading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isRefreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            Integração Stripe
          </CardTitle>
          <CardDescription>
            Verifica se as tabelas usadas pelo sincronismo de cobranças estão disponíveis.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border -mt-2">
          <MetricRow
            icon={DollarSign}
            label="Tabelas do Stripe Sync"
            description={
              stripeSyncTables?.ok === false
                ? "Tabelas ausentes — o sincronismo de cobranças não funcionará até a correção."
                : stripeSyncTables?.ok === true
                ? "stripe.accounts verificada com sucesso"
                : "Aguardando verificação no startup..."
            }
            status={stripeSyncTablesStatus}
            value={
              stripeSyncTables?.checkedAt
                ? `Verificado: ${new Date(stripeSyncTables.checkedAt).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}`
                : undefined
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            Redis das filas BullMQ
          </CardTitle>
          <CardDescription>
            Mostra qual Redis as filas usam e por que a troca de recurso foi aprovada ou bloqueada.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 -mt-2">
          <MetricRow
            icon={Activity}
            label="Redis selecionado"
            description={queueCutover?.reason ?? (isLoading ? "Aguardando verificação..." : "Resultado de cutover indisponível.")}
            status={queueCutoverStatus}
            value={queueCutover ? `${queueCutover.selectedRedis} · ${queueCutoverOutcomeLabel}` : undefined}
          />
          {queueCutover && (queueCutover.blockerCount > 0 || queueCutover.blockedWorkCount > 0) && (
            <div className="rounded-md border border-amber-300/70 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20">
              <p className="font-medium">
                {queueCutover.blockerCount} bloqueador(es) · {queueCutover.blockedWorkCount} item(ns) na fila legada
              </p>
              <ul className="mt-2 space-y-2">
                {queueCutover.blockers.map((blocker, index) => (
                  <li key={`${blocker.queue}-${blocker.state}-${index}`} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {blocker.queue === "*" ? "Inspeção" : blocker.queue}
                      {blocker.count > 0 ? ` · ${blocker.count} ${blocker.state}` : ""}
                    </span>
                    <span className="block">{blocker.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            Agendamentos de lembretes
          </CardTitle>
          <CardDescription>
            Horários no fuso {reminderSchedulers?.timezone ?? "configurado"}; schedules ausentes ou atrasados ficam destacados.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border -mt-2">
          <MetricRow
            icon={Activity}
            label="Registro dos schedulers"
            description={
              reminderSchedulers
                ? `${reminderSchedulers.schedulers.length - reminderSchedulers.unattemptedCount} tentados · ${reminderSchedulers.failedCount} falha(s) · ${reminderSchedulers.missingCount} ausentes · ${reminderSchedulers.delayedCount} atrasados`
                : "Aguardando dados de registro..."
            }
            status={reminderSchedulerStatus}
          />
          {reminderSchedulers?.schedulers.map((scheduler) => {
            const schedulerStatus: StatusLevel = scheduler.scheduleStatus === "healthy"
              ? "ok"
              : scheduler.scheduleStatus === "delayed" ||
                scheduler.scheduleStatus === "missing" ||
                scheduler.scheduleStatus === "registration_failed"
              ? "degraded"
              : scheduler.scheduleStatus === "unavailable"
              ? "unavailable"
              : "unknown";
            const labels: Record<string, string> = {
              "boarding-reminder-daily": "Lembrete de embarque",
              "payment-reminder-daily": "Lembrete de pagamento",
              "expired-reservations-cleanup": "Limpeza de reservas expiradas",
              "failed-email-retry": "Nova tentativa de e-mails",
              "referral-expiry-notification-daily": "Aviso de expiração de indicação",
              "referral-expiry-warning-daily": "Alerta de expiração de indicação",
              "expiry-warning-email-retry": "Nova tentativa de avisos de expiração",
              "referral-bonus-release-notification-daily": "Aviso de liberação de bônus",
              "nps-dispatch-hourly": "Envio de pesquisa NPS",
              "installment-due-reminder-daily": "Lembrete de parcela",
              "seat-reconciliation-daily": "Reconciliação de assentos",
              "trial-expiry-notification-daily": "Aviso de expiração de avaliação",
              "uploadthing-orphan-cleanup-nightly": "Limpeza de arquivos órfãos",
              "chatbot-delivery-retry": "Nova tentativa de entrega do chatbot",
            };
            const scheduleStatusLabel: Record<typeof scheduler.scheduleStatus, string> = {
              healthy: "Agendado",
              registration_failed: "Falha no registro",
              missing: "Scheduler ausente na fila",
              delayed: "Próxima execução atrasada",
              unavailable: "Estado da fila indisponível",
            };
            const lastRunLabel = scheduler.lastRunAt
              ? `${formatReminderTime(scheduler.lastRunAt, reminderSchedulers.timezone)}${scheduler.lastRunStatus === "failed" ? " (falhou)" : ""}`
              : "sem execução recente encontrada";
            const description = [
              scheduleStatusLabel[scheduler.scheduleStatus],
              `próxima: ${formatReminderTime(scheduler.nextRunAt, reminderSchedulers.timezone)}`,
              `última: ${lastRunLabel}`,
              scheduler.scheduleStatus === "registration_failed" ? `${scheduler.failureCount} falha(s) no registro` : "",
            ].filter(Boolean).join(" · ");
            return (
              <MetricRow
                key={scheduler.id}
                icon={schedulerStatus === "degraded" ? AlertTriangle : Activity}
                label={labels[scheduler.id] ?? scheduler.name}
                description={description}
                status={schedulerStatus}
              />
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="w-4 h-4 text-primary" />
                Contadores de Assentos
              </CardTitle>
              <CardDescription className="mt-1.5">
                Compara os contadores armazenados (reserved_seats, confirmed_seats, available_seats) com os valores
                calculados a partir das reservas ativas. Divergências são corrigidas automaticamente a cada 24h (04:00 BRT).
              </CardDescription>
            </div>
            {seatStatus === "drift_detected" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRepairSeatDrift}
                disabled={isRepairingSeatDrift}
                className="shrink-0 mt-0.5"
              >
                {isRepairingSeatDrift ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                )}
                Corrigir Divergências
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="divide-y divide-border -mt-2">
          <MetricRow
            icon={Activity}
            label="Divergência de Assentos"
            description={
              seatDrift
                ? `${seatDrift.tripsWithDrift} de ${seatDrift.tripsChecked} viagens ativas com divergência`
                : "Aguardando dados..."
            }
            status={seatStatus}
            value={seatDrift ? `${seatDrift.tripsChecked} viagens verificadas` : undefined}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base flex items-center gap-2">
                <GitMerge className="w-4 h-4 text-primary" />
                Pipeline — Negócios Órfãos
              </CardTitle>
              <CardDescription className="mt-1.5">
                Negócios no Pipeline com status "Aberto" cujas reservas vinculadas estão canceladas. Estes negócios
                deveriam ter sido revertidos automaticamente no momento do cancelamento.
              </CardDescription>
            </div>
            {orphanStatus === "orphans_detected" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRepair}
                disabled={isRepairing}
                className="shrink-0 mt-0.5"
              >
                {isRepairing ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                )}
                Corrigir Órfãos
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="divide-y divide-border -mt-2">
          <MetricRow
            icon={Activity}
            label="Negócios Abertos em Reservas Canceladas"
            description={
              orphans
                ? orphans.openDealsOnCancelledReservations === 0
                  ? "Nenhum negócio órfão encontrado"
                  : `${orphans.openDealsOnCancelledReservations} negócio(s) órfão(s) detectado(s)`
                : "Aguardando dados..."
            }
            status={orphanStatus}
            value={
              orphans
                ? `${orphans.openDealsOnCancelledReservations} órfão(s)`
                : undefined
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-primary" />
            Financeiro — Saldo Negativo de Clientes
          </CardTitle>
          <CardDescription>
            Clientes cujo saldo devedor armazenado é negativo (pagaram mais do que o registrado). Indica
            inconsistência nos cálculos financeiros — corrigida automaticamente na próxima criação/edição de pagamento.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border -mt-2">
          <MetricRow
            icon={Activity}
            label="Clientes com Saldo Negativo"
            description={
              clientDrift
                ? clientDrift.clientsWithNegativeBalance === 0
                  ? "Nenhum cliente com inconsistência financeira"
                  : `${clientDrift.clientsWithNegativeBalance} cliente(s) com saldo devedor negativo`
                : "Aguardando dados..."
            }
            status={clientDriftStatus}
            value={clientDrift ? `${clientDrift.clientsWithNegativeBalance} cliente(s)` : undefined}
          />
        </CardContent>
      </Card>

      <Card className="border-muted/60 bg-muted/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="w-4 h-4 text-muted-foreground" />
            Sobre a Reconciliação Automática
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            <strong className="text-foreground">Contadores de assentos:</strong> Corrigidos automaticamente todos os dias
            às 04:00 (BRT). Para correção imediata de todas as viagens com divergência, use o botão "Corrigir agora"
            acima. Para uma viagem específica, use "Sincronizar Contadores" no mapa de assentos da viagem.
          </p>
          <p>
            <strong className="text-foreground">Negócios do pipeline:</strong> Negócios órfãos são prevenidos pelo
            sincronismo retroativo automático que ocorre ao cancelar uma reserva. Negócios anteriores à implementação
            desta funcionalidade podem aparecer aqui.
          </p>
          <p>
            <strong className="text-foreground">Saldo negativo de clientes:</strong> Recalculado automaticamente a cada
            criação ou edição de pagamento. Divergências remanescentes indicam inconsistências históricas.
          </p>
          <p>
            <strong className="text-foreground">Atualização automática:</strong> Esta página atualiza a cada 60 segundos.
            Os contadores de divergência são calculados em tempo real e podem levar alguns segundos para atualizar
            após uma correção manual.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
