import { Worker } from "bullmq";
import { getRedisConnection } from "../lib/redis";
import { attachCircuitBreaker } from "../lib/worker-circuit-breaker";
import { logger } from "../lib/logger";
import { CalendarSyncService } from "../lib/google-calendar/sync-service";
import type { CalendarSyncJobData } from "../queues/index";

let _worker: Worker<CalendarSyncJobData> | null = null;

export function startCalendarSyncWorker(): Worker<CalendarSyncJobData> | null {
  const conn = getRedisConnection();
  if (!conn) {
    logger.warn("[calendar-sync-worker] No Redis connection — worker not started");
    return null;
  }

  const isDev = process.env.NODE_ENV !== "production";

  _worker = new Worker<CalendarSyncJobData>(
    "calendar-sync",
    async (job) => {
      const { type, tripId, paymentId, clientId, actorUserId } = job.data;
      logger.info({ jobId: job.id, type, tripId, paymentId, clientId }, "[calendar-sync-worker] Processing job");

      switch (type) {
        case "syncTrip":
          if (!tripId) throw new Error("syncTrip requires tripId");
          await CalendarSyncService.syncTrip(tripId);
          break;
        case "syncTripForUser":
          if (!tripId || !actorUserId) throw new Error("syncTripForUser requires tripId and actorUserId");
          await CalendarSyncService.syncTripForUser(tripId, actorUserId);
          break;
        case "syncPayment":
          if (!paymentId) throw new Error("syncPayment requires paymentId");
          await CalendarSyncService.syncPayment(paymentId);
          break;
        case "syncBirthday":
          if (!clientId) throw new Error("syncBirthday requires clientId");
          await CalendarSyncService.syncBirthday(clientId);
          break;
        case "deleteEventsForTrip":
          if (!tripId) throw new Error("deleteEventsForTrip requires tripId");
          await CalendarSyncService.deleteEventsForTrip(tripId);
          break;
        default:
          logger.warn({ type }, "[calendar-sync-worker] Unknown job type — skipping");
      }

      logger.info({ jobId: job.id, type }, "[calendar-sync-worker] Job complete");
    },
    isDev
      ? { connection: conn, concurrency: 1, stalledInterval: 60_000, drainDelay: 30 }
      : { connection: conn, concurrency: 3, stalledInterval: 15_000 },
  );

  _worker.on("failed", (job, err) => {
    const maxAttempts = job?.opts?.attempts ?? 5;
    const isFinal = (job?.attemptsMade ?? 0) >= maxAttempts;
    logger.error(
      { jobId: job?.id, type: job?.data?.type, tripId: job?.data?.tripId, attemptsMade: job?.attemptsMade, isFinal, err },
      "[calendar-sync-worker] Job failed",
    );
  });

  attachCircuitBreaker(_worker, "calendar-sync-worker");

  logger.info("[calendar-sync-worker] Started");
  return _worker;
}

export async function stopCalendarSyncWorker(): Promise<void> {
  if (_worker) {
    await _worker.close().catch(() => {});
    _worker = null;
  }
}

export function isCalendarSyncWorkerRunning(): boolean {
  return _worker !== null;
}
