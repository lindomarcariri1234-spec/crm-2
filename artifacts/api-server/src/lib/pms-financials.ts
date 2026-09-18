export type PmsFinancials = {
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
};

/**
 * Recalculates a PMS reservation's balance without ever creating an implicit
 * credit. Monetary comparisons use integer centavos to avoid floating-point
 * drift around the paid-total boundary.
 */
export function calculatePmsFinancials(totalAmount: number, paidAmount: number): PmsFinancials | null {
  if (!Number.isFinite(totalAmount) || !Number.isFinite(paidAmount)) return null;

  const totalCents = Math.round(totalAmount * 100);
  const paidCents = Math.round(paidAmount * 100);
  if (totalCents < paidCents) return null;

  return {
    totalAmount: totalCents / 100,
    paidAmount: paidCents / 100,
    balanceAmount: (totalCents - paidCents) / 100,
  };
}