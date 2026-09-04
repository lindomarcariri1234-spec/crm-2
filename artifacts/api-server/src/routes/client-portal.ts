import { Router, type NextFunction } from "express";
import { computeReferralTier } from "../lib/referral-tiers";
import { calculateReferralWallet } from "../lib/referral-wallet";
import { localToday } from "@workspace/shared";
import { db } from "@workspace/db";
import {
  clientsTable,
  reservationsTable,
  passengersTable,
  tripsTable,
  usersTable,
  referralsTable,
  referralSettingsTable,
  referralCampaignsTable,
  tenantsTable,
  loyaltyProgramsTable,
  loyaltyMembersTable,
  loyaltyTransactionsTable,
  clientNotificationsTable,
  clientNpsResponsesTable,
  clientFavoritesTable,
  storeProductsTable,
  storesTable,
  tripMediaTable,
  clientAchievementsTable,
  clientDreamDestinationsTable,
  financialLedgerEntriesTable,
  storeOrdersTable,
  paymentsTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql, inArray, gt, count, isNull, lt, or } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, MANAGEMENT_ROLES } from "../lib/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { ROLES, REFERRAL_STATUS, RESERVATION_STATUS } from "@workspace/permissions";
import { generateVoucherPdf } from "../lib/voucher-pdf";
import { getPdfQueue } from "../queues/index";
import { generateId, generateReferralCode } from "../lib/id";
import { generateAndAssignReferralCode } from "../lib/referral-code";
import { dispatchReferralWelcomeEmail } from "../queues/email-helpers";
import { addClientSseConnection, removeClientSseConnection } from "../lib/client-sse";
import { getRecentNotifications, getUnreadCount, markAllRead } from "../lib/client-notifications";
import { areWorkersEnabled } from "../lib/redis";
import { logger } from "../lib/logger";
import { expireClientBenefits, getClientBenefitBalances } from "../services/settlements/financial-ledger";
import { clerkClient } from "@clerk/express";
import { normalizeCpfInput, reconcileClientIdentity } from "../services/client-identity";
import {
  calculateReceivedAmount,
  allocateOrderReceiptToReservation,
  orderFinancialSummary,
  reservationFinancialSummary,
} from "../lib/linked-data";

const router = Router();

