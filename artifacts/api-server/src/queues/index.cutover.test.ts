import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  approved: vi.fn(),
  areWorkersEnabled: vi.fn(() => true),
  getRedisConnection: vi.fn((): { status: string } | null => ({ status: "ready" })),
  counts: {} as Record<string, number>,
  delayedJobs: [] as Array<{ name: string; repeatJobKey?: string }>,
  schedulers: [] as Array<{ name: string; id?: string | null }>,
  queueNames: [] as string[],
  closed: 0,
  inspectionError: null as Error | null,
}));

vi.mock("bullmq", () => ({
  Queue: class {
    name: string;
    constructor(name: string) {
      this.name = name;
      state.queueNames.push(name);
    }
    async getJobCounts() {
      if (state.inspectionError) throw state.inspectionError;
      return state.counts;
    }
    async getJobs() {
      return this.name === "reminders" ? state.delayedJobs : [];
    }
    async getJobSchedulers() {
      return state.schedulers;
    }
    async close() {
      state.closed += 1;
    }
  },
}));

vi.mock("../lib/redis", () => ({
  approveSeparateQueueRedisCutover: state.approved,
  areWorkersEnabled: state.areWorkersEnabled,
  getBullMQQueueConnection: vi.fn(() => null),
  getRedisConnection: state.getRedisConnection,
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { prepareBullMQQueueRedisCutover } from "./index";

describe("prepareBullMQQueueRedisCutover", () => {
  beforeEach(() => {
    vi.stubEnv("REDIS_URL", "rediss://legacy.example:6379");
    vi.stubEnv("REDIS_QUEUE_URL", "rediss://queue.example:6379");
    state.approved.mockClear();
    state.getRedisConnection.mockClear();
    state.areWorkersEnabled.mockReturnValue(true);
    state.getRedisConnection.mockReturnValue({ status: "ready" });
    state.counts = { wait: 0, active: 0, failed: 0, paused: 0, "waiting-children": 0, prioritized: 0 };
    state.delayedJobs = [];
    state.schedulers = [];
    state.queueNames = [];
    state.closed = 0;
    state.inspectionError = null;
  });

  afterEach(() => vi.unstubAllEnvs());

  it("approves the new resource only after all legacy queues are clear", async () => {
    await prepareBullMQQueueRedisCutover();

    expect(state.approved).toHaveBeenCalledOnce();
    expect(state.queueNames).toContain("emails");
    expect(state.queueNames).toContain("outbound-deliveries");
    expect(state.closed).toBe(state.queueNames.length);
  });

  it("keeps using the legacy resource while runnable or failed jobs remain", async () => {
    state.counts = { wait: 0, active: 1, failed: 2 };

    await prepareBullMQQueueRedisCutover();

    expect(state.approved).not.toHaveBeenCalled();
  });

  it("keeps delayed non-scheduler work on the legacy resource", async () => {
    state.delayedJobs = [{ name: "manual-delivery-retry" }];

    await prepareBullMQQueueRedisCutover();

    expect(state.approved).not.toHaveBeenCalled();
  });

  it("allows known reminder scheduler jobs because startup recreates their schedules", async () => {
    state.delayedJobs = [{ name: "boarding_reminder", repeatJobKey: "reminders:boarding-reminder-daily:123" }];
    state.schedulers = [{ id: "boarding-reminder-daily", name: "boarding_reminder" }];

    await prepareBullMQQueueRedisCutover();

    expect(state.approved).toHaveBeenCalledOnce();
  });

  it("blocks cutover when the legacy reminder queue has an unknown scheduler", async () => {
    state.schedulers = [{ id: "unknown-scheduler", name: "unregistered_scheduler" }];

    await prepareBullMQQueueRedisCutover();

    expect(state.approved).not.toHaveBeenCalled();
  });

  it("fails safely when the legacy queues cannot be inspected", async () => {
    state.inspectionError = new Error("connection unavailable");

    await prepareBullMQQueueRedisCutover();

    expect(state.approved).not.toHaveBeenCalled();
    expect(state.closed).toBe(state.queueNames.length);
  });

  it("does not switch when the legacy Redis connection cannot be created", async () => {
    state.getRedisConnection.mockReturnValue(null);

    await prepareBullMQQueueRedisCutover();

    expect(state.approved).not.toHaveBeenCalled();
  });

  it("does not inspect or switch when workers are disabled", async () => {
    state.areWorkersEnabled.mockReturnValue(false);

    await prepareBullMQQueueRedisCutover();

    expect(state.getRedisConnection).not.toHaveBeenCalled();
    expect(state.approved).not.toHaveBeenCalled();
  });
});
