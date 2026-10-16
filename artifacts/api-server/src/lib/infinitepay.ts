export type InfinitePayCheckResult = {
  amountCents: number;
  paidAmountCents: number;
  installments: number;
  captureMethod: "pix" | "credit_card";
};

export function formatInfinitePayPhoneNumber(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return `+${digits}`;
  return undefined;
}

/**
 * InfinitePay documents successful link creation and payment checks, but does
 * not publish a /links error-body schema. Classify only the HTTP status; never
 * infer that arbitrary response strings are safe machine-readable codes.
 */
export function classifyInfinitePayHttpFailure(status: number):
  "validation" | "authorization" | "rate_limit" | "provider_error" {
  if (status === 400 || status === 422) return "validation";
  if (status === 401 || status === 403) return "authorization";
  if (status === 429) return "rate_limit";
  return "provider_error";
}

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
