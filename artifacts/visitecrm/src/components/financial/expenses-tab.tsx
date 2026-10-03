import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Expense } from "@workspace/api-client-react";
import {
  getListPaymentsQueryKey,
  useCreateOperationalCostPayable,
  useListPayments,
  useUnlinkOperationalCostPayable,
} from "@workspace/api-client-react";
import { EXPENSE_STATUS, PAYMENT_STATUS, PAYMENT_TYPE } from "@workspace/permissions";
import { CheckCircle, Link2, Plus, Unlink2 } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDateOnlyBR } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  EXPENSE_CATEGORY_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/labels";
import { PaymentPagination } from "./payment-pagination";
import { useToast } from "@/hooks/use-toast";

type ExpensesTabProps = {
  expenses: Expense[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  canCreateFinancial: boolean;
  onRegisterExpense: () => void;
  canEditFinancial: boolean;
  updateExpensePending: boolean;
  onMarkPaid: (expense: Expense) => void;
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
};

const payableListParams = {
  type: PAYMENT_TYPE.PAYABLE,
  unlinkedOnly: true,
  page: 1,
  limit: 500,
};

const fmt = (value: number | string) =>
  formatCurrency(typeof value === "string" ? Number.parseFloat(value) || 0 : value);
const canHavePayable = (status: Expense["status"]) =>
  status === EXPENSE_STATUS.PENDING
  || status === EXPENSE_STATUS.OVERDUE
  || status === EXPENSE_STATUS.PAID;

export function ExpensesTab({
  expenses,
  isLoading,
  isError,
  onRetry,
  canCreateFinancial,
  onRegisterExpense,
  canEditFinancial,
  updateExpensePending,
  onMarkPaid,
  page,
  total,
  pageSize,
  onPageChange,
}: ExpensesTabProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [payableTarget, setPayableTarget] = useState<Expense | null>(null);
  const [payableMode, setPayableMode] = useState<"create" | "link">("create");
  const [paymentMethod, setPaymentMethod] = useState("pix");
  const [dueDate, setDueDate] = useState("");
  const [existingPaymentId, setExistingPaymentId] = useState("");
  const createPayable = useCreateOperationalCostPayable();
  const unlinkPayable = useUnlinkOperationalCostPayable();
  const {
    data: unlinkedPayablesData,
    isLoading: loadingUnlinkedPayables,
    isError: unlinkedPayablesError,
  } = useListPayments(payableListParams, {
    query: {
      enabled: payableTarget !== null,
      queryKey: getListPaymentsQueryKey(payableListParams),
    },
  });
  const exactPayableMatches = payableTarget
    ? (unlinkedPayablesData?.data ?? []).filter((payment) =>
      Math.round(payment.amount * 100) === Math.round(payableTarget.amount * 100)
      && payment.status === payableTarget.status,
    )
    : [];
  const canCreatePayable = canCreateFinancial && Boolean(payableTarget && canHavePayable(payableTarget.status));
  const canLinkPayable = canEditFinancial && Boolean(payableTarget && canHavePayable(payableTarget.status));
  const payableMutationPending = createPayable.isPending || unlinkPayable.isPending;

  const refreshOperationalCostData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/expenses"] }),
      queryClient.invalidateQueries({ queryKey: ["trip-costs"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/admin/financial-metrics"] }),
    ]);
  };

  const openPayableDialog = (expense: Expense) => {
    setPayableTarget(expense);
    setPayableMode(canCreateFinancial ? "create" : "link");
    setPaymentMethod("pix");
    setDueDate(expense.payableDueDateRequired ? "" : expense.dueDate.slice(0, 10));
    setExistingPaymentId("");
  };

  const closePayableDialog = () => {
    if (payableMutationPending) return;
    setPayableTarget(null);
  };

  const handleCreateOrLinkPayable = async () => {
    if (!payableTarget) return;
    if (payableMode === "link" && !existingPaymentId) {
      toast({ title: "Selecione uma conta a pagar.", variant: "destructive" });
      return;
    }
    if (payableMode === "create" && payableTarget.payableDueDateRequired && !dueDate) {
      toast({ title: "Informe o vencimento da conta a pagar.", variant: "destructive" });
      return;
    }
    try {
      await createPayable.mutateAsync({
        data: {
          sourceType: payableTarget.source === "trip" ? "trip_cost" : "expense",
          sourceId: payableTarget.id,
          ...(payableMode === "link"
            ? { paymentId: existingPaymentId }
            : {
              paymentMethod,
              ...(payableTarget.payableDueDateRequired ? { dueDate } : {}),
            }),
        },
      });
      await refreshOperationalCostData();
      toast({
        title: payableMode === "link" ? "Conta a pagar vinculada." : "Conta a pagar criada.",
      });
      setPayableTarget(null);
    } catch {
      toast({
        title: "Não foi possível associar a conta a pagar.",
        description: "Confira o valor e o status do lançamento e tente novamente.",
        variant: "destructive",
      });
    }
  };

  const handleUnlinkPayable = async (expense: Expense) => {
    const confirmed = window.confirm(
      "Desvincular remove apenas a associação. A despesa e a conta a pagar continuarão salvas separadamente. Deseja continuar?",
    );
    if (!confirmed) return;
    try {
      await unlinkPayable.mutateAsync({
        sourceType: expense.source === "trip" ? "trip_cost" : "expense",
        sourceId: expense.id,
      });
      await refreshOperationalCostData();
      toast({ title: "Conta a pagar desvinculada." });
    } catch {
      toast({
        title: "Não foi possível desvincular a conta.",
        description: "O vínculo atual foi mantido. Tente novamente.",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <div className="flex justify-end mb-3">
        {canCreateFinancial && (
          <Button variant="outline" size="sm" onClick={onRegisterExpense}>
            <Plus className="w-4 h-4 mr-2" /> Registrar Despesa da Agência
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground" data-testid="text-expenses-scope">
        Esta lista reúne despesas da agência e custos diretos de viagem; registros vinculados aparecem uma única vez. Marcar um item como pago atualiza esse custo. Uma conta a pagar só é criada ou vinculada por ação explícita.
      </p>
      <div className="bg-card rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((__, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-sm text-destructive">
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <span role="alert">Não foi possível carregar as despesas e os custos de viagem.</span>
                      <Button size="sm" variant="outline" onClick={onRetry} data-testid="button-retry-expenses">
                        Tentar novamente
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : expenses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    Nenhuma despesa ou custo de viagem encontrado.
                  </TableCell>
                </TableRow>
              ) : expenses.map((expense) => {
                const canMarkPaid = expense.status === EXPENSE_STATUS.PENDING
                  || expense.status === EXPENSE_STATUS.OVERDUE;
                return (
                  <TableRow key={`${expense.source}-${expense.id}`} data-testid={`row-expense-${expense.source}-${expense.id}`}>
                    <TableCell className="font-medium text-sm">{expense.description}</TableCell>
                    <TableCell className="text-xs">
                      <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ${
                        expense.source === "trip" ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-700"
                      }`} data-testid={`text-expense-source-${expense.source}-${expense.id}`}>
                        {expense.source === "trip" ? "Custo da viagem" : "Despesa da agência"}
                      </span>
                      {expense.linkedTripCostId && (
                        <p className="mt-1 text-[10px] text-muted-foreground">Vinculada ao custo da viagem</p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{EXPENSE_CATEGORY_LABELS[expense.category] ?? expense.category}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{expense.supplierName ?? (expense.supplierId ? `${expense.supplierId.slice(0, 8)}…` : "—")}</TableCell>
                    <TableCell className="text-sm">{formatDateOnlyBR(expense.dueDate || null)}</TableCell>
                    <TableCell className="font-medium text-sm">{fmt(expense.amount)}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_STATUS_COLORS[expense.status] ?? "bg-gray-100 text-gray-800"}`}
                        data-testid={`status-expense-${expense.source}-${expense.id}`}
                      >
                        {PAYMENT_STATUS_LABELS[expense.status] ?? expense.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {canEditFinancial && canMarkPaid && expense.linkedTripCostId ? (
                          <Link href="/financeiro/expenses" className="self-center text-xs text-primary underline underline-offset-4" data-testid={`link-manage-expense-${expense.source}-${expense.id}`}>
                            Gerenciar vínculo
                          </Link>
                        ) : canEditFinancial && canMarkPaid ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={updateExpensePending}
                            onClick={() => void onMarkPaid(expense)}
                            data-testid={`button-mark-expense-paid-${expense.source}-${expense.id}`}
                          >
                            <CheckCircle className="w-4 h-4 mr-1" /> Pago
                          </Button>
                        ) : null}
                        {expense.payablePaymentId ? (
                          <>
                            <span className="self-center text-xs text-muted-foreground" data-testid={`text-payable-status-${expense.source}-${expense.id}`}>
                              Conta: {PAYMENT_STATUS_LABELS[expense.payableStatus ?? ""] ?? expense.payableStatus}
                            </span>
                            {canEditFinancial && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={payableMutationPending}
                                onClick={() => void handleUnlinkPayable(expense)}
                                data-testid={`button-unlink-payable-${expense.source}-${expense.id}`}
                              >
                                <Unlink2 className="mr-1 h-4 w-4" /> Desvincular
                              </Button>
                            )}
                          </>
                        ) : (canCreateFinancial || canEditFinancial) && canHavePayable(expense.status) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={payableMutationPending}
                            onClick={() => openPayableDialog(expense)}
                            data-testid={`button-manage-payable-${expense.source}-${expense.id}`}
                          >
                            <Link2 className="mr-1 h-4 w-4" /> Criar/vincular conta
                          </Button>
                        ) : null}
                        {!canEditFinancial && !canCreateFinancial && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <PaymentPagination
          page={page}
          total={total}
          pageSize={pageSize}
          onPageChange={onPageChange}
        />
      </div>
      <Dialog
        open={payableTarget !== null}
        onOpenChange={(open) => {
          if (!open) closePayableDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {payableTarget?.payablePaymentId ? "Gerenciar conta a pagar" : "Associar conta a pagar"}
            </DialogTitle>
            <DialogDescription>
              A associação é manual. Nenhuma conta será vinculada por semelhança de valor ou data.
              {payableTarget && (
                <span className="mt-2 block font-medium text-foreground">
                  {payableTarget.description} · {fmt(payableTarget.amount)} · {PAYMENT_STATUS_LABELS[payableTarget.status] ?? payableTarget.status}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {canCreatePayable && canLinkPayable && (
            <div className="flex gap-2" role="tablist" aria-label="Ação para a conta a pagar">
              <Button
                type="button"
                size="sm"
                variant={payableMode === "create" ? "default" : "outline"}
                onClick={() => setPayableMode("create")}
                role="tab"
                aria-selected={payableMode === "create"}
              >
                Criar nova
              </Button>
              <Button
                type="button"
                size="sm"
                variant={payableMode === "link" ? "default" : "outline"}
                onClick={() => setPayableMode("link")}
                role="tab"
                aria-selected={payableMode === "link"}
              >
                Vincular existente
              </Button>
            </div>
          )}

          {payableMode === "create" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                O lançamento será criado com o valor e o status atuais deste custo.
              </p>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="operational-payable-method">Forma de pagamento</label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger id="operational-payable-method" aria-label="Forma de pagamento">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["pix", "credit_card", "debit_card", "bank_transfer", "cash", "boleto"].map((method) => (
                      <SelectItem key={method} value={method}>
                        {PAYMENT_METHOD_LABELS[method] ?? method}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {payableTarget?.payableDueDateRequired && (
                <div className="space-y-2">
                  <label className="text-sm font-medium" htmlFor="operational-payable-due-date">Vencimento</label>
                  <Input
                    id="operational-payable-due-date"
                    type="date"
                    value={dueDate}
                    onChange={(event) => setDueDate(event.target.value)}
                    required
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Selecione uma conta a pagar sem vínculo e com o mesmo valor e status.
              </p>
              {loadingUnlinkedPayables ? (
                <Skeleton className="h-10 w-full" />
              ) : unlinkedPayablesError ? (
                <p className="text-sm text-destructive" role="alert">Não foi possível carregar contas a pagar. Feche e abra esta janela para tentar novamente.</p>
              ) : exactPayableMatches.length === 0 ? (
                <p className="rounded-md border p-3 text-sm text-muted-foreground">
                  Nenhuma conta sem vínculo corresponde ao valor e status deste custo.
                </p>
              ) : (
                <Select value={existingPaymentId} onValueChange={setExistingPaymentId}>
                  <SelectTrigger aria-label="Conta a pagar existente">
                    <SelectValue placeholder="Selecione uma conta existente" />
                  </SelectTrigger>
                  <SelectContent>
                    {exactPayableMatches.map((payment) => (
                      <SelectItem key={payment.id} value={payment.id}>
                        {(payment.description || payment.category)} · {fmt(payment.amount)} · {formatDateOnlyBR(payment.dueDate)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closePayableDialog} disabled={payableMutationPending}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleCreateOrLinkPayable()}
              disabled={
                payableMutationPending
                || (payableMode === "create" && !canCreatePayable)
                || (payableMode === "link" && (!canLinkPayable || !existingPaymentId || exactPayableMatches.length === 0))
                || (payableMode === "create" && Boolean(payableTarget?.payableDueDateRequired && !dueDate))
              }
            >
              {payableMutationPending ? "Salvando..." : payableMode === "create" ? "Criar conta" : "Vincular conta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}