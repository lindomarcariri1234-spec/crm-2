import { db, reservationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getCommissionSyncQueue } from "./index";
import { syncReservationCommission } from "../routes/payments";
import { logger } from "../lib/logger";
import { areWorkersEnabled } from "../lib/redis";

/**
 * Marks a reservation's commissionSyncStatus as "failed" so administrators
 * can identify reservations missing a commission record via dashboard or query.
 * Called both by the BullMQ worker (after retry exhaustion) and by the
 * direct-call fallback when Redis is unavailable.
 */
export async function markCommissionSyncFailed(reservationId: string, tenantId: string): Promise<void> {
  await db
    .update(reservationsTable)
    .set({ commissionSyncStatus: "failed" })
    .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)))
    .catch((dbErr) => {
      logger.error({ reservationId, err: dbErr }, "[commission-sync] Failed to update commissionSyncStatus");
    });
}

/**
 * Clears commissionSyncStatus after a successful sync, removing any stale
 * "failed" marker that may have been set by a prior attempt.
 */
export async function clearCommissionSyncStatus(reservationId: string, tenantId: string): Promise<void> {
  await db
    .update(reservationsTable)
    .set({ commissionSyncStatus: null })
    .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)))
    .catch((dbErr) => {
      logger.error({ reservationId, err: dbErr }, "[commission-sync] Failed to clear commissionSyncStatus");
    });
}

/**
 * Enqueues a commission sync job when Redis is available (3 attempts with
 * exponential backoff), or falls back to a direct synchronous call if Redis
 * is not configured.
 *
 * On failure the reservation's commissionSyncStatus is set to "failed" so
 * administrators can identify reservations missing a commission record.
 * On success any stale "failed" marker is cleared.
 */
export async function enqueueCommissionSync(reservationId: string, tenantId: string): Promise<void> {
  const queue = getCommissionSyncQueue();

  if (queue) {
    try {
      await queue.add("commission-sync", { reservationId, tenantId });
      logger.info({ reservationId }, "[commission-sync] Job enqueued");
    } catch (enqueueErr) {
      logger.error({ reservationId, err: enqueueErr }, "[commission-sync] Failed to enqueue job — falling back to direct call");
      await runDirectWithFallback(reservationId, tenantId);
    }
  } else {
    if (!areWorkersEnabled()) {
      logger.warn(
        { reservationId, tenantId, jobType: "commission-sync" },
        "[workers-disabled] ENABLE_WORKERS=false — running commission sync directly instead of queuing. Set ENABLE_WORKERS=true to enable async processing.",
      );
    }
    await runDirectWithFallback(reservationId, tenantId);
  }
}

async function runDirectWithFallback(reservationId: string, tenantId: string): Promise<void> {
  try {
    await syncReservationCommission(reservationId, tenantId);
    await clearCommissionSyncStatus(reservationId, tenantId);
  } catch (err) {
    logger.error({ reservationId, err }, "[commission-sync] Direct commission sync failed — marking reservation as commissionSyncFailed");
    await markCommissionSyncFailed(reservationId, tenantId);
  }
}