async function findClientRecord(
  tenantId: string,
  userId: string,
  email: string,
  clerkId: string,
  cpf?: string | null,
) {
  let [client] = await db
    .select()
    .from(clientsTable)
    .where(and(eq(clientsTable.tenantId, tenantId), eq(clientsTable.userId, userId)))
    .limit(1);

  if (!client) {
    if (cpf) {
      const identity = await db.transaction((tx) =>
        reconcileClientIdentity(tx, {
          tenantId,
          userId,
          cpf,
          email,
        }),
      );
      if (identity.clientId) {
        [client] = await db
          .select()
          .from(clientsTable)
          .where(and(
            eq(clientsTable.id, identity.clientId),
            eq(clientsTable.tenantId, tenantId),
          ))
          .limit(1);
      }
    }
  }

  if (!client) {
    let verifiedEmail: string | undefined;
    try {
      const clerkUser = await clerkClient.users.getUser(clerkId);
      const primaryEmail = clerkUser.emailAddresses.find(
        (address) => address.id === clerkUser.primaryEmailAddressId,
      );
      if (primaryEmail?.verification?.status === "verified") {
        verifiedEmail = primaryEmail.emailAddress;
      }
    } catch (error) {
      logger.warn({ error, clerkId }, "Could not verify Clerk email for client fallback");
    }

    if (
      !verifiedEmail
      || verifiedEmail.trim().toLowerCase() !== email.trim().toLowerCase()
    ) return null;

    const linkedClient = await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(lower(btrim(${verifiedEmail})), 0)
        )
      `);

      const matches = await tx
        .select()
        .from(clientsTable)
        .where(and(
          eq(clientsTable.tenantId, tenantId),
          sql`lower(btrim(${clientsTable.email})) = lower(btrim(${verifiedEmail}))`,
        ))
        .limit(2);

      if (matches.length !== 1) return null;
      const [match] = matches;

      if (match.userId && match.userId !== userId) return null;
      if (match.userId === userId) return match;

      const [claimed] = await tx
        .update(clientsTable)
        .set({ userId })
        .where(and(
          eq(clientsTable.id, match.id),
          eq(clientsTable.tenantId, tenantId),
          isNull(clientsTable.userId),
        ))
        .returning({ id: clientsTable.id });
      return claimed ? { ...match, userId } : null;
    });
    if (!linkedClient) return null;
    client = linkedClient;
  }

  return client ?? null;
}

router.get("/client/me", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }

    const [user] = await db
      .select({
        id: usersTable.id,
        name: usersTable.name,
        email: usersTable.email,
        cpf: usersTable.cpf,
        referralCode: usersTable.referralCode,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(eq(usersTable.id, me.id))
      .limit(1);

    const [tenant] = await db
      .select({
        id: tenantsTable.id,
        name: tenantsTable.name,
        slug: tenantsTable.slug,
        logoUrl: tenantsTable.logoUrl,
        primaryColor: tenantsTable.primaryColor,
        settings: tenantsTable.settings,
      })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, me.tenantId))
      .limit(1);

    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId, user?.cpf);

    let reservations: unknown[] = [];
    let referralStats: {
      code: string | null;
      referralCodeStatus: string;
      totalReferrals: number;
      completedReferrals: number;
      pendingReferrals: number;
      totalEarnings: string;
      creditBalance: string;
      shareMessage: string | null;
      currentTierLevel: string;
      currentTierLabel: string;
      currentTierMultiplier: number;
      tierProgress: number;
      nextTierMin: number | null;
      nextTierLabel: string | null;
       nextTierRemaining: number | null;
       nextTierMultiplier: number | null;
      pointsPerReferral: number;
      bonusValidityDays: number;
       wallet: {
         availableCredit: number;
         pendingCredit: number;
         usedCredit: number;
         expiringCredit: number;
         expiringOn: string | null;
       };
    } = {
      code: client?.referralCode ?? null,
      referralCodeStatus: client?.referralCodeStatus ?? "active",
      totalReferrals: 0,
      completedReferrals: 0,
      pendingReferrals: 0,
      totalEarnings: "0.00",
      creditBalance: "0.00",
      shareMessage: null,
      currentTierLevel: "bronze",
      currentTierLabel: "Bronze",
      currentTierMultiplier: 1,
      tierProgress: 0,
      nextTierMin: 5,
      nextTierLabel: "Prata",
       nextTierRemaining: 5,
       nextTierMultiplier: 1.25,
      pointsPerReferral: 0,
      bonusValidityDays: 30,
       wallet: {
         availableCredit: 0,
         pendingCredit: 0,
         usedCredit: 0,
         expiringCredit: 0,
         expiringOn: null,
       },
    };
    let stats = { totalSpent: 0 };
    let loyalty: unknown = null;

    if (client) {
      // Auto-generate and persist a referral code if the client doesn't have one yet.
      // This ensures the code shared via the landing page is always findable in
      // clientsTable by /public/store/:slug/referral/info and /referral/validate.
      let resolvedReferralCode = client.referralCode;
      if (!resolvedReferralCode) {
        try {
          const year = Number(localToday().slice(0, 4)); // Brazil calendar year
          const namePart = (client.name ?? "REF").replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4) || "REF";
          const baseCode = generateReferralCode(client.name ?? "REF", me.tenantId);
          resolvedReferralCode = await generateAndAssignReferralCode(client.id, me.tenantId, baseCode, namePart, year);

          if (resolvedReferralCode) {
            dispatchReferralWelcomeEmail({
              clientId: client.id,
              referralCode: resolvedReferralCode,
              tenantId: me.tenantId,
              tenantSlug: tenant?.slug ?? undefined,
            }).catch((err: unknown) => {
              logger.warn({ err }, "[client-portal] Failed to dispatch referral welcome email");
            });
          }
        } catch {
          // Non-critical — the client portal still loads; the share button will be hidden until next visit resolves
        }
      }

      const rows = await db
        .select({
          id: reservationsTable.id,
          tripId: reservationsTable.tripId,
          reservationNumber: reservationsTable.reservationNumber,
          status: reservationsTable.status,
          voucherCode: reservationsTable.voucherCode,
          totalValue: reservationsTable.totalValue,
          paidValue: reservationsTable.paidValue,
          balance: reservationsTable.balance,
          depositAmount: reservationsTable.depositAmount,
          discountTotal: reservationsTable.discountTotal,
          storeOrderId: reservationsTable.storeOrderId,
          paymentMethod: reservationsTable.paymentMethod,
          createdAt: reservationsTable.createdAt,
          seats: reservationsTable.seats,
          boardingLocationId: reservationsTable.boardingLocationId,
          tripName: tripsTable.name,
          tripDestination: tripsTable.destination,
          tripDepartureDate: tripsTable.departureDate,
          tripReturnDate: tripsTable.returnDate,
          tripType: tripsTable.type,
          tripBoardingPoints: tripsTable.boardingPoints,
        })
        .from(reservationsTable)
        .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
        .where(
          and(
            eq(reservationsTable.clientId, client.id),
            eq(reservationsTable.tenantId, me.tenantId),
          ),
        )
        .orderBy(asc(tripsTable.departureDate), desc(reservationsTable.createdAt));

      const reservationIds = rows.map((r) => r.id);
      const orderNumbers = [...new Set(rows.map(r => r.storeOrderId).filter((value): value is string => !!value))];
      const orders = orderNumbers.length
        ? await db.select().from(storeOrdersTable).where(and(
          eq(storeOrdersTable.tenantId, me.tenantId),
          inArray(storeOrdersTable.orderNumber, orderNumbers),
        ))
        : [];
      const orderMap = new Map(orders.map(order => [order.orderNumber, order]));
      const paymentRows = reservationIds.length || orders.length
        ? await db.select({
          id: paymentsTable.id,
          orderId: paymentsTable.orderId,
          reservationId: paymentsTable.reservationId,
          amount: paymentsTable.amount,
          status: paymentsTable.status,
          type: paymentsTable.type,
        }).from(paymentsTable).where(and(
          eq(paymentsTable.tenantId, me.tenantId),
          or(
            ...(reservationIds.length ? [inArray(paymentsTable.reservationId, reservationIds)] : []),
            ...(orders.length ? [inArray(paymentsTable.orderId, orders.map(order => order.id))] : []),
          ),
        ))
        : [];
      let npsSubmittedSet = new Set<string>();
      if (reservationIds.length > 0) {
        const npsRows = await db
          .select({ reservationId: clientNpsResponsesTable.reservationId })
          .from(clientNpsResponsesTable)
          .where(inArray(clientNpsResponsesTable.reservationId, reservationIds));
        npsSubmittedSet = new Set(npsRows.map((r) => r.reservationId));
      }

      reservations = rows.map((r) => {
        const siblingRows = r.storeOrderId ? rows.filter(row => row.storeOrderId === r.storeOrderId) : [r];
        const order = r.storeOrderId ? orderMap.get(r.storeOrderId) : undefined;
        const summary = order && siblingRows.length === 1
          ? orderFinancialSummary(
            order,
            calculateReceivedAmount(order.id, siblingRows.map(row => row.id), paymentRows),
            paymentRows,
            r,
            siblingRows.map(row => row.id),
          )
          : reservationFinancialSummary(
            r,
            order
              ? allocateOrderReceiptToReservation(
                calculateReceivedAmount(order.id, siblingRows.map(row => row.id), paymentRows),
                order.totalAmount,
                r.totalValue,
                r.id,
                siblingRows,
              )
              : calculateReceivedAmount("", [r.id], paymentRows),
            paymentRows,
            order,
          );
        const boardingPoints = Array.isArray(r.tripBoardingPoints) ? r.tripBoardingPoints : [];
        const boardingPoint = r.boardingLocationId
          ? boardingPoints.find((bp: { id: string; name: string; time: string; address: string }) => bp.id === r.boardingLocationId)
          : null;
        return {
          ...r,
          totalValue: summary.totalAmount,
          paidValue: summary.paidAmount,
          balance: summary.amountRemaining,
          financialSummary: summary,
          seatsCount: Array.isArray(r.seats) ? r.seats.length : 0,
          seats: undefined,
          boardingLocationId: undefined,
          tripBoardingPoints: undefined,
          boardingPointName: boardingPoint?.name ?? null,
          boardingPointTime: boardingPoint?.time ?? null,
          tripDepartureDate: r.tripDepartureDate
            ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(r.tripDepartureDate as unknown as Date)
            : null,
          tripReturnDate: r.tripReturnDate
            ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(r.tripReturnDate as unknown as Date)
            : null,
          createdAt: r.createdAt.toISOString(),
          npsSubmitted: npsSubmittedSet.has(r.id),
        };
      });

      const paidIds = new Set<string>();
      const totalSpent = paymentRows.reduce((sum, payment) => {
        if (paidIds.has(payment.id) || payment.type !== "receivable" || payment.status !== "paid") return sum;
        paidIds.add(payment.id);
        return sum + Number(payment.amount);
      }, 0);
      stats = { totalSpent: Math.round(totalSpent * 100) / 100 };

      const refRows = await db
        .select({
          status: referralsTable.status,
          cnt: sql<number>`COUNT(*)`,
          total: sql<string>`COALESCE(SUM(bonus_amount), '0')`,
        })
        .from(referralsTable)
        .where(
          and(
            eq(referralsTable.tenantId, me.tenantId),
            eq(referralsTable.referrerId, client.id),
          ),
        )
        .groupBy(referralsTable.status);

      let totalReferrals = 0;
      let completedReferrals = 0;
      let pendingReferrals = 0;
      let totalEarnings = 0;

      for (const row of refRows) {
        totalReferrals += Number(row.cnt);
        if (row.status === REFERRAL_STATUS.COMPLETED || row.status === REFERRAL_STATUS.CONVERTED) {
          completedReferrals += Number(row.cnt);
          totalEarnings += Number(row.total);
        }
        if (row.status === REFERRAL_STATUS.PENDING) pendingReferrals = Number(row.cnt);
      }

      const [refSettings] = await db
        .select({
          shareMessage: referralSettingsTable.shareMessage,
          tiersConfig: referralSettingsTable.tiersConfig,
          pointsPerReferral: referralSettingsTable.pointsPerReferral,
          bonusValidityDays: referralSettingsTable.bonusValidityDays,
          gracePeriodDays: referralSettingsTable.gracePeriodDays,
        })
        .from(referralSettingsTable)
        .where(eq(referralSettingsTable.tenantId, me.tenantId))
        .limit(1);

      const walletRows = await db
        .select({
          status: referralsTable.status,
          bonusAmount: referralsTable.bonusAmount,
          bonusPaid: referralsTable.bonusPaid,
          bonusCreditUsedAmount: referralsTable.bonusCreditUsedAmount,
          convertedAt: referralsTable.convertedAt,
          expiresAt: referralsTable.expiresAt,
        })
        .from(referralsTable)
        .where(
          and(
            eq(referralsTable.tenantId, me.tenantId),
            eq(referralsTable.referrerId, client.id),
          ),
        );
      const referralWallet = calculateReferralWallet(
        walletRows,
        refSettings?.gracePeriodDays ?? 30,
      );

      const { tier: currentTier, nextTier, progress: tierProgress } = computeReferralTier(
        completedReferrals,
        refSettings?.tiersConfig ?? null,
      );

      referralStats = {
        code: resolvedReferralCode ?? null,
        referralCodeStatus: client.referralCodeStatus ?? "active",
        totalReferrals,
        completedReferrals,
        pendingReferrals,
        totalEarnings: totalEarnings.toFixed(2),
        creditBalance: referralWallet.availableCredit.toFixed(2),
        shareMessage: refSettings?.shareMessage ?? null,
        currentTierLevel: currentTier.level,
        currentTierLabel: currentTier.label,
        currentTierMultiplier: currentTier.bonusMultiplier,
        tierProgress,
        nextTierMin: nextTier?.minReferrals ?? null,
        nextTierLabel: nextTier?.label ?? null,
        nextTierRemaining: nextTier
          ? Math.max(0, nextTier.minReferrals - completedReferrals)
          : null,
        nextTierMultiplier: nextTier?.bonusMultiplier ?? null,
        pointsPerReferral: refSettings?.pointsPerReferral ?? 0,
        bonusValidityDays: refSettings?.bonusValidityDays ?? 30,
        wallet: {
          ...referralWallet,
          expiringOn: referralWallet.expiringOn?.toISOString() ?? null,
        },
      };

      const [loyaltyProgram] = await db
        .select()
        .from(loyaltyProgramsTable)
        .where(
          and(
            eq(loyaltyProgramsTable.tenantId, me.tenantId),
            eq(loyaltyProgramsTable.isActive, true),
          ),
        )
        .limit(1);

      if (loyaltyProgram) {
        const [member] = await db
          .select()
          .from(loyaltyMembersTable)
          .where(
            and(
              eq(loyaltyMembersTable.tenantId, me.tenantId),
              eq(loyaltyMembersTable.programId, loyaltyProgram.id),
              eq(loyaltyMembersTable.clientId, client.id),
            ),
          )
          .limit(1);

        if (member) {
          const transactions = await db
            .select()
            .from(loyaltyTransactionsTable)
            .where(eq(loyaltyTransactionsTable.memberId, member.id))
            .orderBy(desc(loyaltyTransactionsTable.createdAt))
            .limit(20);

          loyalty = {
            availablePoints: member.availablePoints,
            totalPoints: member.totalPoints,
            tier: member.tier,
            programName: loyaltyProgram.name,
            pointsPerReal: Number(loyaltyProgram.pointsPerReal),
            realPerPoint: Number(loyaltyProgram.realPerPoint),
            minRedeemPoints: loyaltyProgram.minRedeemPoints,
            tierBenefits: loyaltyProgram.tierBenefits ?? null,
            recentTransactions: transactions.map((t) => ({
              id: t.id,
              type: t.type,
              points: t.points,
              description: t.description,
              createdAt: t.createdAt.toISOString(),
            })),
          };
        } else {
          loyalty = {
            availablePoints: 0,
            totalPoints: 0,
            tier: "bronze",
            programName: loyaltyProgram.name,
            pointsPerReal: Number(loyaltyProgram.pointsPerReal),
            realPerPoint: Number(loyaltyProgram.realPerPoint),
            minRedeemPoints: loyaltyProgram.minRedeemPoints,
            tierBenefits: loyaltyProgram.tierBenefits ?? null,
            recentTransactions: [],
          };
        }
      }
    }

    res.json({
      user: user
        ? {
            id: user.id,
            name: user.name,
            email: user.email,
            cpf: user.cpf,
            referralCode: user.referralCode,
            createdAt: user.createdAt?.toISOString() ?? null,
          }
        : null,
      client: client
        ? {
            id: client.id,
            name: client.name,
            email: client.email,
            phone: client.phone,
            cpf: client.cpf,
            birthDate: client.birthDate
              ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(client.birthDate as unknown as Date)
              : null,
            addressCity: client.addressCity,
            addressState: client.addressState,
            referralCode: client.referralCode,
            musicalPreferences: client.musicalPreferences ?? null,
            favoriteDrink: client.favoriteDrink ?? null,
            dreamDestinations: client.dreamDestinations ?? [],
            foodPreferences: client.foodPreferences ?? null,
            travelPreference: client.travelPreference ?? null,
            travelInterests: client.travelInterests ?? [],
            likesPhotosVideos: client.likesPhotosVideos ?? null,
            preferredDestinationTypes: client.preferredDestinationTypes ?? [],
            ambassadorOptIn: client.ambassadorOptIn ?? false,
            customerCode: client.customerCode ?? null,
          }
        : null,
      tenant: tenant
        ? {
            id: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            logoUrl: tenant.logoUrl,
            primaryColor: tenant.primaryColor ?? "#3B82F6",
            npsCategories: (tenant.settings as Record<string, unknown> | null)?.npsCategories ?? null,
          }
        : null,
      reservations,
      referral: referralStats,
      stats,
      loyalty,
    });
  } catch (err) {
    next(err);
  }
});

router.patch("/client/me/preferences", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }
    const body = z.object({
      musicalPreferences: z.string().max(500).nullable().optional(),
      favoriteDrink: z.string().max(200).nullable().optional(),
      dreamDestinations: z.array(z.string().max(200)).max(20).optional(),
      foodPreferences: z.string().max(500).nullable().optional(),
      birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      travelInterests: z.array(z.string().max(100)).max(20).optional(),
      likesPhotosVideos: z.boolean().nullable().optional(),
      preferredDestinationTypes: z.array(z.string().max(100)).max(20).optional(),
      travelPreference: z.string().max(200).nullable().optional(),
    }).safeParse(req.body);
    if (!body.success) {
      next(new ValidationError(String(body.error.message)));
      return;
    }
    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) {
      next(new NotFoundError("Perfil de cliente não encontrado", "NOT_FOUND"));
      return;
    }
    const updates: Record<string, unknown> = {};
    if (body.data.musicalPreferences !== undefined) updates.musicalPreferences = body.data.musicalPreferences;
    if (body.data.favoriteDrink !== undefined) updates.favoriteDrink = body.data.favoriteDrink;
    if (body.data.dreamDestinations !== undefined) updates.dreamDestinations = body.data.dreamDestinations;
    if (body.data.foodPreferences !== undefined) updates.foodPreferences = body.data.foodPreferences;
    if (body.data.birthDate !== undefined) {
      updates.birthDate = body.data.birthDate ? new Date(body.data.birthDate) : null;
    }
    if (body.data.travelInterests !== undefined) updates.travelInterests = body.data.travelInterests;
    if (body.data.likesPhotosVideos !== undefined) updates.likesPhotosVideos = body.data.likesPhotosVideos;
    if (body.data.preferredDestinationTypes !== undefined) updates.preferredDestinationTypes = body.data.preferredDestinationTypes;
    if (body.data.travelPreference !== undefined) updates.travelPreference = body.data.travelPreference;

    if (Object.keys(updates).length > 0) {
      await db
        .update(clientsTable)
        .set(updates)
        .where(and(eq(clientsTable.id, client.id), eq(clientsTable.tenantId, me.tenantId)));
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.patch("/client/me/ambassador", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }
    const body = z.object({ ambassadorOptIn: z.boolean() }).safeParse(req.body);
    if (!body.success) {
      next(new ValidationError(String(body.error.message)));
      return;
    }
    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) {
      next(new NotFoundError("Perfil de cliente não encontrado", "NOT_FOUND"));
      return;
    }
    await db
      .update(clientsTable)
      .set({ ambassadorOptIn: body.data.ambassadorOptIn })
      .where(and(eq(clientsTable.id, client.id), eq(clientsTable.tenantId, me.tenantId)));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// Must match calculateTier() in loyalty-helpers.ts and TIER_CONFIG in perfil/index.tsx
const LOYALTY_TIER_THRESHOLDS = [
  { tier: "bronze", min: 0,    next: 500,  nextLabel: "Prata"    },
  { tier: "silver", min: 500,  next: 1500, nextLabel: "Ouro"     },
  { tier: "gold",   min: 1500, next: 5000, nextLabel: "Diamante" },
  { tier: "diamond",min: 5000, next: null, nextLabel: null       },
] as const;

router.get("/client/me/loyalty", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }

    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) { res.json(null); return; }

    const [loyaltyProgram] = await db
      .select()
      .from(loyaltyProgramsTable)
      .where(and(eq(loyaltyProgramsTable.tenantId, me.tenantId), eq(loyaltyProgramsTable.isActive, true)))
      .limit(1);

    if (!loyaltyProgram) { res.json(null); return; }

    const [member] = await db
      .select()
      .from(loyaltyMembersTable)
      .where(and(
        eq(loyaltyMembersTable.tenantId, me.tenantId),
        eq(loyaltyMembersTable.programId, loyaltyProgram.id),
        eq(loyaltyMembersTable.clientId, client.id),
      ))
      .limit(1);

    const totalPoints = member?.totalPoints ?? 0;
    const currentTierKey = member?.tier ?? "bronze";
    const tierInfo = LOYALTY_TIER_THRESHOLDS.find((t) => t.tier === currentTierKey) ?? LOYALTY_TIER_THRESHOLDS[0];
    const pointsToNext = tierInfo.next !== null ? Math.max(tierInfo.next - totalPoints, 0) : 0;

    res.json({
      availablePoints: member?.availablePoints ?? 0,
      totalPoints,
      tier: currentTierKey,
      nextTier: tierInfo.nextLabel,
      pointsToNext,
      programName: loyaltyProgram.name,
      pointsPerReal: Number(loyaltyProgram.pointsPerReal),
      realPerPoint: Number(loyaltyProgram.realPerPoint),
      minRedeemPoints: loyaltyProgram.minRedeemPoints,
      tierBenefits: loyaltyProgram.tierBenefits ?? null,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/client/me/loyalty/transactions", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) {
      res.json({ data: [], hasMore: false, total: 0 });
      return;
    }

    const [loyaltyProgram] = await db
      .select({ id: loyaltyProgramsTable.id })
      .from(loyaltyProgramsTable)
      .where(and(eq(loyaltyProgramsTable.tenantId, me.tenantId), eq(loyaltyProgramsTable.isActive, true)))
      .limit(1);

    if (!loyaltyProgram) {
      res.json({ data: [], hasMore: false, total: 0 });
      return;
    }

    const [member] = await db
      .select({ id: loyaltyMembersTable.id, availablePoints: loyaltyMembersTable.availablePoints })
      .from(loyaltyMembersTable)
      .where(and(
        eq(loyaltyMembersTable.tenantId, me.tenantId),
        eq(loyaltyMembersTable.programId, loyaltyProgram.id),
        eq(loyaltyMembersTable.clientId, client.id),
      ))
      .limit(1);

    if (!member) {
      res.json({ data: [], hasMore: false, total: 0 });
      return;
    }

    const [totalRow] = await db
      .select({ cnt: count() })
      .from(loyaltyTransactionsTable)
      .where(eq(loyaltyTransactionsTable.memberId, member.id));
    const total = Number(totalRow?.cnt ?? 0);

    // Fetch with running balance: balance AFTER each transaction.
    // Earn/bonus transactions add to balance (+points), redeem/expire subtract (-points).
    // running_balance(T) = availablePoints - SUM(signed_delta) of all transactions newer than T.
    const rows = await db.execute(
      sql`SELECT
          t.id, t.type, t.points, t.description, t.reference_id, t.reference_type, t.created_at,
          (${member.availablePoints} - COALESCE((
            SELECT SUM(CASE WHEN lt2.type IN ('redeem', 'expire') THEN -lt2.points ELSE lt2.points END)
            FROM loyalty_transactions lt2
            WHERE lt2.member_id = ${member.id} AND lt2.created_at > t.created_at
          ), 0)) AS running_balance
        FROM loyalty_transactions t
        WHERE t.member_id = ${member.id}
        ORDER BY t.created_at DESC
        LIMIT ${limit} OFFSET ${offset}`
    );

    res.json({
      data: (rows.rows as Record<string, unknown>[]).map((t) => ({
        id: t.id as string,
        type: t.type as string,
        points: Number(t.points),
        description: t.description as string,
        referenceId: t.reference_id as string | null,
        referenceType: t.reference_type as string | null,
        runningBalance: Number(t.running_balance),
        createdAt: t.created_at instanceof Date
          ? t.created_at.toISOString()
          : String(t.created_at),
      })),
      hasMore: offset + limit < total,
      total,
    });
  } catch (err) {
    next(err);
  }
});

// Wallet and cashback deliberately use the financial ledger, not the loyalty
// points ledger. Reading a statement also records any expired credits as an
// immutable compensating entry before the balance is calculated.
router.get("/client/me/benefits", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }
    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) {
      res.json({ balances: { wallet: 0, cashback: 0 }, data: [] });
      return;
    }

    let balances = { wallet: 0, cashback: 0 };
    await db.transaction(async (tx) => {
      await expireClientBenefits(tx as never, { tenantId: me.tenantId, clientId: client.id });
      balances = await getClientBenefitBalances(tx as never, { tenantId: me.tenantId, clientId: client.id });
    });
    const entries = await db.select().from(financialLedgerEntriesTable)
      .where(and(
        eq(financialLedgerEntriesTable.tenantId, me.tenantId),
        eq(financialLedgerEntriesTable.clientId, client.id),
      ))
      .orderBy(desc(financialLedgerEntriesTable.occurredAt))
      .limit(100);
    res.json({
      balances,
      data: entries
        .filter((entry) => entry.category === "wallet" || entry.category === "cashback")
        .map((entry) => ({
          ...entry,
          amount: Number(entry.amount),
          occurredAt: entry.occurredAt.toISOString(),
          expiresAt: entry.expiresAt?.toISOString() ?? null,
        })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/client/me/loyalty/redeem", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }

    const body = z.object({
      reservationId: z.string().min(1),
      pointsToRedeem: z.number().int().positive(),
    }).safeParse(req.body);
    if (!body.success) {
      next(new ValidationError(String(body.error.message)));
      return;
    }

    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) {
      next(new NotFoundError("Perfil de cliente não encontrado", "NOT_FOUND"));
      return;
    }

    const [reservation] = await db
      .select({
        id: reservationsTable.id,
        reservationNumber: reservationsTable.reservationNumber,
        totalValue: reservationsTable.totalValue,
        paidValue: reservationsTable.paidValue,
        status: reservationsTable.status,
      })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.id, body.data.reservationId),
        eq(reservationsTable.clientId, client.id),
        eq(reservationsTable.tenantId, me.tenantId),
      ))
      .limit(1);

    if (!reservation) {
      next(new NotFoundError("Reserva não encontrada", "NOT_FOUND"));
      return;
    }

    const balance = Math.max(Number(reservation.totalValue) - Number(reservation.paidValue), 0);
    if (balance <= 0) {
      next(new ValidationError("Esta reserva não possui saldo pendente"));
      return;
    }

    if (reservation.status === RESERVATION_STATUS.CANCELLED) {
      next(new ValidationError("Não é possível resgatar pontos em reservas canceladas"));
      return;
    }

    const [loyaltyProgram] = await db
      .select()
      .from(loyaltyProgramsTable)
      .where(and(eq(loyaltyProgramsTable.tenantId, me.tenantId), eq(loyaltyProgramsTable.isActive, true)))
      .limit(1);

    if (!loyaltyProgram) {
      next(new NotFoundError("Programa de fidelidade não ativo", "NOT_FOUND"));
      return;
    }

    const [member] = await db
      .select()
      .from(loyaltyMembersTable)
      .where(and(
        eq(loyaltyMembersTable.tenantId, me.tenantId),
        eq(loyaltyMembersTable.programId, loyaltyProgram.id),
        eq(loyaltyMembersTable.clientId, client.id),
      ))
      .limit(1);

    if (!member) {
      next(new NotFoundError("Você não é membro do programa de fidelidade", "NOT_FOUND"));
      return;
    }

    if (body.data.pointsToRedeem < loyaltyProgram.minRedeemPoints) {
      next(new ValidationError(`O mínimo para resgate é ${loyaltyProgram.minRedeemPoints} pontos`));
      return;
    }

    if (member.availablePoints < loyaltyProgram.minRedeemPoints) {
      next(new ValidationError(`São necessários pelo menos ${loyaltyProgram.minRedeemPoints} pontos para resgatar`));
      return;
    }

    if (body.data.pointsToRedeem > member.availablePoints) {
      next(new ValidationError("Pontos insuficientes"));
      return;
    }

    const realPerPoint = Number(loyaltyProgram.realPerPoint);

    // All reads used for point/discount computation happen inside the transaction
    // with row-level locks to prevent double-spend and stale-snapshot bugs.
    let result: { pointsRedeemed: number; discountAmount: number; newAvailablePoints: number };
    await db.transaction(async (tx) => {
      // Lock member row — prevents concurrent redemptions from overspending
      const [lockedMember] = await tx
        .select({ availablePoints: loyaltyMembersTable.availablePoints })
        .from(loyaltyMembersTable)
        .where(eq(loyaltyMembersTable.id, member.id))
        .for("update")
        .limit(1);

      if (!lockedMember) throw new ValidationError("Membro não encontrado");
      if (lockedMember.availablePoints < loyaltyProgram.minRedeemPoints) {
        throw new ValidationError(`São necessários pelo menos ${loyaltyProgram.minRedeemPoints} pontos para resgatar`);
      }
      if (lockedMember.availablePoints < body.data.pointsToRedeem) {
        throw new ValidationError("Pontos insuficientes (tente novamente)");
      }

      // Lock reservation row — prevents concurrent requests from applying duplicate discounts
      const [lockedReservation] = await tx
        .select({
          totalValue: reservationsTable.totalValue,
          paidValue: reservationsTable.paidValue,
          reservationNumber: reservationsTable.reservationNumber,
        })
        .from(reservationsTable)
        .where(eq(reservationsTable.id, reservation.id))
        .for("update")
        .limit(1);

      if (!lockedReservation) throw new ValidationError("Reserva não encontrada");
      const currentBalance = Math.max(
        Number(lockedReservation.totalValue) - Number(lockedReservation.paidValue),
        0,
      );
      if (currentBalance <= 0) throw new ValidationError("Esta reserva não possui saldo pendente");

      // Compute points first, then derive discount — never the other way around.
      // This prevents the case where floor(balance/realPerPoint)=0 but discount>0.
      // Policy: actualPoints = min(requestedPoints, maxAffordableByBalance)
      //         discountAmount = actualPoints * realPerPoint (always ≥ 0, never > balance)
      const maxPointsByBalance = Math.floor(currentBalance / realPerPoint);
      if (maxPointsByBalance < 1) {
        throw new ValidationError("Saldo da reserva insuficiente para resgate (menor que 1 ponto)");
      }
      const actualPointsRedeemed = Math.min(body.data.pointsToRedeem, maxPointsByBalance);
      if (actualPointsRedeemed < loyaltyProgram.minRedeemPoints) {
        throw new ValidationError(`O mínimo para resgate é ${loyaltyProgram.minRedeemPoints} pontos (saldo disponível permite ${maxPointsByBalance})`);
      }
      const discountAmount = actualPointsRedeemed * realPerPoint;

      const newAvailablePoints = lockedMember.availablePoints - actualPointsRedeemed;

      await tx
        .update(loyaltyMembersTable)
        .set({ availablePoints: newAvailablePoints })
        .where(eq(loyaltyMembersTable.id, member.id));

      const txId = generateId();
      await tx.insert(loyaltyTransactionsTable).values({
        id: txId,
        tenantId: me.tenantId,
        memberId: member.id,
        type: "redeem",
        points: actualPointsRedeemed,
        description: `Resgate de pontos — Reserva ${lockedReservation.reservationNumber ?? reservation.id.slice(-6).toUpperCase()}`,
        referenceId: reservation.id,
        referenceType: "reservation",
      });

      await tx
        .update(reservationsTable)
        .set({
          paidValue: sql`${reservationsTable.paidValue} + ${discountAmount}`,
          discountLoyaltyPoints: sql`COALESCE(${reservationsTable.discountLoyaltyPoints}, 0) + ${actualPointsRedeemed}`,
          discountLoyaltyAmount: sql`COALESCE(${reservationsTable.discountLoyaltyAmount}, '0') + ${discountAmount}`,
        })
        .where(eq(reservationsTable.id, reservation.id));

      result = { pointsRedeemed: actualPointsRedeemed, discountAmount, newAvailablePoints };
    });

    res.json(result!);
  } catch (err) {
    next(err);
  }
});

router.post("/client/nps", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }
    const body = z.object({
      reservationId: z.string().min(1),
      score: z.number().int().min(0).max(10),
      comment: z.string().max(2000).nullable().optional(),
      scoreTransport: z.number().int().min(1).max(5).nullable().optional(),
      scoreService: z.number().int().min(1).max(5).nullable().optional(),
      scoreOrganization: z.number().int().min(1).max(5).nullable().optional(),
      scoreGuide: z.number().int().min(1).max(5).nullable().optional(),
    }).safeParse(req.body);
    if (!body.success) {
      next(new ValidationError(String(body.error.message)));
      return;
    }
    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) {
      next(new NotFoundError("Perfil de cliente não encontrado", "NOT_FOUND"));
      return;
    }
    const [reservation] = await db
      .select({ id: reservationsTable.id, tripId: reservationsTable.tripId })
      .from(reservationsTable)
      .where(
        and(
          eq(reservationsTable.id, body.data.reservationId),
          eq(reservationsTable.clientId, client.id),
          eq(reservationsTable.tenantId, me.tenantId),
        ),
      )
      .limit(1);
    if (!reservation) {
      next(new NotFoundError("Reserva não encontrada", "NOT_FOUND"));
      return;
    }
    const [existing] = await db
      .select({ id: clientNpsResponsesTable.id })
      .from(clientNpsResponsesTable)
      .where(eq(clientNpsResponsesTable.reservationId, body.data.reservationId))
      .limit(1);
    if (existing) {
      next(new ConflictError("Avaliação já enviada para esta reserva", "DUPLICATE_NPS"));
      return;
    }
    const id = generateId();
    await db.insert(clientNpsResponsesTable).values({
      id,
      tenantId: me.tenantId,
      clientId: client.id,
      reservationId: body.data.reservationId,
      tripId: reservation.tripId,
      score: body.data.score,
      scoreTransport: body.data.scoreTransport ?? null,
      scoreService: body.data.scoreService ?? null,
      scoreOrganization: body.data.scoreOrganization ?? null,
      scoreGuide: body.data.scoreGuide ?? null,
      comment: body.data.comment ?? null,
    });
    res.status(201).json({ id });
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === "23505") {
      next(new ConflictError("Avaliação já enviada para esta reserva", "DUPLICATE_NPS"));
      return;
    }
    next(err);
  }
});

router.get("/client/reservations/:id/voucher", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }

    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) {
      next(new NotFoundError("Perfil de cliente não encontrado", "NOT_FOUND"));
      return;
    }

    const [row] = await db
      .select({
        id: reservationsTable.id,
        reservationNumber: reservationsTable.reservationNumber,
        status: reservationsTable.status,
        voucherCode: reservationsTable.voucherCode,
        totalValue: reservationsTable.totalValue,
        paidValue: reservationsTable.paidValue,
        balance: reservationsTable.balance,
        depositAmount: reservationsTable.depositAmount,
        discountTotal: reservationsTable.discountTotal,
        storeOrderId: reservationsTable.storeOrderId,
        paymentMethod: reservationsTable.paymentMethod,
        createdAt: reservationsTable.createdAt,
        seats: reservationsTable.seats,
        boardingLocationId: reservationsTable.boardingLocationId,
        tripName: tripsTable.name,
        tripDestination: tripsTable.destination,
        tripDepartureDate: tripsTable.departureDate,
        tripReturnDate: tripsTable.returnDate,
        tripBoardingPoints: tripsTable.boardingPoints,
      })
      .from(reservationsTable)
      .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
      .where(
        and(
          eq(reservationsTable.id, req.params.id),
          eq(reservationsTable.clientId, client.id),
          eq(reservationsTable.tenantId, me.tenantId),
        ),
      )
      .limit(1);

    if (!row) {
      next(new NotFoundError("Reserva não encontrada", "NOT_FOUND"));
      return;
    }
    const [order, siblingRows] = row.storeOrderId
      ? await Promise.all([
        db.select().from(storeOrdersTable).where(and(
          eq(storeOrdersTable.tenantId, me.tenantId),
          eq(storeOrdersTable.orderNumber, row.storeOrderId),
        )).limit(1).then(result => result[0]),
        db.select({ id: reservationsTable.id, totalValue: reservationsTable.totalValue }).from(reservationsTable).where(and(
          eq(reservationsTable.tenantId, me.tenantId),
          eq(reservationsTable.storeOrderId, row.storeOrderId),
        )),
      ])
      : [undefined, [{ id: row.id }]];
    const voucherPayments = await db.select({
      orderId: paymentsTable.orderId,
      reservationId: paymentsTable.reservationId,
      amount: paymentsTable.amount,
      status: paymentsTable.status,
      type: paymentsTable.type,
    }).from(paymentsTable).where(and(
      eq(paymentsTable.tenantId, me.tenantId),
      or(
        ...(order ? [eq(paymentsTable.orderId, order.id)] : []),
        eq(paymentsTable.reservationId, row.id),
      ),
    ));
    const summary = order && siblingRows.length === 1
      ? orderFinancialSummary(order, calculateReceivedAmount(order.id, [row.id], voucherPayments), voucherPayments, row, [row.id])
      : reservationFinancialSummary(
        row,
        order
          ? allocateOrderReceiptToReservation(
            calculateReceivedAmount(order.id, siblingRows.map(sibling => sibling.id), voucherPayments),
            order.totalAmount,
            row.totalValue,
            row.id,
            siblingRows,
          )
          : calculateReceivedAmount("", [row.id], voucherPayments),
        voucherPayments,
        order,
      );
    if (!summary.reservationValid) {
      next(new ConflictError(
        "O voucher estará disponível quando a reserva estiver confirmada e o pagamento mínimo tiver sido recebido.",
        "RESERVATION_NOT_VALID",
      ));
      return;
    }

    const [[tenant], [user]] = await Promise.all([
      db
        .select({ name: tenantsTable.name, primaryColor: tenantsTable.primaryColor })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, me.tenantId))
        .limit(1),
      db
        .select({ name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, me.id))
        .limit(1),
    ]);

    const reservationPassengers = await db
      .select({ ageCategory: passengersTable.ageCategory, seatNumber: passengersTable.seatNumber })
      .from(passengersTable)
      .where(eq(passengersTable.reservationId, row.id));

    const lapChildCount = reservationPassengers.filter(
      (p) => p.ageCategory === "baby" && !p.seatNumber,
    ).length;

    const passengerName = client.name ?? user?.name ?? "Passageiro";
    const agencyName = tenant?.name ?? "Agência";
    const primaryColor = tenant?.primaryColor ?? "#3B82F6";
    const totalValue = summary.totalAmount;
    const paidValue = summary.paidAmount;
    const balance = summary.amountRemaining;
    const seatsCount = Array.isArray(row.seats) ? row.seats.length : 0;
    const tripDepartureDate = row.tripDepartureDate
      ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(row.tripDepartureDate as unknown as Date)
      : null;
    const tripReturnDate = row.tripReturnDate
      ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(row.tripReturnDate as unknown as Date)
      : null;
    const boardingPoints = Array.isArray(row.tripBoardingPoints) ? row.tripBoardingPoints : [];
    const boardingPoint = row.boardingLocationId
      ? boardingPoints.find((bp: { id: string; name: string; time: string; address: string }) => bp.id === row.boardingLocationId)
      : null;
    const boardingPointName = boardingPoint?.name ?? null;
    const boardingPointTime = boardingPoint?.time ?? null;

    const voucherData = {
      passengerName,
      agencyName,
      primaryColor,
      reservationId: row.id,
      reservationNumber: row.reservationNumber,
      status: row.status,
      voucherCode: row.voucherCode,
      reservationDate: row.createdAt,
      paymentMethod: row.paymentMethod,
      totalValue,
      paidValue,
      balance,
      seatsCount,
      lapChildCount: lapChildCount > 0 ? lapChildCount : undefined,
      tripName: row.tripName,
      tripDestination: row.tripDestination,
      tripDepartureDate,
      tripReturnDate,
      boardingPointName,
      boardingPointTime,
    };

    const pdfBuffer = generateVoucherPdf(voucherData);

    const pdfQueue = getPdfQueue();
    if (pdfQueue) {
      pdfQueue
        .add(`voucher-${generateId()}`, {
          type: "voucher",
          tenantId: me.tenantId,
          reservationId: row.id,
          passengerName,
          agencyName,
          primaryColor,
          reservationNumber: row.reservationNumber,
          status: row.status,
          voucherCode: row.voucherCode,
          reservationDate: row.createdAt.toISOString(),
          paymentMethod: row.paymentMethod,
          totalValue,
          paidValue,
          balance,
          seatsCount,
          tripName: row.tripName,
          tripDestination: row.tripDestination,
          tripDepartureDate,
          tripReturnDate,
          userId: me.id,
          ipAddress: req.ip ?? null,
          userAgent: req.headers["user-agent"] ?? null,
        })
        .catch((err) => req.log.warn({ err }, "[voucher] Failed to enqueue audit job"));
    } else if (!areWorkersEnabled()) {
      logger.warn(
        { jobType: "pdf-voucher", tenantId: me.tenantId, reservationId: row.id },
        "[workers-disabled] ENABLE_WORKERS=false — PDF voucher audit job skipped. Set ENABLE_WORKERS=true to enable async processing.",
      );
    }

    const safeTrip = row.tripName.replace(/[^a-z0-9]/gi, "_").slice(0, 30);
    const filename = `comprovante_${safeTrip}_${row.voucherCode ?? row.id}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

const UpdateClientMeBody = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(30).optional().nullable(),
  cpf: z.string().max(20).optional().nullable(),
  birthDate: z.string().optional().nullable(),
});

