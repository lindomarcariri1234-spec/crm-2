import { useState } from "react";
import { localToday } from "@workspace/shared";
import { useListAdminAuditLogs, useListTenants, type AuditLogWithTenant } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  Download,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  RotateCcw,
  HelpCircle,
} from "lucide-react";

const PAGE_SIZE = 30;

const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-100 text-green-800",
  update: "bg-blue-100 text-blue-800",
  delete: "bg-red-100 text-red-800",
  login: "bg-purple-100 text-purple-800",
  suspend: "bg-orange-100 text-orange-800",
  activate: "bg-emerald-100 text-emerald-800",
};

const ENTITY_LABELS: Record<string, string> = {
  client: "Cliente",
  trip: "Viagem",
  reservation: "Reserva",
  user: "Usuário",
  tenant: "Agência",
  payment: "Pagamento",
};

function fmtDate(date: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(date));
}

type DeliveryReviewFilter = "all" | "inconclusive" | "found" | "resend";
type DeliveryReviewStatus = Exclude<DeliveryReviewFilter, "all">;

type DeliveryReviewEntry = {
  log: AuditLogWithTenant;
  status: DeliveryReviewStatus;
  label: string;
  detail: string;
  provider: string;
  operator: string;
};

function metadataString(metadata: AuditLogWithTenant["before"] | AuditLogWithTenant["after"], key: string) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function formatProvider(provider: string) {
  const labels: Record<string, string> = {
    evolution: "Evolution",
    "z-api": "Z-API",
    resend: "Resend",
  };
  return labels[provider] ?? provider;
}

function toDeliveryReviewEntry(log: AuditLogWithTenant): DeliveryReviewEntry | null {
  if (
    log.entityType !== "outbound_delivery" ||
    (log.action !== "reconcile_outbound_delivery" && log.action !== "retry_reconciled_outbound_delivery")
  ) {
    return null;
  }

  const outcome = metadataString(log.after, "outcome");
  const provider = metadataString(log.after, "provider") ?? metadataString(log.before, "provider") ?? "Não identificado";
  const operator = log.userName ?? log.userId ?? "Sistema";

  if (log.action === "retry_reconciled_outbound_delivery") {
    return {
      log,
      status: "resend",
      label: "Reenvio autorizado",
      detail: "Nova tentativa liberada após confirmação de ausência",
      provider: formatProvider(provider),
      operator,
    };
  }

  if (outcome === "accepted") {
    return {
      log,
      status: "found",
      label: "Encontrada no provedor",
      detail: "O provedor confirmou que a mensagem já foi aceita",
      provider: formatProvider(provider),
      operator,
    };
  }

  if (outcome === "not_found") {
    return {
      log,
      status: "resend",
      label: "Ausente — reenvio disponível",
      detail: "O provedor não encontrou a mensagem original",
      provider: formatProvider(provider),
      operator,
    };
  }

  return {
    log,
    status: "inconclusive",
    label: "Consulta inconclusiva",
    detail: "O resultado do provedor não permitiu concluir a revisão",
    provider: formatProvider(provider),
    operator,
  };
}

