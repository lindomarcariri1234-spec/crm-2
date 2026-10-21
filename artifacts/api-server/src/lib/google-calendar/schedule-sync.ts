import { getCalendarSyncQueue } from "../../queues/index";
import { db, reservationsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { RESERVATION_STATUS } from "@workspace/permissions";
import { CalendarSyncService } from "./sync-service";
import { logger } from "../logger";

/**
 * Dispatches a calendar sync job to the BullMQ queue.
 * Falls back to a direct (synchronous) call if Redis/queue is unavailable.
 * Always fire-and-forget (never throws — safe to call without await).
 */
export async function scheduleCalendarSyncTrip(tripId: string): Promise<void> {
  const queue = getCalendarSyncQueue();
  if (queue) {
    await queue.add("syncTrip", { type: "syncTrip", tripId }, { jobId: `syncTrip:${tripId}:${Date.now()}` })
      .catch((err) => logger.warn({ err, tripId }, "[calendar-queue] Failed to enqueue syncTrip; falling back"));
  } else {
    CalendarSyncService.syncTrip(tripId).catch((err) =>
      logger.error({ err, tripId }, "[calendar-sync] Direct syncTrip failed"),
    );
  }
}

export async function scheduleCalendarSyncReservation(reservationId: string, tenantId: string): Promise<void> {
  try {
    const [reservation] = await db.select({ tripId: reservationsTable.tripId })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.id, reservationId),
        eq(reservationsTable.tenantId, tenantId),
      ))
      .limit(1);
    if (reservation?.tripId) await scheduleCalendarSyncTrip(reservation.tripId);
  } catch (err) {
    logger.warn({ err, reservationId, tenantId }, "[calendar-queue] Failed to schedule reservation sync");
  }
}

export async function scheduleCalendarSyncForClient(clientId: string, tenantId: string): Promise<void> {
  try {
    const reservations = await db.select({ tripId: reservationsTable.tripId })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.clientId, clientId),
        eq(reservationsTable.tenantId, tenantId),
        eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED),
      ));
    for (const tripId of new Set(reservations.map((reservation) => reservation.tripId))) {
      await scheduleCalendarSyncTrip(tripId);
    }
  } catch (err) {
    logger.warn({ err, clientId, tenantId }, "[calendar-queue] Failed to schedule client reservation sync");
  }
}

export async function scheduleCalendarSyncTripForUser(tripId: string, actorUserId: string): Promise<void> {
  const queue = getCalendarSyncQueue();
  if (queue) {
    await queue.add("syncTripForUser", { type: "syncTripForUser", tripId, actorUserId }, { jobId: `syncTripForUser:${tripId}:${actorUserId}:${Date.now()}` })
      .catch((err) => logger.warn({ err, tripId, actorUserId }, "[calendar-queue] Failed to enqueue syncTripForUser; falling back"));
  } else {
    CalendarSyncService.syncTripForUser(tripId, actorUserId).catch((err) =>
      logger.error({ err, tripId, actorUserId }, "[calendar-sync] Direct syncTripForUser failed"),
    );
  }
}

export async function scheduleCalendarSyncPayment(paymentId: string): Promise<void> {
  const queue = getCalendarSyncQueue();
  if (queue) {
    await queue.add("syncPayment", { type: "syncPayment", paymentId }, { jobId: `syncPayment:${paymentId}:${Date.now()}` })
      .catch((err) => logger.warn({ err, paymentId }, "[calendar-queue] Failed to enqueue syncPayment; falling back"));
  } else {
    CalendarSyncService.syncPayment(paymentId).catch((err) =>
      logger.error({ err, paymentId }, "[calendar-sync] Direct syncPayment failed"),
    );
  }
}

export async function scheduleCalendarSyncBirthday(clientId: string): Promise<void> {
  const queue = getCalendarSyncQueue();
  if (queue) {
    await queue.add("syncBirthday", { type: "syncBirthday", clientId }, { jobId: `syncBirthday:${clientId}:${Date.now()}` })
      .catch((err) => logger.warn({ err, clientId }, "[calendar-queue] Failed to enqueue syncBirthday; falling back"));
  } else {
    CalendarSyncService.syncBirthday(clientId).catch((err) =>
      logger.error({ err, clientId }, "[calendar-sync] Direct syncBirthday failed"),
    );
  }
}

export async function scheduleCalendarDeleteEventsForTrip(tripId: string): Promise<void> {
  const queue = getCalendarSyncQueue();
  if (queue) {
    await queue.add("deleteEventsForTrip", { type: "deleteEventsForTrip", tripId }, { jobId: `deleteEvents:${tripId}:${Date.now()}` })
      .catch((err) => logger.warn({ err, tripId }, "[calendar-queue] Failed to enqueue deleteEventsForTrip; falling back"));
  } else {
    CalendarSyncService.deleteEventsForTrip(tripId).catch((err) =>
      logger.error({ err, tripId }, "[calendar-sync] Direct deleteEventsForTrip failed"),
    );
  }
}
