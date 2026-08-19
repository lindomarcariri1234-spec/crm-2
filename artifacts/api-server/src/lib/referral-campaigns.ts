import { referralCampaignsTable, db } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";

type QueryRunner = Pick<typeof db, "select">;

export interface CampaignBonusResult {
  /** Base bonus after campaign multiplier (applied before tier); equals baseBonusValue when no campaign. */
  adjustedBase: number;
  /** Fixed R$ extra added on top of the tier-multiplied base; 0 when no campaign or campaign is a multiplier. */
  fixedExtra: number;
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
): Promise<CampaignBonusResult> {
  const [activeCampaign] = await qr
    .select({
      bonusType: referralCampaignsTable.bonusType,
      bonusValue: referralCampaignsTable.bonusValue,
    })
    .from(referralCampaignsTable)
    .where(and(
      eq(referralCampaignsTable.tenantId, tenantId),
      sql`${referralCampaignsTable.startsAt} <= ${asOf}`,
      sql`${referralCampaignsTable.endsAt} > ${asOf}`,
    ))
    .orderBy(desc(referralCampaignsTable.startsAt))
    .limit(1);

  if (!activeCampaign) return { adjustedBase: baseBonusValue, fixedExtra: 0 };

  const campaignVal = Number(activeCampaign.bonusValue);

  if (activeCampaign.bonusType === "multiplier") {
    return {
      adjustedBase: Math.max(baseBonusValue, baseBonusValue * campaignVal),
      fixedExtra: 0,
    };
  }

  return { adjustedBase: baseBonusValue, fixedExtra: Math.max(0, campaignVal) };
}
