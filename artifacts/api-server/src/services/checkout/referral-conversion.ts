import {
  clientsTable,
  referralsTable,
  referralSettingsTable,
  referralTrackingTable,
  storeOrdersTable,
  loyaltyMembersTable,
  loyaltyTransactionsTable,
  loyaltyProgramsTable,
  referralCommissionsTable,
  partnersTable,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { applyActiveCampaignBonus, normalizeReferralChannel, referralActivitySegment } from "../../lib/referral-campaigns";
import { generateId } from "../../lib/id";
import type { Tx } from "./tx";
import { REFERRAL_STATUS } from "@workspace/permissions";
import { roundMoney } from "../../lib/pricing";
import { computeReferralTier } from "../../lib/referral-tiers";
import { detectReferralFraud } from "../../lib/referral-fraud";
import { calculateTier } from "../../lib/loyalty-helpers";
import { ConflictError } from "../../lib/errors";

export interface RecordReferralArgs {
  tenantId: string;
  referrerId: string;
  referralCode: string;
  referredClientId: string | null;
  customerEmail: string;
  customerName: string;
  discountAmount: number;
  discountValue: number;
  discountType: string;
  referralCookieId?: string;
  conversionIp?: string | null;
  /**
   * ID of the first reservation created in the same checkout transaction.
   * Must be provided when the order includes at least one trip-linked product
   * so that referral reversal on reservation cancellation can identify this record.
   * May be null for pure-product (non-trip) store orders where no reservation exists.
   */
  reservationId?: string | null;
  /**
   * ID of an already-inserted PENDING referral row (created at checkout time by
   * persistCheckoutOrder). When provided, this function will UPDATE that row to
   * 'completed' instead of inserting a new one, preventing duplicate records.
   * When absent (e.g. for orders placed before this feature was shipped), a new
   * row is inserted as before.
   */
  existingReferralId?: string | null;
  /** Optional store products for Phase 2 campaign eligibility; omitted preserves legacy behavior. */
  storeProductIds?: string[];
  /** Active partner IDs represented by the paid order's partner products. */
  partnerIds?: string[];
}

export interface ReferralConversionResult {
  tierUpgraded: boolean;
  newTierLevel: string;
  newTierLabel: string;
  bonusMultiplier: number;
  loyaltyPointsGranted: number;
  loyaltyCurrentBalance: number;
  loyaltyPointsEmailEnabled: boolean;
}

export async function recordReferralConversion(tx: Tx, args: RecordReferralArgs): Promise<ReferralConversionResult> {
  const {
    tenantId, referrerId, referralCode, referredClientId,
    customerEmail, customerName, discountAmount, discountValue, discountType,
    referralCookieId, conversionIp, reservationId, existingReferralId, storeProductIds,
  } = args;

  const [refSettings] = await tx
    .select({
      bonusValue: referralSettingsTable.bonusValue,
      bonusType: referralSettingsTable.bonusType,
      tiersConfig: referralSettingsTable.tiersConfig,
      expirationDays: referralSettingsTable.expirationDays,
      pointsPerReferral: referralSettingsTable.pointsPerReferral,
      loyaltyPointsEmailEnabled: referralSettingsTable.loyaltyPointsEmailEnabled,
      discountExpirationDays: referralSettingsTable.discountExpirationDays,
      maxReferralsPerUser: referralSettingsTable.maxReferralsPerUser,
    })
    .from(referralSettingsTable)
    .where(eq(referralSettingsTable.tenantId, tenantId))
    .limit(1);

  const baseBonusValue = refSettings ? Number(refSettings.bonusValue) : 10;
  const maxReferralsPerUser = refSettings?.maxReferralsPerUser != null ? Number(refSettings.maxReferralsPerUser) : 0;
  const conversionAt = new Date();

  const [referrer] = await tx
    .select({
      successfulReferrals: clientsTable.successfulReferrals,
      email: clientsTable.email,
      status: clientsTable.status,
      ambassadorOptIn: clientsTable.ambassadorOptIn,
      referralCodeStatus: clientsTable.referralCodeStatus,
    })
    .from(clientsTable)
    .where(and(eq(clientsTable.id, referrerId), eq(clientsTable.tenantId, tenantId)))
    .limit(1);

  const currentCompleted = referrer?.successfulReferrals ?? 0;
  // A referral code can have many tracking records. Only a server-issued cookie
  // identifies one of them, so a conversion without that cookie is deliberately
  // attributed to the direct channel instead of borrowing another visitor's UTM.
  const trackingWhere = referralCookieId
    ? and(eq(referralTrackingTable.tenantId, tenantId), eq(referralTrackingTable.cookieId, referralCookieId))
    : null;
  const [trackingRow] = trackingWhere
    ? await tx
      .select({
        firstVisit: referralTrackingTable.firstVisit,
        utmSource: referralTrackingTable.utmSource,
        utmMedium: referralTrackingTable.utmMedium,
      })
      .from(referralTrackingTable)
      .where(trackingWhere)
      .limit(1)
    : [];
  const attributionChannel = normalizeReferralChannel(trackingRow?.utmSource, trackingRow?.utmMedium);

  // Enforce maxReferralsPerUser cap — if limit is reached (and > 0), skip conversion gracefully
  if (maxReferralsPerUser > 0 && currentCompleted >= maxReferralsPerUser) {
    return {
      tierUpgraded: false,
      newTierLevel: "bronze",
      newTierLabel: "Bronze",
      bonusMultiplier: 1,
      loyaltyPointsGranted: 0,
      loyaltyCurrentBalance: 0,
      loyaltyPointsEmailEnabled: refSettings?.loyaltyPointsEmailEnabled ?? true,
    };
  }

  const { tier } = computeReferralTier(currentCompleted, refSettings?.tiersConfig ?? null);
  // Optional context lets Phase 2 campaigns constrain products and referrer tiers;
  // absent product data retains the legacy all-products behavior for old checkout callers.
  const campaignPolicy = await applyActiveCampaignBonus(
    tx, tenantId, baseBonusValue, conversionAt,
    {
      productIds: storeProductIds,
      referrerTierLevel: tier.level,
      activitySegment: referralActivitySegment(currentCompleted),
      attributionChannel,
    },
  );
  const { adjustedBase, fixedExtra } = campaignPolicy;
  const bonusAmount = roundMoney(adjustedBase * tier.bonusMultiplier + fixedExtra);

  // When a pending row was already inserted at checkout time (existingReferralId is
  // present), UPDATE it to 'completed' to avoid a duplicate record. Otherwise, INSERT
  // a new row (backward-compatible for orders placed before this feature shipped).
  const referralId = existingReferralId ?? generateId();

  const discountExpirationDays = refSettings?.discountExpirationDays != null ? Number(refSettings.discountExpirationDays) : null;
  const expirationDays = discountExpirationDays ?? (refSettings?.expirationDays != null ? Number(refSettings.expirationDays) : 30);
  const expiresAt = new Date(conversionAt);
  expiresAt.setDate(expiresAt.getDate() + expirationDays);

  if (existingReferralId) {
    // UPDATE the pending row that was already inserted at checkout time.
    // INVARIANT: reservationId links this completed referral to the first trip reservation
    // created in the same checkout transaction. It MAY be null for product-only orders.
    const [promotedReferral] = await tx.update(referralsTable)
      .set({
        status: REFERRAL_STATUS.COMPLETED,
        referredId: referredClientId,
        referredEmail: customerEmail,
        referredName: customerName,
        discountApplied: true,
        discountValue: discountValue.toFixed(2),
        discountType,
        discountAmount: discountAmount.toFixed(2),
        bonusAmount: bonusAmount.toFixed(2),
        convertedAt: conversionAt,
        expiresAt,
        ...(conversionIp && { ipAddress: conversionIp }),
        ...(reservationId && { reservationId }),
        campaignId: campaignPolicy.campaignId ?? null,
        attributionChannel,
        updatedAt: new Date(),
      })
      .where(and(
        eq(referralsTable.id, existingReferralId),
        eq(referralsTable.tenantId, tenantId),
        eq(referralsTable.status, REFERRAL_STATUS.PENDING),
        eq(referralsTable.bonusPaid, false),
      ))
      .returning({ id: referralsTable.id });
    if (!promotedReferral) {
      throw new ConflictError(
        "A indicação já foi convertida, paga ou mudou de estado.",
        "REFERRAL_CONVERSION_CONFLICT",
      );
    }
  } else {
    // INSERT a new row (backward-compatible path for orders without a pending row).
    // INVARIANT: reservationId links this completed referral to the first trip reservation
    // created in the same checkout transaction (firstReservationId from persist-order.ts).
    // It MAY be null when the store order contains only non-trip products (i.e. no
    // reservation was created). In that case there is nothing to reverse on cancellation,
    // so null is intentional and correct.
    // On the CRM path (reservations.ts) reservationId is always non-null — that path has
    // a separate assertion to enforce this.
    // Do NOT change this to always-null or always-undefined; always pass the value
    // that persist-order.ts provides via args.firstReservationId.
    await tx.insert(referralsTable).values({
      id: referralId,
      tenantId,
      referrerId,
      code: referralCode,
      status: REFERRAL_STATUS.COMPLETED,
      source: "store",
      referredId: referredClientId,
      referredEmail: customerEmail,
      referredName: customerName,
      discountApplied: true,
      discountValue: discountValue.toFixed(2),
      discountType,
      discountAmount: discountAmount.toFixed(2),
      bonusAmount: bonusAmount.toFixed(2),
      convertedAt: conversionAt,
      expiresAt,
      ipAddress: conversionIp ?? null,
      reservationId: reservationId ?? null,
      campaignId: campaignPolicy.campaignId ?? null,
      attributionChannel,
    });
  }

  const [lastReferrerOrder] = await tx
    .select({ ipAddress: storeOrdersTable.ipAddress })
    .from(storeOrdersTable)
    .where(and(
      eq(storeOrdersTable.tenantId, tenantId),
      eq(storeOrdersTable.clientId, referrerId),
    ))
    .orderBy(desc(storeOrdersTable.createdAt))
    .limit(1);

  const fraud = detectReferralFraud({
    conversionIp: conversionIp ?? null,
    referrerIp: lastReferrerOrder?.ipAddress ?? null,
    firstVisit: trackingRow?.firstVisit ?? null,
    conversionAt,
    referredEmail: customerEmail,
    referrerEmail: referrer?.email ?? null,
  });

  if (fraud.flagged) {
    await tx.update(referralsTable)
      .set({ fraudFlag: true, fraudReason: fraud.reason, updatedAt: new Date() })
      .where(eq(referralsTable.id, referralId));
  }

  // A contractual commission is its own ledger entry. It is never credited to
  // a normal client just because that client received a promotional bonus:
  // ambassadors must opt in and keep an active referral code; partners must
  // be active, contractually enabled, and represented by this paid order.
  let recipient: { type: "ambassador" | "partner"; id: string } | null = null;
  if (campaignPolicy.commissionRecipientType === "ambassador") {
    if (
      referrer?.status === "active"
      && referrer.ambassadorOptIn === true
      && referrer.referralCodeStatus === "active"
    ) {
      recipient = { type: "ambassador", id: referrerId };
    }
  } else if (campaignPolicy.commissionRecipientType === "partner") {
    const partnerIds = [...new Set(args.partnerIds ?? [])];
    const configuredPartnerIds = campaignPolicy.eligiblePartnerIds ?? [];
    const candidateIds = configuredPartnerIds.length > 0
      ? partnerIds.filter((id) => configuredPartnerIds.includes(id))
      : partnerIds;
    if (candidateIds.length > 0) {
      const [partner] = await tx
        .select({ id: partnersTable.id })
        .from(partnersTable)
        .where(and(
          eq(partnersTable.tenantId, tenantId),
          eq(partnersTable.status, "active"),
          eq(partnersTable.referralCommissionEligible, true),
          inArray(partnersTable.id, candidateIds),
        ))
        .limit(1);
      if (partner) recipient = { type: "partner", id: partner.id };
    }
  }

  const commissionValue = Number(campaignPolicy.commissionValue ?? 0);
  const commissionAmount = campaignPolicy.commissionType === "fixed"
    ? commissionValue
    : campaignPolicy.commissionType === "bonus_percentage"
      ? roundMoney(bonusAmount * commissionValue / 100)
      : 0;
  if (!fraud.flagged && recipient && campaignPolicy.campaignId && commissionAmount > 0) {
    const calculation = campaignPolicy.commissionType === "fixed"
      ? `fixed campaign commission (${commissionValue.toFixed(2)})`
      : `${commissionValue.toFixed(4)}% of promotional bonus ${bonusAmount.toFixed(2)}`;
    await tx.insert(referralCommissionsTable).values({
      id: generateId(),
      tenantId,
      referralId,
      referrerId,
      campaignId: campaignPolicy.campaignId,
      recipientType: recipient.type,
      recipientId: recipient.id,
      amount: commissionAmount.toFixed(2),
      basis: `${calculation}; ${recipient.type} eligible at conversion`,
      status: "pending",
    }).onConflictDoNothing();
  }

  // Compute tier BEFORE increment to detect upgrade
  const tierBefore = computeReferralTier(currentCompleted, refSettings?.tiersConfig ?? null);

  await tx.update(clientsTable)
    .set({
      totalReferrals: sql`COALESCE(total_referrals, 0) + 1`,
      successfulReferrals: sql`COALESCE(successful_referrals, 0) + 1`,
      referralEarnings: sql`COALESCE(referral_earnings, 0) + ${bonusAmount.toFixed(2)}`,
    })
    .where(eq(clientsTable.id, referrerId));

  // Detect tier upgrade: if the new count crosses a tier threshold, fire email
  const newCompleted = currentCompleted + 1;
  const tierAfter = computeReferralTier(newCompleted, refSettings?.tiersConfig ?? null);
  const tierUpgraded = tierAfter.tier.level !== tierBefore.tier.level;

  if (referredClientId) {
    await tx.update(clientsTable)
      .set({ referredById: referrerId })
      .where(and(eq(clientsTable.id, referredClientId), sql`referred_by_id IS NULL`));
  }

  const conversionUpdate = {
    converted: true,
    convertedAt: conversionAt,
    updatedAt: new Date(),
    ...(conversionIp ? { ipAddress: conversionIp } : {}),
  };

  if (referralCookieId) {
    await tx.update(referralTrackingTable)
      .set(conversionUpdate)
      .where(and(
        eq(referralTrackingTable.tenantId, tenantId),
        eq(referralTrackingTable.cookieId, referralCookieId),
      ));
  }

  let loyaltyPointsGranted = 0;
  let loyaltyCurrentBalance = 0;
  const loyaltyPointsEmailEnabled = refSettings?.loyaltyPointsEmailEnabled ?? true;

  const pointsPerReferral = refSettings ? Number(refSettings.pointsPerReferral ?? 0) : 0;
  if (pointsPerReferral > 0) {
    const [loyaltyMember] = await tx
      .select({
        id: loyaltyMembersTable.id,
        programId: loyaltyMembersTable.programId,
        totalPoints: loyaltyMembersTable.totalPoints,
        availablePoints: loyaltyMembersTable.availablePoints,
      })
      .from(loyaltyMembersTable)
      .where(
        and(
          eq(loyaltyMembersTable.tenantId, tenantId),
          eq(loyaltyMembersTable.clientId, referrerId),
        ),
      )
      .limit(1);

    if (loyaltyMember) {
      const [activeProgram] = await tx
        .select({ id: loyaltyProgramsTable.id })
        .from(loyaltyProgramsTable)
        .where(
          and(
            eq(loyaltyProgramsTable.id, loyaltyMember.programId),
            eq(loyaltyProgramsTable.isActive, true),
          ),
        )
        .limit(1);

      if (activeProgram) {
        const [existingLoyaltyTx] = await tx
          .select({ id: loyaltyTransactionsTable.id })
          .from(loyaltyTransactionsTable)
          .where(
            and(
              eq(loyaltyTransactionsTable.memberId, loyaltyMember.id),
              eq(loyaltyTransactionsTable.referenceId, referralId),
              eq(loyaltyTransactionsTable.referenceType, "referral"),
            ),
          )
          .limit(1);

        if (!existingLoyaltyTx) {
          await tx.insert(loyaltyTransactionsTable).values({
            id: generateId(),
            tenantId,
            memberId: loyaltyMember.id,
            type: "referral",
            points: pointsPerReferral,
            description: "Bônus de indicação",
            referenceId: referralId,
            referenceType: "referral",
          });

          const newTotal = loyaltyMember.totalPoints + pointsPerReferral;
          const newAvailable = loyaltyMember.availablePoints + pointsPerReferral;
          const newTier = calculateTier(newTotal);

          await tx
            .update(loyaltyMembersTable)
            .set({
              totalPoints: newTotal,
              availablePoints: newAvailable,
              tier: newTier,
              lastActivityAt: new Date(),
            })
            .where(eq(loyaltyMembersTable.id, loyaltyMember.id));

          loyaltyPointsGranted = pointsPerReferral;
          loyaltyCurrentBalance = newAvailable;
        }
      }
    }
  }

  return {
    tierUpgraded,
    newTierLevel: tierAfter.tier.level,
    newTierLabel: tierAfter.tier.label,
    bonusMultiplier: tierAfter.tier.bonusMultiplier,
    loyaltyPointsGranted,
    loyaltyCurrentBalance,
    loyaltyPointsEmailEnabled,
  };
}
