import {
  db,
  clientsTable,
  referralsTable,
  reservationsTable,
  paymentsTable,
  loyaltyMembersTable,
  loyaltyTransactionsTable,
  referralBonusReversalsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { PAYMENT_STATUS, PAYMENT_TYPE, REFERRAL_STATUS, RESERVATION_STATUS } from "@workspace/permissions";
import { recordReferralConversion } from "./checkout/referral-conversion";
import type { DbExecutor } from "../lib/reservation-payments";
import { calculateTier } from "../lib/loyalty-helpers";
import { generateId } from "../lib/id";
import { AppError } from "../lib/errors";

/** Promotes the CRM-created referral intent only after a paid reservation. */
export async function convertPaidReservationReferral(reservationId: string, tenantId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [reservation] = await tx.select().from(reservationsTable).where(and(
      eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId),
    )).for("update").limit(1);
    const isNonPayableReservation = ([
      RESERVATION_STATUS.CANCELLED,
      RESERVATION_STATUS.REFUNDED,
      RESERVATION_STATUS.FAILED,
    ] as string[]).includes(reservation?.status ?? "");
    if (
      !reservation ||
      Number(reservation.paidValue ?? 0) <= 0 ||
      isNonPayableReservation ||
      !reservation.clientId
    ) return;
    const [referral] = await tx.select().from(referralsTable).where(and(
      eq(referralsTable.tenantId, tenantId), eq(referralsTable.reservationId, reservationId), eq(referralsTable.status, REFERRAL_STATUS.PENDING),
    )).limit(1);
    if (!referral) return;
    const [client] = await tx.select({ name: clientsTable.name, email: clientsTable.email }).from(clientsTable)
      .where(and(eq(clientsTable.id, reservation.clientId), eq(clientsTable.tenantId, tenantId))).limit(1);
    if (!client) return;
    await recordReferralConversion(tx as never, {
      tenantId, referrerId: referral.referrerId, referralCode: referral.code,
      referredClientId: reservation.clientId, customerName: client.name, customerEmail: client.email,
      discountAmount: Number(referral.discountAmount), discountValue: Number(referral.discountValue),
      discountType: referral.discountType ?? "percentage", reservationId,
      existingReferralId: referral.id,
    });
  });
}

export type ReservationReferralReversalReason =
  | "payment_cancelled"
  | "payment_refunded"
  | "payment_charged_back"
  | "payment_failed"
  | "payment_deleted";

export interface ReservationReferralReversal {
  referralId: string;
  reservationId: string;
  referrerId: string;
  referredId: string | null;
  bonusAmount: string;
  reason: ReservationReferralReversalReason;
  loyaltyPointsReversed: number;
}

/**
 * Reverses a reservation referral only when no positive receivable payment
 * remains. Payment status changes are intentionally handled separately from
 * reservation cancellation: a reservation can stay active after one of its
 * partial payments is refunded or deleted.
 *
 * The transaction locks the reservation and referral before checking the
 * remaining payments. This makes duplicate callbacks harmless and prevents two
 * concurrent callbacks from decrementing the referrer's counters twice.
 */
export async function reverseReservationReferralIfNoEligiblePayment(
  reservationId: string,
  tenantId: string,
  reason: ReservationReferralReversalReason,
): Promise<ReservationReferralReversal | null> {
  return db.transaction(async (tx) =>
    reverseReservationReferralIfNoEligiblePaymentInTransaction(tx as unknown as DbExecutor, {
      reservationId,
      tenantId,
      reason,
    }),
  );
}

