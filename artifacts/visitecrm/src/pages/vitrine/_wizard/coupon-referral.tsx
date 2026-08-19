import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tag, CheckCircle, X, Loader2 } from "lucide-react";
import type { WizardState } from "./use-wizard-state";

export function StepCouponReferral({
  state,
  couponsEnabled = true,
  referralsEnabled = true,
}: {
  state: WizardState;
  couponsEnabled?: boolean;
  referralsEnabled?: boolean;
}) {
  const {
    form,
    set,
    couponResult,
    validatingCoupon,
    validateCoupon,
    removeCoupon,
    couponDiscount,
    referralCode,
    setReferralCode,
    referralApplied,
    referralDiscount,
    applyReferral,
    removeReferral,
  } = state;

  if (!couponsEnabled && !referralsEnabled) return null;

  return (
    <div className="border rounded-xl p-4 space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-1.5">
        <Tag className="w-3.5 h-3.5" /> Códigos de Desconto
      </h3>

      {referralsEnabled && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Código de Indicação</Label>
          {referralApplied ? (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
              <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
              <span className="flex-1 text-green-700">
                Código <strong>{referralCode}</strong> aplicado! Desconto:{" "}
                <strong>R$ {referralDiscount.toFixed(2)}</strong>
              </span>
              <button onClick={removeReferral} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                placeholder="Ex: MARIA2024"
                className="font-mono"
              />
              <Button variant="outline" onClick={applyReferral} disabled={!referralCode.trim()}>
                Aplicar
              </Button>
            </div>
          )}
        </div>
      )}

      {couponsEnabled && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Cupom de Desconto</Label>
          {couponResult?.valid ? (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-sm">
              <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
              <span className="flex-1 text-green-700">
                Cupom <strong>{couponResult.code}</strong> aplicado! Desconto:{" "}
                <strong>R$ {couponDiscount.toFixed(2)}</strong>
              </span>
              <button onClick={removeCoupon} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                value={form.couponCode}
                onChange={(e) => set("couponCode", e.target.value.toUpperCase())}
                placeholder="CODIGO"
                className="font-mono"
              />
              <Button
                variant="outline"
                onClick={validateCoupon}
                disabled={!form.couponCode || validatingCoupon}
              >
                {validatingCoupon ? <Loader2 className="w-4 h-4 animate-spin" /> : "Aplicar"}
              </Button>
            </div>
          )}
          {couponResult && !couponResult.valid && (
            <p className="text-xs text-red-600">{couponResult.error ?? "Cupom inválido"}</p>
          )}
        </div>
      )}
    </div>
  );
}
