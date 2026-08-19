import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useListTripCosts, useCreateTripCost, useUpdateTripCost, useDeleteTripCost,
} from "@workspace/api-client-react";
import type { TripCost, LayoutCell } from "@workspace/api-client-react";
import { EXPENSE_STATUS } from "@workspace/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Plus, AlertCircle, Loader2, Pencil, Trash2, Wallet, Receipt, Banknote,
  TrendingUp, TrendingDown, PiggyBank,
} from "lucide-react";
import { CELL_COLORS, COST_CATEGORIES, COST_STATUS_MAP } from "./constants";
import { formatCurrency, formatDate } from "./utils";

export function LayoutMiniPreview({ cells, rows, cols }: { cells: { row: number; col: number; floor?: number; type: string }[]; rows: number; cols: number }) {
  const floor1 = cells.filter(c => (c.floor ?? 1) === 1);
  const cellMap = new Map(floor1.map(c => [`${c.row}-${c.col}`, c.type]));
  const size = Math.max(4, Math.min(10, Math.floor(120 / Math.max(rows, cols))));
  return (
    <div className="flex flex-col gap-0.5 mt-1">
      {Array.from({ length: rows }).map((_, ri) => (
        <div key={ri} className="flex gap-0.5">
          {Array.from({ length: cols }).map((_, ci) => {
            const type = cellMap.get(`${ri + 1}-${ci + 1}`) ?? "empty";
            return (
              <div
                key={ci}
                className={`rounded-sm ${CELL_COLORS[type] ?? "bg-gray-100"}`}
                style={{ width: size, height: size }}
                title={type}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

export type { LayoutCell };

const costFormSchema = z.object({
  category: z.enum(["Transporte", "Hospedagem", "Alimentação", "Guia", "Marketing", "Seguro", "Taxas", "Outros"] as const, {
    required_error: "Selecione uma categoria",
    invalid_type_error: "Categoria inválida",
  }),
  description: z.string().min(1, "Descrição obrigatória").max(200, "Máximo 200 caracteres"),
  supplierName: z.string().max(100).optional(),
  amount: z.number({ invalid_type_error: "Valor inválido" }).positive("Valor deve ser maior que zero"),
  status: z.enum(["pending", "paid", "overdue"] as const).default("pending"),
  dueDate: z.string().optional(),
  notes: z.string().max(500).optional(),
});

type CostFormValues = z.infer<typeof costFormSchema>;

function TripCostModal({ tripId, cost, open, onClose, onSaved }: {
  tripId: string;
  cost: TripCost | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const createCost = useCreateTripCost();
  const updateCost = useUpdateTripCost();

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } = useForm<CostFormValues>({
    resolver: zodResolver(costFormSchema),
    defaultValues: { status: "pending", amount: 0 },
  });

  useEffect(() => {
    if (open) {
      if (cost) {
        reset({
          category: cost.category as CostFormValues["category"],
          description: cost.description,
          supplierName: cost.supplierName ?? "",
          amount: cost.amount,
          status: cost.status as CostFormValues["status"],
          dueDate: cost.dueDate ? cost.dueDate.substring(0, 10) : "",
          notes: cost.notes ?? "",
        });
      } else {
        reset({ category: undefined, description: "", supplierName: "", amount: 0, status: "pending", dueDate: "", notes: "" });
      }
    }
  }, [cost, open, reset]);

  const onSubmit = async (values: CostFormValues) => {
    try {
      const payload = {
        category: values.category,
        description: values.description,
        supplierName: values.supplierName || null,
        amount: values.amount,
        status: values.status,
        dueDate: values.dueDate || null,
        notes: values.notes || null,
      };
      if (cost) {
        await updateCost.mutateAsync({ tripId, costId: cost.id, data: payload });
        toast({ title: "Custo atualizado" });
      } else {
        await createCost.mutateAsync({ tripId, data: payload });
        toast({ title: "Custo adicionado" });
      }
      onSaved();
      onClose();
    } catch {
      toast({ title: "Erro ao salvar custo", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-primary" />
            {cost ? "Editar Custo" : "Novo Custo"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Categoria *</Label>
              <Controller
                name="category"
                control={control}
                render={({ field }) => (
                  <Select value={field.value ?? ""} onValueChange={field.onChange}>
                    <SelectTrigger className={errors.category ? "border-destructive" : ""}>
                      <SelectValue placeholder="Selecionar..." />
                    </SelectTrigger>
                    <SelectContent>
                      {COST_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.category && <p className="text-[10px] text-destructive">{errors.category.message}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Controller
                name="status"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pendente</SelectItem>
                      <SelectItem value="paid">Pago</SelectItem>
                      <SelectItem value="overdue">Vencido</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Descrição *</Label>
            <Input
              placeholder="Ex: Locação do ônibus"
              className={errors.description ? "border-destructive" : ""}
              {...register("description")}
            />
            {errors.description && <p className="text-[10px] text-destructive">{errors.description.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Valor (R$) *</Label>
              <Controller
                name="amount"
                control={control}
                render={({ field }) => (
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0,00"
                    className={errors.amount ? "border-destructive" : ""}
                    value={field.value ?? ""}
                    onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                  />
                )}
              />
              {errors.amount && <p className="text-[10px] text-destructive">{errors.amount.message}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Vencimento</Label>
              <Input type="date" {...register("dueDate")} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Fornecedor</Label>
            <Input placeholder="Nome do fornecedor (opcional)" {...register("supplierName")} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Observações</Label>
            <Textarea rows={2} placeholder="Anotações adicionais..." {...register("notes")} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />Salvando...</> : "Salvar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TripCostsTab({ tripId }: { tripId: string }) {
  const { toast } = useToast();
  const { data, isLoading, refetch } = useListTripCosts(tripId, {
    query: { queryKey: ["trip-costs", tripId], enabled: !!tripId },
  });
  const deleteCost = useDeleteTripCost();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCost, setEditingCost] = useState<TripCost | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const costs = data?.costs ?? [];
  const summary = data?.summary;

  const filtered = costs.filter(c => {
    if (filterCategory !== "all" && c.category !== filterCategory) return false;
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    return true;
  });

  const handleDelete = async (id: string) => {
    if (!confirm("Remover este custo?")) return;
    setDeletingId(id);
    try {
      await deleteCost.mutateAsync({ tripId, costId: id });
      toast({ title: "Custo removido" });
      refetch();
    } catch {
      toast({ title: "Erro ao remover custo", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const groupedByCategory = COST_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = costs.filter(c => c.category === cat).reduce((s, c) => s + c.amount, 0);
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="space-y-6">
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Banknote className="w-4 h-4 text-blue-600" />
              <span className="text-xs text-blue-600 font-medium">Receita Prevista</span>
            </div>
            <p className="text-lg font-bold text-blue-700">{formatCurrency(summary.expectedRevenue)}</p>
            <p className="text-xs text-blue-500 mt-0.5">{summary.confirmedSeats} passageiros</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="w-4 h-4 text-red-600" />
              <span className="text-xs text-red-600 font-medium">Custos Reais</span>
            </div>
            <p className="text-lg font-bold text-red-700">{formatCurrency(summary.totalRealCosts)}</p>
            <p className="text-xs text-red-500 mt-0.5">Pagos: {formatCurrency(summary.totalPaidCosts)}</p>
          </div>
          <div className={`border rounded-lg p-4 ${summary.profit >= 0 ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"}`}>
            <div className="flex items-center gap-2 mb-1">
              {summary.profit >= 0
                ? <TrendingUp className="w-4 h-4 text-green-600" />
                : <TrendingDown className="w-4 h-4 text-red-600" />}
              <span className={`text-xs font-medium ${summary.profit >= 0 ? "text-green-600" : "text-red-600"}`}>Lucro Líquido</span>
            </div>
            <p className={`text-lg font-bold ${summary.profit >= 0 ? "text-green-700" : "text-red-700"}`}>
              {formatCurrency(summary.profit)}
            </p>
            <p className={`text-xs mt-0.5 ${summary.profit >= 0 ? "text-green-500" : "text-red-500"}`}>
              Margem: {summary.margin.toFixed(1)}%
            </p>
          </div>
          <div className={`border rounded-lg p-4 ${summary.budgetVariance <= 0 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
            <div className="flex items-center gap-2 mb-1">
              <PiggyBank className="w-4 h-4 text-amber-600" />
              <span className="text-xs text-amber-700 font-medium">Orçado vs Real</span>
            </div>
            <p className={`text-lg font-bold ${summary.budgetVariance <= 0 ? "text-green-700" : "text-amber-700"}`}>
              {summary.budgetVariance <= 0
                ? `${formatCurrency(Math.abs(summary.budgetVariance))} abaixo`
                : `${formatCurrency(summary.budgetVariance)} acima`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Orçado: {formatCurrency(summary.plannedBudget)}</p>
          </div>
        </div>
      )}

      {summary && summary.totalPendingCosts > 0 && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>
            Há <strong>{formatCurrency(summary.totalPendingCosts)}</strong> em custos pendentes de pagamento.
          </span>
        </div>
      )}

      <div className="bg-card border rounded-lg">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-sm">Custos da Viagem</h3>
            <Badge variant="secondary">{costs.length}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="h-8 text-xs w-36">
                <SelectValue placeholder="Categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as categorias</SelectItem>
                {COST_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="h-8 text-xs w-28">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="paid">Pago</SelectItem>
                <SelectItem value="overdue">Vencido</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8 text-xs gap-1" onClick={() => { setEditingCost(null); setModalOpen(true); }}>
              <Plus className="w-3.5 h-3.5" />
              Adicionar
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-6 space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Wallet className="w-10 h-10 mx-auto mb-3 opacity-25" />
            <p className="text-sm">{costs.length === 0 ? "Nenhum custo registrado ainda" : "Nenhum custo com esses filtros"}</p>
            {costs.length === 0 && (
              <Button variant="outline" size="sm" className="mt-3 text-xs" onClick={() => { setEditingCost(null); setModalOpen(true); }}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Adicionar primeiro custo
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y">
            {filtered.map(cost => {
              const statusInfo = COST_STATUS_MAP[cost.status] ?? COST_STATUS_MAP.pending;
              return (
                <div key={cost.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{cost.description}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">{cost.category}</Badge>
                      <span className={`inline-flex text-[10px] px-2 py-0.5 rounded-full border font-medium ${statusInfo.color}`}>
                        {statusInfo.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                      {cost.supplierName && <span>{cost.supplierName}</span>}
                      {cost.dueDate && <span>Vence: {formatDate(cost.dueDate)}</span>}
                      {cost.paidAt && <span>Pago em: {formatDate(cost.paidAt)}</span>}
                      {cost.notes && <span className="italic truncate max-w-[200px]">{cost.notes}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-bold text-sm ${cost.status === EXPENSE_STATUS.PAID ? "text-green-700" : cost.status === EXPENSE_STATUS.OVERDUE ? "text-red-600" : ""}`}>
                      {formatCurrency(cost.amount)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                      onClick={() => { setEditingCost(cost); setModalOpen(true); }}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                      disabled={deletingId === cost.id}
                      onClick={() => handleDelete(cost.id)}>
                      {deletingId === cost.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {costs.length > 0 && (
          <div className="border-t p-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">Resumo por categoria</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {COST_CATEGORIES.filter(cat => groupedByCategory[cat] > 0).map(cat => (
                <div key={cat} className="text-xs">
                  <span className="text-muted-foreground">{cat}: </span>
                  <span className="font-medium">{formatCurrency(groupedByCategory[cat])}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <TripCostModal
        tripId={tripId}
        cost={editingCost}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => refetch()}
      />
    </div>
  );
}