export async function reverseReservationReferralIfNoEligiblePaymentInTransaction(
  tx: DbExecutor,
  args: {
    reservationId: string;
    tenantId: string;
    reason: ReservationReferralReversalReason;
  },
): Promise<ReservationReferralReversal | null> {
  const { reservationId, tenantId, reason } = args;

  const [reservation] = await tx
    .select({
      id: reservationsTable.id,
      clientId: reservationsTable.clientId,
    })
    .from(reservationsTable)
    .where(and(
      eq(reservationsTable.id, reservationId),
      eq(reservationsTable.tenantId, tenantId),
    ))
    .for("update")
    .limit(1);
  if (!reservation) return null;

  // `PAID` is the only status included in reservation.paidValue and the
  // status that can trigger the referral conversion. Amount > 0 prevents a
  // zero-value bookkeeping row from keeping an indication eligible.
  const [eligiblePayment] = await tx
    .select({ id: paymentsTable.id })
    .from(paymentsTable)
    .where(and(
      eq(paymentsTable.tenantId, tenantId),
      eq(paymentsTable.reservationId, reservationId),
      eq(paymentsTable.type, PAYMENT_TYPE.RECEIVABLE),
      eq(paymentsTable.status, PAYMENT_STATUS.PAID),
      sql`${paymentsTable.amount} > 0`,
    ))
    .for("update")
    .limit(1);
  if (eligiblePayment) return null;

  const [referral] = await tx
    .select({
      id: referralsTable.id,
      reservationId: referralsTable.reservationId,
      referrerId: referralsTable.referrerId,
      referredId: referralsTable.referredId,
      bonusAmount: referralsTable.bonusAmount,
      status: referralsTable.status,
      reversalReason: referralsTable.reversalReason,
    })
    .from(referralsTable)
    .where(and(
      eq(referralsTable.tenantId, tenantId),
      eq(referralsTable.reservationId, reservationId),
      // A completed referral is reversed below. A reversed referral is
      // returned as a notification retry signal: the financial work must not
      // run again, but a later callback can recover an earlier failed notice.
      sql`${referralsTable.status} IN (${REFERRAL_STATUS.COMPLETED}, ${REFERRAL_STATUS.REVERSED})`,
    ))
    .for("update")
    .limit(1);
  if (!referral) return null;
  if (referral.status === REFERRAL_STATUS.REVERSED) {
    return {
      referralId: referral.id,
      reservationId: referral.reservationId ?? reservationId,
      referrerId: referral.referrerId,
      referredId: referral.referredId,
      bonusAmount: String(referral.bonusAmount ?? "0"),
      reason: (referral.reversalReason as ReservationReferralReversalReason | null) ?? reason,
      loyaltyPointsReversed: 0,
    };
  }

  // Serialize balance changes with conversions and other reversals. The
  // tenant predicate is part of the lock, so a callback can never affect a
  // referrer from another agency.
  await tx.execute(
    sql`SELECT id FROM clients WHERE id = ${referral.referrerId} AND tenant_id = ${tenantId} FOR UPDATE`,
  );

  const bonusAmount = Number(referral.bonusAmount ?? 0);
  await tx
    .update(clientsTable)
    .set({
      successfulReferrals: sql`GREATEST(0, COALESCE(successful_referrals, 0) - 1)`,
      referralEarnings: sql`GREATEST(0, COALESCE(referral_earnings, 0) - ${bonusAmount.toFixed(2)})`,
    })
    .where(and(
      eq(clientsTable.id, referral.referrerId),
      eq(clientsTable.tenantId, tenantId),
    ));

  const reversalAt = new Date();
  await tx
    .update(referralsTable)
    .set({
      status: REFERRAL_STATUS.REVERSED,
      reversalReason: reason,
      reversalAt,
      updatedAt: reversalAt,
    })
    .where(and(
      eq(referralsTable.id, referral.id),
      eq(referralsTable.tenantId, tenantId),
      eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
    ));

  // Referral commissions have their own financial lifecycle. A reversal
  // changes their state but never removes the original commission record.
  await tx.execute(
    sql`UPDATE referral_commissions
        SET status = 'reversed', reversed_at = ${reversalAt}, updated_at = ${reversalAt}
        WHERE tenant_id = ${tenantId}
          AND referral_id = ${referral.id}
          AND status IN ('pending', 'approved')`,
  );

  let loyaltyPointsReversed = 0;
  await tx.execute(
    sql`SELECT id FROM loyalty_members
        WHERE tenant_id = ${tenantId} AND client_id = ${referral.referrerId}
        LIMIT 1 FOR UPDATE`,
  );
  const [loyaltyMember] = await tx
    .select({
      id: loyaltyMembersTable.id,
      totalPoints: loyaltyMembersTable.totalPoints,
      availablePoints: loyaltyMembersTable.availablePoints,
    })
    .from(loyaltyMembersTable)
    .where(and(
      eq(loyaltyMembersTable.tenantId, tenantId),
      eq(loyaltyMembersTable.clientId, referral.referrerId),
    ))
    .limit(1);

  if (loyaltyMember) {
    const [referralPoints] = await tx
      .select({ id: loyaltyTransactionsTable.id, points: loyaltyTransactionsTable.points })
      .from(loyaltyTransactionsTable)
      .where(and(
        eq(loyaltyTransactionsTable.tenantId, tenantId),
        eq(loyaltyTransactionsTable.memberId, loyaltyMember.id),
        eq(loyaltyTransactionsTable.type, "referral"),
        eq(loyaltyTransactionsTable.referenceId, referral.id),
        eq(loyaltyTransactionsTable.referenceType, "referral"),
      ))
      .limit(1);
    const [existingReversal] = await tx
      .select({ id: loyaltyTransactionsTable.id })
      .from(loyaltyTransactionsTable)
      .where(and(
        eq(loyaltyTransactionsTable.tenantId, tenantId),
        eq(loyaltyTransactionsTable.memberId, loyaltyMember.id),
        eq(loyaltyTransactionsTable.referenceId, referral.id),
        eq(loyaltyTransactionsTable.referenceType, "referral_reversal"),
      ))
      .limit(1);

    if (referralPoints && !existingReversal && referralPoints.points > 0) {
      loyaltyPointsReversed = referralPoints.points;
      const newTotalPoints = Math.max(0, loyaltyMember.totalPoints - loyaltyPointsReversed);
      await tx
        .update(loyaltyMembersTable)
        .set({
          totalPoints: newTotalPoints,
          availablePoints: sql`GREATEST(0, ${loyaltyMember.availablePoints}::integer - ${loyaltyPointsReversed}::integer)`,
          tier: calculateTier(newTotalPoints),
          lastActivityAt: reversalAt,
        })
        .where(and(
          eq(loyaltyMembersTable.id, loyaltyMember.id),
          eq(loyaltyMembersTable.tenantId, tenantId),
        ));
      await tx.insert(loyaltyTransactionsTable).values({
        id: `${referral.id}:reversal`,
        tenantId,
        memberId: loyaltyMember.id,
        type: "redeem",
        points: -loyaltyPointsReversed,
        description: `Estorno de pontos — indicação ${referral.id}`,
        referenceId: referral.id,
        referenceType: "referral_reversal",
      });
    }
  }

  return {
    referralId: referral.id,
    reservationId: referral.reservationId ?? reservationId,
    referrerId: referral.referrerId,
    referredId: referral.referredId,
    bonusAmount: String(referral.bonusAmount ?? "0"),
    reason,
    loyaltyPointsReversed,
  };
}

