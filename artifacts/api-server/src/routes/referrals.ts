import { Router, type NextFunction } from "express";
import { db, referralsTable, clientsTable, referralSettingsTable, referralTrackingTable, tenantsTable, emailLogsTable, reservationsTable, referralCampaignsTable, referralCommissionsTable, partnersTable, storeOrdersTable, dealsTable, paymentsTable } from "@workspace/db";
import { eq, and, desc, sql, count, ilike, or, inArray, getTableColumns, isNull, isNotNull } from "drizzle-orm";
import { z } from "zod/v4";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { ADMIN_ROLES, ALL_STAFF_ROLES } from '../lib/tenant';
import { ACTIONS, hasPermission, REFERRAL_STATUS, RESOURCES } from "@workspace/permissions";
import { enqueueReferralBonusPaidEmail, dispatchReferralExpiringSoonEmail, dispatchReferralBonusReleasedEmail } from "../queues/email-helpers";
import { interpolateWhatsAppMessage } from "../lib/whatsapp";
import { dispatchOutboundMessage } from "../services/outbound-delivery";
import { DEFAULT_TIERS as DEFAULT_TIERS_CONFIG, computeReferralTier } from "../lib/referral-tiers";
import type { ReferralTier } from "../lib/referral-tiers";
import { formatBRL, localToday } from "@workspace/shared";
import { calculateReferralCommercialAnalytics } from "../lib/referral-commercial-analytics";
import { rankingMetadata } from "../lib/ranking-contract";
import { calculateReceivedAmount, linkedOrder, linkedReservation } from "../lib/linked-data";
import { linkedDeal } from "../lib/linked-data";
import { reversePaidReferralBonus } from "../services/reservation-referral-conversion";

const router = Router();
const CampaignBonusType = z.enum(["multiplier", "fixed_extra", "fixed_bonus", "percentage_bonus", "reduced_bonus", "no_reward"]);
const CampaignConfig = z.object({
  eligibleStoreProductIds: z.array(z.string().min(1)).max(500).optional(),
  eligibleTierLevels: z.array(z.string().min(1).max(80)).max(50).optional(),
  conversionCap: z.number().int().positive().nullable().optional(),
  budgetAmount: z.number().nonnegative().nullable().optional(),
  shareMessage: z.string().max(2000).nullable().optional(),
  materialUrl: z.string().url().max(2000).nullable().optional(),
  publicRanking: z.boolean().optional(),
  eligibleActivitySegments: z.array(z.enum(["active", "occasional", "inactive"])).max(3).optional(),
  eligibleChannels: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  commissionType: z.enum(["none", "fixed", "bonus_percentage"]).optional(),
  commissionValue: z.number().nonnegative().optional(),
  commissionRecipientType: z.enum(["ambassador", "partner"]).optional(),
  eligiblePartnerIds: z.array(z.string().min(1)).max(500).optional(),
});

const CreateReferralBody = z.object({
  referrerId: z.string(),
  referredId: z.string().optional(),
  referredEmail: z.string().email().optional(),
  code: z.string(),
  bonusAmount: z.string().optional(),
});

