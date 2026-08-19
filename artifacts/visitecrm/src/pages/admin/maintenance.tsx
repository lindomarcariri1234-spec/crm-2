import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Trash2,
  ScanSearch,
  FileImage,
  ExternalLink,
  CheckSquare,
  Square,
  History,
  Clock,
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Database,
  Mail,
  Bell,
  FileText,
  DollarSign,
  Gauge,
  Users,
  Play,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  useGetSystemHealth,
  useHealthCheck,
  getGetSystemHealthQueryKey,
  getHealthCheckQueryKey,
} from "@workspace/api-client-react";

interface OrphanedFile {
  key: string;
  name: string;
  size: number;
  url: string;
}

interface CleanupHistoryEntry {
  executedAt: Date;
  deletedCount: number;
  freedBytes: number;
  failedCount: number;
  scope: "selected" | "all";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(date: Date): string {
  return date.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

type StatusLevel = "ok" | "degraded" | "unavailable" | "loading" | "unknown";

interface StatusDotProps {
  status: StatusLevel;
}

function StatusDot({ status }: StatusDotProps) {
  if (status === "loading") {
    return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />;
  }
  if (status === "ok") {
    return <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />;
  }
  if (status === "degraded") {
    return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
  }
  if (status === "unavailable") {
    return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
  }
  return <XCircle className="w-4 h-4 text-muted-foreground shrink-0" />;
}

interface StatusBadgeProps {
  status: StatusLevel;
}

function StatusBadge({ status }: StatusBadgeProps) {
  if (status === "loading") {
    return <Badge variant="secondary" className="text-xs">Verificando...</Badge>;
  }
  if (status === "ok") {
    return <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 border-green-200">Operacional</Badge>;
  }
  if (status === "degraded") {
    return <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 border-amber-200">Degradado</Badge>;
  }
  if (status === "unavailable") {
    return <Badge variant="destructive" className="text-xs">Indisponível</Badge>;
  }
  return <Badge variant="secondary" className="text-xs">Desconhecido</Badge>;
}

interface HealthRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  status: StatusLevel;
}

function HealthRow({ icon: Icon, label, description, status }: HealthRowProps) {
  return (
    <div className="flex items-center gap-3 py-3 border-b last:border-b-0">
      <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StatusDot status={status} />
        <StatusBadge status={status} />
      </div>
    </div>
  );
}

function SystemHealthSection() {
  const { data: systemHealth, isLoading: isLoadingSystemHealth, dataUpdatedAt } = useGetSystemHealth({
    query: { queryKey: getGetSystemHealthQueryKey(), refetchInterval: 60_000 },
  });

  const { data: healthData, isLoading: isLoadingHealth } = useHealthCheck({
    query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 60_000 },
  });

  const isLoading = isLoadingSystemHealth || isLoadingHealth;

  const redisStatus: StatusLevel = isLoading
    ? "loading"
    : systemHealth?.redis?.status ?? "unknown";

  const redisDailyUsage = systemHealth?.redis?.dailyUsage ?? null;

  const dbStatus: StatusLevel = isLoading
    ? "loading"
    : healthData?.database?.connected
    ? "ok"
    : "unavailable";

  function workerStatus(running: boolean | undefined): StatusLevel {
    if (isLoading) return "loading";
    if (running === undefined) return "unknown";
    return running ? "ok" : "unavailable";
  }