router.patch("/client/me", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }

    const parsed = UpdateClientMeBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError("Dados inválidos", "VALIDATION_ERROR"));
      return;
    }

    const data = parsed.data;
    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);

    if (!client) {
      next(new NotFoundError("Perfil de cliente não encontrado", "NOT_FOUND"));
      return;
    }

    // An existing CPF is a canonical identity value. Profile edits may add a
    // missing CPF, but an empty/null form value must never erase it.
    const requestedCpf = data.cpf === undefined ? client.cpf : normalizeCpfInput(data.cpf);
    const normalizedCpf = requestedCpf ?? client.cpf;
    const [updated] = await db.transaction(async (tx) => {
      if (!client.cpf && normalizedCpf) {
        const identity = await reconcileClientIdentity(tx, {
          tenantId: me.tenantId,
          userId: me.id,
          cpf: normalizedCpf,
          name: data.name,
          email: client.email,
          phone: data.phone,
          birthDate: data.birthDate ? new Date(data.birthDate) : null,
        });

        if (identity.clientId && identity.clientId !== client.id) {
          throw new ConflictError(
            "O CPF informado pertence a outro cadastro de cliente nesta agência.",
            "CLIENT_IDENTITY_CONFLICT",
          );
        }
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (data.name !== undefined) updates.name = data.name;
      if (data.phone !== undefined) updates.phone = data.phone;
      if (normalizedCpf) updates.cpf = normalizedCpf;
      if (data.birthDate !== undefined) {
        updates.birthDate = data.birthDate ? new Date(data.birthDate) : null;
      }

      await tx
        .update(clientsTable)
        .set(updates)
        .where(and(eq(clientsTable.id, client.id), eq(clientsTable.tenantId, me.tenantId)));

      if (data.name !== undefined) {
        await tx.update(usersTable).set({ name: data.name }).where(eq(usersTable.id, me.id));
      }

      return tx
        .select()
        .from(clientsTable)
        .where(and(eq(clientsTable.id, client.id), eq(clientsTable.tenantId, me.tenantId)))
        .limit(1);
    });

    res.json({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      cpf: updated.cpf,
      birthDate: updated.birthDate
        ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(updated.birthDate as unknown as Date)
        : null,
      addressCity: updated.addressCity,
      addressState: updated.addressState,
      referralCode: updated.referralCode ?? null,
    });
  } catch (err) {
    next(err);
  }
});

