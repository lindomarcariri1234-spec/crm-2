import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  getListExpensesQueryKey,
  useListTripCosts, useCreateTripCost, useUpdateTripCost, useDeleteTripCost,
  useListExpenses, useLinkExpenseToTripCost, useUnlinkExpenseFromTripCost,
} from "@workspace/api-client-react";
import type { Expense, TripCost, LayoutCell, ListTripCostsResponse } from "@workspace/api-client-react";
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
  PiggyBank, Link2, Unlink,
} from "lucide-react";
import { CELL_COLORS, COST_CATEGORIES, COST_STATUS_MAP } from "./constants";
import { formatCurrency, formatDate } from "./utils";
import { FinancialConsolidationView } from "@/components/financial-consolidation-view";
import { calculateOccupancyProjections } from "./financial-projection";

type ScenarioInputs = {
  adultFare: string;
  childFare: string;
  seniorFare: string;
  adultMix: string;
  childMix: string;
  seniorMix: string;
  fixedCosts: string;
  variablePerPassenger: string;
};

const EMPTY_SCENARIO_INPUTS: ScenarioInputs = {
  adultFare: "0",
  childFare: "0",
  seniorFare: "0",
  adultMix: "100",
  childMix: "0",
  seniorMix: "0",
  fixedCosts: "0",
  variablePerPassenger: "0",
};

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

function savedScenarioInputs(
  pricing: ListTripCostsResponse["pricing"] | undefined,
  plannedCosts: ListTripCostsResponse["plannedCosts"],
): ScenarioInputs {
  const fixedCosts = plannedCosts
    .filter(row => row.kind === "fixed")
    .reduce((sum, row) => sum + (Number.isFinite(row.amount) ? row.amount : 0), 0);
  const variablePerPassenger = plannedCosts
    .filter(row => row.kind === "variable")
    .reduce((sum, row) => {
      const amount = row.amountPerPassenger;
      return sum + (typeof amount === "number" && Number.isFinite(amount) ? amount : 0);
    }, 0);
  return {
    adultFare: String(pricing?.adult ?? 0),
    childFare: String(pricing?.child ?? 0),
    seniorFare: String(pricing?.senior ?? 0),
    adultMix: "100",
    childMix: "0",
    seniorMix: "0",
    fixedCosts: String(fixedCosts),
    variablePerPassenger: String(variablePerPassenger),
  };
}

