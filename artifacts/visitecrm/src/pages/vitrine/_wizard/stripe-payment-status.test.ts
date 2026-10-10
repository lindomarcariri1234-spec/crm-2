import { describe, expect, it } from "vitest";
import { isUnpaidStripeFailure } from "./stripe-payment-status";

describe("isUnpaidStripeFailure", () => {
  it("identifies a failed Stripe attempt with no confirmed funds", () => {
    expect(isUnpaidStripeFailure("failed", 0)).toBe(true);
    expect(isUnpaidStripeFailure("FAILED", "0.00")).toBe(true);
  });

  it("does not treat paid or partially paid orders as unpaid failures", () => {
    expect(isUnpaidStripeFailure("paid", 0)).toBe(false);
    expect(isUnpaidStripeFailure("failed", 25)).toBe(false);
  });

  it("fails closed when the payment amount is unavailable", () => {
    expect(isUnpaidStripeFailure("failed", undefined)).toBe(false);
    expect(isUnpaidStripeFailure("processing", 0)).toBe(false);
  });
});
