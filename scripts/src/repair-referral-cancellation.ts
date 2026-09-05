/**
 * Repairs one missed referral reversal for a cancelled reservation.
 *
 * This script is intentionally scoped to one tenant, one referral and one
 * reservation. It is normally invoked by the explicitly requested Vercel
 * production one-shot repair hook, first without --apply and then with it.
 */

import { randomUUID } from "node:crypto";
import {
  auditLogsTable,
  clientsTable,
  db,
  pool,
  referralCommissionsTable,
  referralsTable,
  reservationsTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

const tenantId = argument("--tenant-id")?.trim();
const referralId = argument("--referral-id")?.trim();
const reservationId = argument("--reservation-id")?.trim();
const reason = argument("--reason")?.trim();
const apply = process.argv.includes("--apply");

type RepairResult = {
  status: "dry-run" | "repaired" | "already-repaired" | "not-found";
  tenantId: string;
  referralId: string;
  reservationId: string;
  bonusAmount: string | null;
  previousReferralStatus: string | null;
  referralStatus: string | null;
  previousSuccessfulReferrals: number | null;
  successfulReferrals: number | null;
  previousReferralEarnings: string | null;
  referralEarnings: string | null;
  reservationMarkedAt: string | null;
  auditLogWritten: boolean;
};

function printResult(result: RepairResult): void {
  console.log(`REPAIR_RESULT ${JSON.stringify(result)}`);
}

async function main(): Promise<void> {
  if (!tenantId || !referralId || !reservationId || !reason) {
    throw new Error(
      "Informe --tenant-id, --referral-id, --reservation-id e --reason. O reparo nunca pesquisa entre tenants.",
    );
  }

  const [candidate] = await db
    .select({
      referralId: referralsTable.id,
      referralStatus: referralsTable.status,
      bonusPaid: referralsTable.bonusPaid,
      bonusAmount: referralsTable.bonusAmount,
      referralReservationId: referralsTable.reservationId,
      reservationId: reservationsTable.id,
      reservationStatus: reservationsTable.status,
      referrerId: referralsTable.referrerId,
      successfulReferrals: clientsTable.successfulReferrals,
      referralEarnings: clientsTable.referralEarnings,
    })
    .from(referralsTable)
    .leftJoin(
      reservationsTable,
      and(
        eq(reservationsTable.id, referralsTable.reservationId),
        eq(reservationsTable.tenantId, tenantId),
      ),
    )
    .leftJoin(
      clientsTable,
      and(
        eq(clientsTable.id, referralsTable.referrerId),
        eq(clientsTable.tenantId, tenantId),
      ),
    )
    .where(
      and(
        eq(referralsTable.id, referralId),
        eq(referralsTable.tenantId, tenantId),
        eq(referralsTable.reservationId, reservationId),
        eq(reservationsTable.id, reservationId),
      ),
    )
    .limit(1);

  if (!candidate) {
    printResult({
      status: "not-found",
      tenantId,
      referralId,
      reservationId,
      bonusAmount: null,
      previousReferralStatus: null,
      referralStatus: null,
      previousSuccessfulReferrals: null,
      successfulReferrals: null,
      previousReferralEarnings: null,
      referralEarnings: null,
      reservationMarkedAt: null,
      auditLogWritten: false,
    });
    return;
  }

  const baseResult = {
    tenantId,
    referralId,
    reservationId,
    bonusAmount: candidate.bonusAmount == null ? null : String(candidate.bonusAmount),
    previousReferralStatus: candidate.referralStatus,
    previousSuccessfulReferrals: candidate.successfulReferrals,
    previousReferralEarnings:
      candidate.referralEarnings == null ? null : String(candidate.referralEarnings),
  };

  if (candidate.referralStatus === "reversed") {
    printResult({
      ...baseResult,
      status: "already-repaired",
      referralStatus: "reversed",
      successfulReferrals: candidate.successfulReferrals,
      referralEarnings:
        candidate.referralEarnings == null ? null : String(candidate.referralEarnings),
      reservationMarkedAt: null,
      auditLogWritten: false,
    });
    return;
  }

  if (candidate.referralStatus !== "completed") {
    throw new Error(`Indicação ${referralId} está em status inesperado: ${candidate.referralStatus}.`);
  }
  if (candidate.bonusPaid) {
    throw new Error(`Indicação ${referralId} já tem bônus pago; este reparo não altera bônus pagos.`);
  }
  if (candidate.reservationStatus !== "cancelled") {
    throw new Error(
      `A reserva ${reservationId} não está cancelada: ${candidate.reservationStatus ?? "ausente"}.`,
    );
  }

  if (!apply) {
    printResult({
      ...baseResult,
      status: "dry-run",
      referralStatus: candidate.referralStatus,
      successfulReferrals: candidate.successfulReferrals == null
        ? null
        : Math.max(0, candidate.successfulReferrals - 1),
      referralEarnings: candidate.referralEarnings == null
        ? null
        : Math.max(0, Number(candidate.referralEarnings) - Number(candidate.bonusAmount ?? 0)).toFixed(2),
      reservationMarkedAt: null,
      auditLogWritten: false,
    });
    return;
  }

  const result = await db.transaction<RepairResult>(async (tx) => {
    const [lockedReferral] = await tx
      .select({
        id: referralsTable.id,
        status: referralsTable.status,
        bonusPaid: referralsTable.bonusPaid,
        bonusAmount: referralsTable.bonusAmount,
        referrerId: referralsTable.referrerId,
        reservationId: referralsTable.reservationId,
      })
      .from(referralsTable)
      .where(
        and(
          eq(referralsTable.id, referralId),
          eq(referralsTable.tenantId, tenantId),
          eq(referralsTable.reservationId, reservationId),
        ),
      )
      .for("update")
      .limit(1);

    const [lockedReservation] = await tx
      .select({
        id: reservationsTable.id,
        status: reservationsTable.status,
        referralReversalAt: reservationsTable.referralReversalAt,
      })
      .from(reservationsTable)
      .where(
        and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)),
      )
      .for("update")
      .limit(1);

    if (!lockedReferral || !lockedReservation) {
      return {
        ...baseResult,
        status: "not-found",
        referralStatus: null,
        successfulReferrals: null,
        referralEarnings: null,
        reservationMarkedAt: null,
        auditLogWritten: false,
      };
    }

    if (lockedReferral.status === "reversed" && lockedReservation.referralReversalAt) {
      return {
        ...baseResult,
        status: "already-repaired",
        referralStatus: "reversed",
        successfulReferrals: candidate.successfulReferrals,
        referralEarnings:
          candidate.referralEarnings == null ? null : String(candidate.referralEarnings),
        reservationMarkedAt: lockedReservation.referralReversalAt.toISOString(),
        auditLogWritten: false,
      };
    }
    if (lockedReferral.status !== "completed" || lockedReferral.bonusPaid) {
      throw new Error(`Estado mudou durante o reparo da indicação ${referralId}.`);
    }
    if (lockedReservation.status !== "cancelled") {
      throw new Error(`A reserva ${reservationId} não está cancelada no momento do reparo.`);
    }

    const bonusAmount = Number(lockedReferral.bonusAmount ?? 0);
    if (!Number.isFinite(bonusAmount) || bonusAmount < 0) {
      throw new Error(`Bônus inválido na indicação ${referralId}.`);
    }

    await tx.execute(
      sql`SELECT id FROM clients WHERE id = ${lockedReferral.referrerId}
          AND tenant_id = ${tenantId} FOR UPDATE`,
    );

    const reversalAt = new Date();
    await tx
      .update(clientsTable)
      .set({
        successfulReferrals: sql`GREATEST(0, COALESCE(successful_referrals, 0) - 1)`,
        referralEarnings: sql`GREATEST(0, COALESCE(referral_earnings, 0) - ${bonusAmount.toFixed(2)})`,
      })
      .where(
        and(
          eq(clientsTable.id, lockedReferral.referrerId),
          eq(clientsTable.tenantId, tenantId),
        ),
      );

    await tx
      .update(referralsTable)
      .set({
        status: "reversed",
        reversalReason: reason,
        reversalAt,
        updatedAt: reversalAt,
      })
      .where(
        and(
          eq(referralsTable.id, referralId),
          eq(referralsTable.tenantId, tenantId),
          eq(referralsTable.status, "completed"),
        ),
      );

    await tx
      .update(referralCommissionsTable)
      .set({ status: "reversed", reversedAt: reversalAt, updatedAt: reversalAt })
      .where(
        and(
          eq(referralCommissionsTable.tenantId, tenantId),
          eq(referralCommissionsTable.referralId, referralId),
          inArray(referralCommissionsTable.status, ["pending", "approved"]),
        ),
      );

    await tx
      .update(reservationsTable)
      .set({ referralReversalAt: reversalAt })
      .where(
        and(
          eq(reservationsTable.id, reservationId),
          eq(reservationsTable.tenantId, tenantId),
          sql`${reservationsTable.referralReversalAt} IS NULL`,
        ),
      );

    await tx.insert(auditLogsTable).values({
      id: randomUUID(),
      tenantId,
      userId: null,
      action: "repair_referral_cancellation",
      entityType: "referral",
      entityId: referralId,
      before: {
        status: lockedReferral.status,
        bonusPaid: lockedReferral.bonusPaid,
        bonusAmount: String(lockedReferral.bonusAmount ?? "0"),
        reservationId,
        successfulReferrals: candidate.successfulReferrals,
        referralEarnings: candidate.referralEarnings,
      },
      after: {
        status: "reversed",
        reversalReason: reason,
        reservationReferralReversalAt: reversalAt.toISOString(),
        source: "production_one_shot_repair",
      },
    });

    const [updatedClient] = await tx
      .select({
        successfulReferrals: clientsTable.successfulReferrals,
        referralEarnings: clientsTable.referralEarnings,
      })
      .from(clientsTable)
      .where(
        and(
          eq(clientsTable.id, lockedReferral.referrerId),
          eq(clientsTable.tenantId, tenantId),
        ),
      )
      .limit(1);

    return {
      ...baseResult,
      status: "repaired",
      referralStatus: "reversed",
      successfulReferrals: updatedClient?.successfulReferrals ?? null,
      referralEarnings:
        updatedClient?.referralEarnings == null ? null : String(updatedClient.referralEarnings),
      reservationMarkedAt: reversalAt.toISOString(),
      auditLogWritten: true,
    };
  });

  printResult(result);
}

main()
  .catch((error) => {
    console.error("repair-referral-cancellation falhou:", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());