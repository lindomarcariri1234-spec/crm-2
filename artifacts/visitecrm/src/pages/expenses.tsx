import { useState, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { localToday } from "@workspace/shared";
import {
  useListExpenses,
  useCreateExpense,
  useUpdateExpense,
  useListTrips,
  useListSuppliers,
} from "@workspace/api-client-react";
import { EXPENSE_STATUS } from "@workspace/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, CheckCircle, TrendingDown, Clock, AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { PAYMENT_STATUS_LABELS as STATUS_LABELS, PAYMENT_STATUS_COLORS as STATUS_COLORS, PAYMENT_METHOD_LABELS as METHOD_LABELS, EXPENSE_CATEGORY_LABELS as CATEGORY_LABELS } from "@/lib/labels";
import { ListLoadErrorRow } from "@/components/list-load-error";

const fmt = (v: number | string) => formatCurrency(typeof v === "string" ? parseFloat(v) || 0 : v);
const CATEGORY_COLORS: Record<string, string> = {
  transport: "#3B82F6",
  accommodation: "#8B5CF6",
  food: "#10B981",
  marketing: "#F59E0B",
  administrative: "#6366F1",
  commission: "#EF4444",
  other: "#94A3B8",
};
const EXPENSE_PAGE_SIZE = 50;

function CategoryChart({ data }: { data: Array<{ category: string; total: number }> }) {
  const max = Math.max(...data.map(d => d.total), 1);
  return (
    <div className="space-y-3">
      {data.map(d => {
        const pct = (d.total / max) * 100;
        return (
          <div key={d.category} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-28 shrink-0">{CATEGORY_LABELS[d.category] ?? d.category}</span>
            <div className="flex-1 bg-muted rounded-full h-2">
              <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: CATEGORY_COLORS[d.category] ?? "#94A3B8" }} />
            </div>
            <span className="text-xs font-medium w-24 text-right">{fmt(d.total)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Expenses() {
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [tripFilter, setTripFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [periodFilter, setPeriodFilter] = useState<"all" | "month" | "quarter" | "year">("all");
  const [page, setPage] = useState(1);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [expenseMethod, setExpenseMethod] = useState("pix");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [createCategory, setCreateCategory] = useState("transport");
  const [createSupplierId, setCreateSupplierId] = useState("none");
  const [createTripId, setCreateTripId] = useState("none");
  const queryClient = useQueryClient();

  const { data: expensesData, isLoading, isError, refetch } = useListExpenses({
    status: statusFilter || undefined,
    tripId: tripFilter || undefined,
    category: categoryFilter || undefined,
    supplierId: supplierFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    limit: EXPENSE_PAGE_SIZE,
    includeTripCosts: true,
    summaryPeriod: periodFilter,
  });
  const { data: tripsData } = useListTrips({ limit: 100 });
  const { data: suppliersRaw } = useListSuppliers();
  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();

  const expenses = expensesData?.data ?? [];
  const kpis = expensesData?.summary ?? {
    total: 0,
    paid: 0,
    pending: 0,
    overdue: 0,
    paidThisMonth: 0,
    categoryBreakdown: [],
  };
  const categoryBreakdown = expensesData?.summary?.categoryBreakdown ?? [];
  const totalPages = Math.max(1, Math.ceil((expensesData?.total ?? 0) / EXPENSE_PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [statusFilter, categoryFilter, tripFilter, dateFrom, dateTo, supplierFilter, periodFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const suppliersMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of (suppliersRaw ?? [])) m[s.id] = s.name;
    return m;
  }, [suppliersRaw]);

  const handleMarkPaid = async (id: string) => {
    await updateExpense.mutateAsync({
      id,
      data: { status: EXPENSE_STATUS.PAID, paymentDate: localToday() }
    });
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] }),
      queryClient.invalidateQueries({ queryKey: ["trip-costs"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/financial-metrics"] }),
    ]);
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await createExpense.mutateAsync({
      data: {
        category: createCategory || "other",
        description: fd.get("description") as string,
        amount: parseFloat(fd.get("amount") as string || "0"),
        dueDate: fd.get("dueDate") as string,
        paymentMethod: expenseMethod || undefined,
        tripId: (createTripId && createTripId !== "none") ? createTripId : undefined,
        supplierId: (createSupplierId && createSupplierId !== "none") ? createSupplierId : undefined,
        notes: (fd.get("notes") as string) || undefined,
      }
    });
    setIsCreateOpen(false);
    setCreateCategory("transport");
    setCreateSupplierId("none");
    setCreateTripId("none");
    await Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] }),
      queryClient.invalidateQueries({ queryKey: ["trip-costs"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/financial-metrics"] }),
    ]);
  };

  const hasFilters = statusFilter || categoryFilter || tripFilter || dateFrom || dateTo || supplierFilter;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Despesas</h1>
          <p className="text-muted-foreground text-sm">Controle todas as despesas operacionais e por viagem</p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> Registrar Despesa
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Resumo financeiro das despesas</p>
        <Select value={periodFilter} onValueChange={v => setPeriodFilter(v as typeof periodFilter)}>
          <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os períodos</SelectItem>
            <SelectItem value="month">Este mês</SelectItem>
            <SelectItem value="quarter">Últimos 3 meses</SelectItem>
            <SelectItem value="year">Último ano</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <Card><CardContent className="p-5 flex items-start gap-3">
          <div className="mt-1 p-2 rounded-md bg-muted text-yellow-600"><Clock className="w-5 h-5" /></div>
          <div>
            <p className="text-sm text-muted-foreground">Total Pendente</p>
            <p className="text-xl font-bold text-yellow-600">{fmt(kpis.pending)}</p>
            <p className="text-xs text-muted-foreground">{periodFilter !== "all" ? "No período" : "Em aberto"}</p>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-5 flex items-start gap-3">
          <div className="mt-1 p-2 rounded-md bg-muted text-green-600"><CheckCircle className="w-5 h-5" /></div>
          <div>
            <p className="text-sm text-muted-foreground">Pago este Mês</p>
            <p className="text-xl font-bold text-green-600">{fmt(kpis.paidThisMonth)}</p>
            <p className="text-xs text-muted-foreground">Pagas no período: {fmt(kpis.paid)}</p>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-5 flex items-start gap-3">
          <div className="mt-1 p-2 rounded-md bg-muted text-destructive"><AlertCircle className="w-5 h-5" /></div>
          <div>
            <p className="text-sm text-muted-foreground">Em Atraso</p>
            <p className="text-xl font-bold text-destructive">{fmt(kpis.overdue)}</p>
            <p className="text-xs text-muted-foreground">Vencidas sem pagamento</p>
          </div>
        </CardContent></Card>
        <Card><CardContent className="p-5 flex items-start gap-3">
          <div className="mt-1 p-2 rounded-md bg-muted text-red-600"><TrendingDown className="w-5 h-5" /></div>
          <div>
            <p className="text-sm text-muted-foreground">Total Geral</p>
            <p className="text-xl font-bold">{fmt(kpis.total)}</p>
            <p className="text-xs text-muted-foreground">{periodFilter !== "all" ? "No período selecionado" : "Todas as despesas"}</p>
          </div>
        </CardContent></Card>
      </div>

      {categoryBreakdown.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Despesas por Categoria</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryChart data={categoryBreakdown} />
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-3 bg-card p-4 rounded-lg border">
         <Select value={statusFilter || "all"} onValueChange={v => { setStatusFilter(v === "all" ? "" : v); }}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value={EXPENSE_STATUS.PENDING}>Pendente</SelectItem>
            <SelectItem value={EXPENSE_STATUS.PAID}>Pago</SelectItem>
            <SelectItem value={EXPENSE_STATUS.OVERDUE}>Vencido</SelectItem>
            <SelectItem value={EXPENSE_STATUS.CANCELLED}>Cancelado</SelectItem>
          </SelectContent>
        </Select>
         <Select value={categoryFilter || "all"} onValueChange={v => { setCategoryFilter(v === "all" ? "" : v); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            <SelectItem value="transport">Transporte</SelectItem>
            <SelectItem value="accommodation">Hospedagem</SelectItem>
            <SelectItem value="food">Alimentação</SelectItem>
            <SelectItem value="marketing">Marketing</SelectItem>
            <SelectItem value="administrative">Administrativo</SelectItem>
            <SelectItem value="other">Outro</SelectItem>
          </SelectContent>
        </Select>
         <Select value={tripFilter || "all"} onValueChange={v => { setTripFilter(v === "all" ? "" : v); }}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="Viagem" /></SelectTrigger>
          <SelectContent className="max-h-48">
            <SelectItem value="all">Todas as viagens</SelectItem>
            {tripsData?.data.map(t => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(suppliersRaw ?? []).length > 0 && (
          <Select value={supplierFilter || "all"} onValueChange={v => setSupplierFilter(v === "all" ? "" : v)}>
             <SelectTrigger className="w-[160px]"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
            <SelectContent className="max-h-48">
              <SelectItem value="all">Todos fornecedores</SelectItem>
              {(suppliersRaw ?? []).map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-2">
             <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36" placeholder="De" />
          <span className="text-muted-foreground text-sm">até</span>
          <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36" placeholder="Até" />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => { setStatusFilter(""); setCategoryFilter(""); setTripFilter(""); setDateFrom(""); setDateTo(""); setSupplierFilter(""); }}>
            Limpar filtros
          </Button>
        )}
      </div>

      <div className="bg-card rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
               <TableHead>Descrição</TableHead>
               <TableHead>Origem</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Viagem</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Forma</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 10 }).map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
              ))
            ) : isError ? (
              <ListLoadErrorRow
                 colSpan={10}
                onRetry={refetch}
                message="Não foi possível carregar as despesas."
              />
            ) : expenses.length === 0 ? (
              <TableRow>
                 <TableCell colSpan={10} className="text-center py-10 text-muted-foreground">
                  {hasFilters ? "Nenhuma despesa com os filtros selecionados." : "Nenhuma despesa registrada."}
                </TableCell>
              </TableRow>
            ) : expenses.map(e => (
              <TableRow key={e.id}>
                <TableCell className="font-medium text-sm">{e.description}</TableCell>
                 <TableCell className="text-sm">
                   <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                     e.source === "trip" ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-700"
                   }`}>
                     {e.source === "trip" ? "Custo da viagem" : "Despesa da agência"}
                   </span>
                 </TableCell>
                <TableCell className="text-sm text-muted-foreground">{CATEGORY_LABELS[e.category] ?? e.category}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {e.supplierId ? (
                    <button
                      type="button"
                      className="font-medium text-primary underline-offset-2 hover:underline cursor-pointer text-left"
                      onClick={() => setSupplierFilter(e.supplierId!)}
                      title="Filtrar por este fornecedor"
                    >
                       {e.supplierName ?? suppliersMap[e.supplierId] ?? e.supplierId.slice(0, 8) + "…"}
                    </button>
                   ) : e.supplierName ?? "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{e.tripId ? tripsData?.data.find(t => t.id === e.tripId)?.name ?? e.tripId.slice(0, 8) + "…" : "—"}</TableCell>
                <TableCell className="text-sm">{new Date(e.dueDate).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</TableCell>
                <TableCell className="font-medium text-sm">{fmt(e.amount)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{METHOD_LABELS[e.paymentMethod ?? ""] ?? e.paymentMethod ?? "—"}</TableCell>
                <TableCell>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[e.status] ?? "bg-gray-100 text-gray-800"}`}>
                    {STATUS_LABELS[e.status] ?? e.status}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                   {e.source !== "trip" && e.status !== EXPENSE_STATUS.PAID && e.status !== EXPENSE_STATUS.CANCELLED && (
                    <Button size="sm" variant="outline" onClick={() => handleMarkPaid(e.id)}>
                      <CheckCircle className="w-4 h-4 mr-1" /> Pago
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

       {totalPages > 1 && (
         <div className="flex items-center justify-between px-2">
           <p className="text-sm text-muted-foreground">
             Mostrando {((page - 1) * EXPENSE_PAGE_SIZE) + 1}–{Math.min(page * EXPENSE_PAGE_SIZE, expensesData?.total ?? 0)} de {expensesData?.total ?? 0} registros
           </p>
           <div className="flex items-center gap-2">
             <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
               <ChevronLeft className="w-4 h-4" /> Anterior
             </Button>
             <span className="text-sm font-medium">{page} / {totalPages}</span>
             <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
               Próxima <ChevronRight className="w-4 h-4" />
             </Button>
           </div>
         </div>
       )}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Registrar Despesa</DialogTitle></DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Categoria</label>
                <Select value={createCategory} onValueChange={setCreateCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="transport">Transporte</SelectItem>
                    <SelectItem value="accommodation">Hospedagem</SelectItem>
                    <SelectItem value="food">Alimentação</SelectItem>
                    <SelectItem value="marketing">Marketing</SelectItem>
                    <SelectItem value="administrative">Administrativo</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Forma de Pagamento</label>
                <Select value={expenseMethod} onValueChange={setExpenseMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pix">PIX</SelectItem>
                    <SelectItem value="credit_card">Cartão</SelectItem>
                    <SelectItem value="bank_transfer">Transferência</SelectItem>
                    <SelectItem value="cash">Dinheiro</SelectItem>
                    <SelectItem value="boleto">Boleto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Descrição *</label>
              <Input name="description" required placeholder="Ex: Passagens aéreas São Paulo" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Valor (R$) *</label>
                <Input name="amount" type="number" step="0.01" required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Vencimento *</label>
                <Input name="dueDate" type="date" required defaultValue={localToday()} />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Fornecedor (opcional)</label>
              <Select value={createSupplierId} onValueChange={setCreateSupplierId}>
                <SelectTrigger><SelectValue placeholder="Vincular a um fornecedor..." /></SelectTrigger>
                <SelectContent className="max-h-48">
                  <SelectItem value="none">Nenhum</SelectItem>
                  {(suppliersRaw ?? []).map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Viagem (opcional)</label>
              <Select value={createTripId} onValueChange={setCreateTripId}>
                <SelectTrigger><SelectValue placeholder="Vincular a uma viagem..." /></SelectTrigger>
                <SelectContent className="max-h-48">
                  <SelectItem value="none">Nenhuma</SelectItem>
                  {(tripsData?.data ?? []).map(t => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Observações</label>
              <Input name="notes" placeholder="Informações adicionais..." />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={createExpense.isPending}>
                {createExpense.isPending ? "Salvando..." : "Registrar"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
