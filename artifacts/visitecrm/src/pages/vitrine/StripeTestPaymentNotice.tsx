import { AlertTriangle } from "lucide-react";

type StripeTestPaymentNoticeProps = {
  paymentProvider?: string | null;
  stripeLivemode?: boolean | null;
  className?: string;
};

type StripePaymentMode = Pick<StripeTestPaymentNoticeProps, "paymentProvider" | "stripeLivemode">;

export function isStripeTestPayment(order: StripePaymentMode | null | undefined): boolean {
  return order?.paymentProvider === "stripe" && order.stripeLivemode === false;
}

export function StripeTestPaymentNotice({
  paymentProvider,
  stripeLivemode,
  className,
}: StripeTestPaymentNoticeProps) {
  if (!isStripeTestPayment({ paymentProvider, stripeLivemode })) return null;

  return (
    <div
      role="status"
      data-testid="stripe-test-payment-warning"
      className={`flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 ${className ?? ""}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
      <div>
        <p className="font-semibold">Pagamento Stripe em modo de teste</p>
        <p>Nenhuma cobrança real foi realizada neste pedido.</p>
      </div>
    </div>
  );
}
