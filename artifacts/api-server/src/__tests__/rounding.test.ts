import { describe, it, expect } from "vitest";
import { roundMoney, applyDiscounts, computeBalance } from "../lib/pricing.js";

describe("roundMoney", () => {
  it("returns a number (not a string)", () => {
    expect(typeof roundMoney(10.5)).toBe("number");
  });

  it("rounds to exactly 2 decimal places", () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(10.004)).toBe(10);
    expect(roundMoney(1.125)).toBe(1.13);
  });

  it("is idempotent — applying twice yields the same result", () => {
    const values = [0.1 + 0.2, 1.005, 99.999, 0.001];
    for (const v of values) {
      expect(roundMoney(roundMoney(v))).toBe(roundMoney(v));
    }
  });

  it("handles floating-point accumulation (0.1 + 0.2)", () => {
    const result = roundMoney(0.1 + 0.2);
    expect(result).toBe(0.3);
  });

  it("handles values with more than 2 decimal places", () => {
    expect(roundMoney(10.3333333)).toBe(10.33);
    expect(roundMoney(10.6666666)).toBe(10.67);
    expect(roundMoney(0.005)).toBe(0.01);
  });

  it("floors at zero — does not produce negative values from rounding", () => {
    expect(roundMoney(0.001)).toBe(0);
    expect(roundMoney(0.004)).toBe(0);
  });

  it("handles large monetary values correctly", () => {
    expect(roundMoney(9999.999)).toBe(10000);
    expect(roundMoney(1234.565)).toBe(1234.57);
  });

  it("handles zero", () => {
    expect(roundMoney(0)).toBe(0);
  });

  it("handles negative values (for reversal deltas)", () => {
    // Math.round uses "round half to +infinity" tie-breaking.
    // -10.005 in IEEE 754 is ~-1000.5000000001 after ×100, so rounds to -1001 → -10.01.
    expect(roundMoney(-10.005)).toBe(-10.01);
    expect(roundMoney(-10.006)).toBe(-10.01);
    expect(roundMoney(-10.004)).toBe(-10);
  });
});

describe("applyDiscounts — uses roundMoney internally", () => {
  it("produces rounded output even with fractional percentage discounts", () => {
    // 100 * 7.5% = 7.5 — exact, no rounding issue
    const result = applyDiscounts(100, 7.5, 0, 0);
    expect(result.appliedCoupon).toBe(7.5);
    expect(result.finalTotal).toBe(92.5);
  });

  it("handles 1/3 percentages without floating-point drift", () => {
    // 333.33 * 33.33% = 111.1 (rounded) — not a repeating decimal catastrophe
    const base = 333.33;
    const discount = roundMoney(base * (1 / 3));
    const result = applyDiscounts(base, discount, 0, 0);
    expect(result.appliedCoupon).toBe(discount);
    expect(result.finalTotal).toBe(roundMoney(base - discount));
  });

  it("all outputs are 2-decimal-place numbers", () => {
    const result = applyDiscounts(199.99, 19.999, 0, 0);
    for (const key of ["appliedCoupon", "appliedLoyalty", "appliedReferral", "discountTotal", "finalTotal"] as const) {
      const val = result[key];
      expect(roundMoney(val)).toBe(val);
    }
  });

  it("finalTotal never goes below zero even with over-discounting", () => {
    const result = applyDiscounts(50, 100, 100, 100);
    expect(result.finalTotal).toBe(0);
  });
});

describe("computeBalance — uses roundMoney internally", () => {
  it("handles floating-point subtraction without drift", () => {
    expect(computeBalance(100.1, 0.1)).toBe(100);
    expect(computeBalance(1000.0, 333.33)).toBe(666.67);
  });

  it("never returns a negative balance", () => {
    expect(computeBalance(100, 150)).toBe(0);
  });

  it("returns zero when fully paid", () => {
    expect(computeBalance(299.99, 299.99)).toBe(0);
  });
});