function maskEmail(email: string): string {
  const atIdx = email.indexOf("@");
  if (atIdx <= 0) return email;
  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx);
  if (local.length <= 2) return `${local[0]}***${domain}`;
  return `${local.slice(0, 2)}***${domain}`;
}

router.get("/client/me/referrals", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }

    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) {
      res.json({ data: [] });
      return;
    }

    const rows = await db
      .select({
        id: referralsTable.id,
        referredName: referralsTable.referredName,
        referredEmail: referralsTable.referredEmail,
        status: referralsTable.status,
        convertedAt: referralsTable.convertedAt,
        bonusAmount: referralsTable.bonusAmount,
        bonusPaid: referralsTable.bonusPaid,
        bonusPaidAt: referralsTable.bonusPaidAt,
        bonusCreditUsedAt: referralsTable.bonusCreditUsedAt,
        bonusCreditOrderId: referralsTable.bonusCreditOrderId,
        bonusCreditUsedAmount: referralsTable.bonusCreditUsedAmount,
        createdAt: referralsTable.createdAt,
        expiresAt: referralsTable.expiresAt,
        reversalReason: referralsTable.reversalReason,
      })
      .from(referralsTable)
      .where(
        and(
          eq(referralsTable.tenantId, me.tenantId),
          eq(referralsTable.referrerId, client.id),
        ),
      )
      .orderBy(desc(referralsTable.createdAt));

    const referralIds = rows.map((r) => r.id);
    const loyaltyPointsMap = new Map<string, number>();
    if (referralIds.length > 0) {
      const loyaltyTxRows = await db
        .select({
          referenceId: loyaltyTransactionsTable.referenceId,
          points: loyaltyTransactionsTable.points,
        })
        .from(loyaltyTransactionsTable)
        .where(
          and(
            eq(loyaltyTransactionsTable.tenantId, me.tenantId),
            eq(loyaltyTransactionsTable.referenceType, "referral"),
            inArray(loyaltyTransactionsTable.referenceId, referralIds),
          ),
        );
      for (const tx of loyaltyTxRows) {
        if (tx.referenceId) {
          loyaltyPointsMap.set(tx.referenceId, (loyaltyPointsMap.get(tx.referenceId) ?? 0) + Number(tx.points));
        }
      }
    }

    const completedCount = rows.filter(
      (r) => r.status === REFERRAL_STATUS.COMPLETED || r.status === REFERRAL_STATUS.CONVERTED,
    ).length;

    const [refSettings] = await db
      .select({
        tiersConfig: referralSettingsTable.tiersConfig,
        gracePeriodDays: referralSettingsTable.gracePeriodDays,
      })
      .from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, me.tenantId))
      .limit(1);

    const { tier: currentTier, nextTier, progress: tierProgress } = computeReferralTier(
      completedCount,
      refSettings?.tiersConfig ?? null,
    );

    const gracePeriodDays = refSettings?.gracePeriodDays ?? 30;

    res.json({
      data: rows.map((r) => {
        const convertedAtDate = r.convertedAt ? (r.convertedAt as unknown as Date) : null;
        const bonusReleasesAt = convertedAtDate
          ? new Date(convertedAtDate.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000)
          : null;
        const bonusBlocked =
          r.status === REFERRAL_STATUS.REVERSED ||
          (bonusReleasesAt !== null && new Date() < bonusReleasesAt);
        return {
          id: r.id,
          referredName: r.referredName ?? null,
          referredEmail: r.referredEmail ? maskEmail(r.referredEmail) : null,
          status: r.status,
          convertedAt: convertedAtDate ? convertedAtDate.toISOString() : null,
          bonusAmount: r.bonusAmount,
          bonusPaid: r.bonusPaid,
          bonusPaidAt: r.bonusPaidAt ? (r.bonusPaidAt as unknown as Date).toISOString() : null,
          bonusCreditUsedAt: r.bonusCreditUsedAt ? (r.bonusCreditUsedAt as unknown as Date).toISOString() : null,
          bonusCreditOrderId: r.bonusCreditOrderId ?? null,
          bonusCreditUsedAmount: r.bonusCreditUsedAmount ?? null,
          createdAt: (r.createdAt as unknown as Date).toISOString(),
          expiresAt: r.expiresAt ? (r.expiresAt as unknown as Date).toISOString() : null,
          bonusReleasesAt: bonusReleasesAt ? bonusReleasesAt.toISOString() : null,
          bonusBlocked,
          reversalReason: r.reversalReason ?? null,
          loyaltyPoints: loyaltyPointsMap.get(r.id) ?? null,
        };
      }),
      tier: {
        currentTierLevel: currentTier.level,
        currentTierLabel: currentTier.label,
        currentTierMultiplier: currentTier.bonusMultiplier,
        tierProgress,
        nextTierMin: nextTier?.minReferrals ?? null,
        nextTierLabel: nextTier?.label ?? null,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Client-safe projection of the currently active referral campaign.
 * Commercial controls such as budget, caps and commission policy deliberately
 * remain available only through the staff campaign endpoints.
 */
router.get("/client/me/referral-campaign", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }

    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) {
      res.json(null);
      return;
    }

    const now = new Date();
    const [campaign] = await db
      .select({
        id: referralCampaignsTable.id,
        name: referralCampaignsTable.name,
        startsAt: referralCampaignsTable.startsAt,
        endsAt: referralCampaignsTable.endsAt,
        bonusType: referralCampaignsTable.bonusType,
        bonusValue: referralCampaignsTable.bonusValue,
        bannerText: referralCampaignsTable.bannerText,
        shareMessage: referralCampaignsTable.shareMessage,
        materialUrl: referralCampaignsTable.materialUrl,
        eligibleActivitySegments: referralCampaignsTable.eligibleActivitySegments,
      })
      .from(referralCampaignsTable)
      .where(and(
        eq(referralCampaignsTable.tenantId, me.tenantId),
        sql`${referralCampaignsTable.startsAt} <= ${now}`,
        sql`${referralCampaignsTable.endsAt} > ${now}`,
      ))
      .orderBy(desc(referralCampaignsTable.startsAt))
      .limit(1);

    if (!campaign) {
      res.json(null);
      return;
    }

    const activitySegment = client.successfulReferrals >= 3
      ? "active"
      : client.successfulReferrals >= 1 ? "occasional" : "inactive";
    const eligibleSegments = campaign.eligibleActivitySegments ?? [];
    if (eligibleSegments.length > 0 && !eligibleSegments.includes(activitySegment)) {
      // The portal must not advertise a reward the client cannot earn. Campaign
      // channel eligibility is evaluated when the public link is tracked.
      res.json(null);
      return;
    }

    const { eligibleActivitySegments: _internalSegmentPolicy, ...safeCampaign } = campaign;
    res.json({ ...safeCampaign, bonusValue: Number(campaign.bonusValue) });
  } catch (err) {
    next(err);
  }
});