router.get("/referrals/validate/:code", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const { code } = req.params;

    const [referral] = await db
      .select({
        id: referralsTable.id,
        bonusAmount: referralsTable.bonusAmount,
        referrerId: referralsTable.referrerId,
        referrerCodeStatus: clientsTable.referralCodeStatus,
      })
      .from(referralsTable)
      .leftJoin(clientsTable, eq(referralsTable.referrerId, clientsTable.id))
      .where(and(
        eq(referralsTable.tenantId, me.tenantId),
        eq(referralsTable.code, code),
        eq(referralsTable.status, REFERRAL_STATUS.PENDING),
      )).limit(1);

    if (!referral) {
      res.json({ valid: false, bonusAmount: 0, message: "Código de indicação inválido ou já utilizado" });
      return;
    }

    if (referral.referrerCodeStatus && referral.referrerCodeStatus !== "active") {
      res.json({ valid: false, bonusAmount: 0, message: "Código do indicador bloqueado ou cancelado" });
      return;
    }

    res.json({
      valid: true,
      referralId: referral.id,
      bonusAmount: referral.bonusAmount != null ? Number(referral.bonusAmount) : 0,
      message: null,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/referrals/stats", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ALL_STAFF_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const rows = await db.select({
      status: referralsTable.status,
      cnt: count(),
    }).from(referralsTable)
      .where(eq(referralsTable.tenantId, me.tenantId))
      .groupBy(referralsTable.status);

    const stats: Record<string, number> = { pending: 0, completed: 0, expired: 0 };
    for (const r of rows) {
      stats[r.status] = Number(r.cnt);
    }
    const total = Object.values(stats).reduce((a, b) => a + b, 0);

    const [earningsRow] = await db.select({
      total: sql<string>`COALESCE(SUM(bonus_amount),0)`,
    }).from(referralsTable)
      .where(and(
        eq(referralsTable.tenantId, me.tenantId),
        eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
      ));

    const [discountRow] = await db.select({
      total: sql<string>`COALESCE(SUM(discount_amount),0)`,
    }).from(referralsTable)
      .where(and(
        eq(referralsTable.tenantId, me.tenantId),
        eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
      ));

    const conversionRate = total > 0 ? Math.round((stats.completed / total) * 100) : 0;

    const [refSettings] = await db
      .select({ tiersConfig: referralSettingsTable.tiersConfig })
      .from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, me.tenantId))
      .limit(1);

    const tiersConfig = refSettings?.tiersConfig ?? DEFAULT_TIERS_CONFIG;

    const tierDistRows = await db
      .select({
        referrerId: referralsTable.referrerId,
        conversions: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.status} = ${REFERRAL_STATUS.COMPLETED})`,
      })
      .from(referralsTable)
      .where(eq(referralsTable.tenantId, me.tenantId))
      .groupBy(referralsTable.referrerId);

    const tierDistribution: Record<string, number> = {};
    let topTierLevel = tiersConfig[0]?.level ?? "bronze";
    let topTierMinReferrals = -1;
    for (const row of tierDistRows) {
      const { tier } = computeReferralTier(Number(row.conversions), tiersConfig);
      tierDistribution[tier.level] = (tierDistribution[tier.level] ?? 0) + 1;
      if (tier.minReferrals > topTierMinReferrals) {
        topTierLevel = tier.level;
        topTierMinReferrals = tier.minReferrals;
      }
    }

    const topTierConfig = tiersConfig.find((t) => t.level === topTierLevel);
    const sortedTiers = [...tiersConfig].sort((a, b) => a.minReferrals - b.minReferrals);
    const topTierIdx = sortedTiers.findIndex((t) => t.level === topTierLevel);
    const nextTierForTop = sortedTiers[topTierIdx + 1] ?? null;
    const totalReferrers = tierDistRows.length;
    const topTierCount = tierDistribution[topTierLevel] ?? 0;
    const tierProgress = totalReferrers > 0 ? Math.round((topTierCount / totalReferrers) * 100) : 0;

    res.json({
      total,
      pending: stats.pending,
      completed: stats.completed,
      expired: stats.expired,
      conversionRate,
      totalBonusPaid: Number(earningsRow?.total ?? 0),
      totalDiscountGiven: Number(discountRow?.total ?? 0),
      tiersConfig,
      tierDistribution,
      currentTier: {
        level: topTierConfig?.level ?? "bronze",
        label: topTierConfig?.label ?? "Bronze",
        bonusMultiplier: topTierConfig?.bonusMultiplier ?? 1,
        minReferrals: topTierConfig?.minReferrals ?? 0,
        nextTierLabel: nextTierForTop?.label ?? null,
        nextTierMin: nextTierForTop?.minReferrals ?? null,
      },
      tierProgress,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/referrals", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ALL_STAFF_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const page = Math.max(1, parseInt((req.query.page as string) ?? "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) ?? "20", 10)));
    const offset = (page - 1) * limit;
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;

    const validReferralStatuses = Object.values(REFERRAL_STATUS);
    if (status && !validReferralStatuses.includes(status as (typeof validReferralStatuses)[number])) {
      next(new ValidationError(String(`Invalid status. Must be one of: ${validReferralStatuses.join(", ")}`), "VALIDATION_ERROR"));
      return;
    }

    const conditions = [eq(referralsTable.tenantId, me.tenantId)];
    if (status) conditions.push(eq(referralsTable.status, status));
    if (search) {
      conditions.push(or(
        ilike(referralsTable.code, `%${search}%`),
        ilike(referralsTable.referrerName, `%${search}%`),
        ilike(referralsTable.referredEmail, `%${search}%`),
        ilike(referralsTable.referredName, `%${search}%`),
        ilike(clientsTable.name, `%${search}%`),
        ilike(clientsTable.email, `%${search}%`),
      )!);
    }

    const [totalRow] = await db.select({ total: count() }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(and(...conditions));
    const total = Number(totalRow?.total ?? 0);

    const rows = await db.select({
      ...getTableColumns(referralsTable),
      referrerClientName: clientsTable.name,
      referrerClientEmail: clientsTable.email,
      referrerClientWhatsapp: clientsTable.whatsapp,
      referrerClientPhone: clientsTable.phone,
      referrerSuccessfulReferrals: clientsTable.successfulReferrals,
    }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(and(...conditions))
      .orderBy(desc(referralsTable.createdAt))
      .limit(limit)
      .offset(offset);

    // Backfill lastVisit and visitsCount from referral_tracking for referrals
    // that predate the forward-sync logic (historical data reconciliation).
    const codes = [...new Set(rows.map((r) => r.code))];
    const trackingMap = new Map<string, { lastVisit: Date | null; visitsCount: number }>();
    if (codes.length > 0) {
      const trackingAgg = await db
        .select({
          referralCode: referralTrackingTable.referralCode,
          lastVisit: sql<string | null>`MAX(${referralTrackingTable.lastVisit})`,
          visitsCount: sql<number>`SUM(${referralTrackingTable.visitsCount})`,
        })
        .from(referralTrackingTable)
        .where(and(
          eq(referralTrackingTable.tenantId, me.tenantId),
          inArray(referralTrackingTable.referralCode, codes),
        ))
        .groupBy(referralTrackingTable.referralCode);
      for (const t of trackingAgg) {
        trackingMap.set(t.referralCode, {
          lastVisit: t.lastVisit ? new Date(t.lastVisit) : null,
          visitsCount: Number(t.visitsCount) || 0,
        });
      }
    }

    const [tenantRefSettings] = await db
      .select({ gracePeriodDays: referralSettingsTable.gracePeriodDays })
      .from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, me.tenantId))
      .limit(1);
    const gracePeriodDays = tenantRefSettings?.gracePeriodDays ?? 30;

    const reservationIds = rows.map(r => r.reservationId).filter((id): id is string => !!id);
    const canonicalReservations = reservationIds.length ? await db.select().from(reservationsTable).where(and(
      eq(reservationsTable.tenantId, me.tenantId), inArray(reservationsTable.id, reservationIds),
    )) : [];
    // A storefront referral is inserted as PENDING before payment and only gets
    // its reservationId when the payment-gated conversion runs. Resolve the
    // order by the persisted referralId as well, so a partially paid order is
    // never displayed as an orphaned referral.
    const pendingReferralIds = rows
      .filter((r) => !r.reservationId)
      .map((r) => r.id);
    const pendingOrders = pendingReferralIds.length
      ? await db.select().from(storeOrdersTable).where(and(
        eq(storeOrdersTable.tenantId, me.tenantId),
        inArray(sql<string>`${storeOrdersTable.pendingReferral}->>'referralId'`, pendingReferralIds),
      ))
      : [];
    const orderNumbers = [...new Set([
      ...canonicalReservations.map(r => r.storeOrderId).filter((id): id is string => !!id),
      ...pendingOrders.map(o => o.orderNumber),
    ])];
    const [siblingReservations, linkedOrders] = orderNumbers.length ? await Promise.all([
      db.select().from(reservationsTable).where(and(eq(reservationsTable.tenantId, me.tenantId), inArray(reservationsTable.storeOrderId, orderNumbers))),
      db.select().from(storeOrdersTable).where(and(
      eq(storeOrdersTable.tenantId, me.tenantId), inArray(storeOrdersTable.orderNumber, orderNumbers),
      )),
    ]) : [[], []] as [(typeof reservationsTable.$inferSelect)[], (typeof storeOrdersTable.$inferSelect)[]];
    const allLinkedReservations = [...canonicalReservations, ...siblingReservations.filter(r => !canonicalReservations.some(c => c.id === r.id))];
    const reservationMap = new Map(canonicalReservations.map(r => [r.id, r]));
    const orderMap = new Map([...linkedOrders, ...pendingOrders].map(o => [o.orderNumber, o]));
    const pendingOrderByReferralId = new Map(
      pendingOrders.flatMap((order) => {
        const pending = order.pendingReferral as { referralId?: string | null } | null;
        return pending?.referralId ? [[pending.referralId, order] as const] : [];
      }),
    );
    const orderIds = [...new Set([...linkedOrders, ...pendingOrders].map((order) => order.id))];
    const linkedReservationIds = allLinkedReservations.map((reservation) => reservation.id);
    const payments = orderIds.length || linkedReservationIds.length
      ? await db.select({
        orderId: paymentsTable.orderId,
        reservationId: paymentsTable.reservationId,
        amount: paymentsTable.amount,
        status: paymentsTable.status,
        type: paymentsTable.type,
      }).from(paymentsTable).where(and(
        eq(paymentsTable.tenantId, me.tenantId),
        or(
          ...(orderIds.length ? [inArray(paymentsTable.orderId, orderIds)] : []),
          ...(linkedReservationIds.length ? [inArray(paymentsTable.reservationId, linkedReservationIds)] : []),
        ),
      ))
      : [];
    const deals = allLinkedReservations.length ? await db.select().from(dealsTable).where(and(
      eq(dealsTable.tenantId, me.tenantId), inArray(dealsTable.reservationId, allLinkedReservations.map(r => r.id)),
    )) : [];
    const referrals = rows.map(({ referrerClientName, referrerClientEmail, referrerClientWhatsapp, referrerClientPhone, referrerSuccessfulReferrals, ...r }) => {
      const tracking = trackingMap.get(r.code);
      const bonusReleasesAt = r.convertedAt
        ? new Date(new Date(r.convertedAt).getTime() + gracePeriodDays * 24 * 60 * 60 * 1000)
        : null;
      const bonusBlocked =
        r.status === REFERRAL_STATUS.REVERSED ||
        (bonusReleasesAt !== null && new Date() < bonusReleasesAt);
      return {
        ...r,
        referrerName: referrerClientName ?? r.referrerName,
        referrerEmail: referrerClientEmail ?? r.referrerEmail,
        referrerPhone: referrerClientPhone ?? r.referrerPhone,
        referrerWhatsapp: referrerClientWhatsapp ?? null,
        referrerSuccessfulReferrals: referrerSuccessfulReferrals ?? 0,
        lastVisit: r.lastVisit ?? tracking?.lastVisit ?? null,
        visitsCount: Math.max(r.visitsCount ?? 0, tracking?.visitsCount ?? 0),
        bonusReleasesAt: bonusReleasesAt?.toISOString() ?? null,
        bonusBlocked,
        linkedReservation: r.reservationId ? linkedReservation(reservationMap.get(r.reservationId)) : null,
        linkedReservations: (() => {
          const canonical = r.reservationId ? reservationMap.get(r.reservationId) : null;
          const order = canonical?.storeOrderId
            ? orderMap.get(canonical.storeOrderId)
            : pendingOrderByReferralId.get(r.id);
          return order
            ? allLinkedReservations.filter((reservation) => reservation.storeOrderId === order.orderNumber).map(linkedReservation)
            : [];
        })(),
        linkedOrder: (() => {
          const canonical = r.reservationId ? reservationMap.get(r.reservationId) : null;
          const order = canonical?.storeOrderId
            ? orderMap.get(canonical.storeOrderId)
            : pendingOrderByReferralId.get(r.id);
          if (!order) return null;
          const siblingIds = allLinkedReservations
            .filter((reservation) => reservation.storeOrderId === order.orderNumber)
            .map((reservation) => reservation.id);
          return linkedOrder(order, {
            paidAmount: calculateReceivedAmount(order.id, siblingIds, payments),
          });
        })(),
        linkedDeals: (() => {
          const canonical = r.reservationId ? reservationMap.get(r.reservationId) : null;
          const order = canonical?.storeOrderId
            ? orderMap.get(canonical.storeOrderId)
            : pendingOrderByReferralId.get(r.id);
          return order
            ? deals.filter(d => allLinkedReservations.some(x => x.storeOrderId === order.orderNumber && x.id === d.reservationId)).map(linkedDeal)
            : [];
        })(),
      };
    });

    res.json({
      data: referrals,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
});

router.post("/referrals", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ALL_STAFF_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateReferralBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();

    const [refSettings] = await db
      .select({ expirationDays: referralSettingsTable.expirationDays })
      .from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, me.tenantId))
      .limit(1);
    const expirationDays = refSettings?.expirationDays ?? 30;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expirationDays);

    // NOTE: This admin endpoint creates a referral invite with status='pending' (schema
    // default). reservationId is intentionally absent at this stage — it is only set
    // when the referral is converted (i.e. the referred person completes a purchase),
    // which happens via the CRM reservation path (reservations.ts) or the store
    // checkout path (referral-conversion.ts). Do NOT change this insert to set
    // status='completed' without also supplying a reservationId.
    await db.insert(referralsTable).values({ id, tenantId: me.tenantId, expiresAt, ...parsed.data });
    const [referral] = await db.select().from(referralsTable).where(eq(referralsTable.id, id)).limit(1);
    res.status(201).json(referral);
  } catch (err) {
    next(err);
  }
});

router.patch("/referrals/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = z.object({
      status: z.enum([
        REFERRAL_STATUS.PENDING,
        REFERRAL_STATUS.COMPLETED,
        REFERRAL_STATUS.CONVERTED,
        REFERRAL_STATUS.EXPIRED,
        REFERRAL_STATUS.REVERSED,
      ]).optional(),
      bonusPaid: z.boolean().optional(),
      convertedAt: z.string().optional(),
      isActive: z.boolean().optional(),
      notes: z.string().optional(),
      expiresAt: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }

    const [existing] = await db.select({
      status: referralsTable.status,
      bonusPaid: referralsTable.bonusPaid,
      convertedAt: referralsTable.convertedAt,
      expiresAt: referralsTable.expiresAt,
    })
      .from(referralsTable)
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!existing) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }

    if (parsed.data.bonusPaid !== undefined) {
      next(new AppError(
        "O pagamento do bônus deve ser registrado pelo endpoint de pagamento.",
        422,
        "REFERRAL_PAYMENT_STATE",
      ));
      return;
    }
    if (parsed.data.convertedAt !== undefined) {
      next(new AppError(
        "A conversão da indicação só pode ser registrada após a confirmação financeira.",
        422,
        "REFERRAL_CONVERSION_STATE",
      ));
      return;
    }
    if (
      parsed.data.status !== undefined &&
      parsed.data.status !== existing.status &&
      !(existing.status === REFERRAL_STATUS.PENDING && parsed.data.status === REFERRAL_STATUS.EXPIRED)
    ) {
      next(new AppError(
        "A transição de status solicitada não é permitida. Use o fluxo de conversão, pagamento ou reversão correspondente.",
        422,
        "REFERRAL_INVALID_TRANSITION",
      ));
      return;
    }
    if (parsed.data.status === REFERRAL_STATUS.EXPIRED && existing.status !== REFERRAL_STATUS.PENDING) {
      next(new AppError(
        "Somente indicações pendentes podem ser expiradas manualmente.",
        422,
        "REFERRAL_INVALID_TRANSITION",
      ));
      return;
    }
    if (
      parsed.data.status === REFERRAL_STATUS.EXPIRED &&
      parsed.data.isActive === true
    ) {
      next(new AppError(
        "Uma indicação expirada deve permanecer inativa.",
        422,
        "REFERRAL_INVALID_TRANSITION",
      ));
      return;
    }
    if (parsed.data.isActive === true && existing.status === REFERRAL_STATUS.EXPIRED) {
      next(new AppError(
        "Uma indicação expirada não pode ser reativada manualmente.",
        422,
        "REFERRAL_INVALID_TRANSITION",
      ));
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.status !== undefined && parsed.data.status !== existing.status) {
      updates.status = parsed.data.status;
    }
    if (parsed.data.status === REFERRAL_STATUS.EXPIRED) {
      updates.isActive = false;
    }
    if (parsed.data.isActive != null) updates.isActive = parsed.data.isActive;
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;
    if (parsed.data.expiresAt !== undefined) {
      const newExpiresAt = new Date(parsed.data.expiresAt);
      updates.expiresAt = newExpiresAt;
      const oldTime = existing.expiresAt ? new Date(existing.expiresAt).getTime() : null;
      if (oldTime !== newExpiresAt.getTime()) {
        updates.expiryWarning7SentAt = null;
        updates.expiryWarning1SentAt = null;
      }
    }

    await db.update(referralsTable).set(updates)
      .where(and(
        eq(referralsTable.id, req.params.id),
        eq(referralsTable.tenantId, me.tenantId),
        ...(existing.status === REFERRAL_STATUS.PENDING && parsed.data.status === REFERRAL_STATUS.EXPIRED
          ? [eq(referralsTable.status, REFERRAL_STATUS.PENDING)]
          : []),
      ));
    const [referral] = await db.select().from(referralsTable)
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId))).limit(1);
    if (!referral) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    res.json(referral);
  } catch (err) {
    next(err);
  }
});

router.post("/referrals/:id/pay-bonus", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [row] = await db.select({
      ...getTableColumns(referralsTable),
      referrerClientName: clientsTable.name,
      referrerClientEmail: clientsTable.email,
      referrerClientWhatsapp: clientsTable.whatsapp,
      referrerClientPhone: clientsTable.phone,
      tenantName: tenantsTable.name,
      tenantLogo: tenantsTable.logoUrl,
    }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .leftJoin(tenantsTable, eq(referralsTable.tenantId, tenantsTable.id))
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)))
      .limit(1);

    if (!row) { next(new NotFoundError("Indicação não encontrada", "NOT_FOUND")); return; }
    if (row.status === REFERRAL_STATUS.REVERSED) {
      next(new AppError("Bônus revertido por cancelamento da reserva", 422, "UNPROCESSABLE"));
      return;
    }
    if (row.status !== REFERRAL_STATUS.COMPLETED) {
      next(new AppError("Bônus só pode ser pago em indicações convertidas", 422, "UNPROCESSABLE"));
      return;
    }
    if (!row.convertedAt) {
      next(new AppError(
        "A indicação convertida não possui data de conversão confirmada.",
        422,
        "REFERRAL_CONVERSION_STATE",
      ));
      return;
    }
    if (row.bonusPaid) {
      next(new AppError("Bônus já foi pago anteriormente", 422, "UNPROCESSABLE"));
      return;
    }
    const [payBonusSettings] = await db
      .select({ gracePeriodDays: referralSettingsTable.gracePeriodDays })
      .from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, me.tenantId))
      .limit(1);
    const payBonusGracePeriod = payBonusSettings?.gracePeriodDays ?? 30;
    if (row.convertedAt) {
      const lockUntil = new Date(new Date(row.convertedAt).getTime() + payBonusGracePeriod * 24 * 60 * 60 * 1000);
      if (new Date() < lockUntil) {
        const releaseDate = lockUntil.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
        next(new AppError(`Bônus disponível somente após o período de carência de ${payBonusGracePeriod} dias. Liberação em ${releaseDate}`, 422, "BONUS_LOCKED"));
        return;
      }
    }

    const now = new Date();
    const [paidReferral] = await db.update(referralsTable)
      .set({ bonusPaid: true, bonusPaidAt: now, updatedAt: now })
      .where(and(
        eq(referralsTable.id, req.params.id),
        eq(referralsTable.tenantId, me.tenantId),
        eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
        eq(referralsTable.bonusPaid, false),
      ))
      .returning({ id: referralsTable.id });

    if (!paidReferral) {
      next(new ConflictError(
        "O pagamento não foi confirmado porque a indicação já foi paga ou mudou de estado.",
        "REFERRAL_PAYMENT_CONFLICT",
      ));
      return;
    }

    const referrerEmail = row.referrerClientEmail ?? row.referrerEmail;
    const referrerName = row.referrerClientName ?? row.referrerName ?? "Indicador";
    const agencyName = row.tenantName ?? "Agência";
    const bonusValue = parseFloat(String(row.bonusAmount ?? "0"));
    const paidDateStr = now.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

    if (referrerEmail) {
      try {
        const agencyLogoUrl = row.tenantLogo ?? null;
        await enqueueReferralBonusPaidEmail(
          {
            referrerName,
            referrerEmail,
            bonusAmount: bonusValue,
            paidDate: paidDateStr,
            agencyName,
            agencyLogo: agencyLogoUrl,
          },
          me.tenantId,
          row.referrerId,
          req.params.id,
        );
      } catch (emailErr) {
      }
    }

    const [updated] = await db.select({
      ...getTableColumns(referralsTable),
      referrerClientName: clientsTable.name,
      referrerClientEmail: clientsTable.email,
      referrerClientWhatsapp: clientsTable.whatsapp,
      referrerClientPhone: clientsTable.phone,
    }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)))
      .limit(1);

    if (!updated) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }

    const { referrerClientName, referrerClientEmail, referrerClientWhatsapp, referrerClientPhone, ...rest } = updated;
    res.json({
      ...rest,
      referrerName: referrerClientName ?? rest.referrerName,
      referrerEmail: referrerClientEmail ?? rest.referrerEmail,
      referrerPhone: referrerClientPhone ?? rest.referrerPhone,
      referrerWhatsapp: referrerClientWhatsapp ?? null,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/referrals/:id/resend-expiry-warning", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.MANAGE)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const windowParam = req.query.window;
    if (windowParam !== "7" && windowParam !== "1") {
      next(new ValidationError("Parâmetro 'window' inválido — use '7' ou '1'", "VALIDATION_ERROR"));
      return;
    }
    const windowNum = parseInt(windowParam, 10) as 7 | 1;

    const [row] = await db.select({
      ...getTableColumns(referralsTable),
      referrerClientEmail: clientsTable.email,
    }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)))
      .limit(1);

    if (!row) { next(new NotFoundError("Indicação não encontrada", "NOT_FOUND")); return; }
    if (!row.expiresAt) {
      next(new ValidationError("Esta indicação não tem data de expiração", "UNPROCESSABLE"));
      return;
    }
    if (!row.referrerId) {
      next(new ValidationError("Indicação sem indicador registrado", "UNPROCESSABLE"));
      return;
    }

    if (!row.referrerClientEmail) {
      next(new ValidationError("O indicador não tem e-mail cadastrado — aviso não pode ser enviado", "UNPROCESSABLE"));
      return;
    }

    const now = new Date();
    const expiresAt = new Date(row.expiresAt);
    if (expiresAt <= now) {
      next(new ValidationError("A indicação já expirou", "UNPROCESSABLE"));
      return;
    }

    const msLeft = expiresAt.getTime() - now.getTime();
    const windowMs = windowNum * 24 * 60 * 60 * 1000;
    if (msLeft < windowMs) {
      next(new AppError(`A janela D-${windowNum} já passou — restam menos de ${windowNum} dia(s) para a expiração`, 422, "WINDOW_PASSED"));
      return;
    }

    const clearUpdate = windowNum === 7
      ? { expiryWarning7SentAt: null, updatedAt: now }
      : { expiryWarning1SentAt: null, updatedAt: now };

    await db.update(referralsTable)
      .set(clearUpdate)
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)));

    await dispatchReferralExpiringSoonEmail(row.referrerId, me.tenantId, row.code, expiresAt, windowNum);

    const sentNow = new Date();
    const sentUpdate = windowNum === 7
      ? { expiryWarning7SentAt: sentNow, updatedAt: sentNow }
      : { expiryWarning1SentAt: sentNow, updatedAt: sentNow };

    await db.update(referralsTable)
      .set(sentUpdate)
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)));

    const [updated] = await db.select({
      ...getTableColumns(referralsTable),
      referrerClientName: clientsTable.name,
      referrerClientEmail: clientsTable.email,
      referrerClientWhatsapp: clientsTable.whatsapp,
      referrerClientPhone: clientsTable.phone,
    }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)))
      .limit(1);

    if (!updated) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    const { referrerClientName, referrerClientEmail, referrerClientWhatsapp, referrerClientPhone, ...rest } = updated;
    res.json({
      ...rest,
      referrerName: referrerClientName ?? rest.referrerName,
      referrerEmail: referrerClientEmail ?? rest.referrerEmail,
      referrerPhone: referrerClientPhone ?? rest.referrerPhone,
      referrerWhatsapp: referrerClientWhatsapp ?? null,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/referrals/:id/resend-bonus-release", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.MANAGE)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [row] = await db.select({
      ...getTableColumns(referralsTable),
      referrerClientEmail: clientsTable.email,
    }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)))
      .limit(1);

    if (!row) { next(new AppError("Indicação não encontrada", 422, "NOT_FOUND")); return; }
    if (row.status !== REFERRAL_STATUS.COMPLETED) {
      next(new AppError("Reenvio disponível apenas para indicações com status 'concluído'", 422, "UNPROCESSABLE"));
      return;
    }
    if (!row.referrerId) {
      next(new AppError("Indicação sem indicador registrado", 422, "UNPROCESSABLE"));
      return;
    }
    if (!row.referrerClientEmail) {
      next(new AppError("O indicador não tem e-mail cadastrado — notificação não pode ser enviada", 422, "UNPROCESSABLE"));
      return;
    }

    const [payBonusRefSettings] = await db
      .select({ gracePeriodDays: referralSettingsTable.gracePeriodDays })
      .from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, me.tenantId))
      .limit(1);
    const payBonusGracePeriodDays = payBonusRefSettings?.gracePeriodDays ?? 30;
    const bonusReleasesAt = row.convertedAt
      ? new Date(new Date(row.convertedAt).getTime() + payBonusGracePeriodDays * 24 * 60 * 60 * 1000)
      : null;
    const bonusBlocked = bonusReleasesAt !== null && new Date() < bonusReleasesAt;
    if (bonusBlocked) {
      next(new AppError(
        `O bônus ainda está em período de liberação — disponível em ${bonusReleasesAt!.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
        422,
        "BONUS_STILL_BLOCKED",
      ));
      return;
    }

    const now = new Date();
    await db.update(referralsTable)
      .set({ bonusReleaseNotifiedAt: null, updatedAt: now })
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)));

    const releaseDate = bonusReleasesAt?.toISOString() ?? now.toISOString();
    await dispatchReferralBonusReleasedEmail(
      row.referrerId,
      me.tenantId,
      parseFloat(String(row.bonusAmount)) || 0,
      releaseDate,
      row.id,
    );

    const sentNow = new Date();
    await db.update(referralsTable)
      .set({ bonusReleaseNotifiedAt: sentNow, updatedAt: sentNow })
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)));

    const [updated] = await db.select({
      ...getTableColumns(referralsTable),
      referrerClientName: clientsTable.name,
      referrerClientEmail: clientsTable.email,
      referrerClientWhatsapp: clientsTable.whatsapp,
      referrerClientPhone: clientsTable.phone,
    }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)))
      .limit(1);

    if (!updated) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    const { referrerClientName, referrerClientEmail: rEmail, referrerClientWhatsapp, referrerClientPhone, ...rest } = updated;
    res.json({
      ...rest,
      referrerName: referrerClientName ?? rest.referrerName,
      referrerEmail: rEmail ?? rest.referrerEmail,
      referrerPhone: referrerClientPhone ?? rest.referrerPhone,
      referrerWhatsapp: referrerClientWhatsapp ?? null,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/referrals/:id/expiry-email-status", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ALL_STAFF_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [row] = await db.select({
      code: referralsTable.code,
      referrerClientEmail: clientsTable.email,
    }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)))
      .limit(1);

    if (!row) { next(new NotFoundError("Indicação não encontrada", "NOT_FOUND")); return; }

    const referrerEmail = row.referrerClientEmail;
    if (!referrerEmail) {
      res.json({ d7: null, d1: null });
      return;
    }

    const logs = await db.select({
      id: emailLogsTable.id,
      subject: emailLogsTable.subject,
      status: emailLogsTable.status,
      errorMessage: emailLogsTable.errorMessage,
      createdAt: emailLogsTable.createdAt,
    }).from(emailLogsTable)
      .where(and(
        eq(emailLogsTable.tenantId, me.tenantId),
        eq(emailLogsTable.recipient, referrerEmail),
        ilike(emailLogsTable.subject, `%${row.code}%`),
      ))
      .orderBy(desc(emailLogsTable.createdAt))
      .limit(50);

    const d7Logs = logs.filter((l) => l.subject.includes("7 dias"));
    const d1Logs = logs.filter((l) => l.subject.includes("1 dia"));

    const toEntry = (log: typeof logs[0] | undefined) =>
      log ? { status: log.status, errorMessage: log.errorMessage ?? null, sentAt: log.createdAt } : null;

    res.json({ d7: toEntry(d7Logs[0]), d1: toEntry(d1Logs[0]) });
  } catch (err) {
    next(err);
  }
});

