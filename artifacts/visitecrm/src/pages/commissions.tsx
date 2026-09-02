import { useState, useMemo, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import {
  useListCommissions,
  useListCommissionRules,
  useUpdateCommission,
  useCreateCommissionRule,
  useUpdateCommissionRule,
  useDeleteCommissionRule,
  useListTrips,
  useListReservations,
  useRetryCommissionSync,
} from "@workspace/api-client-react";
import type { CommissionRule } from "@workspace/api-client-react";
import { COMMISSION_STATUS } from "@workspace/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Pencil, Trash2, DollarSign, CheckCircle, Clock, AlertTriangle, RefreshCw } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { COMMISSION_STATUS_LABELS as STATUS_LABELS, COMMISSION_STATUS_COLORS as STATUS_COLORS } from "@/lib/labels";
import { QueryErrorState } from "@/components/query-error-state";

const fmt = (v: number | string) => formatCurrency(typeof v === "string" ? parseFloat(v) || 0 : v);

const VALID_COMMISSION_TABS = ["commissions", "rules"];

export default function Commissions() {
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const [tab, setTab] = useState(() => {
    const t = new URLSearchParams(searchStr).get("tab");
    return VALID_COMMISSION_TABS.includes(t ?? "") ? t! : "commissions";
  });

  useEffect(() => {
    const t = new URLSearchParams(searchStr).get("tab");
    if (t && VALID_COMMISSION_TABS.includes(t)) setTab(t);
  }, [searchStr]);

  function handleTabChange(value: string) {
    setTab(value);
    const params = new URLSearchParams(searchStr);
    params.set("tab", value);
    navigate(`?${params.toString()}`, { replace: true });
  }
  const [statusFilter, setStatusFilter] = useState("");
  const [isRuleOpen, setIsRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<CommissionRule | null>(null);
  const [ruleDisplayType, setRuleDisplayType] = useState("percentage");
  const [appliesTo, setAppliesTo] = useState("all");
  const [selectedTripId, setSelectedTripId] = useState("");
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());

  const ruleType = ruleDisplayType === "tiered" ? "percentage" : ruleDisplayType as "percentage" | "fixed";

  const { data: commissionsRaw, isLoading: loadingCommissions, isError: commissionsError, error: commissionsQueryError, refetch: refetchCommissions } = useListCommissions();
  const { data: rulesData, isLoading: loadingRules, isError: rulesError, error: rulesQueryError, refetch: refetchRules } = useListCommissionRules();
  const { data: tripsData } = useListTrips({ limit: 100 });
  const { data: failedSyncData, isLoading: loadingFailedSync, isError: failedSyncError, error: failedSyncQueryError, refetch: refetchFailedSync } = useListReservations({ commissionSyncStatus: "failed", limit: 100 });
  const updateCommission = useUpdateCommission();
  const createRule = useCreateCommissionRule();
  const updateRule = useUpdateCommissionRule();
  const deleteRule = useDeleteCommissionRule();
  const retrySync = useRetryCommissionSync();

  const commissions = useMemo(() => {
    const all = Array.isArray(commissionsRaw) ? commissionsRaw : [];
    if (!statusFilter) return all;
    return all.filter(c => c.status === statusFilter);
  }, [commissionsRaw, statusFilter]);

  const kpis = useMemo(() => {
    const all = Array.isArray(commissionsRaw) ? commissionsRaw : [];
    const total = all.reduce((s, c) => s + parseFloat(c.commissionAmount), 0);
    const paid = all.filter(c => c.status === COMMISSION_STATUS.PAID).reduce((s, c) => s + parseFloat(c.commissionAmount), 0);
    const pending = all.filter(c => c.status === COMMISSION_STATUS.PENDING).reduce((s, c) => s + parseFloat(c.commissionAmount), 0);
    const approved = all.filter(c => c.status === COMMISSION_STATUS.APPROVED).reduce((s, c) => s + parseFloat(c.commissionAmount), 0);
    const pendingOrApproved = pending + approved;
    const count = all.length;
    return { total, paid, pending, approved, pendingOrApproved, count };
  }, [commissionsRaw]);

  const failedSyncReservations = useMemo(() => failedSyncData?.data ?? [], [failedSyncData]);

  const handleApprove = async (id: string) => {
    await updateCommission.mutateAsync({ id, data: { status: COMMISSION_STATUS.APPROVED } });
    refetchCommissions();
  };

  const handlePay = async (id: string) => {
    await updateCommission.mutateAsync({ id, data: { status: COMMISSION_STATUS.PAID, paidAt: new Date().toISOString() } });
    refetchCommissions();
  };

  const handleRetrySync = async (id: string) => {
    setRetryingIds(prev => new Set(prev).add(id));
    try {
      await retrySync.mutateAsync({ id });
      refetchFailedSync();
    } finally {
      setRetryingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleSaveRule = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const isTiered = ruleDisplayType === "tiered";
    if (isTiered && !selectedTripId) {
      alert("Selecione uma viagem para a regra escalonada por viagem.");
      return;
    }
    const effectiveAppliesTo = isTiered ? "trip" : appliesTo;
    const ruleData = {
      name: fd.get("name") as string,
      type: ruleType,
      value: fd.get("value") as string,
      appliesTo: effectiveAppliesTo,
      tripId: (isTiered || appliesTo === "trip") ? selectedTripId || undefined : undefined,
      isActive: true,
    };
    if (editingRule) {
      await updateRule.mutateAsync({ id: editingRule.id, data: ruleData });
    } else {
      await createRule.mutateAsync({ data: ruleData });
    }
    setIsRuleOpen(false);
    setEditingRule(null);
    setAppliesTo("all");
    setSelectedTripId("");
    refetchRules();
  };

  const handleDeleteRule = async (id: string) => {
    if (!confirm("Excluir esta regra de comissão?")) return;
    await deleteRule.mutateAsync({ id });
    refetchRules();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Comissões</h1>
          <p className="text-muted-foreground text-sm">Gerencie comissões de vendedores e regras de cálculo</p>
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-muted text-blue-600 mt-1"><DollarSign className="w-5 h-5" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-xl font-bold">{fmt(kpis.total)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-muted text-green-600 mt-1"><CheckCircle className="w-5 h-5" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Pagas</p>
                <p className="text-xl font-bold text-green-600">{fmt(kpis.paid)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-muted text-yellow-600 mt-1"><Clock className="w-5 h-5" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Pendentes/Aprovadas</p>
                <p className="text-xl font-bold text-yellow-600">{fmt(kpis.pendingOrApproved)}</p>
                <p className="text-xs text-muted-foreground">Pendente: {fmt(kpis.pending)} · Aprovada: {fmt(kpis.approved)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-md bg-muted text-purple-600 mt-1"><DollarSign className="w-5 h-5" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Número de Comissões</p>
                <p className="text-xl font-bold text-purple-600">{kpis.count}</p>
                <p className="text-xs text-muted-foreground">{loadingCommissions ? "—" : `${(Array.isArray(commissionsRaw) ? commissionsRaw : []).filter(c => c.status === COMMISSION_STATUS.PAID).length} pagas`}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {(loadingFailedSync || failedSyncError || failedSyncReservations.length > 0) && (
        <Card className="border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-orange-700 dark:text-orange-400 text-base">
              <AlertTriangle className="w-5 h-5" />
              Sincronização de Comissão com Falha
              {!loadingFailedSync && (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-orange-200 dark:bg-orange-800 text-orange-800 dark:text-orange-200 text-xs font-semibold px-2 py-0.5">
                  {failedSyncReservations.length}
                </span>
              )}
            </CardTitle>
            <p className="text-sm text-orange-600 dark:text-orange-400">
              As reservas abaixo falharam ao sincronizar o registro de comissão. Use "Retentar" para acionar uma nova sincronização.
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="rounded-md border border-orange-200 dark:border-orange-800 overflow-hidden bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reserva</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Viagem</TableHead>
                    <TableHead>Valor Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingFailedSync ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
                    ))
                  ) : failedSyncError ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <QueryErrorState resourceLabel="as reservas com falha de sincronização" error={failedSyncQueryError} onRetry={() => { void refetchFailedSync(); }} compact />
                      </TableCell>
                    </TableRow>
                  ) : failedSyncReservations.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-sm">{r.reservationNumber ?? r.id.slice(0, 10) + "…"}</TableCell>
                      <TableCell className="text-sm">{r.client?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.trip?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm font-medium">
                        <div className="flex flex-col gap-0.5">
                          {(r as { discountTotal?: number | null }).discountTotal ? (
                            <>
                              <span className="text-xs text-muted-foreground line-through">{fmt(r.totalValue + ((r as { discountTotal?: number | null }).discountTotal ?? 0))}</span>
                              <span>{fmt(r.totalValue)}</span>
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 w-fit">com desconto</span>
                            </>
                          ) : fmt(r.totalValue)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                          <AlertTriangle className="w-3 h-3" />
                          Falhou
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-900/30"
                          disabled={retryingIds.has(r.id)}
                          onClick={() => handleRetrySync(r.id)}
                        >
                          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${retryingIds.has(r.id) ? "animate-spin" : ""}`} />
                          {retryingIds.has(r.id) ? "Retentando…" : "Retentar"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={tab} onValueChange={handleTabChange}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="commissions">Comissões</TabsTrigger>
            <TabsTrigger value="rules">Regras de Cálculo</TabsTrigger>
          </TabsList>
          {tab === "commissions" && (
            <Select value={statusFilter || "all"} onValueChange={v => setStatusFilter(v === "all" ? "" : v)}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Filtrar status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value={COMMISSION_STATUS.PENDING}>Pendente</SelectItem>
                <SelectItem value={COMMISSION_STATUS.APPROVED}>Aprovada</SelectItem>
                <SelectItem value={COMMISSION_STATUS.PAID}>Paga</SelectItem>
              </SelectContent>
            </Select>
          )}
          {tab === "rules" && (
            <Button onClick={() => { setEditingRule(null); setRuleDisplayType("percentage"); setAppliesTo("all"); setSelectedTripId(""); setIsRuleOpen(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Nova Regra
            </Button>
          )}
        </div>

        <TabsContent value="commissions" className="mt-4">
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendedor (ID)</TableHead>
                  <TableHead>Reserva</TableHead>
                  <TableHead>Base de Cálculo</TableHead>
                  <TableHead>Valor da Comissão</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pago em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingCommissions ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 7 }).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
                  ))
                ) : commissionsError ? (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <QueryErrorState resourceLabel="as comissões" error={commissionsQueryError} onRetry={() => { void refetchCommissions(); }} compact />
                    </TableCell>
                  </TableRow>
                ) : commissions.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center py-10 text-muted-foreground">Nenhuma comissão encontrada.</TableCell></TableRow>
                ) : commissions.map(c => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium text-sm font-mono">{c.userId.slice(0, 12)}…</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.reservationId ?? "—"}</TableCell>
                    <TableCell className="text-sm">{fmt(c.baseAmount)}</TableCell>
                    <TableCell className="font-semibold text-sm">{fmt(c.commissionAmount)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-800"}`}>
                        {STATUS_LABELS[c.status] ?? c.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.paidAt ? new Date(c.paidAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {c.status === COMMISSION_STATUS.PENDING && (
                          <Button size="sm" variant="outline" onClick={() => handleApprove(c.id)}>
                            Aprovar
                          </Button>
                        )}
                        {c.status === COMMISSION_STATUS.APPROVED && (
                          <Button size="sm" onClick={() => handlePay(c.id)}>
                            <DollarSign className="w-4 h-4 mr-1" /> Pagar
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          <div className="bg-card rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome da Regra</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Aplica a</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingRules ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <TableRow key={i}>{Array.from({ length: 6 }).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
                  ))
                ) : rulesError ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <QueryErrorState resourceLabel="as regras de comissão" error={rulesQueryError} onRetry={() => { void refetchRules(); }} compact />
                    </TableCell>
                  </TableRow>
                ) : !rulesData?.length ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Nenhuma regra cadastrada.</TableCell></TableRow>
                ) : rulesData.map(rule => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium text-sm">{rule.name}</TableCell>
                    <TableCell className="text-sm">
                      {rule.appliesTo === "trip" && rule.tripId ? "Escalonado por viagem" : rule.type === "percentage" ? "Percentual" : "Valor Fixo"}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {rule.type === "percentage" ? `${rule.value}%` : fmt(rule.value)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {rule.appliesTo === "trip" && rule.tripId
                        ? (tripsData?.data.find(t => t.id === rule.tripId)?.name ?? "Viagem específica")
                        : rule.appliesTo === "all" ? "Todas" : rule.appliesTo === "national" ? "Nacionais" : rule.appliesTo === "international" ? "Internacionais" : rule.appliesTo}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${rule.isActive ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-800"}`}>
                        {rule.isActive ? "Ativa" : "Inativa"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8"
                          onClick={() => { setEditingRule(rule); setRuleDisplayType(rule.appliesTo === "trip" && rule.tripId ? "tiered" : rule.type); setAppliesTo(rule.appliesTo ?? "all"); setSelectedTripId(rule.tripId ?? ""); setIsRuleOpen(true); }}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                          onClick={() => handleDeleteRule(rule.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={isRuleOpen} onOpenChange={v => { setIsRuleOpen(v); if (!v) setEditingRule(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRule ? "Editar Regra" : "Nova Regra de Comissão"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveRule} className="space-y-4 mt-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Nome da Regra *</label>
              <Input name="name" required defaultValue={editingRule?.name ?? ""} placeholder="Ex: Comissão Padrão 10%" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Tipo de Comissão</label>
              <Select value={ruleDisplayType} onValueChange={v => { setRuleDisplayType(v); if (v !== "tiered") setSelectedTripId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentual (%) — geral</SelectItem>
                  <SelectItem value="fixed">Valor Fixo (R$) — geral</SelectItem>
                  <SelectItem value="tiered">Escalonado por viagem (%)</SelectItem>
                </SelectContent>
              </Select>
              {ruleDisplayType === "tiered" && (
                <p className="text-xs text-muted-foreground">A taxa percentual se aplica especificamente à viagem selecionada.</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{ruleDisplayType === "fixed" ? "Valor (R$)" : "Percentual (%)"}</label>
              <Input
                name="value"
                type="number"
                step="0.01"
                required
                defaultValue={editingRule?.value ?? ""}
                placeholder={ruleDisplayType === "fixed" ? "150.00" : "10"}
              />
            </div>
            {ruleDisplayType === "tiered" ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Viagem específica *</label>
                <Select value={selectedTripId} onValueChange={setSelectedTripId}>
                  <SelectTrigger><SelectValue placeholder="Escolha a viagem..." /></SelectTrigger>
                  <SelectContent className="max-h-48">
                    {(tripsData?.data ?? []).map(t => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-medium">Aplica a</label>
                <Select value={appliesTo} onValueChange={v => { setAppliesTo(v); if (v !== "trip") setSelectedTripId(""); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as viagens</SelectItem>
                    <SelectItem value="national">Viagens nacionais</SelectItem>
                    <SelectItem value="international">Viagens internacionais</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => { setIsRuleOpen(false); setEditingRule(null); }}>Cancelar</Button>
              <Button type="submit" disabled={createRule.isPending || updateRule.isPending}>
                {createRule.isPending || updateRule.isPending ? "Salvando..." : "Salvar Regra"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
