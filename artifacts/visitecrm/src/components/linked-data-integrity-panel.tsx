import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, History, Loader2, RefreshCw, Wrench } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface LinkedDataReconciliationIssue {
  type: string;
  id: string;
  reason: string;
}

export interface LinkedDataReconciliationResult {
  repaired: string[];
  issues: LinkedDataReconciliationIssue[];
  mode: "dry-run" | "repair";
  generatedAt: string;
  checked: number;
  repairedCount: number;
  issueCount: number;
  summary: {
    checked: Record<string, number>;
    repaired: Record<string, number>;
    issues: Record<string, number>;
  };
  categories: Record<string, {
    checked: number;
    repaired: string[];
    issues: LinkedDataReconciliationIssue[];
  }>;
}

interface LinkedDataReconciliationHistoryEntry {
  id: string;
  mode: "dry-run" | "repair";
  executedAt: string;
  checkedCount: number;
  repairedCount: number;
  issueCount: number;
  summary: Record<string, {
    checked: number;
    repaired: number;
    issues: number;
    reasons: Record<string, number>;
  }>;
}

interface LinkedDataReconciliationHistory {
  items: LinkedDataReconciliationHistoryEntry[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
}

export function groupReconciliationIssues(issues: LinkedDataReconciliationIssue[]) {
  return issues.reduce<Record<string, LinkedDataReconciliationIssue[]>>((groups, issue) => {
    (groups[issue.type] ??= []).push(issue);
    return groups;
  }, {});
}

const CATEGORY_LABELS: Record<string, string> = {
  "client-financial": "Financeiro do cliente",
  "trip-seats": "Assentos da viagem",
  "reservation-passengers": "Passageiros da reserva",
  "client-user": "Conta do cliente",
  "reservation-order": "Reserva e pedido",
  "order-client": "Cliente do pedido",
  "order-payment": "Pedido e pagamento",
  "referral-reservation": "Indicação e reserva",
  "deal-reservation": "Oportunidade e reserva",
  "pipeline-deal": "Oportunidade do pipeline",
};

const ISSUE_REASON_LABELS: Record<string, string> = {
  receivable_totals_mismatch: "Totais de recebíveis divergentes",
  seat_counters_mismatch: "Contadores de assentos divergentes",
  missing_unambiguous_primary_passenger: "Passageiro principal ausente; origem única identificada",
  passenger_count_diagnostic: "Quantidade de passageiros divergente; requer análise",
  missing_unambiguous_email_link: "Conta sem vínculo com correspondência exata",
  ambiguous_or_already_linked_email: "E-mail ambíguo ou já vinculado",
  order_missing_in_tenant: "Pedido não encontrado nesta agência",
  missing_unambiguous_client: "Cliente ausente; origem única identificada",
  client_mismatch_or_multi_trip: "Cliente divergente ou pedido com várias viagens",
  fully_paid_reservations_with_unpaid_order: "Reservas quitadas, mas pedido não pago",
  reservation_missing_in_tenant: "Reserva não encontrada nesta agência",
  ambiguous_order_candidates: "Mais de um pedido possível",
  ambiguous_multi_reservation_order: "Pedido com várias reservas possíveis",
  referral_order_has_no_trip_reservations: "Pedido de indicação sem reserva de viagem",
  missing_unambiguous_canonical_reservation: "Reserva canônica ausente; origem única identificada",
  duplicate_reservation_deals: "Mais de uma oportunidade ligada à reserva",
  client_trip_or_value_mismatch: "Cliente, viagem ou valor divergente da reserva",
  missing_valid_reservation_deal: "Oportunidade válida da reserva não encontrada",
  missing_deal_invalid_reservation_links: "Oportunidade ausente e vínculos da reserva inválidos",
};

export function readableIntegrityCategory(value: string) {
  return CATEGORY_LABELS[value] ?? value.replace(/[_-]/g, " ");
}

export function readableIntegrityReason(value: string) {
  return ISSUE_REASON_LABELS[value] ?? value.replace(/[_-]/g, " ");
}

async function reconcileLinkedData(repair: boolean): Promise<LinkedDataReconciliationResult> {
  const response = await fetch(`${BASE}/api/admin/linked-data/reconcile`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repair }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(body?.message ?? body?.error ?? "Não foi possível verificar os vínculos.");
  }
  return response.json() as Promise<LinkedDataReconciliationResult>;
}

