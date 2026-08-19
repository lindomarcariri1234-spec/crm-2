import { describe, it, expect } from "vitest";
import { applyDiscounts, computeBalance, computeEffectiveLoyaltyPoints } from "../lib/pricing.js";

describe("applyDiscounts — multi-step discount pipeline", () => {
  it("returns full base value and zero discount when no discounts are applied", () => {
    const result = applyDiscounts(1000, 0, 0, 0);
    expect(result.appliedCoupon).toBe(0);
    expect(result.appliedLoyalty).toBe(0);
    expect(result.appliedReferral).toBe(0);
    expect(result.discountTotal).toBe(0);
    expect(result.finalTotal).toBe(1000);
  });

  it("applies coupon discount alone and leaves loyalty/referral untouched", () => {
    const result = applyDiscounts(500, 75, 0, 0);
    expect(result.appliedCoupon).toBe(75);
    expect(result.appliedLoyalty).toBe(0);
    expect(result.appliedReferral).toBe(0);
    expect(result.finalTotal).toBe(425);
  });

  it("applies loyalty discount alone and leaves coupon/referral untouched", () => {
    const result = applyDiscounts(500, 0, 40, 0);
    expect(result.appliedCoupon).toBe(0);
    expect(result.appliedLoyalty).toBe(40);
    expect(result.appliedReferral).toBe(0);
    expect(result.finalTotal).toBe(460);
  });

  it("applies referral discount alone and leaves coupon/loyalty untouched", () => {
    const result = applyDiscounts(500, 0, 0, 30);
    expect(result.appliedCoupon).toBe(0);
    expect(result.appliedLoyalty).toBe(0);
    expect(result.appliedReferral).toBe(30);
    expect(result.finalTotal).toBe(470);
  });

  it("applies all three discounts in sequence: coupon first, then loyalty, then referral", () => {
    const result = applyDiscounts(1000, 100, 50, 25);
    expect(result.appliedCoupon).toBe(100);
    expect(result.appliedLoyalty).toBe(50);
    expect(result.appliedReferral).toBe(25);
    expect(result.discountTotal).toBe(175);
    expect(result.finalTotal).toBe(825);
  });

  it("caps final total at zero when combined discounts exceed base value", () => {
    const result = applyDiscounts(100, 200, 0, 0);
    expect(result.appliedCoupon).toBe(100);
    expect(result.finalTotal).toBe(0);
    expect(result.discountTotal).toBeLessThanOrEqual(100);
  });

  it("caps each subsequent discount on remaining balance so total never goes negative", () => {
    const result = applyDiscounts(100, 60, 60, 60);
    expect(result.appliedCoupon).toBe(60);
    expect(result.appliedLoyalty).toBe(40);
    expect(result.appliedReferral).toBe(0);
    expect(result.finalTotal).toBe(0);
    expect(result.discountTotal).toBeLessThanOrEqual(100);
  });

  it("loyalty and referral are applied on post-coupon balance, not on original base value", () => {
    const result = applyDiscounts(200, 150, 100, 50);
    expect(result.appliedCoupon).toBe(150);
    expect(result.appliedLoyalty).toBe(50);
    expect(result.appliedReferral).toBe(0);
    expect(result.finalTotal).toBe(0);
  });

  it("handles fractional currency values and rounds to 2 decimal places", () => {
    const result = applyDiscounts(99.99, 10.005, 0, 0);
    expect(result.appliedCoupon).toBe(10.01);
    expect(result.finalTotal).toBe(89.98);
  });
});

describe("computeBalance — balance after partial payment", () => {
  it("balance equals total value when no payment has been made", () => {
    expect(computeBalance(1500, 0)).toBe(1500);
  });

  it("balance is zero when total value is fully paid", () => {
    expect(computeBalance(1500, 1500)).toBe(0);
  });

  it("balance is zero when overpaid (never returns a negative balance)", () => {
    expect(computeBalance(1500, 2000)).toBe(0);
  });

  it("balance reflects the outstanding amount after a partial payment", () => {
    expect(computeBalance(1500, 600)).toBe(900);
  });

  it("rounds the balance to 2 decimal places", () => {
    expect(computeBalance(100.005, 0)).toBe(100.01);
  });
});

describe("computeEffectiveLoyaltyPoints — points actually consumed", () => {
  it("returns 0 when realPerPoint is zero (avoids divide-by-zero)", () => {
    expect(computeEffectiveLoyaltyPoints(500, 50, 0)).toBe(0);
  });

  it("returns 0 when realPerPoint is negative", () => {
    expect(computeEffectiveLoyaltyPoints(500, 50, -1)).toBe(0);
  });

  it("returns exact point count when points map exactly to applied amount", () => {
    // 100 points * 0.5 per point = 50.00 applied — exact match
    expect(computeEffectiveLoyaltyPoints(100, 50, 0.5)).toBe(100);
  });

  it("caps points when applied discount is less than what all points are worth", () => {
    // customer tried to redeem 200 points worth 100.00, but only 60.00 was applied
    // ceil(60 / 0.5) = 120 points should be consumed, not 200
    expect(computeEffectiveLoyaltyPoints(200, 60, 0.5)).toBe(120);
  });

  it("uses ceil so customers are never charged fewer points than the discount they received", () => {
    // 75.10 applied / 0.5 per point = 150.2 → ceil = 151 points consumed
    expect(computeEffectiveLoyaltyPoints(300, 75.10, 0.5)).toBe(151);
  });

  it("returns full points when applied amount covers all of them (no cap needed)", () => {
    // 50 points * 1.00 per point = 50.00, applied is 50.00 → no cap
    expect(computeEffectiveLoyaltyPoints(50, 50, 1)).toBe(50);
  });

  it("returns 0 when no discount was actually applied", () => {
    // loyalty was requested but the full base was already discounted by coupon
    expect(computeEffectiveLoyaltyPoints(200, 0, 0.5)).toBe(0);
  });

  it("handles very small per-point values without overflow", () => {
    // 1000 points at 0.01 each = 10.00; 8.00 applied → ceil(8/0.01) = 800
    expect(computeEffectiveLoyaltyPoints(1000, 8, 0.01)).toBe(800);
  });
});
