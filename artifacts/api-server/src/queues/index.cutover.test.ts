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
  getBullMQWorkerConnection: vi.fn(() => ({ status: "ready" })),
  getBullMQQueueConnection: vi.fn(() => ({ status: "ready" })),
  rejectSeparateQueueRedisCutover: vi.fn(),
  probeConsumes: true,
  workerInstances: [] as Array<{ emit: (event: string, ...args: unknown[]) => void }>,
  addedProbeJobs: [] as string[],
  removedProbeJobs: [] as string[],
  selectedRedis: "REDIS_URL" as "REDIS_URL" | "REDIS_QUEUE_URL" | "disabled",
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
    async add(_name: string, data: { nonce: string }, options: { jobId: string }) {
      state.addedProbeJobs.push(options.jobId);
      if (state.probeConsumes) {
        queueMicrotask(() => {
          for (const worker of state.workerInstances) {
            worker.emit("completed", { id: options.jobId }, data.nonce);
          }
        });
      }
      return { id: options.jobId };
    }
    async remove(jobId: string) {
      state.removedProbeJobs.push(jobId);
    }
    async close() {
      state.closed += 1;
    }
  },
  Worker: class {
    handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    constructor() {
      state.workerInstances.push(this);
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const handler of this.handlers.get(event) ?? []) handler(...args);
    }
    async waitUntilReady() {}
    async close() {}
  },
}));

vi.mock("../lib/redis", () => ({
  approveSeparateQueueRedisCutover: state.approved,
  areWorkersEnabled: state.areWorkersEnabled,
  getBullMQQueueConnection: state.getBullMQQueueConnection,
  getBullMQWorkerConnection: state.getBullMQWorkerConnection,
  getBullMQRedisSelection: vi.fn(() => state.selectedRedis),
  getRedisConnection: state.getRedisConnection,
  rejectSeparateQueueRedisCutover: state.rejectSeparateQueueRedisCutover,
  waitForEvictionPolicyCheck: vi.fn(() => Promise.resolve()),
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import {
  prepareAndVerifyBullMQQueueRedisCutover,
  getBullMQRedisCutoverStatus,
  prepareBullMQQueueRedisCutover,
  verifyBullMQWorkerConsumesProbe,
} from "./index";

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
    state.getBullMQWorkerConnection.mockClear();
    state.getBullMQQueueConnection.mockClear();
    state.rejectSeparateQueueRedisCutover.mockClear();
    state.workerInstances = [];
    state.probeConsumes = true;
    state.addedProbeJobs = [];
    state.removedProbeJobs = [];
    state.selectedRedis = "REDIS_URL";
    state.approved.mockImplementation(() => { state.selectedRedis = "REDIS_QUEUE_URL"; });
    state.rejectSeparateQueueRedisCutover.mockImplementation(() => { state.selectedRedis = "REDIS_URL"; });
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

  it("exposes blocker counts and reasons while safely staying on REDIS_URL", async () => {
    state.counts = { wait: 3, active: 1 };

    await prepareBullMQQueueRedisCutover();

    expect(getBullMQRedisCutoverStatus()).toMatchObject({
      selectedRedis: "REDIS_URL",
      outcome: "blocked",
      reason: "Ainda há trabalho nas filas legadas; o BullMQ permanece em REDIS_URL",
    });
    const status = getBullMQRedisCutoverStatus();
    expect(status.blockerCount).toBe(status.blockers.length);
    expect(status.blockedWorkCount).toBe(status.blockers.reduce((sum, blocker) => sum + blocker.count, 0));
    expect(status.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ queue: "emails", state: "wait", count: 3, reason: expect.stringContaining("3 item(ns)") }),
      expect.objectContaining({ queue: "emails", state: "active", count: 1 }),
    ]));
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

  it("confirms the selected Redis by consuming a harmless probe job", async () => {
    await expect(verifyBullMQWorkerConsumesProbe(100)).resolves.toBe(true);

    expect(state.getBullMQWorkerConnection).toHaveBeenCalledOnce();
    expect(state.getBullMQQueueConnection).toHaveBeenCalledOnce();
    expect(state.addedProbeJobs).toHaveLength(1);
    expect(state.removedProbeJobs).toHaveLength(0);
  });

  it("rejects a connected Redis when no worker consumes the probe", async () => {
    state.probeConsumes = false;

    await expect(verifyBullMQWorkerConsumesProbe(5)).resolves.toBe(false);

    expect(state.addedProbeJobs).toHaveLength(1);
    expect(state.removedProbeJobs).toEqual(state.addedProbeJobs);
  });

  it("keeps the new Redis selected only after the preflight and worker probe succeed", async () => {
    await expect(prepareAndVerifyBullMQQueueRedisCutover(100)).resolves.toBe(true);

    expect(state.approved).toHaveBeenCalledOnce();
    expect(state.rejectSeparateQueueRedisCutover).not.toHaveBeenCalled();
    expect(state.addedProbeJobs).toHaveLength(1);
    expect(getBullMQRedisCutoverStatus()).toMatchObject({
      selectedRedis: "REDIS_QUEUE_URL",
      outcome: "verified",
      blockerCount: 0,
    });
  });

  it("reverts to REDIS_URL when the cutover probe is not consumed", async () => {
    state.probeConsumes = false;

    await expect(prepareAndVerifyBullMQQueueRedisCutover(5)).resolves.toBe(false);

    expect(state.approved).toHaveBeenCalledOnce();
    expect(state.rejectSeparateQueueRedisCutover).toHaveBeenCalledOnce();
    expect(getBullMQRedisCutoverStatus()).toMatchObject({
      selectedRedis: "REDIS_URL",
      outcome: "reverted",
      blockerCount: 1,
      blockedWorkCount: 1,
    });
  });
});
