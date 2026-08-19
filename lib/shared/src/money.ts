/**
 * Single authoritative monetary rounding function shared by the API server and
 * the web frontend. All monetary computations must go through this function to
 * avoid inconsistencies between parseFloat/toFixed approaches and to keep the
 * server and client price rules in lockstep.
 */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Applies coupon, loyalty and referral discounts sequentially against a base
 * value. Discounts are capped so the running balance never goes negative, and
 * the order (coupon → loyalty → referral) is the authoritative server rule.
 *
 * The web reservation wizard consumes this same function purely for display so
 * the preview always matches what the server will compute on submission.
 */
export function applyDiscounts(
  baseValue: number,
  couponAmount: number,
  loyaltyAmount: number,
  referralAmount: number,
): {
  appliedCoupon: number;
  appliedLoyalty: number;
  appliedReferral: number;
  discountTotal: number;
  finalTotal: number;
} {
  let remaining = baseValue;

  const appliedCoupon = roundMoney(Math.min(couponAmount, remaining));
  remaining = roundMoney(remaining - appliedCoupon);

  const appliedLoyalty = roundMoney(Math.min(loyaltyAmount, remaining));
  remaining = roundMoney(remaining - appliedLoyalty);

  const appliedReferral = roundMoney(Math.min(referralAmount, remaining));

  const discountTotal = roundMoney(appliedCoupon + appliedLoyalty + appliedReferral);
  const finalTotal = Math.max(0, roundMoney(baseValue - discountTotal));

  return { appliedCoupon, appliedLoyalty, appliedReferral, discountTotal, finalTotal };
}

/**
 * Canonical BRL currency formatter for on-screen and HTML/email contexts.
 * Uses the locale `style: "currency"` formatting, e.g. `R$ 1.234,50` (the
 * separator between symbol and amount is a non-breaking space, which is correct
 * for HTML/UI). Do NOT use this for plain-text outputs like CSV exports or PDFs
 * where a non-breaking space can break parsing or font rendering — use
 * `formatBRLPlain` there instead.
 */
export function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Plain-text BRL formatter for CSV exports, PDFs and calendar event text.
 * Produces `R$ ` (a regular space) followed by a grouped, 2-decimal amount,
 * e.g. `R$ 1.234,50`. Avoids the non-breaking space emitted by the locale
 * currency style so downstream parsers (Excel) and PDF fonts stay happy.
 */
export function formatBRLPlain(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
