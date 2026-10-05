import type { Worker } from "bullmq";
import { logger } from "./logger";
import {
  isRedisDailyLimitCircuitOpen,
  isTransientRedisError,
  recordTransientRedisError,
  registerRedisDailyLimitWorker,
  reportRedisDailyLimitError,
  resetTransientRedisErrors,
} from "./redis";

// BullMQ caps an idle blocking read at 10 seconds; the default is 5 seconds.
// Using the cap halves empty-queue polling without delaying a pushed job.
export const WORKER_IDLE_DRAIN_DELAY_SECONDS = 10;

/**
 * Attaches circuit-breaker + transient-error handling to a BullMQ worker.
 *
 * When Redis rejects commands for a daily quota, one shared process-level
 * circuit pauses all workers. A single PING probe backs off from 15 minutes
 * up to one hour; only a successful probe resumes the workers.
 *
 * Call once per worker, right after instantiation.  It replaces the need to
 * add individual "error" / "ready" handlers in each worker file.
 *
 * @param worker     - The BullMQ Worker instance.
 * @param workerName - Short name used in log messages (e.g. "email-worker").
 */
export function attachCircuitBreaker<T>(worker: Worker<T>, workerName: string): void {
  const unregisterWorker = registerRedisDailyLimitWorker(worker);
  worker.once("closed", unregisterWorker);

  worker.on("error", (err: Error) => {
    if (reportRedisDailyLimitError(err)) {
      logger.warn({ workerName }, `[${workerName}] Redis daily-limit circuit is active`);
    } else if (isTransientRedisError(err)) {
      recordTransientRedisError();
      logger.warn({ err }, `[${workerName}] Transient worker error (will recover automatically)`);
    } else {
      logger.error({ err }, `[${workerName}] Worker error`);
    }
  });

  worker.on("ready", () => {
    if (!isRedisDailyLimitCircuitOpen()) resetTransientRedisErrors();
  });
}
