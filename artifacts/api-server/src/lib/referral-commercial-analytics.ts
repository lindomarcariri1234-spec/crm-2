import { REFERRAL_STATUS } from "@workspace/permissions";

export interface CommercialReferralRow {
  tenantId: string;
  referrerId: string;
  referrerName: string | null;
  status: string;
  convertedAt: Date | string | null;
  bonusAmount: string | number | null;
  bonusPaid: boolean;
  bonusPaidAt: Date | string | null;
  bonusCreditUsedAmount: string | number | null;
  discountAmount: string | number | null;
  reservationStatus: string | null;
  reservationPaidValue: string | number | null;
  commissionAmount?: string | number | null;
  commissionStatus?: string | null;
}

export interface ReferralCommercialSummary {
  validReferrals: number;
  attributedRevenue: number;
  rewardsPaid: number;
  rewardsPending: number;
  discountGiven: number;
  /** Contractual commissions; intentionally excluded from promotional CAC. */
  commissions: number;
  acquisitionCost: number;
  cac: number;
  roiPercent: number;
  roiMultiple: number;
}

export interface ReferralCommercialRankingEntry {
  referrerId: string;
  referrerName: string;
  conversions: number;
  attributedRevenue: number;
  rewardsPaid: number;
  commissionAmount: number;
}

const VALID_REFERRAL_STATUSES = new Set<string>([
  REFERRAL_STATUS.COMPLETED,
  REFERRAL_STATUS.CONVERTED,
]);
const VALID_COMMISSION_STATUSES = new Set(["pending", "approved", "paid"]);

function dateAt(value: Date | string | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Computes commercial referral results only from valid conversions in one
 * tenant and period. Cancelled reservations and reverted referrals are not
 * eligible, so they cannot inflate revenue, CAC, or ROI.
 */
export function calculateReferralCommercialAnalytics(
  rows: CommercialReferralRow[],
  tenantId: string,
  since: Date,
  until?: Date,
): {
  summary: ReferralCommercialSummary;
  ranking: ReferralCommercialRankingEntry[];
} {
  const summary = {
    validReferrals: 0,
    attributedRevenue: 0,
    rewardsPaid: 0,
    rewardsPending: 0,
    discountGiven: 0,
    commissions: 0,
  };
  const ranking = new Map<string, ReferralCommercialRankingEntry>();

  for (const row of rows) {
    const convertedAt = dateAt(row.convertedAt);
    const isValid =
      row.tenantId === tenantId &&
      VALID_REFERRAL_STATUSES.has(row.status) &&
      convertedAt !== null &&
      convertedAt >= since &&
      (until === undefined || convertedAt <= until) &&
      row.reservationStatus !== "cancelled";
    if (!isValid) continue;

    const bonusAmount = Math.max(0, Number(row.bonusAmount ?? 0));
    const creditUsed = Math.min(bonusAmount, Math.max(0, Number(row.bonusCreditUsedAmount ?? 0)));
    const revenue = Math.max(0, Number(row.reservationPaidValue ?? 0));
    const discount = Math.max(0, Number(row.discountAmount ?? 0));
    // A ledger commission remains a commission, rather than a promotional
    // reward. Only an unreversed ledger entry attached to this valid
    // conversion is reportable.
    const commission = row.commissionStatus && VALID_COMMISSION_STATUSES.has(row.commissionStatus)
      ? Math.max(0, Number(row.commissionAmount ?? 0))
      : 0;
    const pendingReward = row.bonusPaid ? 0 : Math.max(0, bonusAmount - creditUsed);

    summary.validReferrals += 1;
    summary.attributedRevenue += revenue;
    summary.rewardsPaid += row.bonusPaid ? bonusAmount : 0;
    summary.rewardsPending += pendingReward;
    summary.discountGiven += discount;
    summary.commissions += commission;

    const entry = ranking.get(row.referrerId) ?? {
      referrerId: row.referrerId,
      referrerName: row.referrerName ?? "Indicador sem nome",
      conversions: 0,
      attributedRevenue: 0,
      rewardsPaid: 0,
      commissionAmount: 0,
    };
    entry.conversions += 1;
    entry.attributedRevenue += revenue;
    entry.rewardsPaid += row.bonusPaid ? bonusAmount : 0;
    entry.commissionAmount += commission;
    ranking.set(row.referrerId, entry);
  }

  const acquisitionCost = summary.rewardsPaid + summary.discountGiven;
  const cac = summary.validReferrals > 0 ? acquisitionCost / summary.validReferrals : 0;
  const roiMultiple = acquisitionCost > 0 ? summary.attributedRevenue / acquisitionCost : 0;
  const roiPercent = acquisitionCost > 0
    ? ((summary.attributedRevenue - acquisitionCost) / acquisitionCost) * 100
    : 0;

  return {
    summary: {
      validReferrals: summary.validReferrals,
      attributedRevenue: money(summary.attributedRevenue),
      rewardsPaid: money(summary.rewardsPaid),
      rewardsPending: money(summary.rewardsPending),
      discountGiven: money(summary.discountGiven),
      commissions: money(summary.commissions),
      acquisitionCost: money(acquisitionCost),
      cac: money(cac),
      roiPercent: money(roiPercent),
      roiMultiple: money(roiMultiple),
    },
    ranking: [...ranking.values()]
      .map((entry) => ({
        ...entry,
        attributedRevenue: money(entry.attributedRevenue),
        rewardsPaid: money(entry.rewardsPaid),
        commissionAmount: money(entry.commissionAmount),
      }))
      .sort(
        (a, b) =>
          b.attributedRevenue - a.attributedRevenue ||
          b.conversions - a.conversions ||
          a.referrerName.localeCompare(b.referrerName, "pt-BR"),
      )
      .slice(0, 10),
  };
}