router.get("/referrals/:id/bonus-release-email-status", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ALL_STAFF_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [row] = await db.select({
      code: referralsTable.code,
      referrerClientEmail: clientsTable.email,
    }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)))
      .limit(1);

    if (!row) { next(new NotFoundError("Indicação não encontrada", "NOT_FOUND")); return; }

    const referrerEmail = row.referrerClientEmail;
    if (!referrerEmail) {
      res.json({ bonusRelease: null });
      return;
    }

    // The bonus-release email is enqueued with the referral id stamped on the
    // email log (see enqueueReferralBonusReleasedEmail) and a distinctive
    // subject ("…disponível para resgate…"). Filter on both so we never pick up
    // an expiry-warning email (which also stamps referralId) for this referral.
    const logs = await db.select({
      id: emailLogsTable.id,
      subject: emailLogsTable.subject,
      status: emailLogsTable.status,
      errorMessage: emailLogsTable.errorMessage,
      createdAt: emailLogsTable.createdAt,
    }).from(emailLogsTable)
      .where(and(
        eq(emailLogsTable.tenantId, me.tenantId),
        eq(emailLogsTable.referralId, req.params.id),
        ilike(emailLogsTable.subject, `%disponível para resgate%`),
      ))
      .orderBy(desc(emailLogsTable.createdAt))
      .limit(50);

    const toEntry = (log: typeof logs[0] | undefined) =>
      log ? { status: log.status, errorMessage: log.errorMessage ?? null, sentAt: log.createdAt } : null;

    res.json({ bonusRelease: toEntry(logs[0]) });
  } catch (err) {
    next(err);
  }
});

router.get("/referrals/:id/share", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ALL_STAFF_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [row] = await db
      .select({
        code: referralsTable.code,
        tenantSlug: tenantsTable.slug,
      })
      .from(referralsTable)
      .leftJoin(tenantsTable, eq(referralsTable.tenantId, tenantsTable.id))
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)))
      .limit(1);

    if (!row) { next(new NotFoundError("Indicação não encontrada", "NOT_FOUND")); return; }

    const frontendBase = (process.env["FRONTEND_URL"] ?? `https://${process.env["REPLIT_DEV_DOMAIN"] ?? "localhost"}`).replace(/\/$/, "");
    const slug = row.tenantSlug ?? me.tenantId;
    const link = `${frontendBase}/loja/${slug}/indicacao?code=${row.code}`;

    const QRCode = await import("qrcode");
    const qrCodeDataUrl = await QRCode.default.toDataURL(link, { margin: 2, width: 256 });

    res.json({ link, qrCodeDataUrl });
  } catch (err) {
    next(err);
  }
});

