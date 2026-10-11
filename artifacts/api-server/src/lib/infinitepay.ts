export type InfinitePayCheckResult = {
  amountCents: number;
  paidAmountCents: number;
  installments: number;
  captureMethod: "pix" | "credit_card";
};

const SAFE_PROVIDER_ERROR_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const PROVIDER_ERROR_CODE_KEYS = ["code", "error_code", "errorCode"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readProviderErrorCode(record: Record<string, unknown>): string | undefined {
  for (const key of PROVIDER_ERROR_CODE_KEYS) {
    const value = record[key];
    if (typeof value === "string" && SAFE_PROVIDER_ERROR_CODE.test(value)) {
      return value;
    }
  }
  return undefined;
}

/**
 * Extract only a bounded machine-readable code from the provider response.
 * Provider messages and the rest of the response may contain customer data.
 */
export function extractInfinitePayErrorCode(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;

  const topLevelCode = readProviderErrorCode(payload);
  if (topLevelCode) return topLevelCode;

  const error = payload["error"];
  if (typeof error === "string" && SAFE_PROVIDER_ERROR_CODE.test(error)) {
    return error;
  }
  return isRecord(error) ? readProviderErrorCode(error) : undefined;
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