async function fetchReconciliationHistory(offset: number): Promise<LinkedDataReconciliationHistory> {
  const response = await fetch(`${BASE}/api/admin/linked-data/reconcile/history?limit=8&offset=${offset}`, {
    credentials: "include",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new Error(body?.message ?? body?.error ?? "Não foi possível carregar o histórico.");
  }
  return response.json() as Promise<LinkedDataReconciliationHistory>;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function invalidateLinkedDataQueries(queryClient: ReturnType<typeof useQueryClient>) {
  const terms = [
    "clients", "users", "trips", "reservations", "stats", "referrals",
    "pipeline", "deals", "store/orders", "store-orders", "ranking", "club", "alerts",
    "financial-metrics", "payments", "expenses", "commissions", "dashboard", "analytics", "insights",
  ];
  return queryClient.invalidateQueries({
    predicate: (query) => terms.some((term) => JSON.stringify(query.queryKey).includes(term)),
  });
}

export function LinkedDataIntegrityPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [result, setResult] = useState<LinkedDataReconciliationResult | null>(null);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const [repairing, setRepairing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [history, setHistory] = useState<LinkedDataReconciliationHistory | null>(null);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const repairInFlightRef = useRef(false);

  const loadHistory = useCallback(async (offset: number) => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const next = await fetchReconciliationHistory(offset);
      setHistory(next);
      setHistoryOffset(offset);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "Não foi possível carregar o histórico.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const inspect = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await reconcileLinkedData(false);
      setResult(next);
      setGeneratedAt(new Date(next.generatedAt));
      await loadHistory(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível verificar os vínculos.");
    } finally {
      setLoading(false);
    }
  }, [loadHistory]);

  useEffect(() => { void inspect(); }, [inspect]);

  const categories = useMemo(() => groupReconciliationIssues(result?.issues ?? []), [result?.issues]);
  const issueCount = result?.issues.length ?? 0;

  async function repair() {
    if (repairInFlightRef.current) return;
    repairInFlightRef.current = true;
    setConfirmOpen(false);
    setRepairing(true);
    setError(null);
    try {
      const next = await reconcileLinkedData(true);
      setResult(next);
      setGeneratedAt(new Date(next.generatedAt));
      await invalidateLinkedDataQueries(queryClient);
      await inspect();
      toast({
        title: "Sincronização concluída",
        description: next.repaired.length
          ? `${next.repaired.length} vínculo(s) seguro(s) atualizado(s).`
          : "Nenhum vínculo elegível para correção foi encontrado.",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível sincronizar os vínculos.");
      toast({ title: "Erro na sincronização", variant: "destructive" });
    } finally {
      repairInFlightRef.current = false;
      setRepairing(false);
    }
  }

  return (
    <Card data-testid="card-linked-data-integrity">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4" /> Sincronização de cadastros e vínculos
            </CardTitle>
            <CardDescription className="mt-1">
              A verificação é somente leitura. Correções usam apenas valores exatos e não ambíguos desta agência.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void inspect()} disabled={loading || repairing} data-testid="button-refresh-linked-integrity">
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Verificar
            </Button>
            <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={loading || repairing || issueCount === 0} data-testid="button-repair-linked-integrity">
              {repairing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wrench className="mr-1.5 h-3.5 w-3.5" />}
              Corrigir vínculos
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {generatedAt && <p className="text-xs text-muted-foreground" data-testid="text-linked-integrity-generated-at">Última verificação: {generatedAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p>}
        {result && (
          <div className="grid gap-3 sm:grid-cols-3" data-testid="summary-linked-integrity">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Registros verificados</p>
              <p className="mt-1 text-xl font-semibold" data-testid="text-linked-integrity-checked">{result.checked}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Inconsistências</p>
              <p className="mt-1 text-xl font-semibold" data-testid="text-linked-integrity-issue-count">{issueCount}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Corrigidos nesta execução</p>
              <p className="mt-1 text-xl font-semibold" data-testid="text-linked-integrity-repaired-count">{result.repairedCount}</p>
            </div>
          </div>
        )}
        {loading ? (
          <div className="flex items-center gap-2 py-5 text-sm text-muted-foreground" data-testid="status-linked-integrity-loading">
            <Loader2 className="h-4 w-4 animate-spin" /> Verificando vínculos da agência…
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="status-linked-integrity-error">{error}</div>
        ) : result && issueCount === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700" data-testid="status-linked-integrity-empty">
            <CheckCircle2 className="h-4 w-4" /> Nenhuma inconsistência de vínculo foi encontrada.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm" data-testid="text-linked-integrity-summary">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <strong>{issueCount}</strong> inconsistência{issueCount === 1 ? "" : "s"} encontrada{issueCount === 1 ? "" : "s"} em {Object.keys(categories).length} categoria{Object.keys(categories).length === 1 ? "" : "s"}.
            </div>
            <div className="space-y-3">
              {Object.entries(categories).map(([type, issues]) => (
                <div key={type} className="rounded-md border p-3" data-testid={`group-linked-integrity-${type}`}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-sm font-medium">{readableIntegrityCategory(type)}</span>
                    <Badge variant="secondary">{issues.length}</Badge>
                  </div>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {issues.map((issue) => <li key={`${issue.type}-${issue.id}`} data-testid={`issue-linked-integrity-${issue.id}`}><span className="font-mono">{issue.id}</span> · {readableIntegrityReason(issue.reason)}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
        {result?.repaired.length ? <p className="text-xs text-green-700" data-testid="text-linked-integrity-repaired">{result.repaired.length} vínculo(s) corrigido(s) na última execução.</p> : null}
        <div className="border-t pt-4" data-testid="section-linked-integrity-history">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <History className="h-4 w-4" /> Histórico de sincronizações
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">Execuções recentes desta agência, com contagens e motivos agregados.</p>
            </div>
          </div>
          {historyLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground" data-testid="status-linked-integrity-history-loading">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando histórico…
            </div>
          ) : historyError ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="status-linked-integrity-history-error">
              <span>{historyError}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadHistory(historyOffset)}
                disabled={historyLoading}
                data-testid="button-retry-linked-integrity-history"
              >
                Tentar novamente
              </Button>
            </div>
          ) : !history?.items.length ? (
            <p className="py-4 text-sm text-muted-foreground" data-testid="status-linked-integrity-history-empty">Nenhuma sincronização registrada ainda.</p>
          ) : (
            <div className="space-y-2">
              {history.items.map((run) => (
                <div key={run.id} className="rounded-md border p-3" data-testid={`history-linked-integrity-run-${run.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={run.mode === "repair" ? "default" : "secondary"}>
                        {run.mode === "repair" ? "Correção" : "Verificação"}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{formatDateTime(run.executedAt)}</span>
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span><strong className="text-foreground">{run.checkedCount}</strong> verificados</span>
                      <span><strong className="text-foreground">{run.repairedCount}</strong> corrigidos</span>
                      <span><strong className={run.issueCount ? "text-amber-700" : "text-foreground"}>{run.issueCount}</strong> inconsistências</span>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(run.summary).map(([type, category]) => (
                      <span key={type} className="rounded bg-muted px-2 py-1 text-xs" data-testid={`history-linked-integrity-category-${run.id}-${type}`}>
                        {readableIntegrityCategory(type)}: {category.checked} verificados · {category.repaired} corrigidos · {category.issues} inconsistências
                        {Object.entries(category.reasons).length ? ` · ${Object.entries(category.reasons).map(([reason, count]) => `${readableIntegrityReason(reason)} (${count})`).join(", ")}` : ""}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {history.pagination.total > history.pagination.limit && (
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-muted-foreground">
                    {history.pagination.offset + 1}–{Math.min(history.pagination.offset + history.items.length, history.pagination.total)} de {history.pagination.total}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={historyOffset === 0 || historyLoading} onClick={() => void loadHistory(Math.max(0, historyOffset - 8))} data-testid="button-linked-integrity-history-previous">
                      <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Anteriores
                    </Button>
                    <Button variant="outline" size="sm" disabled={!history.pagination.hasMore || historyLoading} onClick={() => void loadHistory(historyOffset + 8)} data-testid="button-linked-integrity-history-next">
                      Próximas <ChevronRight className="ml-1 h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar correção de vínculos?</AlertDialogTitle>
            <AlertDialogDescription>
              Somente vínculos com uma origem exata e não ambígua serão atualizados. Nenhum dado será excluído e vínculos entre agências não serão considerados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-linked-integrity-repair">Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void repair()} data-testid="button-confirm-linked-integrity-repair">Confirmar correção</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}