router.get("/referrals/analytics", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ALL_STAFF_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const period = parseInt((req.query.period as string) || "90", 10);
    if (![30, 90, 180].includes(period)) {
      next(new ValidationError("period must be 30, 90, or 180", "VALIDATION_ERROR"));
      return;
    }

    const now = new Date();
    const since = new Date(now.getTime() - period * 24 * 60 * 60 * 1000);
    const prevSince = new Date(since.getTime() - period * 24 * 60 * 60 * 1000);
    // Use Brazil calendar month so 12m and current-month boundaries are correct at 21h-midnight BRT
    const [_refY, _refM1] = localToday().split("-").map(Number);
    const _brMidRef = (y: number, m1: number, d: number) => new Date(Date.UTC(y, m1 - 1, d, 3, 0, 0, 0));
    const twelveMonthsAgo = _brMidRef(_refY, _refM1 - 11, 1);

    // Current and previous calendar month boundaries (Brazil midnight)
    const currentMonthStart = _brMidRef(_refY, _refM1, 1);
    const prevMonthStart = _brMidRef(_refY, _refM1 - 1, 1);

    const [
      seriesRows,
      funnelRow_,
      prevRow_,
      monthlyRows,
      channelRows,
      currentMonthRow_,
      prevMonthRow_,
      trackingFunnelRow_,
      commercialRows,
    ] = await Promise.all([
      // Weekly series for selected period (existing behaviour)
      db.select({
        week: sql<string>`date_trunc('week', ${referralsTable.createdAt})::date::text`,
        created: count(),
        converted: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.status} = ${REFERRAL_STATUS.COMPLETED})`,
      }).from(referralsTable)
        .where(and(eq(referralsTable.tenantId, me.tenantId), sql`${referralsTable.createdAt} >= ${since}`))
        .groupBy(sql`date_trunc('week', ${referralsTable.createdAt})`)
        .orderBy(sql`date_trunc('week', ${referralsTable.createdAt})`),

      // Funnel for period
      db.select({
        created: count(),
        visited: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.visitsCount} > 0)`,
        converted: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.status} = ${REFERRAL_STATUS.COMPLETED})`,
        bonusPaid: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.bonusPaid} = true)`,
      }).from(referralsTable)
        .where(and(eq(referralsTable.tenantId, me.tenantId), sql`${referralsTable.createdAt} >= ${since}`)),

      // Previous period comparison
      db.select({
        created: count(),
        converted: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.status} = ${REFERRAL_STATUS.COMPLETED})`,
      }).from(referralsTable)
        .where(and(
          eq(referralsTable.tenantId, me.tenantId),
          sql`${referralsTable.createdAt} >= ${prevSince}`,
          sql`${referralsTable.createdAt} < ${since}`,
        )),

      // Monthly time series — last 12 months (Brazil timezone so BRT-midnight records land in the correct month)
      db.select({
        month: sql<string>`to_char(${referralsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`,
        created: count(),
        converted: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.status} = ${REFERRAL_STATUS.COMPLETED})`,
        bonusPaid: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.bonusPaid} = true)`,
      }).from(referralsTable)
        .where(and(eq(referralsTable.tenantId, me.tenantId), sql`${referralsTable.createdAt} >= ${twelveMonthsAgo}`))
        .groupBy(sql`to_char(${referralsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`)
        .orderBy(sql`to_char(${referralsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`),

      // Channel breakdown from referral_tracking.utmSource for the period
      db.select({
        source: sql<string>`COALESCE(NULLIF(${referralTrackingTable.utmSource}, ''), 'direto')`,
        visitors: sql<number>`COUNT(DISTINCT ${referralTrackingTable.cookieId})`,
        converted: sql<number>`COUNT(DISTINCT CASE WHEN ${referralTrackingTable.converted} = true THEN ${referralTrackingTable.cookieId} END)`,
      }).from(referralTrackingTable)
        .where(and(
          eq(referralTrackingTable.tenantId, me.tenantId),
          sql`${referralTrackingTable.createdAt} >= ${since}`,
        ))
        .groupBy(sql`COALESCE(NULLIF(${referralTrackingTable.utmSource}, ''), 'direto')`)
        .orderBy(sql`COUNT(DISTINCT ${referralTrackingTable.cookieId}) DESC`)
        .limit(8),

      // Current calendar month
      db.select({
        referrals: count(),
        conversions: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.status} = ${REFERRAL_STATUS.COMPLETED})`,
        bonusPaid: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.bonusPaid} = true)`,
        bonusPaidAmount: sql<number>`COALESCE(SUM(${referralsTable.bonusAmount}) FILTER (WHERE ${referralsTable.bonusPaid} = true), 0)`,
      }).from(referralsTable)
        .where(and(
          eq(referralsTable.tenantId, me.tenantId),
          sql`${referralsTable.createdAt} >= ${currentMonthStart}`,
        )),

      // Previous calendar month
      db.select({
        referrals: count(),
        conversions: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.status} = ${REFERRAL_STATUS.COMPLETED})`,
        bonusPaid: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.bonusPaid} = true)`,
        bonusPaidAmount: sql<number>`COALESCE(SUM(${referralsTable.bonusAmount}) FILTER (WHERE ${referralsTable.bonusPaid} = true), 0)`,
      }).from(referralsTable)
        .where(and(
          eq(referralsTable.tenantId, me.tenantId),
          sql`${referralsTable.createdAt} >= ${prevMonthStart}`,
          sql`${referralsTable.createdAt} < ${currentMonthStart}`,
        )),

      // Tracking-based funnel: unique visitors, checkout starts, and conversions from referral_tracking for the period
      db.select({
        uniqueVisitors: sql<number>`COUNT(DISTINCT ${referralTrackingTable.cookieId})`,
        checkoutStarts: sql<number>`COUNT(DISTINCT CASE WHEN ${referralTrackingTable.pagesVisited} IS NOT NULL AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${referralTrackingTable.pagesVisited}::jsonb) AS elem
          WHERE elem LIKE '%/checkout%'
        ) THEN ${referralTrackingTable.cookieId} END)`,
        converted: sql<number>`COUNT(DISTINCT CASE WHEN ${referralTrackingTable.converted} = true THEN ${referralTrackingTable.cookieId} END)`,
      }).from(referralTrackingTable)
        .where(and(
          eq(referralTrackingTable.tenantId, me.tenantId),
          sql`${referralTrackingTable.createdAt} >= ${since}`,
        )),

      // Commercial result uses the referral-to-reservation linkage instead of
      // every reservation with a code. The helper additionally excludes
      // cancelled and reversed conversions before deriving CAC and ROI.
      db.select({
        tenantId: referralsTable.tenantId,
        referrerId: referralsTable.referrerId,
        referrerName: clientsTable.name,
        status: referralsTable.status,
        convertedAt: referralsTable.convertedAt,
        bonusAmount: referralsTable.bonusAmount,
        bonusPaid: referralsTable.bonusPaid,
        bonusPaidAt: referralsTable.bonusPaidAt,
        bonusCreditUsedAmount: referralsTable.bonusCreditUsedAmount,
        discountAmount: referralsTable.discountAmount,
        reservationStatus: reservationsTable.status,
        reservationPaidValue: reservationsTable.paidValue,
        commissionAmount: referralCommissionsTable.amount,
        commissionStatus: referralCommissionsTable.status,
      })
        .from(referralsTable)
        .leftJoin(
          reservationsTable,
          and(
            eq(reservationsTable.id, referralsTable.reservationId),
            eq(reservationsTable.tenantId, me.tenantId),
          ),
        )
        .leftJoin(
          clientsTable,
          and(
            eq(clientsTable.id, referralsTable.referrerId),
            eq(clientsTable.tenantId, me.tenantId),
          ),
        )
        .leftJoin(
          referralCommissionsTable,
          and(
            eq(referralCommissionsTable.referralId, referralsTable.id),
            eq(referralCommissionsTable.tenantId, me.tenantId),
          ),
        )
        .where(and(
          eq(referralsTable.tenantId, me.tenantId),
          sql`${referralsTable.convertedAt} >= ${since}`,
        )),
    ]);

    const [funnelRow] = funnelRow_;
    const [prevRow] = prevRow_;
    const [currentMonthRow] = currentMonthRow_;
    const [prevMonthRow] = prevMonthRow_;
    const [trackingFunnelRow] = trackingFunnelRow_;

    const created = Number(funnelRow?.created ?? 0);
    const converted = Number(funnelRow?.converted ?? 0);
    const conversionRate = created > 0 ? Math.round((converted / created) * 100) : 0;
    const prevCreated = Number(prevRow?.created ?? 0);
    const prevConverted = Number(prevRow?.converted ?? 0);
    const prevConversionRate = prevCreated > 0 ? Math.round((prevConverted / prevCreated) * 100) : 0;
    const commercialAnalytics = calculateReferralCommercialAnalytics(
      commercialRows,
      me.tenantId,
      since,
      new Date(),
    );

    res.json({
      series: seriesRows.map(r => ({ week: r.week, created: Number(r.created), converted: Number(r.converted) })),
      monthly: monthlyRows.map(r => ({
        month: r.month.slice(0, 7),
        created: Number(r.created),
        converted: Number(r.converted),
        bonusPaid: Number(r.bonusPaid),
      })),
      funnel: {
        created,
        visited: Number(funnelRow?.visited ?? 0),
        converted,
        bonusPaid: Number(funnelRow?.bonusPaid ?? 0),
      },
      trackingFunnel: {
        uniqueVisitors: Number(trackingFunnelRow?.uniqueVisitors ?? 0),
        checkoutStarts: Number(trackingFunnelRow?.checkoutStarts ?? 0),
        converted: Number(trackingFunnelRow?.converted ?? 0),
      },
      channels: channelRows.map(r => ({
        source: r.source,
        visitors: Number(r.visitors),
        converted: Number(r.converted),
      })),
      roi: {
        totalBonusPaid: commercialAnalytics.summary.rewardsPaid,
        totalReferredRevenue: commercialAnalytics.summary.attributedRevenue,
      },
      summary: commercialAnalytics.summary,
      ranking: commercialAnalytics.ranking,
      rankingMeta: rankingMetadata("referralCommercial", "admin", {
        key: `last-${period}-days`,
        semantics: `rolling ${period}-day period ending at response generation time; calendar-month endpoints use America/Sao_Paulo boundaries`,
      }),
      currentMonth: {
        referrals: Number(currentMonthRow?.referrals ?? 0),
        conversions: Number(currentMonthRow?.conversions ?? 0),
        bonusPaid: Number(currentMonthRow?.bonusPaid ?? 0),
        bonusPaidAmount: Number(currentMonthRow?.bonusPaidAmount ?? 0),
      },
      prevMonth: {
        referrals: Number(prevMonthRow?.referrals ?? 0),
        conversions: Number(prevMonthRow?.conversions ?? 0),
        bonusPaid: Number(prevMonthRow?.bonusPaid ?? 0),
        bonusPaidAmount: Number(prevMonthRow?.bonusPaidAmount ?? 0),
      },
      conversionRate,
      prevConversionRate,
      discountGiven: commercialAnalytics.summary.discountGiven,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/referrals/analytics/export", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    // Full referral analytics export is an administrator-only audit surface;
    // COMMISSIONS.VIEW governs ordinary report access below.
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const now = new Date();
    let since: Date;

    // Support either explicit startDate/endDate OR the period shortcut
    const startDateParam = req.query.startDate as string | undefined;
    const endDateParam = req.query.endDate as string | undefined;
    if (startDateParam) {
      const parsed = new Date(startDateParam);
      if (isNaN(parsed.getTime())) {
        next(new ValidationError("startDate must be a valid ISO date", "VALIDATION_ERROR"));
        return;
      }
      since = parsed;
    } else {
      const period = parseInt((req.query.period as string) || "90", 10);
      if (![30, 90, 180].includes(period)) {
        next(new ValidationError("period must be 30, 90, or 180; or provide startDate/endDate", "VALIDATION_ERROR"));
        return;
      }
      since = new Date(now.getTime() - period * 24 * 60 * 60 * 1000);
    }
    let until: Date = now;
    if (endDateParam) {
      const parsedEnd = new Date(endDateParam);
      if (isNaN(parsedEnd.getTime())) {
        next(new ValidationError("endDate must be a valid ISO date", "VALIDATION_ERROR"));
        return;
      }
      if (parsedEnd < since) {
        next(new ValidationError("endDate must be on or after startDate", "VALIDATION_ERROR"));
        return;
      }
      until = parsedEnd;
    }
    const [_r2Y, _r2M1] = localToday().split("-").map(Number);
    const _brMid2 = (y: number, m1: number, d: number) => new Date(Date.UTC(y, m1 - 1, d, 3, 0, 0, 0));
    const twelveMonthsAgo = _brMid2(_r2Y, _r2M1 - 11, 1);

    const [monthlyRows, channelRows, commercialRows] = await Promise.all([
      // Monthly series for the selected date window — Brazil timezone to avoid wrong-month at 21h-midnight BRT
      db.select({
        month: sql<string>`to_char(${referralsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`,
        created: count(),
        converted: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.status} = ${REFERRAL_STATUS.COMPLETED})`,
        bonusPaid: sql<number>`COUNT(*) FILTER (WHERE ${referralsTable.bonusPaid} = true)`,
        bonusTotal: sql<number>`COALESCE(SUM(${referralsTable.bonusAmount}) FILTER (WHERE ${referralsTable.bonusPaid} = true), 0)`,
      }).from(referralsTable)
        .where(and(
          eq(referralsTable.tenantId, me.tenantId),
          sql`${referralsTable.createdAt} >= ${since}`,
          sql`${referralsTable.createdAt} <= ${until}`,
        ))
        .groupBy(sql`to_char(${referralsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`)
        .orderBy(sql`to_char(${referralsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`),

      // Channel breakdown for the same window
      db.select({
        source: sql<string>`COALESCE(NULLIF(${referralTrackingTable.utmSource}, ''), 'direto')`,
        visitors: sql<number>`COUNT(DISTINCT ${referralTrackingTable.cookieId})`,
        converted: sql<number>`COUNT(DISTINCT CASE WHEN ${referralTrackingTable.converted} = true THEN ${referralTrackingTable.cookieId} END)`,
      }).from(referralTrackingTable)
        .where(and(
          eq(referralTrackingTable.tenantId, me.tenantId),
          sql`${referralTrackingTable.createdAt} >= ${since}`,
          sql`${referralTrackingTable.createdAt} <= ${until}`,
        ))
        .groupBy(sql`COALESCE(NULLIF(${referralTrackingTable.utmSource}, ''), 'direto')`)
        .orderBy(sql`COUNT(DISTINCT ${referralTrackingTable.cookieId}) DESC`),

      // Export the same linked, reversible commercial result used by the
      // dashboard; do not infer attribution from a reservation code.
      db.select({
        tenantId: referralsTable.tenantId,
        referrerId: referralsTable.referrerId,
        referrerName: clientsTable.name,
        status: referralsTable.status,
        convertedAt: referralsTable.convertedAt,
        bonusAmount: referralsTable.bonusAmount,
        bonusPaid: referralsTable.bonusPaid,
        bonusPaidAt: referralsTable.bonusPaidAt,
        bonusCreditUsedAmount: referralsTable.bonusCreditUsedAmount,
        discountAmount: referralsTable.discountAmount,
        reservationStatus: reservationsTable.status,
        reservationPaidValue: reservationsTable.paidValue,
        commissionAmount: referralCommissionsTable.amount,
        commissionStatus: referralCommissionsTable.status,
      })
        .from(referralsTable)
        .leftJoin(
          reservationsTable,
          and(
            eq(reservationsTable.id, referralsTable.reservationId),
            eq(reservationsTable.tenantId, me.tenantId),
          ),
        )
        .leftJoin(
          clientsTable,
          and(
            eq(clientsTable.id, referralsTable.referrerId),
            eq(clientsTable.tenantId, me.tenantId),
          ),
        )
        .leftJoin(
          referralCommissionsTable,
          and(
            eq(referralCommissionsTable.referralId, referralsTable.id),
            eq(referralCommissionsTable.tenantId, me.tenantId),
          ),
        )
        .where(and(
          eq(referralsTable.tenantId, me.tenantId),
          sql`${referralsTable.convertedAt} >= ${since}`,
          sql`${referralsTable.convertedAt} <= ${until}`,
        )),
    ]);

    const commercialAnalytics = calculateReferralCommercialAnalytics(
      commercialRows,
      me.tenantId,
      since,
      until,
    );

    const CHANNEL_LABEL_MAP: Record<string, string> = {
      whatsapp: "WhatsApp", qr_code: "QR Code", qrcode: "QR Code",
      direct: "Link direto", direto: "Link direto", instagram: "Instagram",
      facebook: "Facebook", email: "E-mail", sms: "SMS",
    };
    const channelLabelFn = (s: string) => CHANNEL_LABEL_MAP[s.toLowerCase()] ?? s;

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "VisiteCRM";

    // Sheet 1: Monthly series
    const wsMonthly = wb.addWorksheet("Série Mensal");
    const monthlyHeaders = ["Mês", "Indicações criadas", "Convertidas", "Bônus pagos", "Total bônus (R$)", "Taxa de conversão (%)"];
    const hRowM = wsMonthly.addRow(monthlyHeaders);
    hRowM.font = { bold: true };
    for (const r of monthlyRows) {
      const monthLabel = r.month.slice(0, 7);
      const cr = Number(r.created);
      const cv = Number(r.converted);
      wsMonthly.addRow([
        monthLabel,
        cr,
        cv,
        Number(r.bonusPaid),
        Number(r.bonusTotal).toFixed(2),
        cr > 0 ? Math.round((cv / cr) * 100) : 0,
      ]);
    }
    monthlyHeaders.forEach((_, i) => { wsMonthly.getColumn(i + 1).width = Math.max(monthlyHeaders[i].length, 16) + 2; });

    // Sheet 2: Channel breakdown
    const wsChannels = wb.addWorksheet("Canais");
    const channelHeaders = ["Canal", "Visitantes únicos", "Conversões", "Taxa de conversão (%)"];
    const hRowC = wsChannels.addRow(channelHeaders);
    hRowC.font = { bold: true };
    for (const r of channelRows) {
      const v = Number(r.visitors);
      const cv = Number(r.converted);
      wsChannels.addRow([channelLabelFn(r.source), v, cv, v > 0 ? Math.round((cv / v) * 100) : 0]);
    }
    channelHeaders.forEach((_, i) => { wsChannels.getColumn(i + 1).width = Math.max(channelHeaders[i].length, 16) + 2; });

    // Sheet 3: Commercial result
    const wsRoi = wb.addWorksheet("Resultado Comercial");
    wsRoi.addRow(["Métrica", "Valor"]).font = { bold: true };
    wsRoi.addRow(["Conversões válidas", commercialAnalytics.summary.validReferrals]);
    wsRoi.addRow(["Receita atribuída / valor pago (R$)", commercialAnalytics.summary.attributedRevenue.toFixed(2)]);
    wsRoi.addRow(["Bônus promocionais pagos (R$)", commercialAnalytics.summary.rewardsPaid.toFixed(2)]);
    wsRoi.addRow(["Bônus promocionais pendentes (R$)", commercialAnalytics.summary.rewardsPending.toFixed(2)]);
    wsRoi.addRow(["Descontos concedidos (R$)", commercialAnalytics.summary.discountGiven.toFixed(2)]);
    wsRoi.addRow(["Comissões contratuais (R$)", commercialAnalytics.summary.commissions.toFixed(2)]);
    wsRoi.addRow(["Custo de aquisição (R$)", commercialAnalytics.summary.acquisitionCost.toFixed(2)]);
    wsRoi.addRow(["CAC (R$)", commercialAnalytics.summary.cac.toFixed(2)]);
    wsRoi.addRow(["ROI (%)", commercialAnalytics.summary.roiPercent.toFixed(2)]);
    wsRoi.addRow(["ROI (múltiplo)", commercialAnalytics.summary.acquisitionCost > 0 ? commercialAnalytics.summary.roiMultiple.toFixed(2) : "—"]);
    wsRoi.getColumn(1).width = 36;
    wsRoi.getColumn(2).width = 20;

    // Sheet 4: commercial ranking. Contractual commissions are ledger-backed
    // and remain distinct from promotional bonuses.
    const wsRanking = wb.addWorksheet("Ranking Comercial");
    const rankingHeaders = ["Posição", "Indicador", "Conversões", "Receita atribuída (R$)", "Bônus pagos (R$)", "Comissão (R$)"];
    wsRanking.addRow(rankingHeaders).font = { bold: true };
    commercialAnalytics.ranking.forEach((row, index) => {
      wsRanking.addRow([
        index + 1,
        row.referrerName,
        row.conversions,
        row.attributedRevenue.toFixed(2),
        row.rewardsPaid.toFixed(2),
        row.commissionAmount.toFixed(2),
      ]);
    });
    rankingHeaders.forEach((header, index) => {
      wsRanking.getColumn(index + 1).width = Math.max(header.length, 18) + 2;
    });

    const dateStr = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10);
    const filename = `analytics-indicacoes-${dateStr}.xlsx`;
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
});

