import { CreditCard, CheckCircle2, Info, AlertTriangle } from "lucide-react";
import { PublicStore } from "@/lib/storeApi";
import { PAYMENT_METHODS_CONFIG } from "./constants";
import { StepPaymentSummary } from "./payment-summary";
import type { WizardState } from "./use-wizard-state";

export function StepPayment({ state, store }: { state: WizardState; store: PublicStore }) {
  const { form, set, finalTotal, submitError, setSubmitError } = state;
  const minDeposit = Number(store.minDepositAmount ?? 0);
  const canRequestPartialPayment = minDeposit > 0 && finalTotal > minDeposit;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-5">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary" />
          Forma de Pagamento
        </h2>

        {store.stripeEnabled && store.infinitePayEnabled && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Escolha o provedor</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {([
                ["stripe", "Stripe", "Pagamento no checkout seguro da Stripe."],
                ["infinitepay", "InfinitePay", "Checkout hospedado com Pix e cartão; as condições são as habilitadas na sua conta."],
              ] as const).map(([provider, label, description]) => (
                <label key={provider} className={`cursor-pointer rounded-xl border-2 p-3 ${
                  form.paymentProvider === provider ? "border-orange-500 bg-orange-50" : "border-border bg-white"
                }`}>
                  <input
                    className="mr-2 accent-orange-500"
                    type="radio"
                    name="payment_provider"
                    checked={form.paymentProvider === provider}
                    onChange={() => {
                      set("paymentProvider", provider);
                      if (provider === "infinitepay" && !["pix", "credit_card"].includes(form.paymentMethod)) {
                        set("paymentMethod", "pix");
                      }
                    }}
                  />
                  <span className="font-semibold text-sm">{label}</span>
                  <p className="ml-6 text-xs text-muted-foreground">{description}</p>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="space-y-3">
          {((store.paymentMethods ?? []).length > 0 ? (store.paymentMethods ?? []) : ["pix"]).map(
            (methodId) => {
              const config = PAYMENT_METHODS_CONFIG.find((m) => m.id === methodId);
              if (!config) return null;
              const { Icon } = config;
              const isCardMethod = methodId === "credit_card" || methodId === "debit_card";
              const cardUnavailable = isCardMethod && (
                methodId === "debit_card"
                  ? form.paymentProvider !== "stripe" || !store.stripeEnabled
                  : !(
                      (form.paymentProvider === "stripe" && store.stripeEnabled)
                      || (form.paymentProvider === "infinitepay" && store.infinitePayEnabled)
                    )
              );
              const isSelected = form.paymentMethod === methodId;
              return (
                <label
                  key={methodId}
                  className={`flex items-center gap-4 p-4 rounded-xl border-2 transition-all ${
                    cardUnavailable ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                  } ${
                    isSelected
                      ? "border-orange-500 bg-orange-50"
                      : "border-border hover:border-gray-300 bg-white"
                  }`}
                >
                  <input
                    type="radio"
                    name="payment_method"
                    value={methodId}
                    checked={isSelected}
                    onChange={() => set("paymentMethod", methodId)}
                    disabled={cardUnavailable}
                    className="accent-orange-500"
                  />
                  <div className={`p-2.5 rounded-lg ${config.bg}`}>
                    <Icon className={`w-5 h-5 ${config.color}`} />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{config.label}</p>
                    <p className="text-xs text-muted-foreground">{config.description}</p>
                  </div>
                  {isSelected && <CheckCircle2 className="w-5 h-5 text-orange-500 shrink-0" />}
                </label>
              );
            },
          )}
        </div>
        {(store.paymentMethods ?? []).some(
          (method) => (method === "credit_card" || method === "debit_card")
            && !store.stripeEnabled && !store.infinitePayEnabled,
        ) && (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Pagamento com cartão temporariamente indisponível: a loja precisa configurar Stripe ou InfinitePay.</p>
          </div>
        )}

        {store.minDepositAmount && minDeposit > 0 && (
          <div className="mt-2 p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-4">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
              <div className="text-sm text-amber-900">
                <p className="font-medium">Pagamento Mínimo de Reserva</p>
                <p className="text-amber-700">
                  Valor mínimo: <strong>R$ {Number(store.minDepositAmount).toFixed(2)}</strong>
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label
                className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  !form.depositAmount || Number(form.depositAmount) === 0 || Number(form.depositAmount) >= finalTotal
                    ? "border-amber-500 bg-amber-100"
                    : "border-amber-200 bg-white hover:border-amber-300"
                }`}
              >
                <input
                  type="radio"
                  name="deposit_option"
                  checked={!form.depositAmount || Number(form.depositAmount) === 0 || Number(form.depositAmount) >= finalTotal}
                  onChange={() => set("depositAmount", "")}
                  className="accent-amber-600"
                />
                <div className="flex-1">
                  <p className="font-semibold text-sm text-amber-900">Pagar valor total</p>
                  <p className="text-xs text-amber-700">R$ {finalTotal.toFixed(2)}</p>
                </div>
              </label>

              {canRequestPartialPayment && (
                <label
                  className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                    form.depositAmount && Number(form.depositAmount) > 0 && Number(form.depositAmount) < finalTotal
                      ? "border-amber-500 bg-amber-100"
                      : "border-amber-200 bg-white hover:border-amber-300"
                  }`}
                >
                  <input
                    type="radio"
                    name="deposit_option"
                    checked={!!(form.depositAmount && Number(form.depositAmount) > 0 && Number(form.depositAmount) < finalTotal)}
                    onChange={() => set("depositAmount", minDeposit.toFixed(2))}
                    className="accent-amber-600"
                  />
                  <div className="flex-1">
                    <p className="font-semibold text-sm text-amber-900">Solicitar reserva com entrada mínima</p>
                    <p className="text-xs text-amber-700">
                      R$ {minDeposit.toFixed(2)}{" "}
                      <span className="text-amber-600">
                        (Saldo projetado após pagar a entrada: R$ {(finalTotal - minDeposit).toFixed(2)})
                      </span>
                    </p>
                  </div>
                </label>
              )}
            </div>

            {canRequestPartialPayment && form.depositAmount && Number(form.depositAmount) > 0 && Number(form.depositAmount) < finalTotal && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-amber-800">
                   Entrada solicitada (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min={minDeposit}
                  max={finalTotal}
                  value={form.depositAmount}
                  onChange={(e) => set("depositAmount", e.target.value)}
                  className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
                <p className="text-[11px] text-amber-700">
                   Mínimo R$ {minDeposit.toFixed(2)} — máximo R$ {finalTotal.toFixed(2)}
                </p>
                <p className="text-[11px] text-amber-700">
                  Este valor registra a entrada desejada. O pagamento só será contabilizado após confirmação.
                </p>
              </div>
            )}
          </div>
        )}

        {form.paymentMethod === "pix" && (
          <div className="mt-2 p-4 bg-teal-50 border border-teal-200 rounded-xl text-sm text-teal-900">
            <p className="flex items-start gap-1.5">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
               {form.paymentProvider === "infinitepay"
                 ? "Você será direcionado ao checkout seguro da InfinitePay para pagar por Pix."
                 : "O QR Code do PIX aparecerá na confirmação do pedido para você efetuar o pagamento. Depois, a agência atualizará a confirmação assim que o recebível for identificado."}
            </p>
          </div>
        )}

        {form.paymentMethod === "credit_card" && (
          <div className="mt-2 p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <p className="text-sm text-blue-900">
              {form.paymentProvider === "infinitepay"
                ? "Você será direcionado ao checkout seguro da InfinitePay para concluir o pagamento."
                : "O pagamento será processado pela Stripe. Após revisar o pedido, você informará o cartão no formulário seguro do provedor."}
            </p>
          </div>
        )}

        {form.paymentMethod === "debit_card" && (
          <div className="mt-2 p-4 bg-purple-50 border border-purple-200 rounded-xl text-sm text-purple-900">
            <p className="flex items-start gap-1.5">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              Pagamento no débito processado com segurança pela Stripe.
            </p>
          </div>
        )}

        {form.paymentMethod === "transfer" && (
          <div className="mt-2 p-4 bg-orange-50 border border-orange-200 rounded-xl">
            <p className="mb-2 text-sm font-medium text-orange-900">
              A reserva fica ativa por 30 minutos. Conclua a transferência dentro desse prazo para manter sua vaga.
            </p>
            <p className="text-sm text-orange-900 font-medium mb-2">
              Dados para transferência (TED/DOC/PIX):
            </p>
            <div className="space-y-1.5 text-sm text-orange-800">
              <div className="bg-white/60 rounded-lg p-3 border border-orange-200 space-y-1">
                <p>
                  <span className="font-medium">Banco:</span> Banco do Brasil
                </p>
                <p>
                  <span className="font-medium">Agência:</span> Entre em contato para obter
                </p>
                <p>
                  <span className="font-medium">Conta:</span> Dados enviados por e-mail após confirmação
                </p>
                <p>
                  <span className="font-medium">Favorecido:</span> {store.name}
                </p>
              </div>
              {store.contactWhatsapp && (
                <p className="mt-1">
                  Dados completos também enviados via WhatsApp:{" "}
                  <strong>{store.contactWhatsapp}</strong>
                </p>
              )}
            </div>
          </div>
        )}

        {form.paymentMethod === "boleto" && (
          <div className="mt-2 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800 space-y-1">
            <p className="font-medium">Instruções:</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>A vaga fica reservada por 30 minutos após a criação do pedido, mesmo que o boleto vença em 3 dias úteis</li>
              <li>Pode ser pago em qualquer banco, lotérica ou internet banking</li>
              <li>O pagamento precisa ser confirmado dentro dos 30 minutos para manter a reserva</li>
            </ul>
          </div>
        )}

        {form.paymentMethod === "cash" && (
          <div className="mt-2 p-4 bg-green-50 border border-green-200 rounded-xl text-sm text-green-900">
            <p className="flex items-start gap-1.5">
              <Info className="w-4 h-4 mt-0.5 shrink-0" />
              A reserva fica ativa por 30 minutos. Pague em dinheiro na agência dentro desse prazo para manter sua vaga.
            </p>
            {store.contactAddress && (
              <p className="mt-2 font-medium">📍 {store.contactAddress}</p>
            )}
          </div>
        )}

        {submitError && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <div className="flex-1">
              <p className="font-semibold mb-0.5">Reserva não concluída</p>
              <p>{submitError}</p>
            </div>
            <button
              aria-label="Fechar"
              onClick={() => setSubmitError(null)}
              className="shrink-0 text-amber-500 hover:text-amber-700"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      <div className="lg:col-span-1">
        <StepPaymentSummary state={state} store={store} variant="payment" />
      </div>
    </div>
  );
}