// ── GET /client/notifications ─────────────────────────────────────────────────

router.get("/client/notifications", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }

    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) {
      res.json({ data: [], unreadCount: 0 });
      return;
    }

    const [notifications, unreadCount] = await Promise.all([
      getRecentNotifications(client.id, me.tenantId, 20),
      getUnreadCount(client.id, me.tenantId),
    ]);

    res.json({
      data: notifications.map((n) => ({
        id: n.id,
        type: n.type,
        payload: n.payload ?? {},
        readAt: n.readAt ? (n.readAt as unknown as Date).toISOString() : null,
        createdAt: (n.createdAt as unknown as Date).toISOString(),
      })),
      unreadCount,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /client/notifications/read-all ──────────────────────────────────────

router.post("/client/notifications/read-all", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }

    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) {
      res.status(204).end();
      return;
    }

    await markAllRead(client.id, me.tenantId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ── GET /client/notifications/stream (SSE) ────────────────────────────────────

router.get("/client/notifications/stream", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }

    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) {
      next(new NotFoundError("Client record not found", "NOT_FOUND"));
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    // Capture watermark BEFORE init query so no notification can fall through the gap.
    const streamStartAt = new Date();

    addClientSseConnection(client.id, res);

    const [notifications, unreadCount] = await Promise.all([
      getRecentNotifications(client.id, me.tenantId, 20),
      getUnreadCount(client.id, me.tenantId),
    ]);

    // Track IDs already delivered (via init frame or in-process emitToClient)
    // so the poll loop can skip them and avoid duplicate delivery.
    const sentIds = new Set<string>(notifications.map((n) => n.id));

    const initPayload = JSON.stringify({
      type: "init",
      data: {
        notifications: notifications.map((n) => ({
          id: n.id,
          type: n.type,
          payload: n.payload ?? {},
          readAt: n.readAt ? (n.readAt as unknown as Date).toISOString() : null,
          createdAt: (n.createdAt as unknown as Date).toISOString(),
        })),
        unreadCount,
      },
    });
    res.write(`data: ${initPayload}\n\n`);

    const heartbeat = setInterval(() => {
      try {
        res.write(": heartbeat\n\n");
      } catch {
        clearInterval(heartbeat);
      }
    }, 30_000);

    // Poll cursor starts at stream-open time (before init query), so we never
    // skip a row inserted between init query start and completion.
    let lastPolledAt = streamStartAt;

    const pollInterval = setInterval(async () => {
      // Snapshot the next high-water mark BEFORE querying to avoid losing
      // rows inserted during query execution on the next cycle.
      const queryTime = new Date();
      try {
        const newRows = await db
          .select()
          .from(clientNotificationsTable)
          .where(
            and(
              eq(clientNotificationsTable.clientId, client.id),
              gt(clientNotificationsTable.createdAt, lastPolledAt),
            ),
          )
          .orderBy(asc(clientNotificationsTable.createdAt));

        // Advance cursor only after a successful query.
        lastPolledAt = queryTime;

        // Filter out rows already delivered via init frame or in-process emitToClient.
        const undelivered = newRows.filter((n) => !sentIds.has(n.id));
        if (undelivered.length > 0) {
          const [unreadRow] = await db
            .select({ cnt: count() })
            .from(clientNotificationsTable)
            .where(and(eq(clientNotificationsTable.clientId, client.id), isNull(clientNotificationsTable.readAt)));

          for (const n of undelivered) {
            sentIds.add(n.id);
            const frame = JSON.stringify({
              type: "notification",
              data: {
                id: n.id,
                type: n.type,
                payload: n.payload ?? {},
                readAt: null,
                createdAt: (n.createdAt as unknown as Date).toISOString(),
                unreadCount: Number(unreadRow?.cnt ?? 0),
              },
            });
            res.write(`data: ${frame}\n\n`);
          }
        }
      } catch (pollErr) {
        // Do NOT advance cursor on error — retry with same watermark next tick.
        logger.warn({ err: pollErr, clientId: client.id }, "[sse-poll] poll error for client");
      }
    }, 15_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      clearInterval(pollInterval);
      removeClientSseConnection(client.id, res);
    });
  } catch (err) {
    next(err);
  }
});

