import { referralCampaignsTable, referralsTable, db } from "@workspace/db";
import { and, count, desc, eq, sql } from "drizzle-orm";

type QueryRunner = Pick<typeof db, "select">;

export interface CampaignBonusResult {
  /** Base bonus after campaign multiplier (applied before tier); equals baseBonusValue when no campaign. */
  adjustedBase: number;
  /** Fixed R$ extra added on top of the tier-multiplied base; 0 when no campaign or campaign is a multiplier. */
  fixedExtra: number;
  /** Explicit policy decision; callers can distinguish an ineligible/no-reward campaign. */
  rewardOutcome: "base" | "multiplier" | "fixed_extra" | "fixed_bonus" | "percentage_bonus" | "reduced_bonus" | "no_reward";
  campaignId?: string;
  commissionType?: "none" | "fixed" | "bonus_percentage";
  commissionValue?: number;
  commissionRecipientType?: "ambassador" | "partner";
  eligiblePartnerIds?: string[];
}

export interface CampaignPolicyContext {
  productIds?: string[];
  referrerTierLevel?: string | null;
  /** Derived from valid conversions before the current checkout. */
  activitySegment?: "active" | "occasional" | "inactive";
  /** Normalized source or source:medium attribution captured in the referral cookie. */
  attributionChannel?: string | null;
}

export function normalizeReferralChannel(source?: string | null, medium?: string | null): string {
  const normalize = (value?: string | null) => value?.trim().toLowerCase().replace(/\s+/g, "_") ?? "";
  const normalizedSource = normalize(source);
  const normalizedMedium = normalize(medium);
  if (!normalizedSource) return "direct";
  return normalizedMedium ? `${normalizedSource}:${normalizedMedium}` : normalizedSource;
}

export function referralActivitySegment(successfulReferrals: number): "active" | "occasional" | "inactive" {
  if (successfulReferrals >= 3) return "active";
  if (successfulReferrals >= 1) return "occasional";
  return "inactive";
}

/**
 * Looks up any active campaign for the tenant and returns bonus components:
 *   - multiplier campaign: adjustedBase = baseBonusValue * campaignMult, fixedExtra = 0
 *   - fixed_extra campaign: adjustedBase = baseBonusValue, fixedExtra = campaignVal
 *
 * Callers should compute final bonus as:
 *   adjustedBase * tier.bonusMultiplier + fixedExtra
 *
 * This ensures fixed_extra is a flat add-on independent of the tier multiplier.
 * Uses half-open interval [startsAt, endsAt) consistent with DB exclusion constraint.
 */
