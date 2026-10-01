import type { Payment } from "@workspace/api-client-react";
import { PAYMENT_STATUS } from "@workspace/permissions";
import { CheckCircle, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  PAYMENT_METHOD_LABELS as METHOD_LABELS,
  PAYMENT_STATUS_COLORS as STATUS_COLORS,
  PAYMENT_STATUS_LABELS as STATUS_LABELS,
} from "@/lib/labels";
import { PaymentPagination } from "./payment-pagination";

export type UpcomingInstallment = {
  id: string;
  reservationId: string;
  installmentNumber: number;
  dueDate: string;
  amount: number;
  clientName: string | null;
  tripName: string | null;
  voucherCode: string | null;
};

type ReceivablesTabProps = {
  showUpcomingInstallments: boolean;
  upcomingInstallments: UpcomingInstallment[];
  loadingUpcoming: boolean;
  upcomingError: string | null;
  onRetryUpcoming: () => void;
  loadingPayments: boolean;
  paymentsError: boolean;
  onRetryPayments: () => void;
  paymentRows: Payment[];
  clientMap: Record<string, string>;
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

export function ReceivablesTab({
  showUpcomingInstallments,
  upcomingInstallments,
  loadingUpcoming,
  upcomingError,
  onRetryUpcoming,
  loadingPayments,
  paymentsError,
  onRetryPayments,
  paymentRows,
  clientMap,
  canEditFinancial,
  updatePaymentPending,
  onMarkPaid,
  page,
  total,
  pageSize,
  onPageChange,
}: ReceivablesTabProps) {
  return (
    <>
      {showUpcomingInstallments && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-orange-100 border-b border-orange-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-orange-800">📅 Parcelas com vencimento nos próximos 7 dias</h3>
            <span className="text-xs text-orange-600">{upcomingInstallments.length} parcela(s)</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reserva</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Viagem</TableHead>
                <TableHead>Parcela</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Valor</TableHead>
                <TableHead className="text-right">Ação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingUpcoming ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>{Array.from({ length: 7 }).map((__, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
                ))
              ) : upcomingError ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-sm text-destructive">
                    <div className="flex flex-wrap items-center justify-center gap-3">
                      <span role="alert">{upcomingError}</span>
                      <Button size="sm" variant="outline" onClick={onRetryUpcoming}>
                        Tentar novamente
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : upcomingInstallments.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground text-sm">Nenhuma parcela vencendo nos próximos 7 dias.</TableCell></TableRow>
              ) : upcomingInstallments.map((installment) => (
                <TableRow key={installment.id} className="hover:bg-orange-50/50">
                  <TableCell className="font-mono text-xs">{installment.voucherCode ?? "—"}</TableCell>
                  <TableCell className="text-sm">{installment.clientName ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground truncate max-w-[140px]">{installment.tripName ?? "—"}</TableCell>
                  <TableCell className="text-sm text-center">#{installment.installmentNumber}</TableCell>
                  <TableCell className="text-sm font-medium text-orange-700">{formatDate(String(installment.dueDate))}</TableCell>
                  <TableCell className="font-semibold text-sm">{fmt(installment.amount)}</TableCell>
                  <TableCell className="text-right">
                    <Link href={`/reservations?id=${installment.reservationId}`}>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
                        <ExternalLink className="w-3 h-3 mr-1" />
                        Ver reserva
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="bg-card rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Descrição</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Forma</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingPayments ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 8 }).map((__, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
              ))
            ) : paymentsError ? (
              <TableRow>
                <TableCell colSpan={8} className="py-6 text-center text-sm text-destructive">
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <span role="alert">Não foi possível carregar os recebíveis.</span>
                    <Button size="sm" variant="outline" onClick={onRetryPayments}>
                      Tentar novamente
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : paymentRows.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Nenhum lançamento encontrado.</TableCell></TableRow>
            ) : paymentRows.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell><p className="font-medium text-sm">{payment.description || "—"}</p></TableCell>
                <TableCell className="text-sm text-muted-foreground">{payment.clientId ? (clientMap[payment.clientId] ?? "—") : "—"}</TableCell>
                <TableCell><span className="text-xs text-muted-foreground">{payment.category}</span></TableCell>
                <TableCell className="text-sm">{formatDate(String(payment.dueDate))}</TableCell>
                <TableCell className="font-medium text-sm">{fmt(payment.amount)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{METHOD_LABELS[payment.paymentMethod] ?? payment.paymentMethod}</TableCell>
                <TableCell>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[payment.status] ?? "bg-gray-100 text-gray-800"}`}>
                    {STATUS_LABELS[payment.status] ?? payment.status}
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
                      <CheckCircle className="w-4 h-4 mr-1" />
                      Recebido
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
    </>
  );
}