import type { Expense } from "@workspace/api-client-react";
import { EXPENSE_STATUS } from "@workspace/permissions";
import { CheckCircle, Plus } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDateOnlyBR } from "@/lib/utils";
import {
  EXPENSE_CATEGORY_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/labels";
import { PaymentPagination } from "./payment-pagination";

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

const fmt = (value: number | string) =>
  formatCurrency(typeof value === "string" ? Number.parseFloat(value) || 0 : value);

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
        Esta lista reúne despesas da agência e custos diretos de viagem; registros vinculados aparecem uma única vez. Marcar um item como pago atualiza esse custo. O indicador de lançamentos a pagar é um controle separado e não é criado automaticamente por esta lista.
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
                      {canEditFinancial && canMarkPaid && expense.linkedTripCostId ? (
                        <Link href="/financeiro/expenses" className="text-xs text-primary underline underline-offset-4" data-testid={`link-manage-expense-${expense.source}-${expense.id}`}>
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
                      ) : <span className="text-muted-foreground">—</span>}
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
    </>
  );
}