/**
 * Monetary rounding and sequential discount application now live in the shared
 * workspace package so the API server and the web frontend stay in lockstep.
 * Re-exported here to keep existing import paths (and test mocks) stable.
 */
import { roundMoney, applyDiscounts } from "@workspace/shared";

export { roundMoney, applyDiscounts };

/**
 * Returns the number of loyalty points actually consumed given the discount
 * that was applied. Points are capped so customers never lose more points
 * than the discount they received.
 *
 * @param loyaltyPoints    - Points the customer requested to redeem
 * @param appliedLoyaltyAmount - Actual monetary discount applied (may be < requested)
 * @param realPerPoint     - Monetary value of one loyalty point (>0)
 */
export function computeEffectiveLoyaltyPoints(
  loyaltyPoints: number,
  appliedLoyaltyAmount: number,
  realPerPoint: number,
): number {
  if (realPerPoint <= 0) return 0;
  return Math.min(loyaltyPoints, Math.ceil(appliedLoyaltyAmount / realPerPoint));
}

export function computeBalance(totalValue: number, paidValue: number): number {
  return Math.max(0, roundMoney(totalValue - paidValue));
}

export function normalizeOrderEmail(raw: unknown): string {
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim().toLowerCase();
  }
  return "";
}
