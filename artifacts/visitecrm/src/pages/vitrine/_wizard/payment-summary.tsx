import { PublicStore } from "@/lib/storeApi";
import { TRIP_TYPE_LABELS } from "@/lib/labels";
import { PAYMENT_LABELS } from "./constants";
import type { WizardState } from "./use-wizard-state";
import { Gift } from "lucide-react";

export function StepPaymentSummary({
  state,
  store,
  variant,
}: {
  state: WizardState;
  store: PublicStore;
  variant: "review" | "payment";
}) {
  const {
    product,
    qty,
    unitPrice,
    subtotal,
    referralDiscount,
    referralDiscountPct,
    referralDiscountType,
    couponDiscount,
    referralCreditBalance,
    referralCreditApplied,
    useReferralCredit,
    setUseReferralCredit,
    finalTotal,
    effectiveSeats,
    form,
  } = state;

  if (variant === "review") {
    return (
      <div className="border rounded-2xl p-5 space-y-3 lg:sticky lg:top-4">
        <h3 className="font-bold text-base">Resumo Financeiro</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Preço por pessoa</span>
            <span className="font-medium">R$ {unitPrice.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Quantidade</span>
            <span className="font-medium">× {qty}</span>
          </div>
          <div className="border-t pt-2 flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium">R$ {subtotal.toFixed(2)}</span>
          </div>
          {referralDiscount > 0 && (
            <div className="flex justify-between text-green-600">
              <span>
                {referralDiscountType === "percentage"
                  ? `Desconto de indicação (${referralDiscountPct}%)`
                  : "Desconto de indicação"}
              </span>
              <span>− R$ {referralDiscount.toFixed(2)}</span>
            </div>
          )}
          {couponDiscount > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Desconto de cupom</span>
              <span>− R$ {couponDiscount.toFixed(2)}</span>
            </div>
          )}
          {referralCreditApplied > 0 && (
            <div className="flex justify-between text-purple-600">
              <span>Cashback de indicação</span>
              <span>− R$ {referralCreditApplied.toFixed(2)}</span>
            </div>
          )}
          <div className="border-t pt-2 flex justify-between font-bold text-base">
            <span>Total</span>
            <span style={{ color: store.primaryColor }}>R$ {finalTotal.toFixed(2)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-2xl p-5 space-y-3 lg:sticky lg:top-4">
      <h3 className="font-bold text-base">Resumo Final</h3>
      <div className="space-y-2 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Viagem</p>
          <p className="font-medium leading-tight">{product?.name}</p>
          {product?.tripType && (
            <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
              {TRIP_TYPE_LABELS[product.tripType] ?? product.tripType}
            </span>
          )}
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Passageiros</span>
          <span className="font-medium">{qty}</span>
        </div>
        {effectiveSeats.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">Assentos</p>
            <div className="flex flex-wrap gap-1">
              {effectiveSeats.map((s) => (
                <span
                  key={s}
                  className="px-1.5 py-0.5 rounded text-white text-xs font-semibold"
                  style={{ backgroundColor: store.accentColor || store.primaryColor }}
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="border-t pt-2 flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span>R$ {subtotal.toFixed(2)}</span>
        </div>
        {referralDiscount > 0 && (
          <div className="flex justify-between text-green-600">
            <span>
              {referralDiscountType === "percentage"
                ? `Desconto de indicação (${referralDiscountPct}%)`
                : "Desconto de indicação"}
            </span>
            <span>− R$ {referralDiscount.toFixed(2)}</span>
          </div>
        )}
        {couponDiscount > 0 && (
          <div className="flex justify-between text-green-600">
            <span>Desconto de cupom</span>
            <span>− R$ {couponDiscount.toFixed(2)}</span>
          </div>
        )}

        {/* Referral credit toggle */}
        {referralCreditBalance > 0 && (
          <div className="border rounded-xl p-3 bg-purple-50 border-purple-200 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Gift className="w-4 h-4 text-purple-600 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-purple-800">
                    Cashback disponível: R$ {referralCreditBalance.toFixed(2)}
                  </p>
                  <p className="text-[11px] text-purple-600">Seus bônus de indicação acumulados</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setUseReferralCredit(!useReferralCredit)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                  useReferralCredit ? "bg-purple-600" : "bg-gray-200"
                }`}
                role="switch"
                aria-checked={useReferralCredit}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transform transition-transform ${
                    useReferralCredit ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            {useReferralCredit && referralCreditApplied > 0 && (
              <p className="text-xs text-purple-700 font-medium">
                − R$ {referralCreditApplied.toFixed(2)} serão descontados no total
              </p>
            )}
          </div>
        )}

        {referralCreditApplied > 0 && (
          <div className="flex justify-between text-purple-600">
            <span>Cashback de indicação</span>
            <span>− R$ {referralCreditApplied.toFixed(2)}</span>
          </div>
        )}

        {form.depositAmount && Number(form.depositAmount) > 0 && Number(form.depositAmount) < finalTotal && (
          <>
            <div className="border-t pt-2 flex justify-between text-sm">
              <span className="text-muted-foreground">Valor pago agora</span>
              <span className="font-semibold text-amber-700">R$ {Number(form.depositAmount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Restante a pagar</span>
              <span className="font-medium">R$ {(finalTotal - Number(form.depositAmount)).toFixed(2)}</span>
            </div>
          </>
        )}
        <div className="border-t pt-2 flex justify-between font-bold text-base">
          <span>Total</span>
          <span style={{ color: store.primaryColor }}>R$ {finalTotal.toFixed(2)}</span>
        </div>
        {form.paymentMethod && (
          <div className="pt-1">
            <span
              className="px-3 py-1.5 rounded-lg text-white text-xs font-semibold"
              style={{ backgroundColor: store.accentColor || store.primaryColor }}
            >
              {PAYMENT_LABELS[form.paymentMethod] ?? form.paymentMethod}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
