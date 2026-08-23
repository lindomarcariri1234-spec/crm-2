import { REFERRAL_STATUS } from "@workspace/permissions";

export interface ReferralWalletRow {
  status: string;
  bonusAmount: string | number | null;
  bonusPaid: boolean;
  bonusCreditUsedAmount: string | number | null;
  convertedAt: Date | string | null;
  expiresAt: Date | string | null;
}

export interface ReferralWallet {
  availableCredit: number;
  pendingCredit: number;
  usedCredit: number;
  expiringCredit: number;
  expiringOn: Date | null;
}

const VALID_REFERRAL_STATUSES = new Set<string>([
  REFERRAL_STATUS.COMPLETED,
  REFERRAL_STATUS.CONVERTED,
]);

function asDate(value: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Separates promotional referral credit from paid bonuses and loyalty points.
 * A credit can only be spent after its grace period, and an expired credit is
 * intentionally excluded from the spendable and pending balances.
 */
export function calculateReferralWallet(
  referrals: ReferralWalletRow[],
  gracePeriodDays: number,
  now = new Date(),
): ReferralWallet {
  let availableCredit = 0;
  let pendingCredit = 0;
  let usedCredit = 0;
  let expiringCredit = 0;
  let expiringOn: Date | null = null;
  const expiringBefore = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  for (const referral of referrals) {
    if (!VALID_REFERRAL_STATUSES.has(referral.status)) continue;

    const amount = Math.max(0, Number(referral.bonusAmount ?? 0));
    const used = Math.min(amount, Math.max(0, Number(referral.bonusCreditUsedAmount ?? 0)));
    usedCredit += used;

    const remaining = amount - used;
    if (remaining <= 0 || referral.bonusPaid) continue;

    const expiresAt = asDate(referral.expiresAt);
    if (expiresAt && expiresAt <= now) continue;

    const convertedAt = asDate(referral.convertedAt);
    const releaseAt = convertedAt
      ? new Date(convertedAt.getTime() + Math.max(0, gracePeriodDays) * 24 * 60 * 60 * 1000)
      : null;

    if (releaseAt && releaseAt > now) {
      pendingCredit += remaining;
      continue;
    }

    availableCredit += remaining;
    if (expiresAt && expiresAt <= expiringBefore) {
      expiringCredit += remaining;
      if (!expiringOn || expiresAt < expiringOn) expiringOn = expiresAt;
    }
  }

  return {
    availableCredit: money(availableCredit),
    pendingCredit: money(pendingCredit),
    usedCredit: money(usedCredit),
    expiringCredit: money(expiringCredit),
    expiringOn,
  };
}