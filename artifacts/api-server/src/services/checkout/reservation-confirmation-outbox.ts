import { db, whatsappNotificationOutboxTable } from "@workspace/db";
import { and, eq, isNull, ne } from "drizzle-orm";
import { generateId } from "../../lib/id";
import { logger } from "../../lib/logger";
import { getWhatsAppQueue } from "../../queues/index";
import { dispatchWhatsAppReservationConfirmed } from "../../queues/whatsapp-helpers";

const RESERVATION_CONFIRMED = "reservation_confirmed" as const;

/**
 * Creates (or resumes) the one durable reservation-confirmation notification.
 * A deterministic queue job makes re-enqueueing after a process crash safe.
 */
export async function scheduleReservationConfirmedWhatsApp(
  reservationId: string,
  tenantId: string,
): Promise<void> {
  const [created] = await db
    .insert(whatsappNotificationOutboxTable)
    .values({
      id: generateId(),
      tenantId,
      reservationId,
      type: RESERVATION_CONFIRMED,
    })
    .onConflictDoNothing()
    .returning({
      id: whatsappNotificationOutboxTable.id,
      sentAt: whatsappNotificationOutboxTable.sentAt,
    });

  const [outbox] = created
    ? [created]
    : await db
        .select({
          id: whatsappNotificationOutboxTable.id,
          sentAt: whatsappNotificationOutboxTable.sentAt,
        })
        .from(whatsappNotificationOutboxTable)
        .where(
          and(
            eq(whatsappNotificationOutboxTable.tenantId, tenantId),
            eq(whatsappNotificationOutboxTable.reservationId, reservationId),
            eq(whatsappNotificationOutboxTable.type, RESERVATION_CONFIRMED),
          ),
        )
        .limit(1);

  if (!outbox || outbox.sentAt) return;

  const queue = getWhatsAppQueue();
  if (queue) {
    await queue.add(
      "reservation-confirmed",
      { kind: "reservation-confirmed", outboxId: outbox.id },
      { jobId: `reservation-confirmed:${outbox.id}` },
    );
    await db
      .update(whatsappNotificationOutboxTable)
      .set({ status: "enqueued", enqueuedAt: new Date(), lastError: null })
      .where(and(eq(whatsappNotificationOutboxTable.id, outbox.id), isNull(whatsappNotificationOutboxTable.sentAt)));
    return;
  }

  // Development/single-instance deployments can run without Redis. Delivering
  // directly still leaves failures pending so the next payment retry can recover.
  await deliverReservationConfirmedWhatsApp(outbox.id);
}

/**
 * Called by the WhatsApp worker. Returns false instead of throwing so its caller
 * can use the queue's retry policy while the outbox row remains recoverable.
 */
export async function deliverReservationConfirmedWhatsApp(outboxId: string): Promise<boolean> {
  const [outbox] = await db
    .select({
      id: whatsappNotificationOutboxTable.id,
      tenantId: whatsappNotificationOutboxTable.tenantId,
      reservationId: whatsappNotificationOutboxTable.reservationId,
      sentAt: whatsappNotificationOutboxTable.sentAt,
    })
    .from(whatsappNotificationOutboxTable)
    .where(eq(whatsappNotificationOutboxTable.id, outboxId))
    .limit(1);

  if (!outbox || outbox.sentAt) return true;

  const delivered = await dispatchWhatsAppReservationConfirmed({
    reservationId: outbox.reservationId,
    tenantId: outbox.tenantId,
    delivery: "direct",
  });
  if (!delivered) {
    await db
      .update(whatsappNotificationOutboxTable)
      .set({ status: "pending", lastError: "delivery_failed" })
      .where(eq(whatsappNotificationOutboxTable.id, outbox.id));
    logger.warn({ outboxId }, "[whatsapp-outbox] Reservation confirmation delivery failed");
    return false;
  }

  await db
    .update(whatsappNotificationOutboxTable)
    .set({ status: "sent", sentAt: new Date(), lastError: null })
    .where(and(eq(whatsappNotificationOutboxTable.id, outbox.id), isNull(whatsappNotificationOutboxTable.sentAt)));
  return true;
}

/** Retries durable notifications left pending by a queue or provider failure. */
export async function retryPendingReservationConfirmedWhatsApps(): Promise<void> {
  const pending = await db
    .select({
      reservationId: whatsappNotificationOutboxTable.reservationId,
      tenantId: whatsappNotificationOutboxTable.tenantId,
    })
    .from(whatsappNotificationOutboxTable)
    .where(
      and(
        eq(whatsappNotificationOutboxTable.type, RESERVATION_CONFIRMED),
        ne(whatsappNotificationOutboxTable.status, "sent"),
      ),
    )
    .limit(100);

  await Promise.all(
    pending.map(({ reservationId, tenantId }) =>
      scheduleReservationConfirmedWhatsApp(reservationId, tenantId).catch((err) =>
        logger.warn({ err, reservationId, tenantId }, "[whatsapp-outbox] Failed to resume pending notification"),
      ),
    ),
  );
}