router.get("/referrals/export", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    // The raw referral export includes contact and campaign data and remains
    // an administrator-only export exception to COMMISSIONS.VIEW.
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const format = (req.query.format as string | undefined) ?? "csv";
    if (!["csv", "xlsx", "json"].includes(format)) {
      next(new ValidationError("format must be csv, xlsx, or json", "VALIDATION_ERROR"));
      return;
    }

    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;
    const bonusPaidParam = req.query.bonusPaid as string | undefined;
    const fraudFlagParam = req.query.fraudFlag as string | undefined;
    const expiringSoonParam = req.query.expiringSoon as string | undefined;
    const bonusNotifiedParam = req.query.bonusNotified as string | undefined;

    const validReferralStatusesExport = Object.values(REFERRAL_STATUS);
    if (status && status !== "all" && !validReferralStatusesExport.includes(status as (typeof validReferralStatusesExport)[number])) {
      next(new ValidationError(String(`Invalid status. Must be one of: all, ${validReferralStatusesExport.join(", ")}`), "VALIDATION_ERROR"));
      return;
    }

    const conditions = [eq(referralsTable.tenantId, me.tenantId)];
    if (status && status !== "all") conditions.push(eq(referralsTable.status, status));
    if (bonusPaidParam === "false") conditions.push(eq(referralsTable.bonusPaid, false));
    if (fraudFlagParam === "true") conditions.push(eq(referralsTable.fraudFlag, true));
    if (bonusNotifiedParam === "true") conditions.push(isNotNull(referralsTable.bonusReleaseNotifiedAt));
    if (bonusNotifiedParam === "false") conditions.push(isNull(referralsTable.bonusReleaseNotifiedAt));
    if (expiringSoonParam === "true") {
      const nowDate = new Date();
      const sevenDays = new Date(nowDate.getTime() + 7 * 24 * 60 * 60 * 1000);
      conditions.push(
        and(
          eq(referralsTable.status, REFERRAL_STATUS.PENDING),
          sql`${referralsTable.expiresAt} > NOW()`,
          sql`${referralsTable.expiresAt} <= ${sevenDays}`,
        )!,
      );
    }
    if (search) {
      conditions.push(or(
        ilike(referralsTable.code, `%${search}%`),
        ilike(referralsTable.referrerName, `%${search}%`),
        ilike(referralsTable.referredEmail, `%${search}%`),
        ilike(referralsTable.referredName, `%${search}%`),
        ilike(clientsTable.name, `%${search}%`),
        ilike(clientsTable.email, `%${search}%`),
      )!);
    }

    const rows = await db.select({
      ...getTableColumns(referralsTable),
      referrerClientName: clientsTable.name,
      referrerClientEmail: clientsTable.email,
    }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(and(...conditions))
      .orderBy(desc(referralsTable.createdAt));

    const STATUS_MAP: Record<string, string> = {
      pending: "Pendente",
      completed: "Convertida",
      expired: "Expirada",
      converted: "Convertida",
      reversed: "Revertida",
    };

    const headers = [
      "Código", "Indicador", "E-mail Indicador", "Indicado", "E-mail Indicado",
      "Status", "Bônus (R$)", "Desconto (R$)", "Bônus Pago", "Notif. Bônus em", "Visitas", "Última visita",
      "Criado em", "Convertido em", "Expira em", "Motivo (suspeita)",
    ];

    const dataRows = rows.map(r => [
      r.code,
      r.referrerClientName ?? r.referrerName ?? "",
      r.referrerClientEmail ?? r.referrerEmail ?? "",
      r.referredName ?? "",
      r.referredEmail ?? "",
      STATUS_MAP[r.status] ?? r.status,
      r.bonusAmount ? parseFloat(String(r.bonusAmount)).toFixed(2) : "0.00",
      r.discountAmount ? parseFloat(String(r.discountAmount)).toFixed(2) : "0.00",
      r.bonusPaid ? "Sim" : "Não",
      r.bonusReleaseNotifiedAt ? new Date(r.bonusReleaseNotifiedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
      String(r.visitsCount ?? 0),
      r.lastVisit ? new Date(r.lastVisit).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
      r.createdAt ? new Date(r.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
      r.convertedAt ? new Date(r.convertedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
      r.expiresAt ? new Date(r.expiresAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
      r.fraudReason ?? "",
    ]);

    const dateStr = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).slice(0, 10);

    if (format === "json") {
      const jsonData = rows.map(r => ({
        code: r.code,
        referrerName: r.referrerClientName ?? r.referrerName ?? "",
        referrerEmail: r.referrerClientEmail ?? r.referrerEmail ?? "",
        referredName: r.referredName ?? "",
        referredEmail: r.referredEmail ?? "",
        status: STATUS_MAP[r.status] ?? r.status,
        bonusAmount: r.bonusAmount ? parseFloat(String(r.bonusAmount)).toFixed(2) : "0.00",
        discountAmount: r.discountAmount ? parseFloat(String(r.discountAmount)).toFixed(2) : "0.00",
        bonusPaid: r.bonusPaid ? "Sim" : "Não",
        bonusReleaseNotifiedAt: r.bonusReleaseNotifiedAt ? new Date(r.bonusReleaseNotifiedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
        visitsCount: r.visitsCount ?? 0,
        lastVisit: r.lastVisit ? new Date(r.lastVisit).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
        createdAt: r.createdAt ? new Date(r.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
        convertedAt: r.convertedAt ? new Date(r.convertedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
        expiresAt: r.expiresAt ? new Date(r.expiresAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
        fraudReason: r.fraudReason ?? "",
      }));
      res.json({ headers, rows: jsonData });
      return;
    }

    if (format === "xlsx") {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "VisiteCRM";
      const ws = wb.addWorksheet("Indicações");
      const headerRow = ws.addRow(headers);
      headerRow.font = { bold: true };
      for (const row of dataRows) ws.addRow(row);
      headers.forEach((h, i) => {
        ws.getColumn(i + 1).width = Math.max(h.length, ...dataRows.map(r => String(r[i] ?? "").length)) + 2;
      });
      const buf = await wb.xlsx.writeBuffer();
      const filename = `indicacoes-${dateStr}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(buf));
      return;
    }

    const csv = [headers, ...dataRows]
      .map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const filename = `indicacoes-${dateStr}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("\uFEFF" + csv);
  } catch (err) {
    next(err);
  }
});

router.post("/referral-settings/test-whatsapp", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.EDIT)) { res.status(403).json({ error: "Forbidden" }); return; }

    const parsed = z.object({
      type: z.enum(["converted", "bonusPaid", "reversed", "share"]),
      message: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

    const [settings] = await db.select().from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, me.tenantId)).limit(1);

    const phone = settings?.whatsappPhoneNumber;
    if (!phone) {
      res.status(400).json({ error: "whatsapp_not_configured" });
      return;
    }

    const [tenant] = await db.select().from(tenantsTable)
      .where(eq(tenantsTable.id, me.tenantId)).limit(1);
    const agencyName = tenant?.name ?? "Minha Agência";

    const bonusFormatted = (settings?.bonusValue != null ? Number(settings.bonusValue) : 10)
      .toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    let template = parsed.data.message ?? "";
    if (!template.trim()) {
      if (parsed.data.type === "converted") {
        template = settings?.whatsappConvertedMessage ?? "";
      } else if (parsed.data.type === "bonusPaid") {
        template = settings?.whatsappBonusPaidMessage ?? "";
      } else if (parsed.data.type === "reversed") {
        template = settings?.whatsappReversedMessage ?? "";
      } else {
        template = settings?.shareMessage ?? "";
      }
    }
    if (!template.trim()) {
      res.status(400).json({ error: "empty_template" });
      return;
    }

    const vars =
      parsed.data.type === "converted"
        ? { nome: "Maria", codigo: "JOAO123", agencia: agencyName, valor: bonusFormatted }
        : parsed.data.type === "bonusPaid"
        ? { nome: "João", codigo: "JOAO123", bonus: `R$ ${bonusFormatted}`, valor: bonusFormatted, agencia: agencyName }
        : parsed.data.type === "reversed"
        ? { nome: "Maria", valor: bonusFormatted, agencia: agencyName, saldo: bonusFormatted }
        : { nome: "João", codigo: "JOAO123", link: "https://exemplo.com.br/ind/JOAO123", bonus: `R$ ${bonusFormatted}` };

    const message = interpolateWhatsAppMessage(template, vars);
    const deliveryResult = await dispatchOutboundMessage({
      tenantId: me.tenantId,
      eventType: "referral_test_whatsapp",
      idempotencyKey: `referral-test-whatsapp:${parsed.data.type}:${generateId()}`,
      recipient: { type: "direct", whatsapp: phone },
      whatsapp: { text: message },
      origin: "referral_settings_test",
      originChannel: "whatsapp",
      createdById: me.id,
    });
    const whatsappDelivery = deliveryResult.deliveries.find((delivery) => delivery.channel === "whatsapp");
    const result = {
      success: whatsappDelivery?.status === "pending" || whatsappDelivery?.status === "accepted",
      error: whatsappDelivery?.lastError ?? whatsappDelivery?.skippedReason ?? undefined,
    };

    if (!result.success) {
      if (result.error === "credentials_not_configured") {
        res.status(400).json({ error: "credentials_not_configured" });
      } else {
        res.status(502).json({ error: result.error ?? "send_failed" });
      }
      return;
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/referral-settings", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.VIEW)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const [settings] = await db.select().from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, me.tenantId)).limit(1);
    if (!settings) {
      const defaults = {
        id: generateId(),
        tenantId: me.tenantId,
        isEnabled: true,
        discountType: "percentage",
        discountValue: "5.00",
        bonusType: "credit",
        bonusValue: "10.00",
        expirationDays: 30,
        allowSelfReferral: false,
        requireFirstPurchase: true,
        shareMessage: "Use meu código de indicação e ganhe desconto na sua viagem!",
        tiersConfig: DEFAULT_TIERS_CONFIG,
        whatsappEnabled: false,
        whatsappPhoneNumber: null,
        whatsappConvertedMessage: null,
        whatsappBonusPaidMessage: null,
        whatsappReversedMessage: null,
        expiryWarning7DaysEnabled: true,
        expiryWarning1DayEnabled: true,
        bonusReleaseEmailEnabled: true,
        pointsPerReferral: 0,
        gracePeriodDays: 30,
        bonusValidityDays: 30,
        discountExpirationDays: 30,
        minPurchaseAmount: "0.00",
        maxReferralsPerUser: 0,
      };
      await db.insert(referralSettingsTable).values(defaults);
      res.json(defaults);
      return;
    }
    if (!settings.tiersConfig) {
      res.json({ ...settings, tiersConfig: DEFAULT_TIERS_CONFIG });
      return;
    }
    res.json(settings);
  } catch (err) {
    next(err);
  }
});

router.patch("/referral-settings", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const TierSchema = z.object({
      level: z.string(),
      label: z.string(),
      minReferrals: z.number().int().nonnegative(),
      bonusMultiplier: z.number().positive(),
    });
    const parsed = z.object({
      isEnabled: z.boolean().optional(),
      discountType: z.string().optional(),
      discountValue: z.number().optional(),
      bonusType: z.string().optional(),
      bonusValue: z.number().optional(),
      expirationDays: z.number().optional(),
      allowSelfReferral: z.boolean().optional(),
      requireFirstPurchase: z.boolean().optional(),
      shareMessage: z.string().optional(),
      tiersConfig: z.array(TierSchema).optional(),
      whatsappEnabled: z.boolean().optional(),
      whatsappPhoneNumber: z.string().optional(),
      whatsappConvertedMessage: z.string().optional(),
      whatsappBonusPaidMessage: z.string().optional(),
      whatsappReversedMessage: z.string().optional(),
      expiryWarning7DaysEnabled: z.boolean().optional(),
      expiryWarning1DayEnabled: z.boolean().optional(),
      bonusReleaseEmailEnabled: z.boolean().optional(),
      pointsPerReferral: z.number().int().min(0).optional(),
      loyaltyPointsEmailEnabled: z.boolean().optional(),
      gracePeriodDays: z.number().int().min(0).optional(),
      bonusValidityDays: z.number().int().min(0).optional(),
      discountExpirationDays: z.number().int().min(0).optional(),
      minPurchaseAmount: z.number().min(0).optional(),
      maxReferralsPerUser: z.number().int().min(0).optional(),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.isEnabled != null) updates.isEnabled = parsed.data.isEnabled;
    if (parsed.data.discountType) updates.discountType = parsed.data.discountType;
    if (parsed.data.discountValue != null) updates.discountValue = parsed.data.discountValue.toFixed(2);
    if (parsed.data.bonusType) updates.bonusType = parsed.data.bonusType;
    if (parsed.data.bonusValue != null) updates.bonusValue = parsed.data.bonusValue.toFixed(2);
    if (parsed.data.expirationDays != null) updates.expirationDays = parsed.data.expirationDays;
    if (parsed.data.allowSelfReferral != null) updates.allowSelfReferral = parsed.data.allowSelfReferral;
    if (parsed.data.requireFirstPurchase != null) updates.requireFirstPurchase = parsed.data.requireFirstPurchase;
    if (parsed.data.shareMessage !== undefined) updates.shareMessage = parsed.data.shareMessage;
    if (parsed.data.tiersConfig !== undefined) updates.tiersConfig = parsed.data.tiersConfig as ReferralTier[];
    if (parsed.data.whatsappEnabled != null) updates.whatsappEnabled = parsed.data.whatsappEnabled;
    if (parsed.data.whatsappPhoneNumber !== undefined) updates.whatsappPhoneNumber = parsed.data.whatsappPhoneNumber;
    if (parsed.data.whatsappConvertedMessage !== undefined) updates.whatsappConvertedMessage = parsed.data.whatsappConvertedMessage;
    if (parsed.data.whatsappBonusPaidMessage !== undefined) updates.whatsappBonusPaidMessage = parsed.data.whatsappBonusPaidMessage;
    if (parsed.data.whatsappReversedMessage !== undefined) updates.whatsappReversedMessage = parsed.data.whatsappReversedMessage;
    if (parsed.data.expiryWarning7DaysEnabled != null) updates.expiryWarning7DaysEnabled = parsed.data.expiryWarning7DaysEnabled;
    if (parsed.data.expiryWarning1DayEnabled != null) updates.expiryWarning1DayEnabled = parsed.data.expiryWarning1DayEnabled;
    if (parsed.data.bonusReleaseEmailEnabled != null) updates.bonusReleaseEmailEnabled = parsed.data.bonusReleaseEmailEnabled;
    if (parsed.data.pointsPerReferral != null) updates.pointsPerReferral = parsed.data.pointsPerReferral;
    if (parsed.data.loyaltyPointsEmailEnabled != null) updates.loyaltyPointsEmailEnabled = parsed.data.loyaltyPointsEmailEnabled;
    if (parsed.data.gracePeriodDays != null) updates.gracePeriodDays = parsed.data.gracePeriodDays;
    if (parsed.data.bonusValidityDays != null) updates.bonusValidityDays = parsed.data.bonusValidityDays;
    if (parsed.data.discountExpirationDays != null) updates.discountExpirationDays = parsed.data.discountExpirationDays;
    if (parsed.data.minPurchaseAmount != null) updates.minPurchaseAmount = parsed.data.minPurchaseAmount.toFixed(2);
    if (parsed.data.maxReferralsPerUser != null) updates.maxReferralsPerUser = parsed.data.maxReferralsPerUser;

    const [existing] = await db.select({
      id: referralSettingsTable.id,
      expirationDays: referralSettingsTable.expirationDays,
    }).from(referralSettingsTable).where(eq(referralSettingsTable.tenantId, me.tenantId)).limit(1);

    const expirationDaysChanged = parsed.data.expirationDays != null && (
      !existing || parsed.data.expirationDays !== existing.expirationDays
    );

    const savedSettings = await db.transaction(async (tx) => {
      let result: typeof referralSettingsTable.$inferSelect | undefined;
      if (!existing) {
        const id = generateId();
        await tx.insert(referralSettingsTable).values({
          id,
          tenantId: me.tenantId,
          isEnabled: (updates.isEnabled as boolean | undefined) ?? true,
          discountType: (updates.discountType as string | undefined) ?? "percentage",
          discountValue: (updates.discountValue as string | undefined) ?? "5.00",
          bonusType: (updates.bonusType as string | undefined) ?? "credit",
          bonusValue: (updates.bonusValue as string | undefined) ?? "10.00",
          expirationDays: (updates.expirationDays as number | undefined) ?? 30,
          allowSelfReferral: (updates.allowSelfReferral as boolean | undefined) ?? false,
          requireFirstPurchase: (updates.requireFirstPurchase as boolean | undefined) ?? true,
          shareMessage: (updates.shareMessage as string | undefined) ?? null,
          tiersConfig: (updates.tiersConfig as ReferralTier[] | undefined) ?? DEFAULT_TIERS_CONFIG,
          whatsappEnabled: (updates.whatsappEnabled as boolean | undefined) ?? false,
          whatsappPhoneNumber: (updates.whatsappPhoneNumber as string | undefined) ?? null,
          whatsappConvertedMessage: (updates.whatsappConvertedMessage as string | undefined) ?? null,
          whatsappBonusPaidMessage: (updates.whatsappBonusPaidMessage as string | undefined) ?? null,
          whatsappReversedMessage: (updates.whatsappReversedMessage as string | undefined) ?? null,
          expiryWarning7DaysEnabled: (updates.expiryWarning7DaysEnabled as boolean | undefined) ?? true,
          expiryWarning1DayEnabled: (updates.expiryWarning1DayEnabled as boolean | undefined) ?? true,
          bonusReleaseEmailEnabled: (updates.bonusReleaseEmailEnabled as boolean | undefined) ?? true,
          loyaltyPointsEmailEnabled: (updates.loyaltyPointsEmailEnabled as boolean | undefined) ?? true,
        });
        [result] = await tx.select().from(referralSettingsTable)
          .where(eq(referralSettingsTable.id, id)).limit(1);
      } else {
        await tx.update(referralSettingsTable).set(updates as Partial<typeof referralSettingsTable.$inferInsert>)
          .where(eq(referralSettingsTable.tenantId, me.tenantId));
        [result] = await tx.select().from(referralSettingsTable)
          .where(eq(referralSettingsTable.tenantId, me.tenantId)).limit(1);
      }

      if (expirationDaysChanged) {
        const newDays = parsed.data.expirationDays!;
        await tx.update(referralsTable)
          .set({
            expiresAt: sql`${referralsTable.createdAt} + (${newDays}::integer * interval '1 day')`,
            expiryWarning7SentAt: null,
            expiryWarning1SentAt: null,
            updatedAt: new Date(),
          })
          .where(and(
            eq(referralsTable.tenantId, me.tenantId),
            eq(referralsTable.status, REFERRAL_STATUS.PENDING),
          ));
      }

      return result;
    });

    res.json(savedSettings);
  } catch (err) {
    next(err);
  }
});

router.get("/referrals/commissions/report", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.VIEW)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const rows = await db.select({
      status: referralCommissionsTable.status,
      total: sql<string>`COALESCE(SUM(${referralCommissionsTable.amount}), 0)`,
      count: count(),
    }).from(referralCommissionsTable)
      .where(eq(referralCommissionsTable.tenantId, me.tenantId))
      .groupBy(referralCommissionsTable.status);
    const totals: Record<"pending" | "approved" | "paid", number> = { pending: 0, approved: 0, paid: 0 };
    const counts: Record<"pending" | "approved" | "paid", number> = { pending: 0, approved: 0, paid: 0 };
    for (const row of rows) {
      if (row.status in totals) {
        const status = row.status as keyof typeof totals;
        totals[status] = Number(row.total);
        counts[status] = Number(row.count);
      }
    }
    const entries = await db.select({
      id: referralCommissionsTable.id,
      referralId: referralCommissionsTable.referralId,
      campaignId: referralCommissionsTable.campaignId,
      recipientType: referralCommissionsTable.recipientType,
      recipientId: referralCommissionsTable.recipientId,
      amount: referralCommissionsTable.amount,
      basis: referralCommissionsTable.basis,
      status: referralCommissionsTable.status,
      approvedAt: referralCommissionsTable.approvedAt,
      paidAt: referralCommissionsTable.paidAt,
      reversedAt: referralCommissionsTable.reversedAt,
      createdAt: referralCommissionsTable.createdAt,
      partnerName: partnersTable.name,
      ambassadorName: clientsTable.name,
    }).from(referralCommissionsTable)
      .leftJoin(partnersTable, and(
        eq(referralCommissionsTable.recipientType, "partner"),
        eq(partnersTable.id, referralCommissionsTable.recipientId),
        eq(partnersTable.tenantId, me.tenantId),
      ))
      .leftJoin(clientsTable, and(
        eq(referralCommissionsTable.recipientType, "ambassador"),
        eq(clientsTable.id, referralCommissionsTable.recipientId),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(eq(referralCommissionsTable.tenantId, me.tenantId))
      .orderBy(desc(referralCommissionsTable.createdAt));
    const partnerTotals = new Map<string, { partnerId: string; partnerName: string; pending: number; approved: number; paid: number; reversed: number; total: number }>();
    for (const entry of entries) {
      if (entry.recipientType !== "partner") continue;
      const item = partnerTotals.get(entry.recipientId) ?? {
        partnerId: entry.recipientId,
        partnerName: entry.partnerName ?? "Parceiro removido",
        pending: 0, approved: 0, paid: 0, reversed: 0, total: 0,
      };
      const amount = Number(entry.amount);
      item.total += amount;
      if (entry.status in item) item[entry.status as "pending" | "approved" | "paid" | "reversed"] += amount;
      partnerTotals.set(entry.recipientId, item);
    }
    res.json({
      totals,
      counts,
      entries: entries.map(({ partnerName, ambassadorName, amount, ...entry }) => ({
        ...entry,
        amount: Number(amount),
        recipientName: partnerName ?? ambassadorName ?? "Beneficiário removido",
      })),
      partnerTotals: [...partnerTotals.values()],
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/referrals/commissions/:id/status", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.COMMISSIONS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = z.object({ status: z.enum(["approved", "paid", "reversed"]) }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const [commission] = await db.select().from(referralCommissionsTable)
      .where(and(eq(referralCommissionsTable.id, req.params.id), eq(referralCommissionsTable.tenantId, me.tenantId))).limit(1);
    if (!commission) { next(new NotFoundError("Comissão não encontrada", "NOT_FOUND")); return; }
    const allowed: Record<string, string[]> = {
      pending: ["approved", "reversed"],
      approved: ["paid", "reversed"],
      paid: [],
      reversed: [],
    };
    if (!allowed[commission.status]?.includes(parsed.data.status)) {
      next(new AppError("Transição de status da comissão não permitida", 422, "INVALID_STATUS_TRANSITION"));
      return;
    }
    const now = new Date();
    const updates: Record<string, unknown> = { status: parsed.data.status, updatedAt: now };
    if (parsed.data.status === "approved") updates.approvedAt = now;
    if (parsed.data.status === "paid") updates.paidAt = now;
    if (parsed.data.status === "reversed") updates.reversedAt = now;
    await db.update(referralCommissionsTable).set(updates)
      .where(and(eq(referralCommissionsTable.id, commission.id), eq(referralCommissionsTable.tenantId, me.tenantId)));
    const [updated] = await db.select().from(referralCommissionsTable)
      .where(and(eq(referralCommissionsTable.id, commission.id), eq(referralCommissionsTable.tenantId, me.tenantId))).limit(1);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.get("/referrals/campaigns", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.VIEW)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const campaigns = await db.select().from(referralCampaignsTable)
      .where(eq(referralCampaignsTable.tenantId, me.tenantId))
      .orderBy(desc(referralCampaignsTable.startsAt));

    if (campaigns.length === 0) { res.json([]); return; }

    // Single grouped query for all campaign stats to avoid N+1
    const statsRows = await db.select({
      campaignId: sql<string>`
        (SELECT c2.id FROM referral_campaigns c2
         WHERE c2.tenant_id = ${me.tenantId}
           AND ${referralsTable.convertedAt} >= c2.starts_at
           AND ${referralsTable.convertedAt} < c2.ends_at
         LIMIT 1)
      `,
      referralsCount: count(),
      bonusPaidAmount: sql<number>`COALESCE(SUM(${referralsTable.bonusAmount}) FILTER (WHERE ${referralsTable.bonusPaid} = true), 0)`,
    })
    .from(referralsTable)
    .where(and(
      eq(referralsTable.tenantId, me.tenantId),
      eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
      sql`EXISTS (
        SELECT 1 FROM referral_campaigns c2
        WHERE c2.tenant_id = ${me.tenantId}
          AND ${referralsTable.convertedAt} >= c2.starts_at
          AND ${referralsTable.convertedAt} < c2.ends_at
      )`,
    ))
    .groupBy(sql`
      (SELECT c2.id FROM referral_campaigns c2
       WHERE c2.tenant_id = ${me.tenantId}
         AND ${referralsTable.convertedAt} >= c2.starts_at
         AND ${referralsTable.convertedAt} < c2.ends_at
       LIMIT 1)
    `);

    const statsMap = new Map(statsRows.map((r) => [r.campaignId, r]));

    const result = campaigns.map((c) => {
      const stats = statsMap.get(c.id);
      return {
        ...c,
        bonusValue: Number(c.bonusValue),
        referralsCount: Number(stats?.referralsCount ?? 0),
        bonusPaidAmount: Number(stats?.bonusPaidAmount ?? 0),
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/referrals/campaigns", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const parsed = z.object({
      name: z.string().min(1).max(120),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      bonusType: CampaignBonusType,
      bonusValue: z.number().nonnegative(),
      bannerText: z.string().max(500).optional(),
    }).extend(CampaignConfig.shape).refine(
      (d) => d.bonusType !== "multiplier" || d.bonusValue >= 1,
      { message: "Multiplicador deve ser ≥ 1 para não reduzir o bônus base", path: ["bonusValue"] },
    ).refine(
      (d) => d.commissionType !== "none" || (d.commissionValue ?? 0) === 0,
      { message: "Comissão 'none' deve ter valor zero", path: ["commissionValue"] },
    ).refine(
      (d) => d.commissionType !== undefined && d.commissionType !== "none" ? (d.commissionValue ?? 0) > 0 : true,
      { message: "Comissão deve ser maior que zero", path: ["commissionValue"] },
    ).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }

    const starts = new Date(parsed.data.startsAt);
    const ends = new Date(parsed.data.endsAt);
    if (ends <= starts) {
      next(new ValidationError(String("endsAt deve ser após startsAt" ), "VALIDATION_ERROR")); return;
    }

    const [overlap] = await db.select({ id: referralCampaignsTable.id })
      .from(referralCampaignsTable)
      .where(and(
        eq(referralCampaignsTable.tenantId, me.tenantId),
        sql`${referralCampaignsTable.startsAt} < ${ends}`,
        sql`${referralCampaignsTable.endsAt} > ${starts}`,
      ))
      .limit(1);
    if (overlap) {
      next(new ConflictError("Já existe uma campanha nesse período. Apenas uma campanha pode estar ativa por vez.", "CONFLICT"));
      return;
    }

    const id = generateId();
    await db.insert(referralCampaignsTable).values({
      id,
      tenantId: me.tenantId,
      name: parsed.data.name,
      startsAt: starts,
      endsAt: ends,
      bonusType: parsed.data.bonusType,
      bonusValue: parsed.data.bonusValue.toFixed(4),
      bannerText: parsed.data.bannerText ?? null,
      eligibleStoreProductIds: parsed.data.eligibleStoreProductIds ?? [],
      eligibleTierLevels: parsed.data.eligibleTierLevels ?? [],
      conversionCap: parsed.data.conversionCap ?? null,
      budgetAmount: parsed.data.budgetAmount?.toFixed(2) ?? null,
      shareMessage: parsed.data.shareMessage ?? null,
      materialUrl: parsed.data.materialUrl ?? null,
      publicRanking: parsed.data.publicRanking ?? false,
      eligibleActivitySegments: parsed.data.eligibleActivitySegments ?? [],
      eligibleChannels: parsed.data.eligibleChannels?.map((channel) => channel.toLowerCase()) ?? [],
      commissionType: parsed.data.commissionType ?? "none",
      commissionValue: (parsed.data.commissionValue ?? 0).toFixed(4),
      commissionRecipientType: parsed.data.commissionRecipientType ?? "ambassador",
      eligiblePartnerIds: parsed.data.eligiblePartnerIds ?? [],
    });

    const [campaign] = await db.select().from(referralCampaignsTable)
      .where(eq(referralCampaignsTable.id, id)).limit(1);
    res.status(201).json({ ...campaign!, bonusValue: Number(campaign!.bonusValue) });
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "23P01") {
      next(new ConflictError("Já existe uma campanha nesse período. Apenas uma campanha pode estar ativa por vez.", "CONFLICT"));
      return;
    }
    next(err);
  }
});

router.delete("/referrals/campaigns/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [existing] = await db.select({ id: referralCampaignsTable.id })
      .from(referralCampaignsTable)
      .where(and(
        eq(referralCampaignsTable.id, req.params.id),
        eq(referralCampaignsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!existing) { next(new NotFoundError("Campanha não encontrada", "NOT_FOUND")); return; }

    await db.delete(referralCampaignsTable)
      .where(and(
        eq(referralCampaignsTable.id, req.params.id),
        eq(referralCampaignsTable.tenantId, me.tenantId),
      ));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.patch("/referrals/campaigns/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [existing] = await db.select().from(referralCampaignsTable)
      .where(and(
        eq(referralCampaignsTable.id, req.params.id),
        eq(referralCampaignsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!existing) { next(new NotFoundError("Campanha não encontrada", "NOT_FOUND")); return; }

    const parsed = z.object({
      name: z.string().min(1).max(120).optional(),
      startsAt: z.string().datetime().optional(),
      endsAt: z.string().datetime().optional(),
      bonusType: CampaignBonusType.optional(),
      bonusValue: z.number().nonnegative().optional(),
      bannerText: z.string().max(500).nullable().optional(),
    }).extend(CampaignConfig.shape).refine(
      (d) => {
        const effectiveType = d.bonusType ?? existing.bonusType;
        const effectiveVal = d.bonusValue ?? Number(existing.bonusValue);
        return effectiveType !== "multiplier" || effectiveVal >= 1;
      },
      { message: "Multiplicador deve ser ≥ 1 para não reduzir o bônus base", path: ["bonusValue"] },
    ).refine(
      (d) => {
        const type = d.commissionType ?? existing.commissionType;
        const value = d.commissionValue ?? Number(existing.commissionValue);
        return type === "none" ? value === 0 : value > 0;
      },
      { message: "Configuração de comissão inválida", path: ["commissionValue"] },
    ).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }

    const starts = parsed.data.startsAt ? new Date(parsed.data.startsAt) : new Date(existing.startsAt);
    const ends = parsed.data.endsAt ? new Date(parsed.data.endsAt) : new Date(existing.endsAt);
    if (ends <= starts) { next(new ValidationError(String("endsAt deve ser após startsAt" ), "VALIDATION_ERROR")); return; }

    const [overlap] = await db.select({ id: referralCampaignsTable.id })
      .from(referralCampaignsTable)
      .where(and(
        eq(referralCampaignsTable.tenantId, me.tenantId),
        sql`${referralCampaignsTable.id} != ${req.params.id}`,
        sql`${referralCampaignsTable.startsAt} < ${ends}`,
        sql`${referralCampaignsTable.endsAt} > ${starts}`,
      ))
      .limit(1);
    if (overlap) {
      next(new ConflictError("Já existe uma campanha nesse período. Apenas uma campanha pode estar ativa por vez.", "CONFLICT"));
      return;
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.startsAt !== undefined) updates.startsAt = starts;
    if (parsed.data.endsAt !== undefined) updates.endsAt = ends;
    if (parsed.data.bonusType !== undefined) updates.bonusType = parsed.data.bonusType;
    if (parsed.data.bonusValue !== undefined) updates.bonusValue = parsed.data.bonusValue.toFixed(4);
    if (parsed.data.bannerText !== undefined) updates.bannerText = parsed.data.bannerText;
    if (parsed.data.eligibleStoreProductIds !== undefined) updates.eligibleStoreProductIds = parsed.data.eligibleStoreProductIds;
    if (parsed.data.eligibleTierLevels !== undefined) updates.eligibleTierLevels = parsed.data.eligibleTierLevels;
    if (parsed.data.conversionCap !== undefined) updates.conversionCap = parsed.data.conversionCap;
    if (parsed.data.budgetAmount !== undefined) updates.budgetAmount = parsed.data.budgetAmount?.toFixed(2) ?? null;
    if (parsed.data.shareMessage !== undefined) updates.shareMessage = parsed.data.shareMessage;
    if (parsed.data.materialUrl !== undefined) updates.materialUrl = parsed.data.materialUrl;
    if (parsed.data.publicRanking !== undefined) updates.publicRanking = parsed.data.publicRanking;
    if (parsed.data.eligibleActivitySegments !== undefined) updates.eligibleActivitySegments = parsed.data.eligibleActivitySegments;
    if (parsed.data.eligibleChannels !== undefined) updates.eligibleChannels = parsed.data.eligibleChannels.map((channel) => channel.toLowerCase());
    if (parsed.data.commissionType !== undefined) updates.commissionType = parsed.data.commissionType;
    if (parsed.data.commissionValue !== undefined) updates.commissionValue = parsed.data.commissionValue.toFixed(4);
    if (parsed.data.commissionRecipientType !== undefined) updates.commissionRecipientType = parsed.data.commissionRecipientType;
    if (parsed.data.eligiblePartnerIds !== undefined) updates.eligiblePartnerIds = parsed.data.eligiblePartnerIds;

    await db.update(referralCampaignsTable)
      .set(updates)
      .where(and(
        eq(referralCampaignsTable.id, req.params.id),
        eq(referralCampaignsTable.tenantId, me.tenantId),
      ));

    const [updated] = await db.select().from(referralCampaignsTable)
      .where(eq(referralCampaignsTable.id, req.params.id)).limit(1);
    res.json({ ...updated!, bonusValue: Number(updated!.bonusValue) });
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr.code === "23P01") {
      next(new ConflictError("Já existe uma campanha nesse período. Apenas uma campanha pode estar ativa por vez.", "CONFLICT"));
      return;
    }
    next(err);
  }
});

router.get("/referrals/active-campaign", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ALL_STAFF_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const now = new Date();
    const [campaign] = await db.select().from(referralCampaignsTable)
      .where(and(
        eq(referralCampaignsTable.tenantId, me.tenantId),
        sql`${referralCampaignsTable.startsAt} <= ${now}`,
        sql`${referralCampaignsTable.endsAt} > ${now}`,
      ))
      .orderBy(desc(referralCampaignsTable.startsAt))
      .limit(1);

    if (!campaign) { res.json(null); return; }
    res.json({ ...campaign, bonusValue: Number(campaign.bonusValue) });
  } catch (err) {
    next(err);
  }
});

router.post("/referral-settings/whatsapp-test", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const parsed = z.object({
      phone: z.string().min(8),
      messageType: z.enum(["converted", "bonusPaid", "reversed", "share"]),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String("Parâmetros inválidos" ), "VALIDATION_ERROR")); return; }

    const [settings] = await db.select().from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, me.tenantId)).limit(1);

    const [tenant] = await db.select({ name: tenantsTable.name })
      .from(tenantsTable).where(eq(tenantsTable.id, me.tenantId)).limit(1);

    const agencyName = tenant?.name ?? "Agência";
    const bonusValue = parseFloat(String(settings?.bonusValue ?? "10")) || 10;
    const bonusValFormatted = bonusValue.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const bonusCurrencyFormatted = formatBRL(bonusValue);

    let message: string;
    const { messageType } = parsed.data;

    if (messageType === "converted") {
      const template = settings?.whatsappConvertedMessage ??
        "Boa notícia! {{nome}} usou seu código {{codigo}} e comprou com a {{agencia}}. Seu bônus de R$ {{valor}} está sendo processado.";
      message = interpolateWhatsAppMessage(template, { nome: "Maria Silva", codigo: "TESTE123", agencia: agencyName, valor: bonusValFormatted });
    } else if (messageType === "bonusPaid") {
      const template = settings?.whatsappBonusPaidMessage ??
        "Seu bônus de R$ {{valor}} foi pago! Obrigado por indicar clientes para a {{agencia}}.";
      message = interpolateWhatsAppMessage(template, { nome: "João Silva", codigo: "TESTE123", bonus: bonusCurrencyFormatted, valor: bonusValFormatted, agencia: agencyName });
    } else if (messageType === "reversed") {
      const template = settings?.whatsappReversedMessage ??
        "Olá! A reserva de {{nome}} foi cancelada e o bônus de R$ {{valor}} foi estornado do seu saldo na {{agencia}}. Seu saldo atual é R$ {{saldo}}.";
      message = interpolateWhatsAppMessage(template, { nome: "Maria Silva", valor: bonusValFormatted, agencia: agencyName, saldo: bonusValFormatted });
    } else {
      const template = settings?.shareMessage ?? "Use meu código de indicação e ganhe desconto na sua viagem!";
      message = template
        .replace(/\{\{?nome\}?\}/g, "João")
        .replace(/\{\{?codigo\}?\}/g, "TESTE123")
        .replace(/\{\{?link\}?\}/g, "https://exemplo.com.br/ind/TESTE123")
        .replace(/\{\{?bonus\}?\}/g, bonusCurrencyFormatted);
    }

    const deliveryResult = await dispatchOutboundMessage({
      tenantId: me.tenantId,
      eventType: "referral_test_whatsapp",
      idempotencyKey: `referral-test-whatsapp:${messageType}:${generateId()}`,
      recipient: { type: "direct", whatsapp: parsed.data.phone },
      whatsapp: { text: message },
      origin: "referral_settings_test",
      originChannel: "whatsapp",
      createdById: me.id,
    });
    const whatsappDelivery = deliveryResult.deliveries.find((delivery) => delivery.channel === "whatsapp");
    const result = {
      success: whatsappDelivery?.status === "pending" || whatsappDelivery?.status === "accepted",
      error: whatsappDelivery?.lastError ?? whatsappDelivery?.skippedReason ?? undefined,
    };

    if (!result.success) {
      const error = result.error ?? "unknown_error";
      let detail: string;
      if (error === "credentials_not_configured") {
        detail = "Credenciais Z-API não configuradas. Verifique as variáveis ZAPI_INSTANCE_ID e ZAPI_TOKEN.";
      } else if (error.startsWith("zapi_")) {
        detail = `Z-API retornou status ${error.replace("zapi_", "")}. Verifique se o número está correto e a instância está conectada.`;
      } else {
        detail = `Erro de rede: ${error}`;
      }
      next(new AppError(detail, 422, "WHATSAPP_SEND_FAILED"));
      return;
    }

    res.json({ success: true, phone: parsed.data.phone });
  } catch (err) {
    next(err);
  }
});

