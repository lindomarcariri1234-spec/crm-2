export type InfinitePayCheckResult = {
  amountCents: number;
  paidAmountCents: number;
  installments: number;
  captureMethod: "pix" | "credit_card";
};

export function parseInfinitePayCheckResult(payload: unknown, expectedAmountCents: number): InfinitePayCheckResult | null {
  if (!payload || typeof payload !== "object" || !Number.isSafeInteger(expectedAmountCents) || expectedAmountCents <= 0) {
    return null;
  }
  const result = payload as Record<string, unknown>;
  const amountCents = Number(result["amount"]);
  const paidAmountCents = Number(result["paid_amount"]);
  const captureMethod = result["capture_method"];
  const installmentsValue = Number(result["installments"]);
  if (
    result["success"] !== true
    || result["paid"] !== true
    || amountCents !== expectedAmountCents
    || !Number.isSafeInteger(paidAmountCents)
    || paidAmountCents < expectedAmountCents
    || (captureMethod !== "pix" && captureMethod !== "credit_card")
  ) {
    return null;
  }
  return {
    amountCents,
    paidAmountCents,
    installments: Number.isSafeInteger(installmentsValue) && installmentsValue > 0 ? installmentsValue : 1,
    captureMethod,
  };
}
