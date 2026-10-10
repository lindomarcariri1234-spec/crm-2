export function isUnpaidStripeFailure(
  paymentStatus: unknown,
  paidAmount: unknown,
): boolean {
  const status = typeof paymentStatus === "string" ? paymentStatus.toLowerCase() : "";
  const amount = Number(paidAmount);
  return status === "failed" && Number.isFinite(amount) && amount <= 0;
}
