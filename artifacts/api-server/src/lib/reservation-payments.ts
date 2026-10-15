import { db } from "@workspace/db";
import { reservationsTable, paymentsTable, tripsTable } from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { roundMoney } from "./pricing";
import { RESERVATION_STATUS, PAYMENT_STATUS, PAYMENT_TYPE, type ReservationStatus } from "@workspace/permissions";
import { recomputeClientClassification } from "../services/client-classification.js";

export type DbExecutor = Pick<typeof db, "execute" | "select" | "insert" | "update" | "delete">;

export async function lockReservationsForPaymentReconciliation(
  tenantId: string,
  reservationIds: Iterable<string>,
  executor: DbExecutor,
): Promise<void> {
  const ids = [...new Set(reservationIds)].filter(Boolean);
  if (ids.length === 0) return;

  await executor
    .select({ id: reservationsTable.id })
    .from(reservationsTable)
    .where(and(
      eq(reservationsTable.tenantId, tenantId),
      inArray(reservationsTable.id, ids),
    ))
    .orderBy(asc(reservationsTable.id))
    .for("update");
}

type ReservationUpdate = Partial<typeof reservationsTable.$inferInsert> & {
  status?: ReservationStatus;
};

/**
 * PAID and APPROVED both consume a reservation's receivable balance.
 * Keep this definition shared by status changes and reservation snapshots.
 */
export async function sumReceivedReservationPayments(
  executor: DbExecutor,
  reservationId: string,
  tenantId: string,
): Promise<number> {
  const result = await executor.execute(sql`
    SELECT COALESCE(SUM(amount::numeric), 0) AS total_received
    FROM payments
    WHERE reservation_id = ${reservationId}
      AND tenant_id = ${tenantId}
      AND status IN (${PAYMENT_STATUS.PAID}, ${PAYMENT_STATUS.APPROVED})
  `);
  const row = (result as unknown as { rows: Array<{ total_received: string }> }).rows[0];
  return roundMoney(Number(row?.total_received ?? "0"));
}

export function allocateCumulativeRefundCents(
  receipts: ReadonlyArray<{ id: string; reservationId: string | null; amount: string | number }>,
  cumulativeRefundCents: number,
): Array<{ paymentId: string; refundCents: number }> {
  const ordered = [...receipts]
    .map((receipt) => ({
      ...receipt,
      grossCents: Math.max(0, Math.round(Number(receipt.amount) * 100)),
    }))
    .sort((a, b) =>
      (a.reservationId ?? "").localeCompare(b.reservationId ?? "") || a.id.localeCompare(b.id),
    );
  const grossTotalCents = ordered.reduce((sum, receipt) => sum + receipt.grossCents, 0);
  const targetCents = Math.min(
    grossTotalCents,
    Number.isSafeInteger(cumulativeRefundCents) ? Math.max(0, cumulativeRefundCents) : 0,
  );
  if (grossTotalCents === 0 || targetCents === 0) {
    return ordered.map(({ id }) => ({ paymentId: id, refundCents: 0 }));
  }

  const denominator = BigInt(grossTotalCents);
  const shares = ordered.map((receipt, index) => {
    const numerator = BigInt(targetCents) * BigInt(receipt.grossCents);
    return {
      paymentId: receipt.id,
      grossCents: receipt.grossCents,
      index,
      refundCents: Number(numerator / denominator),
      remainder: numerator % denominator,
    };
  });
  let remainingCents = targetCents - shares.reduce((sum, share) => sum + share.refundCents, 0);
  const remainderOrder = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const share of remainderOrder) {
    if (remainingCents === 0) break;
    if (share.refundCents >= share.grossCents) continue;
    share.refundCents++;
    remainingCents--;
  }
  return shares.map(({ paymentId, refundCents }) => ({ paymentId, refundCents }));
}

