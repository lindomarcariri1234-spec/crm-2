import type { Worker } from "bullmq";
import { logger } from "./logger";
import { isTransientRedisError, recordTransientRedisError, resetTransientRedisErrors } from "./redis";

const INITIAL_PAUSE_MS = 5 * 60 * 1000;  // 5 min
const MAX_PAUSE_MS    = 30 * 60 * 1000;  // 30 min cap

function isRateLimitExhaustedError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("max requests limit exceeded") ||
    msg.includes("max daily request limit")
  );
}

/**
 * Attaches circuit-breaker + transient-error handling to a BullMQ worker.
 *
 * When Upstash Redis exhausts its daily command quota (ERR max requests limit
 * exceeded), BullMQ workers retry at ~300 ms intervals, which burns through
 * the remaining budget in seconds.  This circuit breaker detects that error
 * and pauses the worker with exponential backoff (5 min → 10 min → … → 30 min
 * cap).  The worker resumes automatically after each pause, and the backoff is
 * reset to the initial value once the worker fires a "ready" event (meaning
 * the Redis connection recovered and a job was processed successfully).
 *
 * Call once per worker, right after instantiation.  It replaces the need to
 * add individual "error" / "ready" handlers in each worker file.
 *
 * @param worker     - The BullMQ Worker instance.
 * @param workerName - Short name used in log messages (e.g. "email-worker").
 */
export function attachCircuitBreaker<T>(worker: Worker<T>, workerName: string): void {
  let pauseMs = INITIAL_PAUSE_MS;
  let pauseTimer: ReturnType<typeof setTimeout> | null = null;
  let isPaused = false;

  function scheduleResume(): void {
    if (isPaused) return;
    isPaused = true;

    if (pauseTimer !== null) {
      clearTimeout(pauseTimer);
      pauseTimer = null;
    }

    const delayMs = pauseMs;
    logger.error(
      { workerName, pauseSeconds: Math.round(delayMs / 1000) },
      `[${workerName}] Redis rate limit exhausted — pausing worker for ${Math.round(delayMs / 60_000)} min`,
    );

    void worker.pause(true);

    pauseMs = Math.min(pauseMs * 2, MAX_PAUSE_MS);

    pauseTimer = setTimeout(async () => {
      pauseTimer = null;
      logger.info({ workerName }, `[${workerName}] Resuming after rate-limit pause`);
      isPaused = false;
      void worker.resume();
    }, delayMs);
  }

  worker.on("error", (err: Error) => {
    if (isRateLimitExhaustedError(err)) {
      scheduleResume();
    } else if (isTransientRedisError(err)) {
      recordTransientRedisError();
      logger.warn({ err }, `[${workerName}] Transient worker error (will recover automatically)`);
    } else {
      logger.error({ err }, `[${workerName}] Worker error`);
    }
  });

  worker.on("ready", () => {
    resetTransientRedisErrors();
    if (pauseMs > INITIAL_PAUSE_MS) {
      logger.info({ workerName }, `[${workerName}] Worker ready — resetting backoff to initial value`);
      pauseMs = INITIAL_PAUSE_MS;
    }
    isPaused = false;
  });
}
