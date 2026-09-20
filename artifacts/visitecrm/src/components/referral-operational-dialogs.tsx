import type { Referral } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, CheckSquare2, XCircle } from "lucide-react";
import { formatCurrencyBRL as fmtCurrency } from "@/lib/utils";

type Target = Referral & { referrerWhatsapp?: string | null };

interface Props {
  bulkOpen: boolean;
  onBulkOpenChange: (open: boolean) => void;
  selectedCount: number;
  selectedTotal: string | number;
  bulkPaying: boolean;
  onConfirmBulk: () => void;
  payOpen: boolean;
  onPayOpenChange: (open: boolean) => void;
  payTarget: Target | null;
  payPending: boolean;
  onConfirmPay: () => void;
  reverseOpen: boolean;
  onReverseOpenChange: (open: boolean) => void;
  reverseTarget: Target | null;
  reverseReason: string;
  onReverseReasonChange: (reason: string) => void;
  reversePending: boolean;
  onConfirmReverse: () => void;
}

export function ReferralOperationalDialogs({
  bulkOpen, onBulkOpenChange, selectedCount, selectedTotal, bulkPaying, onConfirmBulk,
  payOpen, onPayOpenChange, payTarget, payPending, onConfirmPay,
  reverseOpen, onReverseOpenChange, reverseTarget, reverseReason, onReverseReasonChange,
  reversePending, onConfirmReverse,
}: Props) {
  return <>
    <Dialog open={bulkOpen} onOpenChange={onBulkOpenChange}>
      <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Pagar bônus em lote</DialogTitle><DialogDescription>Isso marcará os bônus selecionados como pagos e enviará e-mails de confirmação a cada indicador.</DialogDescription></DialogHeader>
      <div className="bg-muted rounded-lg p-4 space-y-2 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Indicações selecionadas</span><span className="font-medium">{selectedCount}</span></div><div className="flex justify-between border-t pt-2"><span className="text-muted-foreground">Total a pagar</span><span className="font-bold text-green-600 text-base">{fmtCurrency(selectedTotal)}</span></div></div>
      <DialogFooter><Button variant="outline" onClick={() => onBulkOpenChange(false)} disabled={bulkPaying}>Cancelar</Button><Button onClick={onConfirmBulk} disabled={bulkPaying} className="bg-green-600 hover:bg-green-700"><CheckSquare2 className="w-4 h-4 mr-2" />{bulkPaying ? "Processando..." : `Confirmar ${selectedCount} pagamento${selectedCount !== 1 ? "s" : ""}`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={payOpen} onOpenChange={onPayOpenChange}>
      <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Confirmar Pagamento de Bônus</DialogTitle><DialogDescription>Isso marcará o bônus como pago e enviará um e-mail de confirmação ao indicador.</DialogDescription></DialogHeader>
      {payTarget && <div className="space-y-3 py-2"><div className="bg-muted rounded-lg p-4 space-y-2 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Indicador</span><span className="font-medium">{payTarget.referrerName ?? payTarget.referrerId.slice(0, 8)}</span></div>{payTarget.referrerEmail && <div className="flex justify-between"><span className="text-muted-foreground">E-mail</span><span className="text-sm">{payTarget.referrerEmail}</span></div>}{payTarget.referrerWhatsapp && <div className="flex justify-between"><span className="text-muted-foreground">WhatsApp</span><span className="text-sm">{payTarget.referrerWhatsapp}</span></div>}<div className="flex justify-between border-t pt-2"><span className="text-muted-foreground">Valor do bônus</span><span className="font-bold text-green-600 text-base">{fmtCurrency(payTarget.bonusAmount)}</span></div></div></div>}
      <DialogFooter><Button variant="outline" onClick={() => onPayOpenChange(false)} disabled={payPending}>Cancelar</Button><Button onClick={onConfirmPay} disabled={payPending} className="bg-green-600 hover:bg-green-700"><Check className="w-4 h-4 mr-2" />{payPending ? "Processando..." : "Confirmar pagamento"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={reverseOpen} onOpenChange={onReverseOpenChange}>
      <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2 text-red-700"><XCircle className="w-5 h-5" />{reverseTarget?.bonusPaid ? "Estornar Bônus Pago" : "Reverter Bônus de Indicação"}</DialogTitle><DialogDescription>{reverseTarget?.bonusPaid ? "Esta ação registrará um estorno financeiro para um bônus já pago, ajustará o saldo, a comissão e os pontos do indicador e enviará uma notificação. Não pode ser desfeita." : "Esta ação reverterá o bônus, decrementará os ganhos do indicador e enviará uma notificação por e-mail. Não pode ser desfeita."}</DialogDescription></DialogHeader>
      {reverseTarget && <div className="space-y-4 py-2"><div className="bg-muted rounded-lg p-4 space-y-2 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Indicador</span><span className="font-medium">{reverseTarget.referrerName ?? reverseTarget.referrerId.slice(0, 8)}</span></div>{reverseTarget.referrerEmail && <div className="flex justify-between"><span className="text-muted-foreground">E-mail</span><span className="text-sm">{reverseTarget.referrerEmail}</span></div>}<div className="flex justify-between border-t pt-2"><span className="text-muted-foreground">Valor do bônus</span><span className="font-bold text-red-600 text-base line-through">{fmtCurrency(reverseTarget.bonusAmount)}</span></div></div><div className="space-y-1.5"><Label htmlFor="reversal-reason">Motivo da reversão <span className="text-red-500">*</span></Label><Input id="reversal-reason" placeholder="Ex: Contestação do cliente, reembolso parcial..." value={reverseReason} onChange={(event) => onReverseReasonChange(event.target.value)} disabled={reversePending} /></div></div>}
      <DialogFooter><Button variant="outline" onClick={() => onReverseOpenChange(false)} disabled={reversePending}>Cancelar</Button><Button onClick={onConfirmReverse} disabled={reversePending || !reverseReason.trim()} className="bg-red-600 hover:bg-red-700 text-white"><XCircle className="w-4 h-4 mr-2" />{reversePending ? "Processando..." : reverseTarget?.bonusPaid ? "Confirmar estorno financeiro" : "Confirmar reversão"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}