  const workers = healthData?.bullmq?.workers;
  const bullmqAllOk = healthData?.bullmq?.active;
  const bullmqStatus: StatusLevel = isLoading
    ? "loading"
    : bullmqAllOk === undefined
    ? "unknown"
    : bullmqAllOk
    ? "ok"
    : "degraded";

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Status do Sistema
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Verificação em tempo real dos componentes da plataforma. Atualiza automaticamente a cada 60 segundos.
            </CardDescription>
          </div>
          {lastUpdated && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
              <RefreshCw className="w-3 h-3" />
              <span>
                {lastUpdated.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-0 divide-y divide-border -mt-2">
        <div className="pb-3 border-b">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Infraestrutura</p>
          <HealthRow
            icon={Database}
            label="Banco de Dados"
            description="Conectividade com o PostgreSQL"
            status={dbStatus}
          />
          <HealthRow
            icon={Activity}
            label="Redis / Cache"
            description={
              redisStatus === "ok"
                ? "Conectado e respondendo normalmente"
                : redisStatus === "degraded"
                ? "Erros transitórios consecutivos — filas podem estar lentas"
                : redisStatus === "unavailable"
                ? "Inacessível — limite diário atingido ou serviço fora do ar"
                : "Verificando conexão..."
            }
            status={redisStatus}
          />
          {!isLoading && redisDailyUsage !== null && (
            <div className="py-3 border-b last:border-b-0">
              <div className="flex items-center gap-3 mb-2">
                <Gauge className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Uso Diário do Redis (Upstash)</p>
                  <p className="text-xs text-muted-foreground">
                    {redisDailyUsage.commandCount.toLocaleString("pt-BR")} de{" "}
                    {redisDailyUsage.maxCommands.toLocaleString("pt-BR")} requisições hoje
                  </p>
                </div>
                <span
                  className={`text-sm font-semibold shrink-0 ${
                    redisDailyUsage.usagePct >= 90
                      ? "text-red-600"
                      : redisDailyUsage.usagePct >= redisDailyUsage.warningThresholdPct
                      ? "text-amber-600"
                      : "text-green-600"
                  }`}
                >
                  {redisDailyUsage.usagePct.toFixed(1)}%
                </span>
              </div>
              <div className="pl-7">
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      redisDailyUsage.usagePct >= 90
                        ? "bg-red-500"
                        : redisDailyUsage.usagePct >= redisDailyUsage.warningThresholdPct
                        ? "bg-amber-400"
                        : "bg-green-500"
                    }`}
                    style={{ width: `${Math.min(redisDailyUsage.usagePct, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Limite diário: {redisDailyUsage.maxCommands.toLocaleString("pt-BR")} req — aviso a partir de{" "}
                  {redisDailyUsage.warningThresholdPct}%
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="pt-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Workers (BullMQ)</p>
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs text-muted-foreground">Status geral dos workers</span>
            <div className="flex items-center gap-2">
              <StatusDot status={bullmqStatus} />
              <StatusBadge status={bullmqStatus} />
            </div>
          </div>
          <HealthRow
            icon={Mail}
            label="Worker de E-mail"
            description="Envio de e-mails transacionais e notificações"
            status={workerStatus(workers?.email)}
          />
          <HealthRow
            icon={Bell}
            label="Worker de Lembretes"
            description="Lembretes automáticos para clientes e agências"
            status={workerStatus(workers?.reminder)}
          />
          <HealthRow
            icon={FileText}
            label="Worker de PDF"
            description="Geração de vouchers e manifesto de passageiros"
            status={workerStatus(workers?.pdf)}
          />
          <HealthRow
            icon={DollarSign}
            label="Worker de Comissões"
            description="Sincronização de comissões e repasses"
            status={workerStatus(workers?.commissionSync)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

interface BackfillResult {
  inserted: number;
  skipped: number;
  total: number;
}

function ReferralPendingBackfillSection() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BackfillResult | null>(null);
  // True once a run with inserted > 0 completes — used to suppress the button
  // so a second click doesn't return a confusing "0 pedidos analisados" response.
  const [completedWithInserts, setCompletedWithInserts] = useState(false);
  // Dry-run count fetched on mount. null = still loading.
  const [dryRunCount, setDryRunCount] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const CACHE_KEY = "backfill_referral_pending_zero";

  useEffect(() => {
    // Skip the fetch if a prior dry-run already returned zero this session.
    if (sessionStorage.getItem(CACHE_KEY) === "1") {
      setDryRunCount(0);
      return;
    }
    fetch("/api/admin/maintenance/backfill-referral-pending-orders/dry-run", {
      credentials: "include",
    })
      .then((res) => res.json())
      .then((data) => {
        const count = data.count ?? 0;
        setDryRunCount(count);
        if (count === 0) {
          sessionStorage.setItem(CACHE_KEY, "1");
        }
      })
      .catch(() => setDryRunCount(0));
  }, []);

  const hasWork = completedWithInserts || (dryRunCount !== null && dryRunCount > 0);

  async function runBackfill() {
    // Clear the zero-count cache so the next mount re-checks after a manual run.
    sessionStorage.removeItem(CACHE_KEY);
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/maintenance/backfill-referral-pending-orders", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao executar backfill");
      setResult(data);
      if (data.inserted > 0) {
        setCompletedWithInserts(true);
        setDryRunCount((prev) => (prev != null ? Math.max(0, prev - data.inserted) : 0));
        toast({
          title: `${data.inserted} indicação(ões) inserida(s) como pendente`,
          description: data.skipped > 0 ? `${data.skipped} pedido(s) ignorado(s)` : undefined,
        });
      } else {
        toast({
          title: "Nenhum pedido para processar",
          description: "Todos os pedidos já foram corrigidos ou não há pedidos com código de indicação aguardando pagamento.",
        });
      }
    } catch (err) {
      toast({ title: "Erro no backfill", description: String(err), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          Backfill: Indicações Pendentes
        </CardTitle>
        <CardDescription className="text-xs">
          Cria linhas <strong>Pendente</strong> na tabela de indicações para pedidos que foram realizados com código de indicação{" "}
          antes da atualização que passou a registrá-las imediatamente no checkout. Operação idempotente — pedidos já processados
          são ignorados automaticamente.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasWork && !expanded ? (
          <div className="flex items-start gap-2.5 rounded-md border border-green-200 bg-green-50 px-3 py-2.5">
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-0.5">
              <p className="text-sm font-medium text-green-800">
                Nada a corrigir
                {dryRunCount === 0 && (
                  <span className="font-normal text-green-700"> — todos os pedidos já estão processados</span>
                )}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 px-2 text-green-700 hover:text-green-900 hover:bg-green-100 mt-1"
                onClick={() => { sessionStorage.removeItem(CACHE_KEY); setExpanded(true); }}
              >
                {expanded ? (
                  <ChevronUp className="w-3 h-3 mr-1.5" />
                ) : (
                  <ChevronDown className="w-3 h-3 mr-1.5" />
                )}
                Mostrar opções
              </Button>
            </div>
          </div>
        ) : completedWithInserts ? (
          <div className="flex items-start gap-2.5 rounded-md border border-green-200 bg-green-50 px-3 py-2.5">
            <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-green-800">
                Backfill concluído nesta sessão
                {result && (
                  <span className="font-normal text-green-700">
                    {" "}— {result.inserted} indicação{result.inserted !== 1 ? "ões" : ""} inserida{result.inserted !== 1 ? "s" : ""}
                    {result.skipped > 0 && `, ${result.skipped} ignorada${result.skipped !== 1 ? "s" : ""}`}
                  </span>
                )}
              </p>
              <p className="text-xs text-green-700">
                Re-execute apenas se novos pedidos com código de indicação chegaram desde então. A operação é segura de repetir.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 px-2 text-green-700 hover:text-green-900 hover:bg-green-100 mt-1"
                onClick={() => { setCompletedWithInserts(false); setResult(null); }}
              >
                <RefreshCw className="w-3 h-3 mr-1.5" />
                Executar novamente
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={runBackfill} disabled={running} size="sm">
              {running ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              {running ? "Executando..." : "Executar Backfill"}
            </Button>
            {result && !running && (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 border-green-200">
                  Nenhum pendente
                </Badge>
                {result.skipped > 0 && (
                  <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 border-amber-200">
                    {result.skipped} ignorado{result.skipped !== 1 ? "s" : ""}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  {result.total} pedido{result.total !== 1 ? "s" : ""} analisado{result.total !== 1 ? "s" : ""}
                </span>
              </div>
            )}
          </div>
        )}
        {result && !completedWithInserts && result.total === 0 && (
          <p className="text-xs text-muted-foreground">
            Não há pedidos com código de indicação aguardando pagamento sem linha correspondente na tabela de indicações.
          </p>
        )}
        {expanded && !hasWork && (
          <p className="text-xs text-muted-foreground">
            Não há pedidos com código de indicação aguardando pagamento sem linha correspondente na tabela de indicações. A operação pode ser executada novamente se novos pedidos legados surgirem.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminMaintenance() {
  const { toast } = useToast();
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [files, setFiles] = useState<OrphanedFile[]>([]);
  const [totalSize, setTotalSize] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [history, setHistory] = useState<CleanupHistoryEntry[]>([]);

  async function scan() {
    setScanning(true);
    setScanned(false);
    setFiles([]);
    setSelected(new Set());
    try {
      const res = await fetch("/api/admin/maintenance/orphaned-files", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro na varredura");
      setFiles(data.files ?? []);
      setTotalSize(data.totalSize ?? 0);
      setScanned(true);
    } catch (err) {
      toast({ title: "Erro na varredura", description: String(err), variant: "destructive" });
    } finally {
      setScanning(false);
    }
  }

  async function deleteSelected() {
    setDeleting(true);
    setConfirmOpen(false);
    const keys = selected.size > 0 ? Array.from(selected) : undefined;
    const scope: "selected" | "all" = keys ? "selected" : "all";
    const targetFiles = keys ? files.filter(f => keys.includes(f.key)) : files;
    const freedBytesEstimate = targetFiles.reduce((sum, f) => sum + f.size, 0);
    try {
      const res = await fetch("/api/admin/maintenance/orphaned-files", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun: false, keys }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao deletar");
      toast({
        title: `${data.deleted} arquivo(s) deletado(s)`,
        description: data.failed > 0 ? `${data.failed} falha(s)` : undefined,
      });
      setHistory(prev => [
        {
          executedAt: new Date(),
          deletedCount: data.deleted ?? 0,
          freedBytes: freedBytesEstimate,
          failedCount: data.failed ?? 0,
          scope,
        },
        ...prev,
      ]);
      setFiles(prev => prev.filter(f => !(keys ? keys.includes(f.key) : true)));
      setSelected(new Set());
      if (!keys) setScanned(false);
    } catch (err) {
      toast({ title: "Erro ao deletar arquivos", description: String(err), variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  function toggleAll() {
    if (selected.size === files.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(files.map(f => f.key)));
    }
  }

  function toggle(key: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const allSelected = files.length > 0 && selected.size === files.length;
  const someSelected = selected.size > 0;
  const deleteCount = selected.size > 0 ? selected.size : files.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Manutenção</h1>
        <p className="text-sm text-muted-foreground">
          Status do sistema e limpeza de dados.
        </p>
      </div>

      <SystemHealthSection />

      <ReferralPendingBackfillSection />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileImage className="w-4 h-4 text-primary" />
            Limpeza de Arquivos Órfãos
          </CardTitle>
          <CardDescription className="text-xs">
            Arquivos enviados para o armazenamento que não estão mais vinculados a nenhum registro no banco de dados.
            Faça a varredura para identificá-los e remova-os para liberar espaço.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button onClick={scan} disabled={scanning || deleting} size="sm">
              {scanning ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ScanSearch className="w-4 h-4 mr-2" />
              )}
              {scanning ? "Varrendo..." : "Verificar Arquivos Órfãos"}
            </Button>
            {scanned && (
              <div className="flex items-center gap-2">
                {files.length > 0 ? (
                  <Badge variant="destructive" className="text-xs">
                    {files.length} arquivo{files.length !== 1 ? "s" : ""} órfão{files.length !== 1 ? "s" : ""} — {formatBytes(totalSize)}
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs bg-green-100 text-green-700">
                    Nenhum arquivo órfão encontrado
                  </Badge>
                )}
              </div>
            )}
          </div>

          {scanned && files.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs gap-1.5"
                  onClick={toggleAll}
                >
                  {allSelected ? (
                    <CheckSquare className="w-3.5 h-3.5" />
                  ) : (
                    <Square className="w-3.5 h-3.5" />
                  )}
                  {allSelected ? "Desmarcar todos" : "Selecionar todos"}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={() => setConfirmOpen(true)}
                  className="text-xs"
                >
                  {deleting ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  {someSelected
                    ? `Deletar ${selected.size} selecionado${selected.size !== 1 ? "s" : ""}`
                    : `Deletar todos (${files.length})`}
                </Button>
              </div>

              <div className="border rounded-md divide-y max-h-[400px] overflow-y-auto text-sm">
                {files.map(file => (
                  <div key={file.key} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30">
                    <Checkbox
                      checked={selected.has(file.key)}
                      onCheckedChange={() => toggle(file.key)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{file.name}</p>
                      <p className="text-xs text-muted-foreground font-mono truncate">{file.key}</p>
                    </div>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">{formatBytes(file.size)}</span>
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:text-primary/80"
                      title="Visualizar arquivo"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              Histórico de Limpezas (sessão atual)
            </CardTitle>
            <CardDescription className="text-xs">
              Registro das limpezas executadas nesta sessão.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-md divide-y text-sm">
              {history.map((entry, i) => (
                <div key={i} className="flex items-center justify-between gap-4 px-3 py-2.5">
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>{formatDateTime(entry.executedAt)}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap justify-end">
                    <span className="text-xs">
                      <span className="font-medium text-destructive">{entry.deletedCount}</span>
                      {" "}arquivo{entry.deletedCount !== 1 ? "s" : ""} deletado{entry.deletedCount !== 1 ? "s" : ""}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ~{formatBytes(entry.freedBytes)} liberado{entry.freedBytes > 0 ? "s" : ""}
                    </span>
                    <span className="text-xs">
                      Escopo: <span className="font-medium">{entry.scope === "all" ? "Todos" : "Selecionados"}</span>
                    </span>
                    {entry.failedCount > 0 && (
                      <span className="text-xs text-destructive">{entry.failedCount} falha(s)</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Você está prestes a deletar permanentemente{" "}
              <strong>{deleteCount} arquivo{deleteCount !== 1 ? "s" : ""}</strong> do armazenamento.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteSelected}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Deletar {deleteCount} arquivo{deleteCount !== 1 ? "s" : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
