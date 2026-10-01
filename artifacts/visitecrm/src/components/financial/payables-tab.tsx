import type { Payment } from "@workspace/api-client-react";
import { PAYMENT_STATUS } from "@workspace/permissions";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  PAYMENT_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/labels";
import { PaymentPagination } from "./payment-pagination";

type PayablesTabProps = {
  payments: Payment[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  canEditFinancial: boolean;
  updatePaymentPending: boolean;
  onMarkPaid: (paymentId: string) => void;
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
};

const fmt = (value: number | string) =>
  formatCurrency(typeof value === "string" ? Number.parseFloat(value) || 0 : value);

export function PayablesTab({
  payments,
  isLoading,
  isError,
  onRetry,
  canEditFinancial,
  updatePaymentPending,
  onMarkPaid,
  page,
  total,
  pageSize,
  onPageChange,
}: PayablesTabProps) {
  return (
    <div className="bg-card rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Descrição</TableHead>
            <TableHead>Categoria</TableHead>
            <TableHead>Vencimento</TableHead>
            <TableHead>Valor</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>{Array.from({ length: 6 }).map((__, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
            ))
          ) : isError ? (
            <TableRow>
              <TableCell colSpan={6} className="py-6 text-center text-sm text-destructive">
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <span role="alert">Não foi possível carregar os pagamentos a pagar.</span>
                  <Button size="sm" variant="outline" onClick={onRetry}>
                    Tentar novamente
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ) : payments.length === 0 ? (
            <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum lançamento encontrado.</TableCell></TableRow>
          ) : payments.map((payment) => (
            <TableRow key={payment.id}>
              <TableCell><p className="font-medium text-sm">{payment.description || "—"}</p></TableCell>
              <TableCell className="text-xs text-muted-foreground">{payment.category}</TableCell>
              <TableCell className="text-sm">{formatDate(String(payment.dueDate))}</TableCell>
              <TableCell className="font-medium text-sm">{fmt(payment.amount)}</TableCell>
              <TableCell>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_STATUS_COLORS[payment.status] ?? "bg-gray-100 text-gray-800"}`}>
                  {PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}
                </span>
              </TableCell>
              <TableCell className="text-right">
                {canEditFinancial && payment.status === PAYMENT_STATUS.PENDING && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={updatePaymentPending}
                    onClick={() => void onMarkPaid(payment.id)}
                  >
                    <CheckCircle className="w-4 h-4 mr-1" /> Pago
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <PaymentPagination
        page={page}
        total={total}
        pageSize={pageSize}
        onPageChange={onPageChange}
      />
    </div>
  );
}