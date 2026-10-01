import { useMemo } from "react";
import type { Commission } from "@workspace/api-client-react";
import { COMMISSION_STATUS } from "@workspace/permissions";
import { DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import {
  PAYMENT_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/labels";

type CommissionsTabProps = {
  commissions: Commission[];
  isLoading: boolean;
  canEditCommissions: boolean;
  onApprove: (commissionId: string) => void;
  onPay: (commissionId: string) => void;
};

const fmt = (value: number | string) =>
  formatCurrency(typeof value === "string" ? Number.parseFloat(value) || 0 : value);

export function CommissionsTab({
  commissions,
  isLoading,
  canEditCommissions,
  onApprove,
  onPay,
}: CommissionsTabProps) {
  const totals = useMemo(() => {
    const total = commissions.reduce((sum, commission) => sum + Number.parseFloat(commission.commissionAmount), 0);
    const paid = commissions
      .filter((commission) => commission.status === COMMISSION_STATUS.PAID)
      .reduce((sum, commission) => sum + Number.parseFloat(commission.commissionAmount), 0);
    const pending = commissions
      .filter((commission) => commission.status === COMMISSION_STATUS.PENDING)
      .reduce((sum, commission) => sum + Number.parseFloat(commission.commissionAmount), 0);
    return { total, paid, pending };
  }, [commissions]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Total de Comissões</p>
            <p className="text-2xl font-bold mt-1">{fmt(totals.total)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Pagas</p>
            <p className="text-2xl font-bold mt-1 text-green-600">{fmt(totals.paid)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Pendentes</p>
            <p className="text-2xl font-bold mt-1 text-yellow-600">{fmt(totals.pending)}</p>
          </CardContent>
        </Card>
      </div>
      <div className="bg-card rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Vendedor</TableHead>
              <TableHead>Reserva</TableHead>
              <TableHead>Base</TableHead>
              <TableHead>Comissão</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>{Array.from({ length: 6 }).map((__, j) => <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
              ))
            ) : commissions.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhuma comissão registrada.</TableCell></TableRow>
            ) : commissions.map((commission) => (
              <TableRow key={commission.id}>
                <TableCell className="font-medium text-sm">{commission.userId}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{commission.reservationId ?? "—"}</TableCell>
                <TableCell className="text-sm">{fmt(commission.baseAmount)}</TableCell>
                <TableCell className="font-semibold text-sm">{fmt(commission.commissionAmount)}</TableCell>
                <TableCell>
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PAYMENT_STATUS_COLORS[commission.status] ?? "bg-gray-100 text-gray-800"}`}>
                    {PAYMENT_STATUS_LABELS[commission.status] ?? commission.status}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {canEditCommissions && commission.status === COMMISSION_STATUS.PENDING && (
                      <Button size="sm" variant="outline" onClick={() => onApprove(commission.id)}>
                        Aprovar
                      </Button>
                    )}
                    {canEditCommissions && commission.status === COMMISSION_STATUS.APPROVED && (
                      <Button size="sm" onClick={() => onPay(commission.id)}>
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
    </div>
  );
}