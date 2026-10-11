import { describe, expect, it } from "vitest";
import {
  getPaymentMethodDescription,
  isPaymentMethodAvailable,
} from "./constants";

describe("InfinitePay card checkout availability", () => {
  it("allows credit card when InfinitePay is enabled without Stripe", () => {
    expect(isPaymentMethodAvailable("credit_card", "infinitepay", false, true)).toBe(true);
  });

  it("does not allow credit card through a disabled provider", () => {
    expect(isPaymentMethodAvailable("credit_card", "infinitepay", true, false)).toBe(false);
    expect(isPaymentMethodAvailable("credit_card", "stripe", false, true)).toBe(false);
  });

  it("keeps debit card exclusive to an enabled Stripe provider", () => {
    expect(isPaymentMethodAvailable("debit_card", "stripe", true, true)).toBe(true);
    expect(isPaymentMethodAvailable("debit_card", "infinitepay", true, true)).toBe(false);
    expect(isPaymentMethodAvailable("debit_card", "stripe", false, true)).toBe(false);
  });

  it("does not apply card-provider restrictions to non-card methods", () => {
    expect(isPaymentMethodAvailable("pix", "infinitepay", false, true)).toBe(true);
  });

  it("shows the selected provider for credit-card payments", () => {
    expect(getPaymentMethodDescription("credit_card", "infinitepay", "")).toContain("InfinitePay");
    expect(getPaymentMethodDescription("credit_card", "stripe", "")).toContain("Stripe");
    expect(getPaymentMethodDescription("pix", "infinitepay", "Pagamento instantâneo"))
      .toBe("Pagamento instantâneo");
  });
});
