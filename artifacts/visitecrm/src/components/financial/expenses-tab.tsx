import type { Expense } from "@workspace/api-client-react";
import { PAYMENT_STATUS, EXPENSE_STATUS } from "@workspace/permissions";
import { CheckCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  EXPENSE_CATEGORY_LABELS,
  PAYMENT_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/labels";

type ExpensesTabProps = {
  expenses: Expense[];
  isLoading: boolean;
  canCreateFinancial: boolean;
  onRegisterExpense: () => void;
  canEditFinancial: boolean;
  updateExpensePending: boolean;
  onMarkPaid: (expenseId: string) => void;
};

const fmt = (value: number | string) =>
  formatCurrency(typeof value === "string" ? Number.parseFloat(value) || 0 : value);

export function ExpensesTab({
  expenses,
  isLoading,
  canCreateFinancial,
  onRegisterExpense,
  canEditFinancial,
  updateExpensePending,
  onMarkPaid,
}: ExpensesTabProps) {
  return (
    <>
      <div className="flex justify-end mb-3">
        {canCreateFinancial && (
          <Button variant="outline" size="sm" onClick={onRegisterExpense}>
            <Plus className="w-4 h-4 mr-2" /> Registrar Despesa
          </Button>
        )}
      </div>
      <div className="bg-card rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
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
                <TableRow key={i}>{Array.from({ length: 7 }).map((__, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
              ))
            ) : expenses.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nenhuma despesa registrada.</TableCell></TableRow>
            ) : expenses.map((expense) => (
              <TableRow key={expense.id}>
                <TableCell className="font-medium text-sm">{expense.description}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{EXPENSE_CATEGORY_LABELS[expense.category] ?? expense.category}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{expense.supplierName ?? (expense.supplierId ? `${expense.supplierId.slice(0, 8)}…` : "—")}</TableCell>
                <TableCell className="text-sm">{formatDate(String(expense.dueDate))}</TableCell>
                <TableCell className="font-medium text-sm">{fmt(expense.amount)}</TableCell>
                <TableCell>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_STATUS_COLORS[expense.status] ?? "bg-gray-100 text-gray-800"}`}>
                    {PAYMENT_STATUS_LABELS[expense.status] ?? expense.status}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {canEditFinancial && expense.status !== EXPENSE_STATUS.PAID && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={updateExpensePending}
                      onClick={() => void onMarkPaid(expense.id)}
                    >
                      <CheckCircle className="w-4 h-4 mr-1" /> Pago
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}