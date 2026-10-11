import { describe, expect, it } from "vitest";
import { extractInfinitePayErrorCode, parseInfinitePayCheckResult } from "../lib/infinitepay.js";

describe("extractInfinitePayErrorCode", () => {
  it.each([
    [{ code: "INVALID_HANDLE" }, "INVALID_HANDLE"],
    [{ error_code: "handle_not_active" }, "handle_not_active"],
    [{ error: { errorCode: "REQUEST_REJECTED" } }, "REQUEST_REJECTED"],
    [{ error: "invalid_request" }, "invalid_request"],
  ])("extracts only a machine-readable provider code", (payload, expected) => {
    expect(extractInfinitePayErrorCode(payload)).toBe(expected);
  });

  it.each([
    [{ message: "The checkout was rejected" }],
    [{ code: "Invalid handle" }],
    [{ code: "x".repeat(65) }],
    [null],
    ["REQUEST_REJECTED"],
  ])("does not treat free-form content as a provider code", (payload) => {
    expect(extractInfinitePayErrorCode(payload)).toBeUndefined();
  });
});

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