router.get("/client/me/favorites", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) { next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE")); return; }

    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) { next(new NotFoundError("Perfil de cliente não encontrado", "NOT_FOUND")); return; }

    const [tripFavs, productFavs] = await Promise.all([
      db
        .select({
          favoriteId: clientFavoritesTable.id,
          tripId: clientFavoritesTable.itemId,
          productSlug: storeProductsTable.slug,
          name: storeProductsTable.name,
          images: storeProductsTable.images,
          destination: storeProductsTable.destination,
          price: storeProductsTable.price,
          salePrice: storeProductsTable.salePrice,
        })
        .from(clientFavoritesTable)
        .innerJoin(storeProductsTable, eq(storeProductsTable.tripId, clientFavoritesTable.itemId))
        .innerJoin(storesTable, and(eq(storesTable.id, storeProductsTable.storeId), eq(storesTable.tenantId, me.tenantId)))
        .where(and(
          eq(clientFavoritesTable.clientId, client.id),
          eq(clientFavoritesTable.tenantId, me.tenantId),
          eq(clientFavoritesTable.itemType, "trip"),
        ))
        .orderBy(desc(clientFavoritesTable.createdAt)),
      db
        .select({
          favoriteId: clientFavoritesTable.id,
          productId: clientFavoritesTable.itemId,
          productSlug: storeProductsTable.slug,
          name: storeProductsTable.name,
          images: storeProductsTable.images,
          price: storeProductsTable.price,
          salePrice: storeProductsTable.salePrice,
        })
        .from(clientFavoritesTable)
        .innerJoin(storeProductsTable, eq(storeProductsTable.id, clientFavoritesTable.itemId))
        .innerJoin(storesTable, and(eq(storesTable.id, storeProductsTable.storeId), eq(storesTable.tenantId, me.tenantId)))
        .where(and(
          eq(clientFavoritesTable.clientId, client.id),
          eq(clientFavoritesTable.tenantId, me.tenantId),
          eq(clientFavoritesTable.itemType, "product"),
        ))
        .orderBy(desc(clientFavoritesTable.createdAt)),
    ]);

    res.json({
      trips: tripFavs.map((r) => ({
        favoriteId: r.favoriteId,
        tripId: r.tripId,
        productSlug: r.productSlug,
        name: r.name,
        imageUrl: (r.images as string[])?.[0] ?? null,
        destination: r.destination ?? null,
        price: r.price,
        salePrice: r.salePrice ?? null,
      })),
      products: productFavs.map((r) => ({
        favoriteId: r.favoriteId,
        productId: r.productId,
        productSlug: r.productSlug,
        name: r.name,
        imageUrl: (r.images as string[])?.[0] ?? null,
        price: r.price,
        salePrice: r.salePrice ?? null,
      })),
    });
  } catch (err) { next(err); }
});