export interface PaidReferralBonusReversal {
  reversalId: string;
  referralId: string;
  reservationId: string | null;
  referrerId: string;
  referredId: string | null;
  bonusAmount: string;
  reason: string;
  alreadyReversed: boolean;
}

/**
 * Financially reverses a referral bonus after it has been paid.
 *
 * This is deliberately separate from the reservation/payment cancellation
 * path: an operator may need to correct a confirmed payout while the
 * reservation remains valid. The referral is locked before any side effect,
 * and the append-only reversal record is the idempotency boundary. Existing
 * referral, commission, and loyalty history is never deleted or rewritten.
 */
export async function reversePaidReferralBonus(
  referralId: string,
  tenantId: string,
  reason: string,
  initiatedById: string,
): Promise<PaidReferralBonusReversal> {
  return db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT id, reservation_id, status, bonus_paid, referrer_id, referred_id, bonus_amount
      FROM referrals
      WHERE id = ${referralId} AND tenant_id = ${tenantId}
      FOR UPDATE
    `);
    const row = (locked.rows as Array<Record<string, unknown>>)[0];
    if (!row) {
      throw new AppError("Indicação não encontrada", 404, "NOT_FOUND");
    }

    const [existingReversal] = await tx
      .select()
      .from(referralBonusReversalsTable)
      .where(and(
        eq(referralBonusReversalsTable.tenantId, tenantId),
        eq(referralBonusReversalsTable.referralId, referralId),
      ))
      .limit(1);
    if (existingReversal) {
      return {
        reversalId: existingReversal.id,
        referralId,
        reservationId: (row.reservation_id as string | null) ?? null,
        referrerId: String(row.referrer_id),
        referredId: (row.referred_id as string | null) ?? null,
        bonusAmount: String(existingReversal.amount),
        reason: existingReversal.reason,
        alreadyReversed: true,
      };
    }

    if (row.status !== REFERRAL_STATUS.COMPLETED || row.bonus_paid !== true) {
      throw new AppError(
        "O estorno financeiro só pode ser feito para um bônus já pago de uma indicação convertida.",
        422,
        "REFERRAL_PAID_REVERSAL",
      );
    }

    const referrerId = String(row.referrer_id);
    const referredId = (row.referred_id as string | null) ?? null;
    const bonusAmount = Number(row.bonus_amount ?? 0);
    if (!Number.isFinite(bonusAmount) || bonusAmount <= 0) {
      throw new AppError("O bônus pago não possui um valor financeiro válido para estorno.", 422, "REFERRAL_INVALID_AMOUNT");
    }

    // Serialize this adjustment with conversion and reservation reversals.
    const clientLock = await tx.execute(
      sql`SELECT id FROM clients WHERE id = ${referrerId} AND tenant_id = ${tenantId} FOR UPDATE`,
    );
    if (!(clientLock.rows as Array<Record<string, unknown>>).length) {
      throw new AppError("Indicador não encontrado para receber o estorno.", 422, "REFERRAL_REFERRER_NOT_FOUND");
    }
    await tx.update(clientsTable)
      .set({
        successfulReferrals: sql`GREATEST(0, COALESCE(successful_referrals, 0) - 1)`,
        referralEarnings: sql`GREATEST(0, COALESCE(referral_earnings, 0) - ${bonusAmount.toFixed(2)})`,
      })
      .where(and(
        eq(clientsTable.id, referrerId),
        eq(clientsTable.tenantId, tenantId),
      ));

    const reversalAt = new Date();
    await tx.update(referralsTable)
      .set({
        status: REFERRAL_STATUS.REVERSED,
        reversalReason: reason,
        reversalAt,
        updatedAt: reversalAt,
      })
      .where(and(
        eq(referralsTable.id, referralId),
        eq(referralsTable.tenantId, tenantId),
        eq(referralsTable.status, REFERRAL_STATUS.COMPLETED),
        eq(referralsTable.bonusPaid, true),
      ));

    // A paid commission is also compensated; the original commission row is
    // retained for audit and its terminal state records the adjustment.
    await tx.execute(sql`
      UPDATE referral_commissions
      SET status = 'reversed', reversed_at = ${reversalAt}, updated_at = ${reversalAt}
      WHERE tenant_id = ${tenantId}
        AND referral_id = ${referralId}
        AND status IN ('pending', 'approved', 'paid')
    `);

    // Reverse the points granted by this referral once, preserving the
    // original loyalty transaction as an immutable credit.
    await tx.execute(sql`
      SELECT id FROM loyalty_members
      WHERE tenant_id = ${tenantId} AND client_id = ${referrerId}
      LIMIT 1 FOR UPDATE
    `);
    const [loyaltyMember] = await tx
      .select({
        id: loyaltyMembersTable.id,
        totalPoints: loyaltyMembersTable.totalPoints,
        availablePoints: loyaltyMembersTable.availablePoints,
      })
      .from(loyaltyMembersTable)
      .where(and(
        eq(loyaltyMembersTable.tenantId, tenantId),
        eq(loyaltyMembersTable.clientId, referrerId),
      ))
      .limit(1);
    if (loyaltyMember) {
      const [referralPoints] = await tx
        .select({ id: loyaltyTransactionsTable.id, points: loyaltyTransactionsTable.points })
        .from(loyaltyTransactionsTable)
        .where(and(
          eq(loyaltyTransactionsTable.tenantId, tenantId),
          eq(loyaltyTransactionsTable.memberId, loyaltyMember.id),
          eq(loyaltyTransactionsTable.type, "referral"),
          eq(loyaltyTransactionsTable.referenceId, referralId),
          eq(loyaltyTransactionsTable.referenceType, "referral"),
        ))
        .limit(1);
      if (referralPoints && referralPoints.points > 0) {
        const [existingPointsReversal] = await tx
          .select({ id: loyaltyTransactionsTable.id })
          .from(loyaltyTransactionsTable)
          .where(and(
            eq(loyaltyTransactionsTable.tenantId, tenantId),
            eq(loyaltyTransactionsTable.memberId, loyaltyMember.id),
            eq(loyaltyTransactionsTable.referenceId, referralId),
            eq(loyaltyTransactionsTable.referenceType, "referral_reversal"),
          ))
          .limit(1);
        if (!existingPointsReversal) {
          const newTotalPoints = Math.max(0, loyaltyMember.totalPoints - referralPoints.points);
          await tx.update(loyaltyMembersTable)
            .set({
              totalPoints: newTotalPoints,
              availablePoints: sql`GREATEST(0, ${loyaltyMember.availablePoints}::integer - ${referralPoints.points}::integer)`,
              tier: calculateTier(newTotalPoints),
              lastActivityAt: reversalAt,
            })
            .where(and(
              eq(loyaltyMembersTable.id, loyaltyMember.id),
              eq(loyaltyMembersTable.tenantId, tenantId),
            ));
          await tx.insert(loyaltyTransactionsTable).values({
            id: `${referralId}:reversal`,
            tenantId,
            memberId: loyaltyMember.id,
            type: "redeem",
            points: -referralPoints.points,
            description: `Estorno de pontos — indicação ${referralId}`,
            referenceId: referralId,
            referenceType: "referral_reversal",
          });
        }
      }
    }

    const reversalId = generateId();
    await tx.insert(referralBonusReversalsTable).values({
      id: reversalId,
      tenantId,
      referralId,
      amount: bonusAmount.toFixed(2),
      reason,
      initiatedById,
      confirmedAt: reversalAt,
    });

    return {
      reversalId,
      referralId,
      reservationId: (row.reservation_id as string | null) ?? null,
      referrerId,
      referredId,
      bonusAmount: bonusAmount.toFixed(2),
      reason,
      alreadyReversed: false,
    };
  });
}