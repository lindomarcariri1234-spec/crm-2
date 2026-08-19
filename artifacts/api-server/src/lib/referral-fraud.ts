export interface FraudDetectionInput {
  conversionIp: string | null;
  referrerIp: string | null;
  firstVisit: Date | null;
  conversionAt: Date;
  referredEmail: string;
  referrerEmail: string | null;
}

export interface FraudDetectionResult {
  flagged: boolean;
  reason: string | null;
}

function normalizeEmail(email: string): string {
  const lower = email.toLowerCase().trim();
  const atIdx = lower.indexOf("@");
  if (atIdx < 0) return lower;
  const domain = lower.slice(atIdx + 1);
  const localRaw = lower.slice(0, atIdx);
  const localWithoutAlias = localRaw.split("+")[0];
  return `${localWithoutAlias}@${domain}`;
}

/**
 * Analyse a referral conversion for fraud signals.
 *
 * Rules (non-blocking — result is for manual review only):
 * 1. Same IP  — referrer's most-recently-known IP matches the buyer's IP,
 *    suggesting the referrer is using their own device/network to self-refer.
 * 2. Quick conversion — less than 60 s between the first tracked visit and
 *    the purchase, typical of scripted/automated abuse.
 * 3. Email alias — both emails normalise to the same address when the
 *    +alias suffix is stripped.
 */
export function detectReferralFraud(input: FraudDetectionInput): FraudDetectionResult {
  const reasons: string[] = [];

  if (
    input.conversionIp &&
    input.referrerIp &&
    input.conversionIp === input.referrerIp
  ) {
    reasons.push("Mesmo IP do indicador e indicado");
  }

  if (input.firstVisit) {
    const elapsedMs = input.conversionAt.getTime() - input.firstVisit.getTime();
    if (elapsedMs >= 0 && elapsedMs < 60_000) {
      reasons.push(`Conversão imediata (${Math.round(elapsedMs / 1000)}s após o clique)`);
    }
  }

  if (input.referrerEmail && input.referredEmail) {
    const normReferrer = normalizeEmail(input.referrerEmail);
    const normReferred = normalizeEmail(input.referredEmail);
    if (normReferrer === normReferred) {
      reasons.push("E-mail suspeito (alias do mesmo endereço)");
    }
  }

  if (reasons.length > 0) {
    return { flagged: true, reason: reasons.join("; ") };
  }
  return { flagged: false, reason: null };
}
