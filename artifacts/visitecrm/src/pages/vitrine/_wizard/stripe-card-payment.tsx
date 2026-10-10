import { useMemo, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StripeCardPaymentState } from "./use-wizard-state";

function StripeCardPaymentForm({ onSubmitted }: { onSubmitted: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);

  async function handlePay() {
    if (!stripe || !elements || paying) return;
    setPaying(true);
    setStripeError(null);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: "if_required",
      });
      if (error) {
        setStripeError(error.message ?? "Pagamento não concluído. Confira os dados e tente novamente.");
        return;
      }
      if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") {
        // This only changes the UI to a pending state. The order is marked paid
        // by the server after the signed Stripe webhook is processed.
        onSubmitted();
        return;
      }
      setStripeError("A Stripe ainda não confirmou este pagamento. Revise os dados e tente novamente.");
    } catch {
      setStripeError("Não foi possível enviar o pagamento. Tente novamente.");
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="space-y-4">
      <PaymentElement />
      {stripeError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {stripeError}
        </p>
      )}
      <Button
        className="w-full text-white font-bold"
        onClick={handlePay}
        disabled={paying || !stripe || !elements}
      >
        {paying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Pagar agora
      </Button>
      <p className="flex items-start justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Seus dados do cartão são processados diretamente pela Stripe e não ficam armazenados nesta loja.
      </p>
    </div>
  );
}

export function StripeCardPayment({
  payment,
  submitted,
  onSubmitted,
}: {
  payment: StripeCardPaymentState;
  submitted: boolean;
  onSubmitted: () => void;
}) {
  const stripePromise = useMemo(
    () => loadStripe(payment.publishableKey),
    [payment.publishableKey],
  );

  if (submitted) {
    return (
      <div role="status" className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Pagamento enviado à Stripe. A confirmação será atualizada aqui após o retorno seguro do provedor.</p>
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{ clientSecret: payment.clientSecret, locale: "pt-BR" }}
    >
      <StripeCardPaymentForm onSubmitted={onSubmitted} />
    </Elements>
  );
}