export async function applyActiveCampaignBonus(
  qr: QueryRunner,
  tenantId: string,
  baseBonusValue: number,
  asOf: Date = new Date(),
  context: CampaignPolicyContext = {},
): Promise<CampaignBonusResult> {
  const [activeCampaign] = await qr
    .select({
      bonusType: referralCampaignsTable.bonusType,
      bonusValue: referralCampaignsTable.bonusValue,
      id: referralCampaignsTable.id,
      eligibleStoreProductIds: referralCampaignsTable.eligibleStoreProductIds,
      eligibleTierLevels: referralCampaignsTable.eligibleTierLevels,
      eligibleActivitySegments: referralCampaignsTable.eligibleActivitySegments,
      eligibleChannels: referralCampaignsTable.eligibleChannels,
      conversionCap: referralCampaignsTable.conversionCap,
      budgetAmount: referralCampaignsTable.budgetAmount,
      commissionType: referralCampaignsTable.commissionType,
      commissionValue: referralCampaignsTable.commissionValue,
      commissionRecipientType: referralCampaignsTable.commissionRecipientType,
      eligiblePartnerIds: referralCampaignsTable.eligiblePartnerIds,
      startsAt: referralCampaignsTable.startsAt,
      endsAt: referralCampaignsTable.endsAt,
    })
    .from(referralCampaignsTable)
    .where(and(
      eq(referralCampaignsTable.tenantId, tenantId),
      sql`${referralCampaignsTable.startsAt} <= ${asOf}`,
      sql`${referralCampaignsTable.endsAt} > ${asOf}`,
    ))
    .orderBy(desc(referralCampaignsTable.startsAt))
    .limit(1);

  if (!activeCampaign) return { adjustedBase: baseBonusValue, fixedExtra: 0, rewardOutcome: "base" };

  const eligibleProducts = activeCampaign.eligibleStoreProductIds ?? [];
  const eligibleTiers = activeCampaign.eligibleTierLevels ?? [];
  const eligibleActivitySegments = activeCampaign.eligibleActivitySegments ?? [];
  const eligibleChannels = activeCampaign.eligibleChannels ?? [];
  const productEligible = eligibleProducts.length === 0
    // Older checkout paths do not yet expose line-item IDs; retain their
    // historic campaign behavior until they opt into policy context.
    || context.productIds === undefined
    || context.productIds.some((id) => eligibleProducts.includes(id));
  const tierEligible = eligibleTiers.length === 0
    || (!!context.referrerTierLevel && eligibleTiers.includes(context.referrerTierLevel));
  const activityEligible = eligibleActivitySegments.length === 0
    || (!!context.activitySegment && eligibleActivitySegments.includes(context.activitySegment));
  const normalizedChannel = context.attributionChannel?.trim().toLowerCase() ?? "direct";
  const channelEligible = eligibleChannels.length === 0
    || eligibleChannels.map((channel) => channel.trim().toLowerCase()).some((channel) =>
      channel === normalizedChannel || normalizedChannel.startsWith(`${channel}:`),
    );
  if (!productEligible || !tierEligible || !activityEligible || !channelEligible) {
    return { adjustedBase: baseBonusValue, fixedExtra: 0, rewardOutcome: "base", campaignId: activeCampaign.id };
  }

  // Campaigns do not overlap. Aggregate historical conversions in its window so
  // old referral rows remain compatible without a campaign_id column.
  if (activeCampaign.conversionCap || activeCampaign.budgetAmount) {
    const [usage] = await qr.select({
      conversions: count(),
      bonusCost: sql<string>`COALESCE(SUM(${referralsTable.bonusAmount}), 0)`,
    }).from(referralsTable).where(and(
      eq(referralsTable.tenantId, tenantId),
      eq(referralsTable.status, "completed"),
      sql`${referralsTable.convertedAt} >= ${activeCampaign.startsAt}`,
      sql`${referralsTable.convertedAt} < ${activeCampaign.endsAt}`,
    ));
    if ((activeCampaign.conversionCap && Number(usage?.conversions ?? 0) >= activeCampaign.conversionCap)
      || (activeCampaign.budgetAmount && Number(usage?.bonusCost ?? 0) >= Number(activeCampaign.budgetAmount))) {
      return { adjustedBase: 0, fixedExtra: 0, rewardOutcome: "no_reward", campaignId: activeCampaign.id };
    }
  }

  const campaignVal = Number(activeCampaign.bonusValue);
  const commission = {
    commissionType: activeCampaign.commissionType as CampaignBonusResult["commissionType"],
    commissionValue: Number(activeCampaign.commissionValue),
    commissionRecipientType: activeCampaign.commissionRecipientType as "ambassador" | "partner",
    eligiblePartnerIds: activeCampaign.eligiblePartnerIds ?? [],
  };

  if (activeCampaign.bonusType === "multiplier") {
    return {
      adjustedBase: Math.max(baseBonusValue, baseBonusValue * campaignVal),
      fixedExtra: 0,
      rewardOutcome: "multiplier",
      campaignId: activeCampaign.id, ...commission,
    };
  }

  if (activeCampaign.bonusType === "no_reward") {
    return { adjustedBase: 0, fixedExtra: 0, rewardOutcome: "no_reward", campaignId: activeCampaign.id, ...commission };
  }
  if (activeCampaign.bonusType === "fixed_bonus") {
    return { adjustedBase: 0, fixedExtra: Math.max(0, campaignVal), rewardOutcome: "fixed_bonus", campaignId: activeCampaign.id, ...commission };
  }
  if (activeCampaign.bonusType === "percentage_bonus") {
    return {
      adjustedBase: Math.max(0, baseBonusValue * campaignVal / 100),
      fixedExtra: 0,
      rewardOutcome: "percentage_bonus",
      campaignId: activeCampaign.id, ...commission,
    };
  }
  if (activeCampaign.bonusType === "reduced_bonus") {
    return {
      adjustedBase: Math.max(0, baseBonusValue * campaignVal),
      fixedExtra: 0,
      rewardOutcome: "reduced_bonus",
      campaignId: activeCampaign.id, ...commission,
    };
  }
  return { adjustedBase: baseBonusValue, fixedExtra: Math.max(0, campaignVal), rewardOutcome: "fixed_extra", campaignId: activeCampaign.id, ...commission };
}
