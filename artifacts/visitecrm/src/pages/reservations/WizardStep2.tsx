import type { Trip } from "@workspace/api-client-react";
import { roundMoney } from "@/lib/reservationPricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tag } from "lucide-react";

interface LoyaltyInfo {
  availablePoints: number;
  minRedeemPoints: number;
  realPerPoint: number;
}

export interface WizardStep2Props {
  totalValue: number;
  setTotalValue: (v: number) => void;
  paidValue: number;
  setPaidValue: (v: number) => void;
  paymentMethod: string;
  setPaymentMethod: (v: string) => void;
  installments: number;
  setInstallments: (v: number) => void;
  firstDueDate: string;
  setFirstDueDate: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  commissionAmount: number;
  setCommissionAmount: (v: number) => void;
  sellerId: string;
  setSellerId: (v: string) => void;
  hasInsurance: boolean;
  setHasInsurance: (v: boolean) => void;
  couponCode: string;
  setCouponCode: (v: string) => void;
  couponApplied: { code: string; amount: number } | null;
  setCouponApplied: (v: { code: string; amount: number } | null) => void;
  couponError: string | null;
  setCouponError: (v: string | null) => void;
  couponLoading: boolean;
  redeemLoyalty: boolean;
  setRedeemLoyalty: (v: boolean) => void;
  loyaltyPointsToRedeem: number;
  setLoyaltyPointsToRedeem: (v: number) => void;
  setLoyaltyAmountApplied: (v: number) => void;
  referralCode: string;
  setReferralCode: (v: string) => void;
  referralApplied: { id: string; code: string; amount: number } | null;
  setReferralApplied: (v: { id: string; code: string; amount: number } | null) => void;
  referralError: string | null;
  setReferralError: (v: string | null) => void;
  referralLoading: boolean;
  discountsOpen: boolean;
  setDiscountsOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  loyaltyInfo: LoyaltyInfo | null | undefined;
  usersForWizard: { id: string; name: string }[] | undefined;
  isSales?: boolean;
  selectedTripFull: Trip | undefined;
  selectedClientId: string;
  effectiveSeats: string[];
  uiCouponApplied: number;
  uiLoyaltyApplied: number;
  uiReferralApplied: number;
  totalDiscount: number;
  handleCouponApply: () => Promise<void>;
  handleReferralApply: () => Promise<void>;
  onBack: () => void;
  onNext: () => void;
}

