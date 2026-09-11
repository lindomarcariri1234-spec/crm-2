import { PublicStore } from "@/lib/storeApi";
import { TRIP_TYPE_LABELS } from "@/lib/labels";
import { PAYMENT_LABELS } from "./constants";
import type { WizardState } from "./use-wizard-state";
import { SignInButton } from "@clerk/react";
import { Gift, Loader2, RefreshCw } from "lucide-react";

function ReferralCreditToggle({
  balance,
  applied,
  enabled,
  onToggle,
  isAuthLoaded,
  isSignedIn,
  loading,
  error,
  onRetry,
}: {
  balance: number;
  applied: number;
  enabled: boolean;
  onToggle: () => void;
  isAuthLoaded: boolean;
  isSignedIn: boolean;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (!isAuthLoaded || loading) {
    return (
      <div className="border rounded-xl p-3 bg-purple-50 border-purple-200">
        <div className="flex items-center gap-2 text-xs font-medium text-purple-800">
          <Loader2 className="w-4 h-4 animate-spin" />
          Consultando seu cashback...
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="border rounded-xl p-3 bg-purple-50 border-purple-200 space-y-2">
        <div className="flex items-start gap-2">
          <Gift className="w-4 h-4 mt-0.5 text-purple-600 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-purple-800">Use seu cashback de indicação</p>
            <p className="text-[11px] text-purple-600">Entre na sua conta de viajante para consultar e aplicar o saldo.</p>
          </div>
        </div>
        <SignInButton mode="modal">
          <button
            type="button"
            className="w-full rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-700"
          >
            Entrar para consultar cashback
          </button>
        </SignInButton>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border rounded-xl p-3 bg-purple-50 border-purple-200 space-y-2">
        <p className="text-xs font-semibold text-purple-800">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-purple-700 hover:text-purple-900"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Tentar novamente
        </button>
      </div>
    );
  }

  if (balance <= 0) {
    return (
      <div className="border rounded-xl p-3 bg-purple-50 border-purple-200">
        <div className="flex items-start gap-2">
          <Gift className="w-4 h-4 mt-0.5 text-purple-600 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-purple-800">Cashback de indicação</p>
            <p className="text-[11px] text-purple-600">Você ainda não possui saldo disponível para esta compra.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-xl p-3 bg-purple-50 border-purple-200 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gift className="w-4 h-4 text-purple-600 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-purple-800">
              Cashback disponível: R$ {balance.toFixed(2)}
            </p>
            <p className="text-[11px] text-purple-600">Seus bônus de indicação acumulados</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
            enabled ? "bg-purple-600" : "bg-gray-200"
          }`}
          role="switch"
          aria-label="Usar cashback de indicação"
          aria-checked={enabled}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transform transition-transform ${
              enabled ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>
      {enabled && applied > 0 && (
        <p className="text-xs text-purple-700 font-medium">
          − R$ {applied.toFixed(2)} serão descontados no total
        </p>
      )}
    </div>
  );
}

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
    isAuthLoaded = true,
    isSignedIn = true,
    referralCreditBalance,
    loadingReferralCreditBalance = false,
    referralCreditBalanceError = null,
    retryReferralCreditBalance = () => {},
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
          <ReferralCreditToggle
            balance={referralCreditBalance}
            applied={referralCreditApplied}
            enabled={useReferralCredit}
            onToggle={() => setUseReferralCredit(!useReferralCredit)}
            isAuthLoaded={Boolean(isAuthLoaded)}
            isSignedIn={Boolean(isSignedIn)}
            loading={loadingReferralCreditBalance}
            error={referralCreditBalanceError}
            onRetry={() => void retryReferralCreditBalance()}
          />
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

        <ReferralCreditToggle
          balance={referralCreditBalance}
          applied={referralCreditApplied}
          enabled={useReferralCredit}
          onToggle={() => setUseReferralCredit(!useReferralCredit)}
          isAuthLoaded={Boolean(isAuthLoaded)}
          isSignedIn={Boolean(isSignedIn)}
          loading={loadingReferralCreditBalance}
          error={referralCreditBalanceError}
          onRetry={() => void retryReferralCreditBalance()}
        />

        {referralCreditApplied > 0 && (
          <div className="flex justify-between text-purple-600">
            <span>Cashback de indicação</span>
            <span>− R$ {referralCreditApplied.toFixed(2)}</span>
          </div>
        )}

        {form.depositAmount && Number(form.depositAmount) > 0 && Number(form.depositAmount) < finalTotal && (
          <>
            <div className="border-t pt-2 flex justify-between text-sm">
              <span className="text-muted-foreground">Entrada solicitada</span>
              <span className="font-semibold text-amber-700">R$ {Number(form.depositAmount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Saldo após a entrada</span>
              <span className="font-medium">R$ {(finalTotal - Number(form.depositAmount)).toFixed(2)}</span>
            </div>
            <p className="text-[11px] text-amber-700">
              A entrada solicitada não representa um pagamento confirmado. O valor pago será atualizado
              somente após a confirmação do recebível pela agência ou pelo provedor.
            </p>
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
