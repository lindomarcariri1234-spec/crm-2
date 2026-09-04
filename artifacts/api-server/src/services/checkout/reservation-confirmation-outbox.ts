import {
  db,
  platformSettingsTable,
  whatsappNotificationOutboxTable,
  type WhatsAppOutboxType,
} from "@workspace/db";
import { and, count, eq, inArray, isNull, lt, min, not, or, sql } from "drizzle-orm";
import { generateId } from "../../lib/id";
import { logger } from "../../lib/logger";
import { getWhatsAppQueue } from "../../queues/index";
import { dispatchWhatsAppReservationConfirmed } from "../../queues/whatsapp-helpers";

const RESERVATION_CONFIRMED = "reservation_confirmed" as const;
const PROCESSING_TIMEOUT_MS = 15 * 60 * 1000;
const UNKNOWN_CONFIRMATION_ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const UNKNOWN_CONFIRMATION_ALERT_AGE_STEP_MINUTES = 60;
const UNKNOWN_CONFIRMATION_ALERT_KEY_PREFIX = "whatsapp_unknown_confirmation_alert:";
const UNKNOWN_CONFIRMATION_ALERT_LABEL = "Last unknown reservation confirmation alert (JSON)";

type UnknownConfirmationAlertState = {
  lastAlertAt: number;
  lastCount: number;
  lastAgeMinutes: number | null;
};

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
      status: whatsappNotificationOutboxTable.status,
    });

  const [outbox] = created
    ? [created]
    : await db
        .select({
          id: whatsappNotificationOutboxTable.id,
          sentAt: whatsappNotificationOutboxTable.sentAt,
          status: whatsappNotificationOutboxTable.status,
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

  if (!outbox || outbox.sentAt || outbox.status === "unknown") return;

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
 * Called by the WhatsApp worker. A provider failure releases the active claim
 * back to pending; an already-ambiguous claim is never reopened by this call.
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
    .set({
      status: "processing",
      attempts: sql`${whatsappNotificationOutboxTable.attempts} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(whatsappNotificationOutboxTable.id, outbox.id),
        isNull(whatsappNotificationOutboxTable.sentAt),
        or(
          eq(whatsappNotificationOutboxTable.status, "pending"),
          eq(whatsappNotificationOutboxTable.status, "enqueued"),
        ),
      ),
    )
    .returning({ id: whatsappNotificationOutboxTable.id });

  if (!claimed.length) {
    logger.info({ outboxId }, "[whatsapp-outbox] Row already claimed by another worker — skipping");
    return true;
  }

  let delivered = false;
  try {
    delivered = await dispatchWhatsAppReservationConfirmed({
      reservationId: outbox.reservationId,
      tenantId: outbox.tenantId,
      delivery: "direct",
    });
  } catch (err) {
    logger.warn({ outboxId, err }, "[whatsapp-outbox] Reservation confirmation delivery threw");
  }
  if (!delivered) {
    const [released] = await db
      .update(whatsappNotificationOutboxTable)
      .set({ status: "pending", lastError: "delivery_failed" })
      .where(and(
        eq(whatsappNotificationOutboxTable.id, outbox.id),
        eq(whatsappNotificationOutboxTable.status, "processing"),
        isNull(whatsappNotificationOutboxTable.sentAt),
      ))
      .returning({ id: whatsappNotificationOutboxTable.id });
    if (released) {
      logger.warn({ outboxId }, "[whatsapp-outbox] Reservation confirmation delivery failed");
    } else {
      logger.warn({ outboxId }, "[whatsapp-outbox] Late failure left ambiguous confirmation untouched");
    }
    return false;
  }

  await db
    .update(whatsappNotificationOutboxTable)
    .set({ status: "sent", sentAt: new Date(), lastError: null })
    .where(and(
      eq(whatsappNotificationOutboxTable.id, outbox.id),
      isNull(whatsappNotificationOutboxTable.sentAt),
      or(
        eq(whatsappNotificationOutboxTable.status, "processing"),
        eq(whatsappNotificationOutboxTable.status, "unknown"),
      ),
    ));
  return true;
}

/**
 * Marks claims left behind by a worker that crashed during delivery as unknown.
 * updatedAt is advanced explicitly because the claim update must start the
 * timeout window even when the ORM's $onUpdate hook is not involved.
 */
export async function resetStaleReservationConfirmedWhatsApps(): Promise<number> {
  const staleBefore = new Date(Date.now() - PROCESSING_TIMEOUT_MS);
  const reset = await db
    .update(whatsappNotificationOutboxTable)
    .set({
      status: "unknown",
      lastError: "delivery_result_unknown",
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
      "[whatsapp-outbox] Marked stale processing rows as unknown",
    );
  }
  return reset.length;
}

/**
 * Emits one structured operational alert per agency while any reservation
 * confirmation remains unresolved. `updatedAt` is the timestamp written when
 * the stale processing lease becomes unknown, so the age reflects the time
 * awaiting manual review rather than the reservation's creation date.
 */
export async function alertUnknownReservationConfirmations(): Promise<void> {
  try {
    const unknownByTenant = await db
      .select({
        tenantId: whatsappNotificationOutboxTable.tenantId,
        unknownCount: count(whatsappNotificationOutboxTable.id),
        oldestAt: min(whatsappNotificationOutboxTable.updatedAt),
      })
      .from(whatsappNotificationOutboxTable)
      .where(and(
        eq(whatsappNotificationOutboxTable.type, RESERVATION_CONFIRMED),
        eq(whatsappNotificationOutboxTable.status, "unknown"),
      ))
      .groupBy(whatsappNotificationOutboxTable.tenantId);

    const now = Date.now();
    for (const row of unknownByTenant) {
      const oldestAt = row.oldestAt instanceof Date ? row.oldestAt : null;
      const unknownCount = Number(row.unknownCount);
      const ageMinutes = oldestAt
        ? Math.max(0, Math.round((now - oldestAt.getTime()) / 60_000))
        : null;

      if (!await claimUnknownConfirmationAlert({
        tenantId: row.tenantId,
        unknownCount,
        ageMinutes,
        now,
      })) {
        continue;
      }

      logger.warn(
        { tenantId: row.tenantId, unknownCount, oldestAt, ageMinutes },
        "[whatsapp-outbox] Unknown reservation confirmations require manual review",
      );
    }
  } catch (err) {
    // Alerting must never prevent the normal confirmed-failure retry sweep.
    logger.error({ err }, "[whatsapp-outbox] Failed to evaluate unknown confirmation alerts");
  }
}

async function claimUnknownConfirmationAlert(opts: {
  tenantId: string;
  unknownCount: number;
  ageMinutes: number | null;
  now: number;
}): Promise<boolean> {
  const { tenantId, unknownCount, ageMinutes, now } = opts;
  const key = `${UNKNOWN_CONFIRMATION_ALERT_KEY_PREFIX}${tenantId}`;

  const [stored] = await db
    .select({
      value: platformSettingsTable.value,
      updatedAt: platformSettingsTable.updatedAt,
    })
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, key))
    .limit(1);

  const previous = parseUnknownConfirmationAlertState(stored?.value);
  const ageReachedNextStep =
    ageMinutes !== null &&
    (previous?.lastAgeMinutes === null || previous?.lastAgeMinutes === undefined
      ? ageMinutes >= UNKNOWN_CONFIRMATION_ALERT_AGE_STEP_MINUTES
      : ageMinutes >= previous.lastAgeMinutes + UNKNOWN_CONFIRMATION_ALERT_AGE_STEP_MINUTES);
  const cooldownElapsed =
    !previous || now - previous.lastAlertAt >= UNKNOWN_CONFIRMATION_ALERT_COOLDOWN_MS;
  const countIncreased = previous !== null && unknownCount > previous.lastCount;

  if (previous && !cooldownElapsed && !countIncreased && !ageReachedNextStep) {
    return false;
  }

  const nextState: UnknownConfirmationAlertState = {
    lastAlertAt: now,
    lastCount: unknownCount,
    lastAgeMinutes: ageMinutes,
  };
  const value = JSON.stringify(nextState);

  if (stored) {
    const [claimed] = await db
      .update(platformSettingsTable)
      .set({ value, updatedAt: new Date(now) })
      .where(and(
        eq(platformSettingsTable.key, key),
        eq(platformSettingsTable.updatedAt, stored.updatedAt),
      ))
      .returning({ id: platformSettingsTable.id });
    return Boolean(claimed);
  }

  const [claimed] = await db
    .insert(platformSettingsTable)
    .values({
      id: generateId(),
      key,
      value,
      label: UNKNOWN_CONFIRMATION_ALERT_LABEL,
    })
    .onConflictDoNothing()
    .returning({ id: platformSettingsTable.id });
  return Boolean(claimed);
}

function parseUnknownConfirmationAlertState(value: string | null | undefined): UnknownConfirmationAlertState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<UnknownConfirmationAlertState>;
    if (
      typeof parsed.lastAlertAt !== "number" ||
      typeof parsed.lastCount !== "number" ||
      (parsed.lastAgeMinutes !== null && typeof parsed.lastAgeMinutes !== "number")
    ) {
      return null;
    }
    return parsed as UnknownConfirmationAlertState;
  } catch {
    return null;
  }
}

/** Retries durable notifications left pending by a queue or provider failure. */
export async function retryPendingReservationConfirmedWhatsApps(): Promise<void> {
  await resetStaleReservationConfirmedWhatsApps();
  await alertUnknownReservationConfirmations();

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