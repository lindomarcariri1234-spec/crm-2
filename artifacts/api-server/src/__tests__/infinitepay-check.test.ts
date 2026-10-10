import { describe, expect, it } from "vitest";
import { parseInfinitePayCheckResult } from "../lib/infinitepay.js";

describe("parseInfinitePayCheckResult", () => {
  const paid = {
    success: true,
    paid: true,
    amount: 12500,
    paid_amount: 12750,
    installments: 3,
    capture_method: "credit_card",
  };

  it("accepts an officially confirmed payment whose order amount matches exactly", () => {
    expect(parseInfinitePayCheckResult(paid, 12500)).toEqual({
      amountCents: 12500,
      paidAmountCents: 12750,
      installments: 3,
      captureMethod: "credit_card",
    });
  });

  it.each([
    [{ ...paid, paid: false }, 12500],
    [{ ...paid, success: false }, 12500],
    [paid, 12499],
    [{ ...paid, amount: 12499 }, 12500],
    [{ ...paid, capture_method: "boleto" }, 12500],
    [{ ...paid, paid_amount: 12499 }, 12500],
  ])("rejects an unverified, mismatched, or unsupported payment", (payload, expectedAmount) => {
    expect(parseInfinitePayCheckResult(payload, expectedAmount)).toBeNull();
  });

  it("does not permit non-positive expected amounts", () => {
    expect(parseInfinitePayCheckResult(paid, 0)).toBeNull();
  });
});
