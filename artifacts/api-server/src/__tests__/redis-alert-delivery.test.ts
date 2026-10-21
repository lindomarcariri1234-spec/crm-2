import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectResults: [] as unknown[],
  select: vi.fn(),
  insert: vi.fn(),
  dispatchOutboundMessage: vi.fn(),
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
  },
  platformSettingsTable: { key: "platform-settings.key", value: "platform-settings.value" },
  redisAlertLogTable: {},
  tenantsTable: { id: "tenants.id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => ({})),
}));

vi.mock("../lib/logger", () => ({ logger: mocks.logger }));
vi.mock("../services/outbound-delivery", () => ({
  dispatchOutboundMessage: mocks.dispatchOutboundMessage,
}));

describe("Redis alert delivery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("REDIS_URL", "redis://redis.invalid");
    vi.stubEnv("SUPERADMIN_EMAIL", "ops@example.test");
    mocks.selectResults.length = 0;
    mocks.select.mockImplementation(() => {
      const query = {
        from: vi.fn(),
        where: vi.fn(),
        limit: vi.fn(),
      };
      query.from.mockReturnValue(query);
      query.where.mockReturnValue(query);
      query.limit.mockImplementation(() => {
        const next = mocks.selectResults.shift();
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
      });
      return query;
    });
    mocks.insert.mockImplementation(() => ({
      values: () => ({ execute: () => Promise.resolve() }),
    }));
    mocks.dispatchOutboundMessage.mockReset();
    mocks.dispatchOutboundMessage.mockResolvedValue({
      deliveries: [{ channel: "email", status: "accepted" }],
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("catches a tenant lookup rejection and leaves the degraded alert eligible for retry", async () => {
    mocks.selectResults.push([], [], new Error("sensitive database detail"));
    const redis = await import("../lib/redis");

    await redis.recordTransientRedisError();
    await redis.recordTransientRedisError();
    await expect(redis.recordTransientRedisError()).resolves.toBeUndefined();

    expect(mocks.dispatchOutboundMessage).not.toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      { errorName: "Error" },
      expect.stringContaining("clearing rate-limit so next error can retry"),
    );
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain("sensitive database detail");

    mocks.selectResults.push([], [], [{ id: "tenant-1" }]);
    await redis.recordTransientRedisError();

    expect(mocks.dispatchOutboundMessage).toHaveBeenCalledOnce();
    expect(mocks.dispatchOutboundMessage.mock.calls[0]?.[0]).toMatchObject({
      eventType: "redis_alert",
      idempotencyKey: expect.stringMatching(/^redis-alert:degraded:/),
    });
  });

  it("keeps a confirmed alert active when recovery preparation fails so a later reset retries", async () => {
    mocks.selectResults.push([], [], [{ id: "tenant-1" }]);
    const redis = await import("../lib/redis");

    await redis.recordTransientRedisError();
    await redis.recordTransientRedisError();
    await redis.recordTransientRedisError();
    expect(mocks.dispatchOutboundMessage).toHaveBeenCalledOnce();

    mocks.selectResults.push([], new Error("sensitive database detail"));
    await expect(redis.resetTransientRedisErrors()).resolves.toBeUndefined();
    expect(mocks.dispatchOutboundMessage).toHaveBeenCalledOnce();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      { errorName: "Error" },
      expect.stringContaining("keeping recovery eligible for retry"),
    );
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain("sensitive database detail");

    mocks.selectResults.push([], [{ id: "tenant-1" }]);
    await redis.resetTransientRedisErrors();
    expect(mocks.dispatchOutboundMessage).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchOutboundMessage.mock.calls[1]?.[0]).toMatchObject({
      eventType: "redis_recovery",
      idempotencyKey: expect.stringMatching(/^redis-recovery:/),
    });

    await redis.resetTransientRedisErrors();
    expect(mocks.dispatchOutboundMessage).toHaveBeenCalledTimes(2);
  });
});
