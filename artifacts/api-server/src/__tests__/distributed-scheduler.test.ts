import { beforeEach, describe, expect, it, vi } from "vitest";

const { logger, redisDailyLimitCircuit } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  redisDailyLimitCircuit: {
    isOpen: vi.fn(() => false),
    reportError: vi.fn(() => false),
  },
}));
vi.mock("../lib/logger", () => ({ logger }));
vi.mock("../lib/redis", () => ({
  getRedisConnection: vi.fn(() => null),
  isRedisDailyLimitCircuitOpen: redisDailyLimitCircuit.isOpen,
  reportRedisDailyLimitError: redisDailyLimitCircuit.reportError,
}));

import { RedisSchedulerLease, runScheduledJob, type SchedulerRedis } from "../lib/distributed-scheduler";

class FakeRedis implements SchedulerRedis {
  status = "ready";
  private entries = new Map<string, { value: string; expiresAt: number }>();

  private get(key: string) {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= Date.now()) this.entries.delete(key);
    return this.entries.get(key);
  }

  async set(key: string, value: string, _mode: "PX", ttlMs: number, _condition: "NX") {
    if (this.get(key)) return null;
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return "OK";
  }

  async eval(script: string, _numKeys: number, key: string, token: string, ttl?: string) {
    const entry = this.get(key);
    if (!entry || entry.value !== token) return 0;
    if (script.includes("PEXPIRE")) {
      entry.expiresAt = Date.now() + Number(ttl);
      return 1;
    }
    this.entries.delete(key);
    return 1;
  }
}

describe("RedisSchedulerLease", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives exclusive ownership to one replica", async () => {
    const redis = new FakeRedis();
    const first = await RedisSchedulerLease.acquire(redis, "scheduler:lease:daily", 60_000);
    const second = await RedisSchedulerLease.acquire(redis, "scheduler:lease:daily", 60_000);

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("cannot delete a newer owner's lease and permits takeover after expiry", async () => {
    vi.useFakeTimers();
    try {
      const redis = new FakeRedis();
      const first = await RedisSchedulerLease.acquire(redis, "scheduler:lease:daily", 60_000);
      await vi.advanceTimersByTimeAsync(60_001);
      const second = await RedisSchedulerLease.acquire(redis, "scheduler:lease:daily", 60_000);

      expect(second).not.toBeNull();
      expect(await first!.release()).toBe(false);
      expect(await second!.release()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("runScheduledJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisDailyLimitCircuit.isOpen.mockReturnValue(false);
  });

  it("fails closed rather than executing when production Redis is unavailable", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const task = vi.fn();
    try {
      await runScheduledJob("safety-test", task, { redis: null });
      expect(task).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ jobName: "safety-test", mode: "production" }),
        expect.stringContaining("skipped"),
      );
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("runs the database-coordinated fallback when Redis rejects a lease at its daily limit", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const redis: SchedulerRedis = {
      status: "ready",
      set: vi.fn().mockRejectedValue(new Error("max daily request limit")),
      eval: vi.fn(),
    };
    const task = vi.fn();
    const databaseFallbackTask = vi.fn();

    try {
      await runScheduledJob("outbound-delivery-recovery", task, {
        redis,
        databaseFallbackTask,
      });

      expect(task).not.toHaveBeenCalled();
      expect(databaseFallbackTask).toHaveBeenCalledOnce();
      expect(redisDailyLimitCircuit.reportError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "max daily request limit" }),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          jobName: "outbound-delivery-recovery",
          mode: "database-claim-fallback",
        }),
        expect.stringContaining("database-coordinated fallback"),
      );
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("does not retry Redis leases while the shared daily-limit circuit is open", async () => {
    const redis: SchedulerRedis = {
      status: "ready",
      set: vi.fn().mockRejectedValue(new Error("max daily request limit")),
      eval: vi.fn(),
    };
    const task = vi.fn();
    const databaseFallbackTask = vi.fn();
    redisDailyLimitCircuit.isOpen.mockReturnValue(true);

    await runScheduledJob("outbound-delivery-recovery", task, {
      redis,
      databaseFallbackTask,
    });

    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
    expect(task).not.toHaveBeenCalled();
    expect(databaseFallbackTask).toHaveBeenCalledOnce();
  });

  it("runs the opted-in database fallback when Redis is unavailable in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    const task = vi.fn();
    const databaseFallbackTask = vi.fn();

    try {
      await runScheduledJob("outbound-delivery-recovery", task, {
        redis: null,
        databaseFallbackTask,
      });

      expect(task).not.toHaveBeenCalled();
      expect(databaseFallbackTask).toHaveBeenCalledOnce();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("does not run the database fallback when another replica owns the Redis lease", async () => {
    const redis = new FakeRedis();
    const lease = await RedisSchedulerLease.acquire(
      redis,
      "scheduler:lease:outbound-delivery-recovery",
      60_000,
    );
    const task = vi.fn();
    const databaseFallbackTask = vi.fn();

    await runScheduledJob("outbound-delivery-recovery", task, {
      redis,
      databaseFallbackTask,
    });

    expect(task).not.toHaveBeenCalled();
    expect(databaseFallbackTask).not.toHaveBeenCalled();
    await lease?.release();
  });
});