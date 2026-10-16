import { describe, expect, it } from "vitest";
import {
  classifyInfinitePayHttpFailure,
  formatInfinitePayPhoneNumber,
  parseInfinitePayCheckResult,
} from "../lib/infinitepay.js";

describe("formatInfinitePayPhoneNumber", () => {
  it.each([
    ["(11) 99988-7766", "+5511999887766"],
    ["11999887766", "+5511999887766"],
    ["+55 (11) 99988-7766", "+5511999887766"],
    ["(11) 3333-2222", "+551133332222"],
    ["", undefined],
    ["123", undefined],
  ])("formats Brazilian checkout phones for InfinitePay", (phone, expected) => {
    expect(formatInfinitePayPhoneNumber(phone)).toBe(expected);
  });
});

describe("classifyInfinitePayHttpFailure", () => {
  it.each([
    [400, "validation"],
    [422, "validation"],
    [401, "authorization"],
    [403, "authorization"],
    [429, "rate_limit"],
    [500, "provider_error"],
  ] as const)("classifies HTTP %i without relying on an undocumented response body", (status, expected) => {
    expect(classifyInfinitePayHttpFailure(status)).toBe(expected);
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
