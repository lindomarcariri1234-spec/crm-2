import type { CommissionReport } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckSquare2,
  Clock,
  Table as TableIcon,
  Wallet,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrencyBRL as fmtCurrency } from "@/lib/utils";

interface ReferralCommissionSummaryProps {
  report?: CommissionReport;
}

export function ReferralCommissionSummary({ report }: ReferralCommissionSummaryProps) {
  if (!report) return null;

  return (
    <div className="space-y-2" aria-label="Resumo de Comissões">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Relatório de Comissões de Campanhas
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-amber-50/40 border-amber-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-800">
              <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
              Comissões Pendentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-amber-900">{fmtCurrency(report.totals.pending)}</p>
            <p className="text-xs text-amber-700 mt-1">{report.counts.pending} indicações</p>
          </CardContent>
        </Card>
        <Card className="bg-blue-50/40 border-blue-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-blue-800">
              <CheckSquare2 className="w-4 h-4 shrink-0" aria-hidden="true" />
              Comissões Aprovadas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-900">{fmtCurrency(report.totals.approved)}</p>
            <p className="text-xs text-blue-700 mt-1">{report.counts.approved} indicações</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50/40 border-green-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-green-800">
              <Wallet className="w-4 h-4 shrink-0" aria-hidden="true" />
              Comissões Pagas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-900">{fmtCurrency(report.totals.paid)}</p>
            <p className="text-xs text-green-700 mt-1">{report.counts.paid} indicações</p>
          </CardContent>
        </Card>
      </div>

      {report.partnerTotals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Total contratado por parceiro</CardTitle>
            <CardDescription>
              Valores de indicação separados do repasse dos produtos do parceiro.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {report.partnerTotals.map((partner) => (
              <div key={partner.partnerId} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{partner.partnerName}</span>
                <span className="font-medium shrink-0">{fmtCurrency(partner.total)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {report.entries.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TableIcon className="w-4 h-4 text-muted-foreground" />
              Lançamentos de comissão
            </CardTitle>
            <CardDescription>
              Beneficiário, cálculo e status de cada comissão de indicação.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Beneficiário</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Base de cálculo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.entries.slice(0, 10).map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{entry.recipientName}</TableCell>
                    <TableCell>{entry.recipientType === "partner" ? "Parceiro" : "Divulgador"}</TableCell>
                    <TableCell className="max-w-[280px] truncate" title={entry.basis}>{entry.basis}</TableCell>
                    <TableCell>
                      <Badge variant={entry.status === "reversed" ? "destructive" : entry.status === "paid" ? "default" : "outline"}>
                        {entry.status === "reversed"
                          ? "Revertida"
                          : entry.status === "approved"
                            ? "Aprovada"
                            : entry.status === "paid"
                              ? "Paga"
                              : "Pendente"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{fmtCurrency(entry.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}