function OccupancyScenarioPlanner({
  tripId,
  capacity,
  pricing,
  plannedCosts,
}: {
  tripId: string;
  capacity: number;
  pricing: ListTripCostsResponse["pricing"] | undefined;
  plannedCosts: ListTripCostsResponse["plannedCosts"];
}) {
  const [inputs, setInputs] = useState<ScenarioInputs>(EMPTY_SCENARIO_INPUTS);
  const initializedTripId = useRef<string | null>(null);

  useEffect(() => {
    if (initializedTripId.current !== tripId) {
      setInputs(savedScenarioInputs(pricing, plannedCosts));
      initializedTripId.current = tripId;
    }
  }, [tripId, pricing, plannedCosts]);

  const projections = calculateOccupancyProjections({
    capacity,
    ticketPrices: {
      adult: Number(inputs.adultFare),
      child: Number(inputs.childFare),
      senior: Number(inputs.seniorFare),
    },
    passengerMixWeights: {
      adult: Number(inputs.adultMix),
      child: Number(inputs.childMix),
      senior: Number(inputs.seniorMix),
    },
    fixedCostAmount: Number(inputs.fixedCosts),
    variableCostPerPassengerAmount: Number(inputs.variablePerPassenger),
  });
  const base = projections.find(projection => projection.occupancyPercent === 80)!;
  const fields: { key: keyof ScenarioInputs; label: string; kind: "fare" | "mix" | "cost"; help: string }[] = [
    { key: "adultFare", label: "Adulto · tarifa", kind: "fare", help: "R$" },
    { key: "childFare", label: "Criança · tarifa", kind: "fare", help: "R$" },
    { key: "seniorFare", label: "Idoso · tarifa", kind: "fare", help: "R$" },
    { key: "adultMix", label: "Adultos", kind: "mix", help: "%" },
    { key: "childMix", label: "Crianças", kind: "mix", help: "%" },
    { key: "seniorMix", label: "Idosos", kind: "mix", help: "%" },
    { key: "fixedCosts", label: "Custo fixo total", kind: "cost", help: "R$ · não varia" },
    { key: "variablePerPassenger", label: "Custo variável por passageiro", kind: "cost", help: "R$ / passageiro" },
  ];

  return (
    <section aria-labelledby="occupancy-planner-title" className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="border-b bg-secondary/35 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Planejamento · somente nesta tela</p>
            <h2 id="occupancy-planner-title" className="mt-1 text-lg font-semibold">Cenários de ocupação</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Explore tarifas e custos planejados sem alterar a viagem ou os registros financeiros.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="button-reset-scenario-assumptions"
            onClick={() => setInputs(savedScenarioInputs(pricing, plannedCosts))}
            className="shrink-0"
          >
            Restaurar premissas salvas
          </Button>
        </div>
        <p className="mt-3 rounded-md border border-primary/15 bg-background/80 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          O mix de passageiros não é salvo no cadastro financeiro. A premissa inicial é 100% adultos; ajuste os pesos abaixo.
          Os pesos são normalizados automaticamente e, se todos forem zero, o cálculo volta a 100% adultos.
        </p>
      </div>

      <div className="grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.72fr)]">
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold">Premissas editáveis</h3>
            <p className="mt-1 text-xs text-muted-foreground">Capacidade usada: {capacity} lugares · valores em reais.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {fields.map(field => {
              const inputId = `scenario-${field.key}`;
              const isMix = field.kind === "mix";
              return (
                <div key={field.key} className={`space-y-1.5 ${field.kind === "cost" ? "sm:col-span-2 xl:col-span-3" : ""}`}>
                  <Label htmlFor={inputId} className="text-xs">{field.label}</Label>
                  <div className="relative">
                    <Input
                      id={inputId}
                      data-testid={`input-${field.key.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`)}`}
                      type="number"
                      min="0"
                      max={isMix ? "100" : undefined}
                      step={isMix ? "1" : "0.01"}
                      inputMode="decimal"
                      value={inputs[field.key]}
                      onChange={event => setInputs(current => ({ ...current, [field.key]: event.target.value }))}
                      aria-describedby={`${inputId}-help`}
                      className="pr-16"
                    />
                    <span id={`${inputId}-help`} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                      {field.help}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Passageiros são arredondados para baixo. O restante é distribuído pelo maior peso fracionário, com desempate na ordem adulto, criança e idoso.
          </p>
        </div>

        <aside className="rounded-lg border border-primary/20 bg-primary/[0.045] p-4" aria-label="Cenário base de 80 por cento">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Referência</p>
              <h3 className="mt-1 text-lg font-semibold">Base · 80%</h3>
            </div>
            <span data-testid="scenario-base-passengers" className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">{base.passengers}/{capacity} lugares</span>
          </div>
          <p data-testid="scenario-base-revenue" className="mt-5 text-3xl font-semibold tracking-tight">{formatCurrency(base.grossRevenue)}</p>
          <p className="text-xs text-muted-foreground">receita projetada por tarifas e mix, não valor contratado</p>
          <dl className="mt-5 space-y-2 border-t pt-4 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Mix alocado</dt><dd className="text-right font-medium">{base.passengerMix.adult} adultos · {base.passengerMix.child} crianças · {base.passengerMix.senior} idosos</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Custos fixos planejados</dt><dd data-testid="scenario-base-fixed-costs" className="font-medium">{formatCurrency(base.fixedCosts)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Custos variáveis planejados</dt><dd data-testid="scenario-base-variable-costs" className="font-medium">{formatCurrency(base.variableCosts)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Custo operacional total</dt><dd data-testid="scenario-base-operating-costs" className="font-medium">{formatCurrency(base.operatingCosts)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Custo médio por passageiro</dt><dd data-testid="scenario-base-average-cost" className="font-medium">{base.averageCostPerPassenger === null ? "—" : formatCurrency(base.averageCostPerPassenger)}</dd></div>
            <div className="flex justify-between gap-3 border-t pt-2"><dt className="font-medium">Saldo projetado</dt><dd data-testid="scenario-base-balance" className={`font-semibold ${base.estimatedProfit < 0 ? "text-destructive" : "text-primary"}`}>{formatCurrency(base.estimatedProfit)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Margem projetada</dt><dd data-testid="scenario-base-margin" className="font-medium">{base.marginPercent === null ? "—" : `${base.marginPercent.toFixed(1)}%`}</dd></div>
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Resultado hipotético de receita projetada menos custos planejados. Não representa caixa recebido nem resultado realizado.
          </p>
        </aside>
      </div>

      <div className="border-t px-4 py-5 sm:px-6">
        <h3 className="mb-3 text-sm font-semibold">Comparativo por ocupação</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projections.map(projection => {
            const isBase = projection.occupancyPercent === 80;
            return (
              <article
                key={projection.occupancyPercent}
                data-testid={`scenario-card-${projection.occupancyPercent}`}
                className={`rounded-lg border p-4 ${isBase ? "border-primary/40 bg-primary/[0.035] ring-1 ring-primary/15" : "bg-background"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-semibold">{projection.occupancyPercent}% de ocupação</h4>
                  {isBase && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Base</span>}
                </div>
                <p data-testid={`scenario-passengers-${projection.occupancyPercent}`} className="mt-1 text-xs text-muted-foreground">
                  {projection.passengers} passageiros · {projection.passengerMix.adult} adultos / {projection.passengerMix.child} crianças / {projection.passengerMix.senior} idosos
                </p>
                <dl className="mt-4 space-y-2 text-xs">
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Receita projetada</dt><dd data-testid={`scenario-revenue-${projection.occupancyPercent}`} className="font-semibold">{formatCurrency(projection.grossRevenue)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Custos fixos</dt><dd data-testid={`scenario-fixed-costs-${projection.occupancyPercent}`}>{formatCurrency(projection.fixedCosts)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Custos variáveis</dt><dd data-testid={`scenario-variable-costs-${projection.occupancyPercent}`}>{formatCurrency(projection.variableCosts)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Custo operacional total</dt><dd data-testid={`scenario-operating-costs-${projection.occupancyPercent}`}>{formatCurrency(projection.operatingCosts)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Custo médio/pax</dt><dd data-testid={`scenario-average-cost-${projection.occupancyPercent}`}>{projection.averageCostPerPassenger === null ? "—" : formatCurrency(projection.averageCostPerPassenger)}</dd></div>
                  <div className="flex justify-between gap-3 border-t pt-2"><dt className="font-medium">Saldo projetado</dt><dd data-testid={`scenario-balance-${projection.occupancyPercent}`} className={`font-semibold ${projection.estimatedProfit < 0 ? "text-destructive" : "text-primary"}`}>{formatCurrency(projection.estimatedProfit)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Margem projetada</dt><dd data-testid={`scenario-margin-${projection.occupancyPercent}`}>{projection.marginPercent === null ? "—" : `${projection.marginPercent.toFixed(1)}%`}</dd></div>
                </dl>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

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
const amountInCents = (value: number | string) => Math.round((Number(value) + Number.EPSILON) * 100);

const AGENCY_CATEGORY_LABELS: Record<string, string> = {
  transport: "Transporte",
  accommodation: "Hospedagem",
  food: "Alimentação",
  marketing: "Marketing",
  administrative: "Taxas",
  commission: "Marketing",
  other: "Outros",
};

type DisplayCost = {
  id: string;
  category: string;
  description: string;
  amount: number;
  status: string;
  dueDate: string | null;
  paidAt: string | null;
  notes: string | null;
  supplierName: string | null;
  createdAt: string;
  source: "trip" | "agency";
  sourceLabel: string;
  linkedExpenseId?: string | null;
  linkedExpenseDescription?: string | null;
};

function getAgencyCategoryLabel(category: string) {
  return AGENCY_CATEGORY_LABELS[category] ?? category;
}

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
        await updateCost.mutateAsync({ id: tripId, costId: cost.id, data: payload });
        toast({ title: "Custo atualizado" });
      } else {
        await createCost.mutateAsync({ id: tripId, data: payload });
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
                  <Select value={field.value} onValueChange={field.onChange} disabled={Boolean(cost?.linkedExpenseId)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pendente</SelectItem>
                      <SelectItem value="paid">Pago</SelectItem>
                      <SelectItem value="overdue">Vencido</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              {cost?.linkedExpenseId && <p className="text-[10px] text-muted-foreground">Desvincule a despesa para alterar o status.</p>}
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
                    disabled={Boolean(cost?.linkedExpenseId)}
                    onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                  />
                )}
              />
              {errors.amount && <p className="text-[10px] text-destructive">{errors.amount.message}</p>}
              {cost?.linkedExpenseId && <p className="text-[10px] text-muted-foreground">Desvincule a despesa para alterar o valor.</p>}
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
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useListTripCosts(tripId, {
    query: { queryKey: ["trip-costs", tripId], enabled: !!tripId },
  });
  const { data: tripExpenses, isLoading: isLoadingTripExpenses, refetch: refetchExpenses } = useListExpenses(
    { tripId, limit: 500 },
    {
      query: {
        queryKey: getListExpensesQueryKey({ tripId, limit: 500 }),
        enabled: Boolean(tripId),
      },
    },
  );
  const deleteCost = useDeleteTripCost();
  const linkExpense = useLinkExpenseToTripCost();
  const unlinkExpense = useUnlinkExpenseFromTripCost();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCost, setEditingCost] = useState<TripCost | null>(null);
  const [linkingCost, setLinkingCost] = useState<DisplayCost | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const costs = data?.costs ?? [];
  const agencyExpenses = data?.agencyExpenses ?? [];
  const plannedCosts = data?.plannedCosts ?? [];
  const summary = data?.summary;
  const pricing = data?.pricing;
  const matchingExpenses = linkingCost
    ? (tripExpenses?.data ?? []).filter(expense =>
      !expense.linkedTripCostId
      && amountInCents(expense.amount) === amountInCents(linkingCost.amount)
      && expense.status === linkingCost.status,
    )
    : [];

  const mergedCosts: DisplayCost[] = [
    ...costs.map((cost): DisplayCost => ({
      id: cost.id,
      category: cost.category,
      description: cost.description,
      amount: cost.amount,
      status: cost.status,
      dueDate: cost.dueDate,
      paidAt: cost.paidAt,
      notes: cost.notes,
      supplierName: cost.supplierName,
      createdAt: cost.createdAt,
      source: "trip",
      sourceLabel: "Custo da viagem",
      linkedExpenseId: cost.linkedExpenseId,
      linkedExpenseDescription: cost.linkedExpenseDescription,
    })),
    ...agencyExpenses.map((expense): DisplayCost => ({
      id: expense.id,
      category: getAgencyCategoryLabel(expense.category),
      description: expense.description,
      amount: expense.amount,
      status: expense.status,
      dueDate: expense.dueDate,
      paidAt: expense.paymentDate ?? null,
      notes: expense.notes ?? null,
      supplierName: null,
      createdAt: expense.createdAt,
      source: "agency",
      sourceLabel: "Despesa da agência",
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const costStatusTotals = mergedCosts.reduce((totals, cost) => {
    if ((cost.source === "trip" && cost.linkedExpenseId) || cost.status === "cancelled") return totals;
    const amount = Number(cost.amount);
    const amountCents = Number.isFinite(amount)
      ? Math.round((amount + Number.EPSILON) * 100)
      : 0;
    if (cost.status === EXPENSE_STATUS.PAID) totals.paid += amountCents;
    else if (cost.status === EXPENSE_STATUS.OVERDUE) totals.overdue += amountCents;
    else if (cost.status === EXPENSE_STATUS.PENDING) totals.pending += amountCents;
    return totals;
  }, { paid: 0, pending: 0, overdue: 0 });

  const filtered = mergedCosts.filter(c => {
    if (filterCategory !== "all" && c.category !== filterCategory) return false;
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    return true;
  });

  const refreshFinancialViews = async () => {
    await Promise.all([
      refetch(),
      refetchExpenses(),
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/financial-metrics"] }),
    ]);
  };

  const handleDelete = async (cost: DisplayCost) => {
    if (cost.source !== "trip") return;
    const message = cost.linkedExpenseId
      ? "Remover este custo e desvincular a despesa associada?"
      : "Remover este custo?";
    if (!confirm(message)) return;
    setDeletingId(cost.id);
    try {
      await deleteCost.mutateAsync({ id: tripId, costId: cost.id });
      toast({ title: "Custo removido" });
      await refreshFinancialViews();
    } catch {
      toast({ title: "Erro ao remover custo", variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  const handleLinkExpense = async (expense: Expense) => {
    if (!linkingCost) return;
    try {
      await linkExpense.mutateAsync({
        id: expense.id,
        data: { tripCostId: linkingCost.id },
      });
      toast({ title: "Despesa vinculada ao custo da viagem" });
      setLinkingCost(null);
      await refreshFinancialViews();
    } catch {
      toast({ title: "Não foi possível vincular os registros", variant: "destructive" });
    }
  };

  const handleUnlinkExpense = async (expenseId: string) => {
    try {
      await unlinkExpense.mutateAsync({ id: expenseId });
      toast({ title: "Vínculo removido" });
      await refreshFinancialViews();
    } catch {
      toast({ title: "Não foi possível remover o vínculo", variant: "destructive" });
    }
  };


  return (
    <div className="space-y-6">
      {summary && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div data-testid="card-trip-booked-revenue" className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Banknote className="w-4 h-4 text-blue-600" />
              <span className="text-xs text-blue-600 font-medium">Receita contratada</span>
            </div>
            <p data-testid="text-trip-booked-revenue" className="text-lg font-bold text-blue-700">{formatCurrency(summary.expectedRevenue)}</p>
            <p className="text-xs text-blue-500 mt-0.5">
              Reservas confirmadas · {summary.confirmedSeats} passageiros. Não é caixa recebido; confira recebimentos na aba Passageiros.
            </p>
          </div>
          <div data-testid="card-trip-costs-recorded" className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="w-4 h-4 text-red-600" />
              <span className="text-xs text-red-600 font-medium">Custos registrados</span>
            </div>
            <p data-testid="text-trip-costs-recorded" className="text-lg font-bold text-red-700">{formatCurrency(summary.totalRealCosts)}</p>
            <p data-testid="text-trip-costs-status-breakdown" className="text-xs text-red-500 mt-0.5">
              Lançamentos reais, incluindo pagos, pendentes e vencidos.
            </p>
          </div>
          <div data-testid="card-trip-costs-paid" className="rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Receipt className="w-4 h-4 text-green-700" />
              <span className="text-xs font-medium text-green-700">Custos pagos</span>
            </div>
            <p data-testid="text-trip-costs-paid" className="text-lg font-bold text-green-800">{formatCurrency(summary.totalPaidCosts)}</p>
            <p className="mt-0.5 text-xs text-green-700">Saída de caixa registrada nos custos.</p>
          </div>
          <div data-testid="card-trip-costs-pending" className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="mb-1 flex items-center gap-2">
              <Receipt className="h-4 w-4 text-amber-700" />
              <span className="text-xs font-medium text-amber-700">Custos em aberto</span>
            </div>
            <p data-testid="text-trip-costs-pending" className="text-lg font-bold text-amber-800">{formatCurrency(summary.totalPendingCosts)}</p>
            <p className="mt-0.5 text-xs text-amber-700">
              Pendentes {formatCurrency(costStatusTotals.pending / 100)} · vencidos {formatCurrency(costStatusTotals.overdue / 100)}.
            </p>
          </div>
          <div data-testid="card-trip-planned-costs" className="rounded-lg border border-border bg-secondary/35 p-4">
            <div className="mb-1 flex items-center gap-2">
              <PiggyBank className="h-4 w-4 text-primary" />
              <span className="text-xs font-medium text-primary">Custos planejados</span>
            </div>
            <p data-testid="text-trip-planned-costs" className="text-lg font-bold">{formatCurrency(summary.plannedBudget)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Orçamento de referência; não é lançamento nem pagamento.</p>
          </div>
          <div data-testid="card-trip-budget-variance" className={`border rounded-lg p-4 ${summary.budgetVariance <= 0 ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}>
            <div className="flex items-center gap-2 mb-1">
              <PiggyBank className="w-4 h-4 text-amber-600" />
              <span className="text-xs text-amber-700 font-medium">Orçado vs lançado</span>
            </div>
            <p data-testid="text-trip-budget-variance" className={`text-lg font-bold ${summary.budgetVariance <= 0 ? "text-green-700" : "text-amber-700"}`}>
              {summary.budgetVariance === 0
                ? "Dentro do orçamento"
                : summary.budgetVariance < 0
                  ? `${formatCurrency(Math.abs(summary.budgetVariance))} abaixo`
                  : `${formatCurrency(summary.budgetVariance)} acima`}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Custos registrados vs orçamento planejado.
            </p>
          </div>
        </div>
      )}

      {data && (
        <OccupancyScenarioPlanner
          key={tripId}
          tripId={tripId}
          capacity={summary?.planningCapacity ?? 0}
          pricing={pricing}
          plannedCosts={plannedCosts}
        />
      )}

      <FinancialConsolidationView
        actualRows={mergedCosts.filter(cost => cost.source !== "trip" || !cost.linkedExpenseId)}
        plannedRows={plannedCosts}
        pricing={pricing}
        actualSummary={summary ? {
          totalRealCosts: summary.totalRealCosts,
          totalPaidCosts: summary.totalPaidCosts,
          totalPendingCosts: summary.totalPendingCosts,
        } : undefined}
        title="Conciliação financeira da viagem"
        description={`Preços, orçamento planejado, custos diretos e despesas da agência · orçamento para ${summary?.confirmedSeats ?? 0} passageiros confirmados / ${summary?.planningCapacity ?? 0} vagas`}
      />

      {costStatusTotals.overdue > 0 && (
        <div data-testid="alert-trip-costs-overdue" className="flex flex-wrap items-center justify-between gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Há <strong>{formatCurrency(costStatusTotals.overdue / 100)}</strong> em custos vencidos.
          </span>
          <Button
            data-testid="button-filter-overdue-costs"
            size="sm"
            variant="outline"
            className="h-7 text-xs border-red-300 text-red-700"
            onClick={() => setFilterStatus(EXPENSE_STATUS.OVERDUE)}
          >
            Ver vencidos
          </Button>
        </div>
      )}
      {costStatusTotals.pending > 0 && (
        <div data-testid="alert-trip-costs-pending" className="flex flex-wrap items-center justify-between gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Há <strong>{formatCurrency(costStatusTotals.pending / 100)}</strong> em custos aguardando pagamento.
          </span>
          <Button
            data-testid="button-filter-pending-costs"
            size="sm"
            variant="outline"
            className="h-7 text-xs border-amber-300 text-amber-700"
            onClick={() => setFilterStatus(EXPENSE_STATUS.PENDING)}
          >
            Ver pendentes
          </Button>
        </div>
      )}

      <div className="bg-card border rounded-lg">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-sm">Custos e despesas da viagem</h3>
            <Badge variant="secondary">{mergedCosts.length}</Badge>
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
                <SelectItem value="cancelled">Cancelada</SelectItem>
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
        ) : isError ? (
          <div className="text-center py-12 text-muted-foreground">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-40 text-destructive" />
            <p className="text-sm">Não foi possível carregar os dados financeiros desta viagem.</p>
            <Button variant="outline" size="sm" className="mt-3 text-xs" onClick={() => refetch()}>
              Tentar novamente
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Wallet className="w-10 h-10 mx-auto mb-3 opacity-25" />
            <p className="text-sm">{mergedCosts.length === 0 ? "Nenhum custo ou despesa vinculada ainda" : "Nenhum custo com esses filtros"}</p>
            {mergedCosts.length === 0 && (
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
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{cost.sourceLabel}</Badge>
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
                    {cost.source !== "trip" ? null : cost.linkedExpenseId ? (
                      <div className="mt-1 flex items-center gap-2 text-xs text-primary">
                        <Link2 className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Despesa vinculada: {cost.linkedExpenseDescription ?? cost.linkedExpenseId}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-xs"
                          onClick={() => handleUnlinkExpense(cost.linkedExpenseId!)}
                          disabled={unlinkExpense.isPending}
                        >
                          <Unlink className="mr-1 h-3 w-3" /> Desvincular
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-1 h-6 px-1.5 text-xs text-muted-foreground"
                        onClick={() => setLinkingCost(cost)}
                      >
                        <Link2 className="mr-1 h-3 w-3" /> Vincular despesa
                      </Button>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`font-bold text-sm ${cost.status === EXPENSE_STATUS.PAID ? "text-green-700" : cost.status === EXPENSE_STATUS.OVERDUE ? "text-red-600" : ""}`}>
                      {formatCurrency(cost.amount)}
                    </p>
                  </div>
                  {cost.source === "trip" && (
                     <div className="flex items-center gap-1 shrink-0">
                       <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                         onClick={() => {
                           const editableCost = costs.find(item => item.id === cost.id);
                           if (editableCost) {
                             setEditingCost(editableCost);
                             setModalOpen(true);
                           }
                         }}>
                         <Pencil className="w-3 h-3" />
                       </Button>
                       <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                         disabled={deletingId === cost.id}
                         onClick={() => handleDelete(cost)}>
                         {deletingId === cost.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                       </Button>
                     </div>
                   )}
                </div>
              );
            })}
          </div>
        )}

      </div>

      <TripCostModal
        tripId={tripId}
        cost={editingCost}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => { void refreshFinancialViews(); }}
      />
      <Dialog open={Boolean(linkingCost)} onOpenChange={open => { if (!open) setLinkingCost(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Vincular uma despesa</DialogTitle>
          </DialogHeader>
          {linkingCost && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Só aparecem despesas desta viagem com valor e status iguais a {linkingCost.description}.
              </p>
              {isLoadingTripExpenses ? (
                <Skeleton className="h-16 w-full" />
              ) : (tripExpenses?.data ?? []).length === 0 ? (
                <p className="rounded-md border p-4 text-sm text-muted-foreground">
                  Não há despesas registradas nesta viagem.
                </p>
              ) : matchingExpenses.length === 0 ? (
                <p className="rounded-md border p-4 text-sm text-muted-foreground">
                  Nenhuma despesa disponível corresponde a este custo.
                </p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-auto">
                  {matchingExpenses.map(expense => (
                    <div key={expense.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{expense.description}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatCurrency(expense.amount)} · {expense.status}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleLinkExpense(expense)}
                        disabled={linkExpense.isPending}
                      >
                        Vincular
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
