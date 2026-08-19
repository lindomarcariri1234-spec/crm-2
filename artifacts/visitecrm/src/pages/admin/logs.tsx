import { useState } from "react";
import { localToday } from "@workspace/shared";
import { useListAdminAuditLogs, useListTenants } from "@workspace/api-client-react";
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
import { Search, Download, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";

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
  return new Date(date).toLocaleString("pt-BR");
}

export default function AdminLogsPage() {
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [entityFilter, setEntityFilter] = useState("all");
  const [tenantFilter, setTenantFilter] = useState("all");
  const [page, setPage] = useState(1);

  const params: Record<string, string> = {};
  if (tenantFilter !== "all") params.tenantId = tenantFilter;
  if (actionFilter !== "all") params.action = actionFilter;
  if (entityFilter !== "all") params.entityType = entityFilter;

  const { data: logs = [], isLoading, isError } = useListAdminAuditLogs(
    Object.keys(params).length > 0 ? params as Parameters<typeof useListAdminAuditLogs>[0] : undefined
  );
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

  function handleFilterChange(setter: (v: string) => void) {
    return (v: string) => { setter(v); setPage(1); };
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
