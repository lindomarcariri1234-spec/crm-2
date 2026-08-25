import { beforeEach, describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/logger", () => ({ logger }));
vi.mock("../lib/redis", () => ({ getRedisConnection: vi.fn(() => null) }));

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
});