export function WizardStep2(p: WizardStep2Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Valor Total (R$) *</label>
          <Input type="number" step="0.01" min="0" value={p.totalValue} onChange={e => p.setTotalValue(parseFloat(e.target.value) || 0)} />
          {p.selectedTripFull && (
            <p className="text-xs text-muted-foreground">
              Preço base: R$ {(p.selectedTripFull.priceAdult ?? 0).toFixed(2)}/pessoa × {p.effectiveSeats.length || 1} assento(s)
            </p>
          )}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Valor Pago (R$)</label>
          <Input type="number" step="0.01" min="0" value={p.paidValue} onChange={e => p.setPaidValue(parseFloat(e.target.value) || 0)} />
          <p className="text-xs text-muted-foreground">Valor já recebido no ato</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Forma de Pagamento</label>
          <Select value={p.paymentMethod} onValueChange={p.setPaymentMethod}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pix">PIX</SelectItem>
              <SelectItem value="credit_card">Cartão de Crédito</SelectItem>
              <SelectItem value="debit_card">Cartão de Débito</SelectItem>
              <SelectItem value="bank_transfer">Transferência</SelectItem>
              <SelectItem value="cash">Dinheiro</SelectItem>
              <SelectItem value="boleto">Boleto</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Parcelas</label>
          <Input type="number" min="1" max="24" value={p.installments} onChange={e => p.setInstallments(parseInt(e.target.value) || 1)} />
        </div>
      </div>
      {p.installments > 1 && (
        <div className="space-y-2">
          <label className="text-sm font-medium">1ª data de vencimento</label>
          <Input type="date" value={p.firstDueDate} onChange={e => p.setFirstDueDate(e.target.value)} />
          <p className="text-xs text-muted-foreground">Informe para gerar o cronograma de parcelas mensais automaticamente.</p>
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">Observações</label>
        <Input placeholder="Observações sobre a reserva..." value={p.notes} onChange={e => p.setNotes(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Comissão (R$)</label>
          <Input type="number" step="0.01" min="0" placeholder="0,00" value={p.commissionAmount || ""} onChange={e => p.setCommissionAmount(parseFloat(e.target.value) || 0)} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Consultor / Vendedor</label>
          <Select value={p.sellerId} onValueChange={p.setSellerId}>
            <SelectTrigger><SelectValue placeholder={p.isSales ? "Você será o responsável" : "Selecionar..."} /></SelectTrigger>
            <SelectContent>
              {!p.isSales && <SelectItem value="none">Não especificado</SelectItem>}
              {(p.usersForWizard ?? []).map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {p.isSales && <p className="text-xs text-muted-foreground">Esta reserva será atribuída automaticamente a você.</p>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input type="checkbox" id="hasInsuranceWizard" className="rounded" checked={p.hasInsurance} onChange={e => p.setHasInsurance(e.target.checked)} />
        <label htmlFor="hasInsuranceWizard" className="text-sm">Incluir seguro de viagem</label>
      </div>

      <div className="border rounded-lg bg-muted/20">
        <button type="button" className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold" onClick={() => p.setDiscountsOpen(v => !v)}>
          <span className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-primary" />
            Descontos e Benefícios
            {p.totalDiscount > 0 && <span className="text-xs font-normal text-green-600 ml-1">−R$ {p.totalDiscount.toFixed(2)}</span>}
          </span>
          <span className="text-muted-foreground text-xs">{p.discountsOpen ? "▲" : "▼"}</span>
        </button>

        {p.discountsOpen && (
          <div className="px-4 pb-4 space-y-4 border-t pt-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cupom de Desconto</label>
              <div className="flex gap-2">
                <Input placeholder="Código do cupom" value={p.couponCode} onChange={e => { p.setCouponCode(e.target.value); p.setCouponApplied(null); p.setCouponError(null); }} disabled={!!p.couponApplied} className="flex-1" />
                {p.couponApplied ? (
                  <Button variant="outline" size="sm" onClick={() => { p.setCouponApplied(null); p.setCouponCode(""); }}>Remover</Button>
                ) : (
                  <Button size="sm" onClick={p.handleCouponApply} disabled={p.couponLoading || !p.couponCode.trim() || p.totalValue <= 0}>
                    {p.couponLoading ? "..." : "Aplicar"}
                  </Button>
                )}
              </div>
              {p.couponApplied && <p className="text-xs text-green-600 font-medium">✓ Cupom aplicado: −R$ {p.uiCouponApplied.toFixed(2)}</p>}
              {p.couponError && <p className="text-xs text-destructive">{p.couponError}</p>}
            </div>

            {p.loyaltyInfo ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <input id="redeemLoyaltyCheck" type="checkbox" checked={p.redeemLoyalty} onChange={e => { p.setRedeemLoyalty(e.target.checked); if (!e.target.checked) { p.setLoyaltyPointsToRedeem(0); p.setLoyaltyAmountApplied(0); } }} />
                  <label htmlFor="redeemLoyaltyCheck" className="text-xs font-medium cursor-pointer">
                    Resgatar pontos de fidelidade
                    <span className="ml-2 text-primary font-semibold">{p.loyaltyInfo.availablePoints} pts disponíveis</span>
                  </label>
                </div>
                {p.redeemLoyalty && (
                  <>
                    <div className="flex gap-2 items-center">
                      <Input
                        type="number"
                        min={p.loyaltyInfo.minRedeemPoints}
                        max={p.loyaltyInfo.availablePoints}
                        step={p.loyaltyInfo.minRedeemPoints}
                        placeholder={`Mín. ${p.loyaltyInfo.minRedeemPoints} pts`}
                        value={p.loyaltyPointsToRedeem || ""}
                        onChange={e => {
                          const pts = parseInt(e.target.value) || 0;
                          const capped = Math.min(pts, p.loyaltyInfo!.availablePoints);
                          p.setLoyaltyPointsToRedeem(capped);
                          p.setLoyaltyAmountApplied(roundMoney(capped * p.loyaltyInfo!.realPerPoint));
                        }}
                        className="flex-1"
                      />
                      {p.loyaltyPointsToRedeem > 0 && <Button variant="outline" size="sm" onClick={() => { p.setLoyaltyPointsToRedeem(0); p.setLoyaltyAmountApplied(0); }}>Limpar</Button>}
                    </div>
                    {p.uiLoyaltyApplied > 0 && <p className="text-xs text-green-600 font-medium">✓ Desconto fidelidade: −R$ {p.uiLoyaltyApplied.toFixed(2)}</p>}
                    {p.loyaltyPointsToRedeem > 0 && p.loyaltyPointsToRedeem < p.loyaltyInfo.minRedeemPoints && (
                      <p className="text-xs text-destructive">Mínimo de {p.loyaltyInfo.minRedeemPoints} pontos para resgate</p>
                    )}
                  </>
                )}
              </div>
            ) : p.selectedClientId ? (
              <p className="text-xs text-muted-foreground italic">Este cliente não possui cadastro no programa de fidelidade.</p>
            ) : null}

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Código de Indicação</label>
              <div className="flex gap-2">
                <Input placeholder="Código de indicação" value={p.referralCode} onChange={e => { p.setReferralCode(e.target.value); p.setReferralApplied(null); p.setReferralError(null); }} disabled={!!p.referralApplied} className="flex-1" />
                {p.referralApplied ? (
                  <Button variant="outline" size="sm" onClick={() => { p.setReferralApplied(null); p.setReferralCode(""); }}>Remover</Button>
                ) : (
                  <Button size="sm" onClick={p.handleReferralApply} disabled={p.referralLoading || !p.referralCode.trim()}>
                    {p.referralLoading ? "..." : "Validar"}
                  </Button>
                )}
              </div>
              {p.referralApplied && <p className="text-xs text-green-600 font-medium">✓ Indicação aplicada: −R$ {p.uiReferralApplied.toFixed(2)}</p>}
              {p.referralError && <p className="text-xs text-destructive">{p.referralError}</p>}
            </div>

            {p.totalDiscount > 0 && (
              <div className="pt-2 border-t flex justify-between text-sm font-semibold">
                <span>Total com desconto:</span>
                <span className="text-primary">
                  R$ {(Math.max(0, roundMoney(p.totalValue - p.totalDiscount))).toFixed(2)}
                  <span className="text-muted-foreground line-through text-xs font-normal ml-1">R$ {p.totalValue.toFixed(2)}</span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-between gap-2 pt-2">
        <Button variant="outline" onClick={p.onBack}>← Anterior</Button>
        <Button onClick={p.onNext} disabled={p.totalValue < 0}>Próximo →</Button>
      </div>
    </div>
  );
}
