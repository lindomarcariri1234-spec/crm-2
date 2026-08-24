import { randomUUID } from "node:crypto";
import cron, { type TaskOptions } from "node-cron";
import { logger } from "./logger";
import { getRedisConnection } from "./redis";

const RELEASE_IF_OWNER = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

const RENEW_IF_OWNER = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
  end
  return 0
`;

export interface SchedulerRedis {
  status?: string;
  set(key: string, value: string, mode: "PX", ttlMs: number, condition: "NX"): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

export interface SchedulerLease {
  readonly key: string;
  readonly token: string;
  release(): Promise<boolean>;
  renew(): Promise<boolean>;
}

export class RedisSchedulerLease implements SchedulerLease {
  private released = false;

  constructor(
    readonly key: string,
    readonly token: string,
    private readonly ttlMs: number,
    private readonly redis: SchedulerRedis,
  ) {}

  static async acquire(redis: SchedulerRedis, key: string, ttlMs: number): Promise<RedisSchedulerLease | null> {
    const token = randomUUID();
    const result = await redis.set(key, token, "PX", ttlMs, "NX");
    return result === "OK" ? new RedisSchedulerLease(key, token, ttlMs, redis) : null;
  }

  async renew(): Promise<boolean> {
    if (this.released) return false;
    return Number(await this.redis.eval(RENEW_IF_OWNER, 1, this.key, this.token, String(this.ttlMs))) === 1;
  }

  async release(): Promise<boolean> {
    if (this.released) return false;
    this.released = true;
    return Number(await this.redis.eval(RELEASE_IF_OWNER, 1, this.key, this.token)) === 1;
  }
}

function getLeaseTtlMs(): number {
  const configured = Number(process.env["SCHEDULER_LEASE_TTL_MS"]);
  // A lease must be long enough to tolerate normal Redis latency, but bounded so
  // a crashed replica cannot suppress a job indefinitely.
  if (Number.isFinite(configured) && configured >= 60_000 && configured <= 30 * 60_000) return configured;
  return 10 * 60_000;
}

function isProduction(): boolean {
  return process.env["NODE_ENV"] === "production";
}

/**
 * Runs an in-process scheduled task under a Redis lease.  Redis is mandatory
 * in production, where replicas may be added independently of application
 * configuration.  Development deliberately retains the single-process
 * fallback so local scheduling works without REDIS_URL.
 */
export async function runScheduledJob(
  jobName: string,
  task: () => Promise<void> | void,
  dependencies: { redis?: SchedulerRedis | null; allowDevelopmentFallback?: boolean } = {},
): Promise<void> {
  const redis = dependencies.redis === undefined ? getRedisConnection() : dependencies.redis;
  const fallback = dependencies.allowDevelopmentFallback ?? !isProduction();

  if (!redis || redis.status !== "ready") {
    if (fallback) {
      logger.warn({ jobName, mode: "single-instance-development" }, "[scheduler] Redis unavailable; running local fallback");
      await task();
    } else {
      logger.error({ jobName, mode: "production" }, "[scheduler] Redis unavailable; scheduled execution skipped");
    }
    return;
  }

  const ttlMs = getLeaseTtlMs();
  const key = `scheduler:lease:${jobName}`;
  let lease: RedisSchedulerLease | null;
  try {
    lease = await RedisSchedulerLease.acquire(redis, key, ttlMs);
  } catch (err) {
    logger.error({ err, jobName }, "[scheduler] Lease acquisition failed; scheduled execution skipped");
    return;
  }

  if (!lease) {
    logger.info({ jobName }, "[scheduler] Lease held by another replica; execution skipped");
    return;
  }

  logger.info({ jobName, ttlMs }, "[scheduler] Lease acquired");
  const renewal = setInterval(() => {
    void lease!.renew().then((renewed) => {
      if (!renewed) logger.warn({ jobName }, "[scheduler] Lease renewal lost");
    }).catch((err) => logger.warn({ err, jobName }, "[scheduler] Lease renewal failed"));
  }, Math.floor(ttlMs / 3));
  renewal.unref();

  try {
    await task();
  } catch (err) {
    logger.error({ err, jobName }, "[scheduler] Scheduled task failed");
  } finally {
    clearInterval(renewal);
    try {
      const released = await lease.release();
      logger.info({ jobName, released }, "[scheduler] Lease released");
    } catch (err) {
      logger.warn({ err, jobName }, "[scheduler] Lease release failed; TTL will recover");
    }
  }
}

/**
 * Single registration point for node-cron. `noOverlap` prevents overlap within
 * one process, while runScheduledJob provides ownership across replicas.
 */
export function scheduleDistributedCron(
  jobName: string,
  expression: string,
  task: () => Promise<void> | void,
  options: TaskOptions = {},
) {
  return cron.schedule(expression, () => runScheduledJob(jobName, task), {
    ...options,
    noOverlap: true,
  });
}