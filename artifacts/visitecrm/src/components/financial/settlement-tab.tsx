import { AlertCircle, DollarSign, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { KpiCard } from "./kpi-card";

export type SettlementData = {
  summary: {
    agencyNet: number;
    partnerPayable: number;
    walletOutstanding: number;
    cashbackOutstanding: number;
    reversals: number;
  };
  entries: Array<{
    id: string;
    participantType: string;
    category: string;
    direction: string;
    amount: number;
    settlementStatus: string;
    eventType: string;
    occurredAt: string;
  }>;
};

type SettlementTabProps = {
  settlement: SettlementData | null;
  isLoading: boolean;
  onRefresh: () => void;
};

const fmt = (value: number | string) =>
  formatCurrency(typeof value === "string" ? Number.parseFloat(value) || 0 : value);

export function SettlementTab({ settlement, isLoading, onRefresh }: SettlementTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Livro de liquidação por participante. Valores de carteira, cashback e comissão não se misturam.
        </p>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={isLoading}>
          Atualizar
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <KpiCard icon={DollarSign} label="Receita da agência" value={fmt(settlement?.summary.agencyNet ?? 0)} color="text-emerald-600" />
        <KpiCard icon={TrendingDown} label="Repasse a parceiros" value={fmt(settlement?.summary.partnerPayable ?? 0)} color="text-blue-600" />
        <KpiCard icon={DollarSign} label="Carteira em aberto" value={fmt(settlement?.summary.walletOutstanding ?? 0)} color="text-violet-600" />
        <KpiCard icon={DollarSign} label="Cashback em aberto" value={fmt(settlement?.summary.cashbackOutstanding ?? 0)} color="text-amber-600" />
        <KpiCard icon={AlertCircle} label="Estornos e disputas" value={fmt(settlement?.summary.reversals ?? 0)} color="text-red-600" />
      </div>
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Participante</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <TableRow key={index}>{Array.from({ length: 5 }).map((__, cell) => <TableCell key={cell}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>
              ))
            ) : !settlement?.entries.length ? (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">Nenhum lançamento de liquidação no período.</TableCell></TableRow>
            ) : settlement.entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="text-sm">{formatDate(entry.occurredAt)}</TableCell>
                <TableCell className="capitalize text-sm">{entry.participantType}</TableCell>
                <TableCell className="text-sm">{entry.category.replace(/_/g, " ")}</TableCell>
                <TableCell><Badge variant={entry.settlementStatus === "reversed" ? "destructive" : "secondary"}>{entry.settlementStatus}</Badge></TableCell>
                <TableCell className={`text-right font-medium ${entry.direction === "debit" ? "text-red-600" : "text-emerald-600"}`}>
                  {entry.direction === "debit" ? "−" : "+"}{fmt(entry.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}