export default function AdminLogsPage() {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [tenantFilter, setTenantFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [reviewFilter, setReviewFilter] = useState<DeliveryReviewFilter>("all");
  const [reviewPage, setReviewPage] = useState(1);

  const params: Record<string, string> = {};
  if (tenantFilter !== "all") params.tenantId = tenantFilter;
  if (actionFilter !== "all") params.action = actionFilter;
  if (entityFilter !== "all") params.entityType = entityFilter;

  const { data: logs = [], isLoading, isError } = useListAdminAuditLogs(
    Object.keys(params).length > 0 ? params as Parameters<typeof useListAdminAuditLogs>[0] : undefined
  );
  const { data: deliveryReviewLogs = [], isLoading: reviewsLoading, isError: reviewsError } = useListAdminAuditLogs({
    entityType: "outbound_delivery",
    ...(tenantFilter !== "all" ? { tenantId: tenantFilter } : {}),
  });
  const { data: tenants = [] } = useListTenants();

  const filtered = logs.filter(l => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      l.entityId.toLowerCase().includes(s) ||
      (l.userName ?? "").toLowerCase().includes(s) ||
      (l.tenantName ?? "").toLowerCase().includes(s)
    );
  });

  const entityTypes = Array.from(new Set(logs.map((l) => l.entityType))).sort();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const deliveryReviews = deliveryReviewLogs
    .map(toDeliveryReviewEntry)
    .filter((entry): entry is DeliveryReviewEntry => entry !== null)
    .filter((entry) => reviewFilter === "all" || entry.status === reviewFilter);
  const reviewTotalPages = Math.max(1, Math.ceil(deliveryReviews.length / PAGE_SIZE));
  const paginatedReviews = deliveryReviews.slice((reviewPage - 1) * PAGE_SIZE, reviewPage * PAGE_SIZE);

  function handleFilterChange(setter: (v: string) => void) {
    return (v: string) => { setter(v); setPage(1); setReviewPage(1); };
  }

  function handleExport() {
    const headers = ["Data", "Ação", "Entidade", "ID Entidade", "Usuário", "Agência"];
    const rows = filtered.map(l => [
      fmtDate(l.createdAt),
      l.action,
      l.entityType,
      l.entityId,
      l.userName ?? "",
      l.tenantName ?? l.tenantId,
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${localToday()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasFilters = search || actionFilter !== "all" || entityFilter !== "all" || tenantFilter !== "all";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Logs de Auditoria</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Histórico global de ações na plataforma · {filtered.length} registros
          </p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={filtered.length === 0}>
          <Download className="w-4 h-4 mr-2" />
          Exportar CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por usuário, entidade ou ID..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <Select value={actionFilter} onValueChange={handleFilterChange(setActionFilter)}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Ação" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="create">Criar</SelectItem>
            <SelectItem value="update">Atualizar</SelectItem>
            <SelectItem value="delete">Excluir</SelectItem>
            <SelectItem value="login">Login</SelectItem>
            <SelectItem value="suspend">Suspender</SelectItem>
            <SelectItem value="activate">Ativar</SelectItem>
          </SelectContent>
        </Select>
        <Select value={entityFilter} onValueChange={handleFilterChange(setEntityFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Entidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {entityTypes.map((e) => (
              <SelectItem key={e} value={e}>{ENTITY_LABELS[e] ?? e}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tenantFilter} onValueChange={handleFilterChange(setTenantFilter)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Agência" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas agências</SelectItem>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" onClick={() => { setSearch(""); setActionFilter("all"); setEntityFilter("all"); setTenantFilter("all"); setPage(1); }}>
            Limpar
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Revisões de entrega</h2>
                <Badge variant="secondary">{deliveryReviews.length}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Consultas ambíguas e autorizações de reenvio por agência. Conteúdo e destinatários não são exibidos.
              </p>
            </div>
            <Select
              value={reviewFilter}
              onValueChange={(value) => {
                setReviewFilter(value as DeliveryReviewFilter);
                setReviewPage(1);
              }}
            >
              <SelectTrigger className="w-full sm:w-52">
                <SelectValue placeholder="Resultado da revisão" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os resultados</SelectItem>
                <SelectItem value="inconclusive">Inconclusivas</SelectItem>
                <SelectItem value="found">Encontradas</SelectItem>
                <SelectItem value="resend">Reenvio autorizado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {reviewsLoading ? (
            <div className="py-10 text-center text-sm text-muted-foreground animate-pulse">Carregando revisões...</div>
          ) : reviewsError ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <AlertCircle className="mx-auto mb-2 h-7 w-7 text-destructive opacity-60" />
              Não foi possível carregar a trilha de revisões.
            </div>
          ) : deliveryReviews.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma revisão encontrada para os filtros selecionados.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Data</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Resultado</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Provedor</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Operador</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Agência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedReviews.map((entry) => (
                      <tr key={entry.log.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{fmtDate(entry.log.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-start gap-2">
                            {entry.status === "found" ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                            ) : entry.status === "resend" ? (
                              <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                            ) : (
                              <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                            )}
                            <div>
                              <div className="font-medium">{entry.label}</div>
                              <div className="text-xs text-muted-foreground">{entry.detail}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{entry.provider}</td>
                        <td className="px-4 py-3">{entry.operator}</td>
                        <td className="px-4 py-3 text-muted-foreground">{entry.log.tenantName ?? entry.log.tenantId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {reviewTotalPages > 1 && (
                <div className="flex items-center justify-between border-t px-4 py-3">
                  <span className="text-xs text-muted-foreground">
                    {deliveryReviews.length} revisões · Página {reviewPage} de {reviewTotalPages}
                  </span>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={reviewPage <= 1} onClick={() => setReviewPage((p) => p - 1)}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={reviewPage >= reviewTotalPages} onClick={() => setReviewPage((p) => p + 1)}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground animate-pulse">Carregando logs...</div>
          ) : isError ? (
            <div className="text-center py-12 text-muted-foreground">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-destructive opacity-60" />
              <p className="text-sm">Erro ao carregar logs. Verifique suas permissões.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">Nenhum log encontrado.</div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Data</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Ação</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Recurso</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">ID do Recurso</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Usuário</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Agência</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((log) => (
                      <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground text-xs whitespace-nowrap">{fmtDate(log.createdAt)}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ACTION_COLORS[log.action] ?? "bg-muted text-muted-foreground"}`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{log.entityType}</td>
                        <td className="px-4 py-3 text-muted-foreground font-mono text-xs truncate max-w-[140px]">{log.entityId}</td>
                        <td className="px-4 py-3">
                          {log.userName ? (
                            <div>
                              <div className="text-xs font-medium">{log.userName}</div>
                              {log.userEmail && <div className="text-xs text-muted-foreground">{log.userEmail}</div>}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{log.tenantName ?? log.tenantId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <span className="text-xs text-muted-foreground">
                    {filtered.length} logs · Página {page} de {totalPages}
                  </span>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