const AddFavoriteBody = z.object({
  itemType: z.enum(["trip", "product"]),
  itemId: z.string().min(1),
});

router.post("/client/me/favorites", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) { next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE")); return; }

    const parsed = AddFavoriteBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError("Dados inválidos", "VALIDATION_ERROR")); return; }

    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) { next(new NotFoundError("Perfil de cliente não encontrado", "NOT_FOUND")); return; }

    const { itemType, itemId } = parsed.data;
    const id = generateId();

    await db.insert(clientFavoritesTable).values({
      id,
      tenantId: me.tenantId,
      clientId: client.id,
      itemType,
      itemId,
    }).onConflictDoNothing();

    res.status(201).json({ id, itemType, itemId });
  } catch (err) { next(err); }
});

router.delete("/client/me/favorites/:itemType/:itemId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) { next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE")); return; }

    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) { next(new NotFoundError("Perfil de cliente não encontrado", "NOT_FOUND")); return; }

    const { itemType, itemId } = req.params;
    if (!itemType || !itemId) { next(new ValidationError("Parâmetros inválidos", "VALIDATION_ERROR")); return; }

    await db.delete(clientFavoritesTable).where(and(
      eq(clientFavoritesTable.clientId, client.id),
      eq(clientFavoritesTable.tenantId, me.tenantId),
      eq(clientFavoritesTable.itemType, itemType),
      eq(clientFavoritesTable.itemId, itemId),
    ));

    res.status(204).send();
  } catch (err) { next(err); }
});

async function computeAndPersistBadges(
  tenantId: string,
  clientRecord: { id: string; birthDate: Date | null; successfulReferrals: number | null },
): Promise<{
  badgeConditions: Array<{ key: string; name: string; description: string; earned: boolean; progress?: number; target?: number }>;
  stats: { totalTrips: number; visitedStates: string[]; uniqueDestinations: string[] };
}> {
  const reservationsWithTrips = await db
    .select({ id: reservationsTable.id, createdAt: reservationsTable.createdAt, tripDestinationState: tripsTable.destinationState, tripDestination: tripsTable.destination })
    .from(reservationsTable)
    .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
    .where(and(eq(reservationsTable.clientId, clientRecord.id), eq(reservationsTable.tenantId, tenantId), inArray(reservationsTable.status, [RESERVATION_STATUS.CONFIRMED])));

  const confirmedCount = reservationsWithTrips.length;
  const visitedStates = [...new Set(reservationsWithTrips.map(r => r.tripDestinationState).filter((s): s is string => !!s && s.length === 2))];
  const uniqueDestinations = [...new Set(reservationsWithTrips.map(r => r.tripDestination).filter(Boolean))];

  const [loyaltyProgram] = await db.select({ id: loyaltyProgramsTable.id }).from(loyaltyProgramsTable)
    .where(and(eq(loyaltyProgramsTable.tenantId, tenantId), eq(loyaltyProgramsTable.isActive, true))).limit(1);
  let isLoyaltyMember = false;
  if (loyaltyProgram) {
    const [member] = await db.select({ id: loyaltyMembersTable.id }).from(loyaltyMembersTable)
      .where(and(eq(loyaltyMembersTable.tenantId, tenantId), eq(loyaltyMembersTable.programId, loyaltyProgram.id), eq(loyaltyMembersTable.clientId, clientRecord.id))).limit(1);
    isLoyaltyMember = !!member;
  }

  const successfulReferrals = clientRecord.successfulReferrals ?? 0;
  const now = new Date(); // used for earnedAt timestamps below
  const isBirthdayMonth = clientRecord.birthDate !== null &&
    (clientRecord.birthDate.getMonth() + 1) === Number(localToday().slice(5, 7)); // Brazil calendar month
  const firstConfirmed = reservationsWithTrips.length > 0
    ? reservationsWithTrips.reduce((a, b) => a.createdAt < b.createdAt ? a : b) : null;

  const conditions = [
    { key: "primeira_viagem",    name: "Primeira Viagem",       description: "Realizou sua primeira viagem conosco",       earned: confirmedCount >= 1,        earnedAt: firstConfirmed?.createdAt ?? now, progress: Math.min(confirmedCount, 1),       target: 1  as number | undefined },
    { key: "viajante_frequente", name: "Viajante Frequente",    description: "5 ou mais viagens confirmadas",               earned: confirmedCount >= 5,        earnedAt: now,                              progress: Math.min(confirmedCount, 5),       target: 5  as number | undefined },
    { key: "explorador",         name: "Explorador",             description: "10 ou mais viagens realizadas",              earned: confirmedCount >= 10,       earnedAt: now,                              progress: Math.min(confirmedCount, 10),      target: 10 as number | undefined },
    { key: "grande_aventureiro", name: "Grande Aventureiro",    description: "20 ou mais viagens realizadas",              earned: confirmedCount >= 20,       earnedAt: now,                              progress: Math.min(confirmedCount, 20),      target: 20 as number | undefined },
    { key: "explorador_brasil",  name: "Explorador do Brasil",  description: "Visitou 5 ou mais estados brasileiros",      earned: visitedStates.length >= 5, earnedAt: now,                              progress: Math.min(visitedStates.length, 5), target: 5  as number | undefined },
    { key: "embaixador",         name: "Embaixador",             description: "Indicou 3 ou mais amigos com sucesso",      earned: successfulReferrals >= 3,  earnedAt: now,                              progress: Math.min(successfulReferrals, 3),  target: 3  as number | undefined },
    { key: "aniversariante",     name: "Aniversariante do Mês", description: "Parabéns pelo seu aniversário neste mês!", earned: isBirthdayMonth,           earnedAt: now,                              progress: undefined,                         target: undefined },
    { key: "cliente_fiel",       name: "Cliente Fiel",          description: "Membro ativo do programa de fidelidade",    earned: isLoyaltyMember,           earnedAt: now,                              progress: undefined,                         target: undefined },
  ];

  for (const c of conditions) {
    if (c.earned) {
      await db.insert(clientAchievementsTable).values({
        id: generateId(),
        clientId: clientRecord.id,
        tenantId,
        badgeKey: c.key,
        earnedAt: c.earnedAt,
      }).onConflictDoNothing();
    }
  }

  return {
    badgeConditions: conditions.map(c => ({ key: c.key, name: c.name, description: c.description, earned: c.earned, progress: c.progress, target: c.target })),
    stats: { totalTrips: confirmedCount, visitedStates, uniqueDestinations },
  };
}

