import { logger } from "./logger";

export interface RedisQuotaWorker {
  pause: (doNotWaitActive?: boolean) => Promise<void>;
  resume: () => Promise<void> | void;
}

export interface RedisDailyBudgetStats {
  usagePct: number;
  warningThresholdPct: number;
}

export function isRedisDailyBudgetBelowRecoveryThreshold(
  stats: RedisDailyBudgetStats | null,
): boolean {
  return Boolean(
    stats
    && Number.isFinite(stats.usagePct)
    && Number.isFinite(stats.warningThresholdPct)
    && stats.usagePct < stats.warningThresholdPct
    && stats.usagePct < 100,
  );
}

export function isRedisQuotaExhaustionResponse(status: number, message: string): boolean {
  return status === 429
    || /max(?:imum)? requests? limit|daily request limit|request limit exceeded|quota exceeded/i.test(message);
}

export interface RedisDailyLimitCircuitOptions {
  probe: () => Promise<unknown>;
  onOpened?: () => void;
  onRecovered?: () => void;
  initialProbeDelayMs?: number;
  maxProbeDelayMs?: number;
  recoveryValidationMs?: number;
}

export function isRedisDailyLimitError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes("max requests limit exceeded") ||
    message.includes("max daily request limit") ||
    message.includes("daily request limit exceeded")
  );
}

/**
 * Shares one slow recovery probe across all BullMQ workers in a process.
 * A successful Redis command is required before workers resume; repeated quota
 * errors back off up to one probe per hour instead of waking every worker.
 */
export function createRedisDailyLimitCircuit({
  probe,
  onOpened,
  onRecovered,
  initialProbeDelayMs = 15 * 60_000,
  maxProbeDelayMs = 60 * 60_000,
  recoveryValidationMs = 5_000,
}: RedisDailyLimitCircuitOptions) {
  const firstProbeDelayMs = Math.max(1, initialProbeDelayMs);
  const maximumProbeDelayMs = Math.max(firstProbeDelayMs, maxProbeDelayMs);
  const workers = new Set<RedisQuotaWorker>();
  let open = false;
  let probeInFlight = false;
  let recoveryFailed = false;
  let nextProbeDelayMs = firstProbeDelayMs;
  let probeTimer: ReturnType<typeof setTimeout> | null = null;

  function pauseWorker(worker: RedisQuotaWorker): void {
    try {
      void worker.pause(true).catch(() => undefined);
    } catch {
      // A local pause is best-effort; the shared circuit still blocks scheduler probes.
    }
  }

  function pauseAllWorkers(): void {
    for (const worker of workers) pauseWorker(worker);
  }

  function scheduleProbe(delayMs: number): void {
    if (!open || probeTimer) return;
    probeTimer = setTimeout(() => {
      probeTimer = null;
      void tryRecover();
    }, delayMs);
    probeTimer.unref?.();
  }

  async function tryRecover(): Promise<void> {
    if (!open || probeInFlight) return;
    probeInFlight = true;
    recoveryFailed = false;
    try {
      await probe();
      if (recoveryFailed) throw new Error("worker_rejected_during_recovery_probe");
      await Promise.all([...workers].map((worker) => worker.resume()));
      if (recoveryFailed) throw new Error("worker_rejected_during_recovery_resume");
      if (recoveryValidationMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, recoveryValidationMs));
      }
      if (recoveryFailed) throw new Error("worker_rejected_during_recovery_validation");
      open = false;
      nextProbeDelayMs = firstProbeDelayMs;
      try {
        onRecovered?.();
      } catch (error) {
        logger.warn(
          { errorName: error instanceof Error ? error.name : "unknown" },
          "[redis] Daily-limit recovery callback failed",
        );
      }
      logger.info("[redis] Daily request limit recovered; circuit closed");
    } catch (error) {
      if (!recoveryFailed) pauseAllWorkers();
      nextProbeDelayMs = Math.min(nextProbeDelayMs * 2, maximumProbeDelayMs);
      const retryDelayMs = nextProbeDelayMs;
      logger.warn(
        {
          errorName: error instanceof Error ? error.name : "unknown",
          retryDelayMs,
        },
        "[redis] Daily-limit recovery probe failed; circuit remains open",
      );
      scheduleProbe(retryDelayMs);
    } finally {
      probeInFlight = false;
    }
  }

  return {
    isOpen: () => open,

    registerWorker(worker: RedisQuotaWorker): () => void {
      workers.add(worker);
      if (open) pauseWorker(worker);
      return () => workers.delete(worker);
    },

    reportError(error: unknown): boolean {
      if (!isRedisDailyLimitError(error)) return false;
      if (open) {
        if (probeInFlight && !recoveryFailed) {
          recoveryFailed = true;
          pauseAllWorkers();
        }
        return true;
      }

      open = true;
      nextProbeDelayMs = firstProbeDelayMs;
      try {
        onOpened?.();
      } catch (callbackError) {
        logger.warn(
          { errorName: callbackError instanceof Error ? callbackError.name : "unknown" },
          "[redis] Daily-limit open callback failed",
        );
      }
      const message = workers.size > 0
        ? "[redis] Daily request limit reached; pausing BullMQ workers"
        : "[redis] Daily request limit reached; Redis-dependent scheduled work paused";
      logger.error(
        { workerCount: workers.size, retryDelayMs: firstProbeDelayMs },
        message,
      );
      pauseAllWorkers();
      scheduleProbe(firstProbeDelayMs);
      return true;
    },

    stop(): void {
      if (probeTimer) clearTimeout(probeTimer);
      probeTimer = null;
      open = false;
      probeInFlight = false;
      nextProbeDelayMs = firstProbeDelayMs;
      workers.clear();
    },
  };
}