router.patch("/referrals/:id/reverse", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const parsed = z.object({
      reason: z.string().min(1, "Motivo é obrigatório"),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }

    const [existing] = await db.select({
      id: referralsTable.id,
      reservationId: referralsTable.reservationId,
      status: referralsTable.status,
      bonusPaid: referralsTable.bonusPaid,
      referrerId: referralsTable.referrerId,
      referredId: referralsTable.referredId,
      bonusAmount: referralsTable.bonusAmount,
    })
      .from(referralsTable)
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId)))
      .limit(1);

    if (!existing) { next(new NotFoundError("Indicação não encontrada", "NOT_FOUND")); return; }
    // Fast pre-flight: avoids opening a transaction for obvious 422 cases.
    // The authoritative check happens inside the transaction under a row lock.
    if (existing.status !== REFERRAL_STATUS.COMPLETED) {
      next(new AppError("Reversão manual só é permitida em indicações com status 'convertida'", 422, "UNPROCESSABLE"));
      return;
    }
    if (existing.bonusPaid) {
      next(new AppError(
        "Um bônus já pago não pode ser revertido por este fluxo.",
        422,
        "REFERRAL_PAID_REVERSAL",
      ));
      return;
    }

    const reversedInfo = await db.transaction(async (tx) => {
      // Lock the referral row first so concurrent duplicate requests serialize.
      const locked = await tx.execute(
        sql`SELECT id, status, bonus_paid, referrer_id, referred_id, bonus_amount FROM referrals WHERE id = ${existing.id} AND tenant_id = ${me.tenantId} FOR UPDATE`
      );
      const lockedRow = (locked.rows as Array<Record<string, unknown>>)[0];
      if (!lockedRow || lockedRow.status !== REFERRAL_STATUS.COMPLETED || lockedRow.bonus_paid === true) {
        // Already reversed by a concurrent request — abort without modifying balances.
        throw new AppError("Reversão manual só é permitida em indicações com status 'convertida'", 422, "UNPROCESSABLE");
      }

      const bonusToReverse = Number(lockedRow.bonus_amount ?? existing.bonusAmount);
      const referrerId = String(lockedRow.referrer_id ?? existing.referrerId);
      const referredId = (lockedRow.referred_id as string | null) ?? existing.referredId ?? null;
      const bonusAmountStr = String(lockedRow.bonus_amount ?? existing.bonusAmount ?? "0");

      // Lock the referrer's client row before modifying their balance.
      await tx.execute(
        sql`SELECT id FROM clients WHERE id = ${referrerId} AND tenant_id = ${me.tenantId} FOR UPDATE`
      );
      await tx.update(clientsTable)
        .set({
          successfulReferrals: sql`GREATEST(0, COALESCE(successful_referrals, 0) - 1)`,
          referralEarnings: sql`GREATEST(0, COALESCE(referral_earnings, 0) - ${bonusToReverse.toFixed(2)})`,
        })
        .where(and(
          eq(clientsTable.id, referrerId),
          eq(clientsTable.tenantId, me.tenantId),
        ));

      const reversalNow = new Date();
      await tx.update(referralsTable)
        .set({
          status: REFERRAL_STATUS.REVERSED,
          reversalReason: parsed.data.reason,
          reversalAt: reversalNow,
          updatedAt: reversalNow,
        })
        .where(and(
          eq(referralsTable.id, existing.id),
          eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
        ));
      await tx.update(referralCommissionsTable)
        .set({ status: "reversed", reversedAt: reversalNow, updatedAt: reversalNow })
        .where(and(
          eq(referralCommissionsTable.tenantId, me.tenantId),
          eq(referralCommissionsTable.referralId, existing.id),
          inArray(referralCommissionsTable.status, ["pending", "approved"]),
        ));

      return { referrerId, referredId, bonusAmountStr };
    });

    const { dispatchReferralReversedEmail } = await import("../queues/email-helpers.js");
    dispatchReferralReversedEmail({
      referrerId: reversedInfo.referrerId,
      referredId: reversedInfo.referredId,
      bonusAmount: reversedInfo.bonusAmountStr,
      tenantId: me.tenantId,
      reason: parsed.data.reason,
      referralId: existing.id,
      reservationId: existing.reservationId,
    }).catch(() => {});

    const [updated] = await db.select({
      ...getTableColumns(referralsTable),
      referrerClientName: clientsTable.name,
      referrerClientEmail: clientsTable.email,
      referrerClientWhatsapp: clientsTable.whatsapp,
      referrerClientPhone: clientsTable.phone,
    }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(and(eq(referralsTable.id, req.params.id), eq(referralsTable.tenantId, me.tenantId))).limit(1);

    if (!updated) { next(new NotFoundError("Not found", "NOT_FOUND")); return; }
    const { referrerClientName, referrerClientEmail, referrerClientWhatsapp, referrerClientPhone, ...rest } = updated;
    res.json({
      ...rest,
      referrerName: referrerClientName ?? rest.referrerName,
      referrerEmail: referrerClientEmail ?? rest.referrerEmail,
      referrerPhone: referrerClientPhone ?? rest.referrerPhone,
      referrerWhatsapp: referrerClientWhatsapp ?? null,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/referrals/:id/reverse-paid-bonus", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const parsed = z.object({
      reason: z.string().trim().min(1, "Motivo é obrigatório").max(1000),
      // Accept the names used by current clients while requiring an explicit
      // affirmative confirmation instead of treating a missing field as yes.
      confirmed: z.boolean().optional(),
      confirm: z.boolean().optional(),
      confirmation: z.boolean().optional(),
    }).superRefine((body, ctx) => {
      if (body.confirmed !== true && body.confirm !== true && body.confirmation !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["confirmed"],
          message: "Confirme o estorno financeiro para continuar",
        });
      }
    }).safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(String(parsed.error.message), "REFERRAL_REVERSAL_CONFIRMATION"));
      return;
    }

    const reversal = await reversePaidReferralBonus(
      req.params.id,
      me.tenantId,
      parsed.data.reason,
      me.id,
    );

    if (!reversal.alreadyReversed) {
      const { dispatchReferralReversedEmail } = await import("../queues/email-helpers.js");
      dispatchReferralReversedEmail({
        referrerId: reversal.referrerId,
        referredId: reversal.referredId,
        bonusAmount: reversal.bonusAmount,
        tenantId: me.tenantId,
        reason: parsed.data.reason,
        referralId: reversal.referralId,
        reservationId: reversal.reservationId,
      }).catch((err) => req.log?.warn?.({ err }, "Falha ao notificar estorno de bônus"));
    }

    const [updated] = await db.select({
      ...getTableColumns(referralsTable),
      referrerClientName: clientsTable.name,
      referrerClientEmail: clientsTable.email,
      referrerClientWhatsapp: clientsTable.whatsapp,
      referrerClientPhone: clientsTable.phone,
    }).from(referralsTable)
      .leftJoin(clientsTable, and(
        eq(referralsTable.referrerId, clientsTable.id),
        eq(clientsTable.tenantId, me.tenantId),
      ))
      .where(and(
        eq(referralsTable.id, req.params.id),
        eq(referralsTable.tenantId, me.tenantId),
      ))
      .limit(1);
    if (!updated) { next(new NotFoundError("Indicação não encontrada", "NOT_FOUND")); return; }

    const { referrerClientName, referrerClientEmail, referrerClientWhatsapp, referrerClientPhone, ...rest } = updated;
    res.json({
      ...rest,
      reversal: {
        id: reversal.reversalId,
        amount: reversal.bonusAmount,
        reason: reversal.reason,
        alreadyApplied: reversal.alreadyReversed,
      },
      referrerName: referrerClientName ?? rest.referrerName,
      referrerEmail: referrerClientEmail ?? rest.referrerEmail,
      referrerPhone: referrerClientPhone ?? rest.referrerPhone,
      referrerWhatsapp: referrerClientWhatsapp ?? null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