export async function applyCumulativeStripeRefundToPayments(
  executor: DbExecutor,
  args: {
    tenantId: string;
    orderId: string;
    paymentIntentId: string;
    amountRefundedCents: number;
    chargeAmountCents: number;
    refundedAt?: Date;
  },
): Promise<{ reservationIds: string[] }> {
  const receipts = await executor
    .select({
      id: paymentsTable.id,
      tenantId: paymentsTable.tenantId,
      reservationId: paymentsTable.reservationId,
      clientId: sql<string | null>`COALESCE(${paymentsTable.clientId}, ${reservationsTable.clientId})`,
      amount: paymentsTable.amount,
      paymentMethod: paymentsTable.paymentMethod,
      installmentNumber: paymentsTable.installmentNumber,
      totalInstallments: paymentsTable.totalInstallments,
      dueDate: paymentsTable.dueDate,
      isTestMode: paymentsTable.isTestMode,
    })
    .from(paymentsTable)
    .leftJoin(reservationsTable, and(
      eq(reservationsTable.id, paymentsTable.reservationId),
      eq(reservationsTable.tenantId, paymentsTable.tenantId),
    ))
    .where(and(
      eq(paymentsTable.tenantId, args.tenantId),
      eq(paymentsTable.orderId, args.orderId),
      eq(paymentsTable.gateway, "stripe"),
      eq(paymentsTable.transactionId, args.paymentIntentId),
      eq(paymentsTable.type, PAYMENT_TYPE.RECEIVABLE),
      inArray(paymentsTable.status, [PAYMENT_STATUS.PAID, PAYMENT_STATUS.APPROVED]),
      sql`${paymentsTable.amount}::numeric > 0`,
    ))
    .orderBy(asc(paymentsTable.reservationId), asc(paymentsTable.id));

  if (receipts.length === 0) return { reservationIds: [] };

  const transactionIdPrefix = `stripe-refund-allocation:${args.paymentIntentId}:`;
  const existingRefundRows = await executor
    .select({
      id: paymentsTable.id,
      transactionId: paymentsTable.transactionId,
      amount: paymentsTable.amount,
    })
    .from(paymentsTable)
    .where(and(
      eq(paymentsTable.tenantId, args.tenantId),
      eq(paymentsTable.orderId, args.orderId),
      eq(paymentsTable.gateway, "stripe"),
      eq(paymentsTable.category, "stripe_refund"),
      sql`LEFT(${paymentsTable.transactionId}, ${transactionIdPrefix.length}) = ${transactionIdPrefix}`,
    ));
  const previouslyRefundedCents = existingRefundRows.reduce((sum, row) => {
    const cents = Math.round(Number(row.amount) * 100);
    return sum + (cents < 0 ? -cents : 0);
  }, 0);
  const requestedCents = Math.min(
    Math.max(0, Math.floor(args.chargeAmountCents)),
    Math.max(0, Math.floor(args.amountRefundedCents)),
  );
  const cumulativeRefundCents = Math.max(previouslyRefundedCents, requestedCents);
  const allocations = allocateCumulativeRefundCents(
    receipts,
    cumulativeRefundCents,
  );
  const existingById = new Map(existingRefundRows.map((row) => [row.id, row]));
  const reservationIds = new Set<string>();
  const refundedAt = args.refundedAt ?? new Date();

  for (const receipt of receipts) {
    const allocation = allocations.find((row) => row.paymentId === receipt.id);
    if (!allocation || allocation.refundCents <= 0) continue;
    const transactionId = `${transactionIdPrefix}${receipt.id}`;
    const refundRowId = transactionId;
    const existing = existingById.get(refundRowId);
    const refundRow = {
      amount: (-allocation.refundCents / 100).toFixed(2),
      status: PAYMENT_STATUS.PAID,
      description: "Reembolso parcial Stripe alocado ao recebimento",
    };
    if (existing) {
      await executor.update(paymentsTable)
        .set(refundRow)
        .where(and(
          eq(paymentsTable.id, existing.id),
          eq(paymentsTable.tenantId, args.tenantId),
        ));
    } else {
      await executor.insert(paymentsTable).values({
        id: refundRowId,
        tenantId: args.tenantId,
        reservationId: receipt.reservationId,
        clientId: receipt.clientId,
        orderId: args.orderId,
        type: PAYMENT_TYPE.RECEIVABLE,
        category: "stripe_refund",
        amount: refundRow.amount,
        paymentMethod: receipt.paymentMethod,
        installmentNumber: receipt.installmentNumber,
        totalInstallments: receipt.totalInstallments,
        dueDate: refundedAt,
        paidAt: refundedAt,
        status: PAYMENT_STATUS.PAID,
        gateway: "stripe",
        transactionId,
        isTestMode: receipt.isTestMode,
        description: refundRow.description,
      });
    }
    if (receipt.reservationId) reservationIds.add(receipt.reservationId);
  }
  return { reservationIds: [...reservationIds].sort() };
}