router.get("/client/me/achievements", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) { next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE")); return; }

    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) {
      res.json({ badges: [], stats: { totalTrips: 0, visitedStates: [], uniqueDestinations: [] } });
      return;
    }

    const { badgeConditions, stats } = await computeAndPersistBadges(me.tenantId, client);

    const persisted = await db
      .select({ badgeKey: clientAchievementsTable.badgeKey, earnedAt: clientAchievementsTable.earnedAt })
      .from(clientAchievementsTable)
      .where(and(eq(clientAchievementsTable.tenantId, me.tenantId), eq(clientAchievementsTable.clientId, client.id)));
    const persistedMap = new Map(persisted.map(b => [b.badgeKey, b.earnedAt]));

    const badges = badgeConditions.map(b => ({
      key: b.key,
      name: b.name,
      description: b.description,
      earned: b.earned,
      earnedAt: b.earned ? (persistedMap.get(b.key)?.toISOString() ?? null) : null,
      progress: b.progress,
      target: b.target,
    }));

    res.json({ badges, stats });
  } catch (err) { next(err); }
});

router.get("/client/me/memories", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) { next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE")); return; }

    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) { res.json({ memories: [] }); return; }

    const now = new Date();

    const reservationsWithTrips = await db
      .select({
        reservationId: reservationsTable.id,
        tripId: tripsTable.id,
        tripName: tripsTable.name,
        tripDestination: tripsTable.destination,
        tripDestinationCity: tripsTable.destinationCity,
        tripDestinationState: tripsTable.destinationState,
        tripCoverImage: tripsTable.coverImage,
        tripDepartureDate: tripsTable.departureDate,
        tripReturnDate: tripsTable.returnDate,
        tripVideos: tripsTable.videos,
      })
      .from(reservationsTable)
      .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
      .where(and(
        eq(reservationsTable.clientId, client.id),
        eq(reservationsTable.tenantId, me.tenantId),
        eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED),
        lt(tripsTable.departureDate, now),
      ))
      .orderBy(desc(tripsTable.departureDate));

    if (reservationsWithTrips.length === 0) { res.json({ memories: [] }); return; }

    const tripIds = reservationsWithTrips.map(r => r.tripId);
    const reservationIds = reservationsWithTrips.map(r => r.reservationId);

    const [npsSubmitted, media] = await Promise.all([
      db.select({ reservationId: clientNpsResponsesTable.reservationId })
        .from(clientNpsResponsesTable)
        .where(and(
          eq(clientNpsResponsesTable.tenantId, me.tenantId),
          inArray(clientNpsResponsesTable.reservationId, reservationIds),
        )),
      db.select()
        .from(tripMediaTable)
        .where(and(
          eq(tripMediaTable.tenantId, me.tenantId),
          inArray(tripMediaTable.tripId, tripIds),
        ))
        .orderBy(asc(tripMediaTable.createdAt)),
    ]);

    const npsSet = new Set(npsSubmitted.map(n => n.reservationId));
    const mediaByTrip = new Map<string, typeof media>();
    for (const m of media) {
      if (!mediaByTrip.has(m.tripId)) mediaByTrip.set(m.tripId, []);
      mediaByTrip.get(m.tripId)!.push(m);
    }

    const memories = reservationsWithTrips.map(r => ({
      reservationId: r.reservationId,
      tripId: r.tripId,
      tripName: r.tripName,
      tripDestination: r.tripDestination,
      tripDestinationCity: r.tripDestinationCity,
      tripDestinationState: r.tripDestinationState,
      tripCoverImage: r.tripCoverImage,
      tripDepartureDate: r.tripDepartureDate.toISOString(),
      tripReturnDate: r.tripReturnDate?.toISOString() ?? null,
      npsSubmitted: npsSet.has(r.reservationId),
      tripVideos: (r.tripVideos ?? []) as string[],
      media: (mediaByTrip.get(r.tripId) ?? []).map(m => ({
        id: m.id,
        url: m.url,
        type: m.type,
        caption: m.caption,
        createdAt: m.createdAt.toISOString(),
      })),
    }));

    res.json({ memories });
  } catch (err) { next(err); }
});

router.get("/client/me/dream-destinations", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) { next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE")); return; }
    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) { res.json({ data: [] }); return; }
    const destinations = await db.select()
      .from(clientDreamDestinationsTable)
      .where(and(eq(clientDreamDestinationsTable.tenantId, me.tenantId), eq(clientDreamDestinationsTable.clientId, client.id)))
      .orderBy(desc(clientDreamDestinationsTable.createdAt));
    res.json({ data: destinations.map(d => ({ id: d.id, destinationName: d.destinationName, note: d.note, createdAt: d.createdAt.toISOString() })) });
  } catch (err) { next(err); }
});

const AddDreamDestinationBody = z.object({
  destinationName: z.string().min(1).max(200),
  note: z.string().max(500).optional(),
});

router.post("/client/me/dream-destinations", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) { next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE")); return; }
    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) { next(new NotFoundError("Cliente não encontrado", "CLIENT_NOT_FOUND")); return; }
    const parsed = AddDreamDestinationBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const [countResult] = await db.select({ c: count() }).from(clientDreamDestinationsTable)
      .where(and(eq(clientDreamDestinationsTable.tenantId, me.tenantId), eq(clientDreamDestinationsTable.clientId, client.id)));
    if ((countResult?.c ?? 0) >= 30) { next(new ValidationError("Limite de 30 destinos atingido", "LIMIT_EXCEEDED")); return; }
    const id = generateId();
    await db.insert(clientDreamDestinationsTable).values({ id, clientId: client.id, tenantId: me.tenantId, destinationName: parsed.data.destinationName, note: parsed.data.note ?? null });
    res.status(201).json({ id, destinationName: parsed.data.destinationName, note: parsed.data.note ?? null, createdAt: new Date().toISOString() });
  } catch (err) { next(err); }
});

router.delete("/client/me/dream-destinations/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) { next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE")); return; }
    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) { next(new NotFoundError("Cliente não encontrado", "CLIENT_NOT_FOUND")); return; }
    const [dest] = await db.select({ id: clientDreamDestinationsTable.id })
      .from(clientDreamDestinationsTable)
      .where(and(eq(clientDreamDestinationsTable.id, req.params.id), eq(clientDreamDestinationsTable.tenantId, me.tenantId), eq(clientDreamDestinationsTable.clientId, client.id)))
      .limit(1);
    if (!dest) { next(new NotFoundError("Destino não encontrado", "NOT_FOUND")); return; }
    await db.delete(clientDreamDestinationsTable).where(eq(clientDreamDestinationsTable.id, req.params.id));
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post("/client/push-token", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role !== ROLES.CLIENT) {
      next(new ForbiddenError("Acesso restrito a clientes", "FORBIDDEN_ROLE"));
      return;
    }
    const body = z.object({ token: z.string().min(1).max(500) }).safeParse(req.body);
    if (!body.success) {
      next(new ValidationError("Token inválido", "VALIDATION_ERROR"));
      return;
    }
    const client = await findClientRecord(me.tenantId, me.id, me.email, me.clerkId);
    if (!client) {
      next(new NotFoundError("Cliente não encontrado", "NOT_FOUND"));
      return;
    }
    await db
      .update(clientsTable)
      .set({ expoPushToken: body.data.token })
      .where(eq(clientsTable.id, client.id));
    res.status(204).send();
  } catch (err) { next(err); }
});

router.get("/admin/clients/:clientId/dream-destinations", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Acesso restrito", "FORBIDDEN_ROLE")); return; }
    const destinations = await db.select()
      .from(clientDreamDestinationsTable)
      .where(and(eq(clientDreamDestinationsTable.tenantId, me.tenantId), eq(clientDreamDestinationsTable.clientId, req.params.clientId)))
      .orderBy(desc(clientDreamDestinationsTable.createdAt));
    res.json({ data: destinations.map(d => ({ id: d.id, destinationName: d.destinationName, note: d.note, createdAt: d.createdAt.toISOString() })) });
  } catch (err) { next(err); }
});

export default router;
