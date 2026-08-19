import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface TripFinancialReport {
  reservationCount: number;
  confirmedCount: number;
  pendingCount: number;
  cancelledCount: number;
  totalRevenue: number;
  totalPaid: number;
  totalPending: number;
  totalExpenses: number;
  netProfit: number;
  revenueByMethod: Record<string, number>;
  expensesByCategory: Record<string, number>;
}

interface PassengersOverviewFinancialDialogProps {
  open: boolean;
  onClose: (v: boolean) => void;
  loadingReport: boolean;
  financialReport: TripFinancialReport | undefined;
  tripName: string | undefined;
}

export function PassengersOverviewFinancialDialog({
  open, onClose, loadingReport, financialReport, tripName,
}: PassengersOverviewFinancialDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Relatório Financeiro — {tripName}</DialogTitle>
        </DialogHeader>
        {loadingReport ? (
          <div className="space-y-3 py-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-10 bg-muted rounded animate-pulse" />)}</div>
        ) : financialReport ? (
          <div className="space-y-5 mt-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Reservas", value: String(financialReport.reservationCount), color: "text-foreground" },
                { label: "Confirmadas", value: String(financialReport.confirmedCount), color: "text-green-600" },
                { label: "Pendentes", value: String(financialReport.pendingCount), color: "text-amber-600" },
                { label: "Canceladas", value: String(financialReport.cancelledCount), color: "text-red-600" },
              ].map(s => (
                <div key={s.label} className="bg-muted/50 rounded-lg p-3 text-center">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Receita Total", value: financialReport.totalRevenue, color: "text-blue-600" },
                { label: "Total Recebido", value: financialReport.totalPaid, color: "text-green-600" },
                { label: "A Receber", value: financialReport.totalPending, color: "text-amber-600" },
                { label: "Total Despesas", value: financialReport.totalExpenses, color: "text-red-600" },
                { label: "Lucro Líquido", value: financialReport.netProfit, color: financialReport.netProfit >= 0 ? "text-green-600" : "text-red-600" },
              ].map(s => (
                <div key={s.label} className="bg-muted/50 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={`text-xl font-bold ${s.color}`}>R$ {s.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                </div>
              ))}
            </div>
            {Object.keys(financialReport.revenueByMethod).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Receita por Forma de Pagamento</h4>
                {Object.entries(financialReport.revenueByMethod).map(([method, amount]) => {
                  const labels: Record<string, string> = { pix: "PIX", credit_card: "Cartão Crédito", debit_card: "Cartão Débito", cash: "Dinheiro", bank_transfer: "Transferência", boleto: "Boleto" };
                  const total = Object.values(financialReport.revenueByMethod).reduce((s, v) => s + v, 0);
                  const pct = total > 0 ? Math.round(amount / total * 100) : 0;
                  return (
                    <div key={method} className="flex items-center gap-3 text-sm">
                      <span className="w-36 text-muted-foreground truncate">{labels[method] ?? method}</span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="font-medium w-20 text-right">R$ {amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {Object.keys(financialReport.expensesByCategory).length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Despesas por Categoria</h4>
                {Object.entries(financialReport.expensesByCategory).map(([cat, amount]) => {
                  const total = financialReport.totalExpenses;
                  const pct = total > 0 ? Math.round(amount / total * 100) : 0;
                  return (
                    <div key={cat} className="flex items-center gap-3 text-sm">
                      <span className="w-36 text-muted-foreground truncate capitalize">{cat}</span>
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-red-400 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="font-medium w-20 text-right">R$ {amount.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {financialReport.totalExpenses === 0 && Object.keys(financialReport.expensesByCategory).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">Nenhuma despesa registrada para esta viagem.</p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground py-4 text-center">Não foi possível carregar o relatório.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
