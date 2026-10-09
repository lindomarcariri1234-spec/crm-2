import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { isStripeTestPayment, StripeTestPaymentNotice } from "./StripeTestPaymentNotice";

describe("StripeTestPaymentNotice", () => {
  it("explains that a Stripe test-mode order did not charge real money", () => {
    const markup = renderToStaticMarkup(
      createElement(StripeTestPaymentNotice, {
        paymentProvider: "stripe",
        stripeLivemode: false,
      }),
    );

    expect(markup).toContain('data-testid="stripe-test-payment-warning"');
    expect(markup).toContain("Pagamento Stripe em modo de teste");
    expect(markup).toContain("Nenhuma cobrança real foi realizada neste pedido.");
  });

  it.each([
    ["live Stripe order", "stripe", true],
    ["unknown Stripe mode", "stripe", null],
    ["non-Stripe order", "manual", false],
    ["unknown provider", null, false],
  ] as const)("does not label a %s as test mode", (_description, paymentProvider, stripeLivemode) => {
    const markup = renderToStaticMarkup(
      createElement(StripeTestPaymentNotice, {
        paymentProvider,
        stripeLivemode,
      }),
    );

    expect(markup).toBe("");
    expect(isStripeTestPayment({ paymentProvider, stripeLivemode })).toBe(false);
  });
});
