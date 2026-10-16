import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  selection: "REDIS_QUEUE_URL" as "REDIS_URL" | "REDIS_QUEUE_URL" | "disabled",
  sourceJobs: [] as Array<Record<string, any>>,
  targetJobs: new Map<string, Record<string, any>>(),
  added: [] as Array<{ name: string; data: unknown; options: Record<string, unknown> }>,
  inspectedJobQueues: [] as string[],
  pending: vi.fn(async () => true),
}));

vi.mock("bullmq", () => ({
  Queue: class {
    name: string;
    constructor(name: string) {
      this.name = name;
    }
    async getJobCounts() {
      return {};
    }
    async getJobs() {
      state.inspectedJobQueues.push(this.name);
      return this.name === "outbound-deliveries" ? state.sourceJobs : [];
    }
    async getJob(id: string) {
      return state.targetJobs.get(id) ?? null;
    }
    async add(name: string, data: unknown, options: Record<string, unknown>) {
      state.added.push({ name, data, options });
      const job = makeJob(String(options.jobId), data, "wait");
      state.targetJobs.set(String(options.jobId), job);
      return job;
    }
    async close() {}
  },
  Worker: class {},
}));

vi.mock("../lib/redis", () => ({
  approveSeparateQueueRedisCutover: vi.fn(),
  areWorkersEnabled: vi.fn(() => true),
  getBullMQRedisSelection: vi.fn(() => state.selection),
  getBullMQWorkerConnection: vi.fn(() => ({ role: "worker" })),
  getBullMQQueueConnection: vi.fn(() => ({ role: "target" })),
  getRedisConnection: vi.fn(() => ({ role: "legacy" })),
  rejectSeparateQueueRedisCutover: vi.fn(),
  waitForEvictionPolicyCheck: vi.fn(() => Promise.resolve()),
}));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("../services/outbound-delivery", () => ({
  isOutboundDeliveryPendingForQueueRecovery: state.pending,
}));

function makeJob(
  id: string,
  data: unknown,
  initialState: string,
  extra: Record<string, unknown> = {},
) {
  const job: Record<string, any> = {
    id,
    name: "outbound-delivery",
    data,
    opts: { attempts: 4, backoff: { type: "exponential", delay: 1000 }, priority: 2 },
    attemptsMade: 1,
    timestamp: Date.now() - 5000,
    delay: 8000,
    removed: false,
    state: initialState,
    async getState() {
      return this.state;
    },
    async remove() {
      this.removed = true;
      state.sourceJobs = state.sourceJobs.filter((source) => source !== this);
      state.targetJobs.delete(this.id);
    },
    ...extra,
  };
  return job;
}

import { recoverLegacyOutboundDeliveryJobs } from "./index";

describe("recoverLegacyOutboundDeliveryJobs", () => {
  beforeEach(() => {
    vi.stubEnv("REDIS_URL", "rediss://legacy.example:6379");
    vi.stubEnv("REDIS_QUEUE_URL", "rediss://queue.example:6379");
    state.selection = "REDIS_QUEUE_URL";
    state.sourceJobs = [];
    state.targetJobs.clear();
    state.added = [];
    state.inspectedJobQueues = [];
    state.pending.mockReset().mockResolvedValue(true);
  });

  it("moves pending deliveries with the same id, remaining attempts, backoff, and delay", async () => {
    const data = { deliveryId: "delivery-1", tenantId: "tenant-1" };
    const job = makeJob("outbound-delivery:tenant-1:delivery-1", data, "delayed");
    state.sourceJobs = [job];

    const result = await recoverLegacyOutboundDeliveryJobs();

    expect(state.added).toHaveLength(1);
    expect(state.added[0]).toMatchObject({
      name: "outbound-delivery",
      data,
      options: {
        jobId: job.id,
        attempts: 3,
        backoff: job.opts.backoff,
        priority: 2,
      },
    });
    expect(state.added[0]?.options.delay).toBeGreaterThan(2_900);
    expect(state.added[0]?.options.delay).toBeLessThanOrEqual(3_000);
    expect(job.removed).toBe(true);
    expect(result).toMatchObject({ migrated: 1, skipped: 0 });
  });

  it("does not copy a completed or exhausted source job", async () => {
    const data = { deliveryId: "delivery-2", tenantId: "tenant-1" };
    state.sourceJobs = [
      makeJob("outbound-delivery:tenant-1:delivery-2", data, "completed"),
      makeJob("outbound-delivery:tenant-1:delivery-3", { deliveryId: "delivery-3", tenantId: "tenant-1" }, "wait", {
        attemptsMade: 4,
      }),
    ];

    const result = await recoverLegacyOutboundDeliveryJobs();

    expect(state.added).toHaveLength(0);
    expect(result.skipped).toBe(2);
  });

  it("leaves non-pending and unrecognized WhatsApp jobs on the legacy Redis", async () => {
    state.pending.mockResolvedValue(false);
    const job = makeJob(
      "outbound-delivery:tenant-1:delivery-4",
      { deliveryId: "delivery-4", tenantId: "tenant-1" },
      "wait",
    );
    state.sourceJobs = [job];

    const result = await recoverLegacyOutboundDeliveryJobs();

    expect(state.added).toHaveLength(0);
    expect(job.removed).toBe(false);
    expect(state.inspectedJobQueues).toEqual(["outbound-deliveries"]);
    expect(result.skipped).toBe(1);
  });

  it("deduplicates against a matching job already on the new Redis", async () => {
    const data = { deliveryId: "delivery-5", tenantId: "tenant-1" };
    const source = makeJob("outbound-delivery:tenant-1:delivery-5", data, "wait");
    const target = makeJob(source.id, data, "delayed");
    state.sourceJobs = [source];
    state.targetJobs.set(source.id, target);

    const result = await recoverLegacyOutboundDeliveryJobs();

    expect(state.added).toHaveLength(0);
    expect(source.removed).toBe(true);
    expect(result.migrated).toBe(1);
  });
});
