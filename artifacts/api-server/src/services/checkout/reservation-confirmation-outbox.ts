import { db, whatsappNotificationOutboxTable, type WhatsAppOutboxType } from "@workspace/db";
import { and, eq, inArray, isNull, lt, not, or, sql } from "drizzle-orm";
import { generateId } from "../../lib/id";
import { logger } from "../../lib/logger";
import { getWhatsAppQueue } from "../../queues/index";
import { dispatchWhatsAppReservationConfirmed } from "../../queues/whatsapp-helpers";

const RESERVATION_CONFIRMED = "reservation_confirmed" as const;
const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;

export type ReservationReminderType = Extract<
  WhatsAppOutboxType,
  "boarding_reminder" | "payment_pending"
>;

/**
 * Runs a reminder only once for its Brazil calendar day. The durable unique
 * key and conditional claim protect against overlapping crons, queue retries
 * and application restarts. Failed delivery is deliberately released to
 * `pending`, allowing the same day's next cron run to recover it.
 */
export async function deliverReservationReminderOnce(opts: {
  reservationId: string;
  tenantId: string;
  type: ReservationReminderType;
  referenceDate: string;
  deliver: () => Promise<boolean>;
}): Promise<"sent" | "duplicate" | "failed"> {
  const { reservationId, tenantId, type, referenceDate, deliver } = opts;
  await db
    .insert(whatsappNotificationOutboxTable)
    .values({
      id: generateId(),
      tenantId,
      reservationId,
      type,
      referenceDate,
    })
    .onConflictDoNothing();

  const claimed = await db
    .update(whatsappNotificationOutboxTable)
    .set({
      status: "processing",
      attempts: sql`${whatsappNotificationOutboxTable.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappNotificationOutboxTable.tenantId, tenantId),
        eq(whatsappNotificationOutboxTable.reservationId, reservationId),
        eq(whatsappNotificationOutboxTable.type, type),
        eq(whatsappNotificationOutboxTable.referenceDate, referenceDate),
        isNull(whatsappNotificationOutboxTable.sentAt),
        not(eq(whatsappNotificationOutboxTable.status, "processing")),
      ),
    )
    .returning({ id: whatsappNotificationOutboxTable.id });

  if (!claimed.length) return "duplicate";

  try {
    const delivered = await deliver();
    await db
      .update(whatsappNotificationOutboxTable)
      .set(
        delivered
          ? { status: "sent", sentAt: new Date(), lastError: null }
          : { status: "pending", lastError: "delivery_failed" },
      )
      .where(eq(whatsappNotificationOutboxTable.id, claimed[0].id));
    return delivered ? "sent" : "failed";
  } catch (err) {
    await db
      .update(whatsappNotificationOutboxTable)
      .set({
        status: "pending",
        lastError: err instanceof Error ? err.message.slice(0, 240) : "delivery_failed",
      })
      .where(eq(whatsappNotificationOutboxTable.id, claimed[0].id));
    return "failed";
  }
}

/** Releases reminder claims after an interrupted process so the same Brazil
 * calendar-day reminder remains recoverable without creating a second row. */
export async function resetStaleReservationReminderClaims(): Promise<number> {
  const staleBefore = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
  const reset = await db
    .update(whatsappNotificationOutboxTable)
    .set({ status: "pending", lastError: "processing_timeout", updatedAt: new Date() })
    .where(
      and(
        inArray(whatsappNotificationOutboxTable.type, ["boarding_reminder", "payment_pending"]),
        eq(whatsappNotificationOutboxTable.status, "processing"),
        lt(whatsappNotificationOutboxTable.updatedAt, staleBefore),
        isNull(whatsappNotificationOutboxTable.sentAt),
      ),
    )
    .returning({ id: whatsappNotificationOutboxTable.id });
  return reset.length;
}

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
      referenceDate: "confirmation",
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

  // Atomically claim the row by transitioning pending/enqueued → processing.
  // If another worker already claimed it (status = 'processing' or sentAt set),
  // the conditional update returns 0 rows and we bail out to avoid duplicate delivery.
  const claimed = await db
    .update(whatsappNotificationOutboxTable)
    .set({ status: "processing", updatedAt: new Date() })
    .where(
      and(
        eq(whatsappNotificationOutboxTable.id, outbox.id),
        isNull(whatsappNotificationOutboxTable.sentAt),
        not(eq(whatsappNotificationOutboxTable.status, "processing")),
      ),
    )
    .returning({ id: whatsappNotificationOutboxTable.id });

  if (!claimed.length) {
    logger.info({ outboxId }, "[whatsapp-outbox] Row already claimed by another worker — skipping");
    return true;
  }

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

/**
 * Releases claims left behind by a worker that crashed during delivery.
 * updatedAt is advanced explicitly because the claim update must start the
 * timeout window even when the ORM's $onUpdate hook is not involved.
 */
export async function resetStaleReservationConfirmedWhatsApps(): Promise<number> {
  const staleBefore = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
  const reset = await db
    .update(whatsappNotificationOutboxTable)
    .set({
      status: "pending",
      lastError: "processing_timeout",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappNotificationOutboxTable.type, RESERVATION_CONFIRMED),
        eq(whatsappNotificationOutboxTable.status, "processing"),
        lt(whatsappNotificationOutboxTable.updatedAt, staleBefore),
        isNull(whatsappNotificationOutboxTable.sentAt),
      ),
    )
    .returning({ id: whatsappNotificationOutboxTable.id });

  if (reset.length > 0) {
    logger.warn(
      { count: reset.length, staleBefore },
      "[whatsapp-outbox] Reset stale processing rows for retry",
    );
  }
  return reset.length;
}

/** Retries durable notifications left pending by a queue or provider failure. */
export async function retryPendingReservationConfirmedWhatsApps(): Promise<void> {
  await resetStaleReservationConfirmedWhatsApps();

  const pending = await db
    .select({
      reservationId: whatsappNotificationOutboxTable.reservationId,
      tenantId: whatsappNotificationOutboxTable.tenantId,
    })
    .from(whatsappNotificationOutboxTable)
    .where(
      and(
        eq(whatsappNotificationOutboxTable.type, RESERVATION_CONFIRMED),
        or(
          eq(whatsappNotificationOutboxTable.status, "pending"),
          eq(whatsappNotificationOutboxTable.status, "enqueued"),
        ),
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