export async function recalculateReservationPaymentAmountsPreservingStatus(
  reservationId: string,
  tenantId: string,
  executor: DbExecutor,
): Promise<void> {
  const [reservation] = await executor
    .select({
      id: reservationsTable.id,
      totalValue: reservationsTable.totalValue,
    })
    .from(reservationsTable)
    .where(and(
      eq(reservationsTable.id, reservationId),
      eq(reservationsTable.tenantId, tenantId),
    ))
    .for("update")
    .limit(1);
  if (!reservation) return;

  const paidValue = await sumReceivedReservationPayments(executor, reservationId, tenantId);
  const balance = roundMoney(Math.max(Number(reservation.totalValue) - paidValue, 0));
  await executor.update(reservationsTable)
    .set({ paidValue: String(paidValue), balance: String(balance) })
    .where(and(
      eq(reservationsTable.id, reservationId),
      eq(reservationsTable.tenantId, tenantId),
    ));
}

export async function syncReservationPaymentStatus(
  reservationId: string,
  tenantId: string,
  executor?: DbExecutor,
): Promise<void> {
  if (!executor) {
    // Keep the parent lock while aggregating payment rows and writing the
    // reservation snapshot; standalone callers otherwise have no transaction.
    await db.transaction(async (tx) => {
      await syncReservationPaymentStatus(reservationId, tenantId, tx);
    });
    return;
  }

  // Match reservation-total edits: lock the parent before reading its financial
  // fields so paidValue and balance are based on the latest totalValue.
  const [reservation] = await executor
    .select()
    .from(reservationsTable)
    .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)))
    .for("update")
    .limit(1);
  if (!reservation) return;

  const totalValue = roundMoney(Number(reservation.totalValue));
  const paidValue = await sumReceivedReservationPayments(executor, reservationId, tenantId);
  const balance = roundMoney(Math.max(totalValue - paidValue, 0));
  const isExpired = String(reservation.status) === "expired";

  if (
    reservation.status === RESERVATION_STATUS.CANCELLED ||
    reservation.status === RESERVATION_STATUS.COMPLETED ||
    reservation.status === RESERVATION_STATUS.REFUNDED ||
    isExpired
  ) {
    await executor
      .update(reservationsTable)
      .set({ paidValue: String(paidValue), balance: String(balance) })
      .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)));
    if (reservation.clientId) {
      await recomputeClientClassification({
        tenantId,
        clientId: reservation.clientId,
        trigger: reservation.status === RESERVATION_STATUS.CANCELLED
          ? "reservation_cancelled"
          : reservation.status === RESERVATION_STATUS.REFUNDED
            ? "reservation_refunded"
            : isExpired
              ? "reservation_expired"
              : "payment_recalculation",
        sourceId: reservation.id,
        reason: reservation.status === RESERVATION_STATUS.CANCELLED
          ? "Reserva cancelada; indicadores de classificação recalculados."
          : reservation.status === RESERVATION_STATUS.REFUNDED
            ? "Reserva reembolsada; indicadores de classificação recalculados."
            : isExpired
              ? "Reserva expirada; indicadores de classificação recalculados."
              : "Pagamento da reserva sincronizado.",
      }, executor);
    }
    return;
  }

  const updates: ReservationUpdate = {
    paidValue: String(paidValue),
    balance: String(balance),
  };

  const previousStatus = reservation.status;

  if (paidValue >= totalValue) {
    updates.status = RESERVATION_STATUS.CONFIRMED;
    if (!reservation.confirmedAt) updates.confirmedAt = new Date();
    updates.expiresAt = null;
  } else if (reservation.status === RESERVATION_STATUS.CONFIRMED) {
    // Reservations confirmed via minimum deposit must stay confirmed
    // even when additional partial payments haven't yet reached totalValue.
    if (!reservation.depositAmount) {
      updates.status = RESERVATION_STATUS.PENDING;
    }
  } else if (
    reservation.status === RESERVATION_STATUS.PENDING
    && reservation.depositAmount
    && paidValue >= roundMoney(Number(reservation.depositAmount))
  ) {
    // A requested deposit does not confirm a reservation by itself. Once a
    // real receivable payment reaches the requested deposit, promote it and
    // move its seats from reserved to confirmed.
    updates.status = RESERVATION_STATUS.CONFIRMED;
    if (!reservation.confirmedAt) updates.confirmedAt = new Date();
    updates.expiresAt = null;
  }

  await executor
    .update(reservationsTable)
    .set(updates)
    .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)));

  // Keep trip seat counters in sync when a payment auto-promotes or auto-demotes a reservation.
  // Only reservations linked to a trip carry a tripId; client-only payment records don't.
  const newStatus = updates.status;
  if (newStatus && newStatus !== previousStatus && reservation.tripId) {
    const seatsCount = reservation.capacityUnits > 0
      ? reservation.capacityUnits
      : (Array.isArray(reservation.seats) ? reservation.seats.length : 0);
    if (seatsCount > 0) {
      const isNowConfirmed = newStatus === RESERVATION_STATUS.CONFIRMED && previousStatus === RESERVATION_STATUS.PENDING;
      const isNowPending = newStatus === RESERVATION_STATUS.PENDING && previousStatus === RESERVATION_STATUS.CONFIRMED;

      if (isNowConfirmed) {
        await executor.update(tripsTable).set({
          confirmedSeats: sql`confirmed_seats + ${seatsCount}`,
          reservedSeats: sql`GREATEST(0, reserved_seats - ${seatsCount})`,
        }).where(and(eq(tripsTable.id, reservation.tripId), eq(tripsTable.tenantId, tenantId)));
      } else if (isNowPending) {
        await executor.update(tripsTable).set({
          confirmedSeats: sql`GREATEST(0, confirmed_seats - ${seatsCount})`,
          reservedSeats: sql`reserved_seats + ${seatsCount}`,
        }).where(and(eq(tripsTable.id, reservation.tripId), eq(tripsTable.tenantId, tenantId)));
      }
    }
  }
  if (reservation.clientId) {
    await recomputeClientClassification({
      tenantId,
      clientId: reservation.clientId,
      trigger: "payment_recalculation",
      sourceId: reservation.id,
      reason: "Pagamento da reserva sincronizado.",
    }, executor);
  }
}

export async function paymentExistsForGatewayTx(
  tenantId: string,
  gateway: string,
  transactionId: string,
  executor: DbExecutor = db,
): Promise<boolean> {
  const [existing] = await executor
    .select({ id: paymentsTable.id })
    .from(paymentsTable)
    .where(
      and(
        eq(paymentsTable.tenantId, tenantId),
        eq(paymentsTable.gateway, gateway),
        eq(paymentsTable.transactionId, transactionId),
      ),
    )
    .limit(1);
  return !!existing;
}
