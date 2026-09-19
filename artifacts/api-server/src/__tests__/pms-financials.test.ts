import { describe, expect, it } from "vitest";
import { calculatePmsFinancials } from "../lib/pms-financials.js";

describe("calculatePmsFinancials", () => {
  it("keeps the received amount and opens the new balance when the total increases", () => {
    expect(calculatePmsFinancials(180, 100)).toEqual({
      totalAmount: 180,
      paidAmount: 100,
      balanceAmount: 80,
    });
  });

  it("allows reducing the total down to the amount already received", () => {
    expect(calculatePmsFinancials(100, 100)).toEqual({
      totalAmount: 100,
      paidAmount: 100,
      balanceAmount: 0,
    });
  });

  it("rejects a new total below the amount already received", () => {
    expect(calculatePmsFinancials(99.99, 100)).toBeNull();
  });

  it("compares centavos without floating-point drift", () => {
    expect(calculatePmsFinancials(100.1, 0.1)).toEqual({
      totalAmount: 100.1,
      paidAmount: 0.1,
      balanceAmount: 100,
    });
  });
});