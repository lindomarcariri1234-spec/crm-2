import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/logger.js", () => ({
  logger: { error: vi.fn() },
}));

import {
  getReminderSchedulerRegistrationHealth,
  getReminderSchedulerRunHealth,
  recordReminderSchedulerExecution,
  REMINDER_SCHEDULERS,
  registerReminderScheduler,
} from "../queues/reminder-schedulers.js";

describe("reminder scheduler registration health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a sanitized failure and then distinguishes a successful retry", async () => {
    const scheduler = REMINDER_SCHEDULERS.boardingReminderDaily;
    await registerReminderScheduler(scheduler, async () => {
      throw new Error("Redis at redis://user:password@private-host failed");
    });

    const failed = getReminderSchedulerRegistrationHealth();
    expect(failed.status).toBe("degraded");
    expect(failed.failedCount).toBe(1);
    expect(failed.schedulers.find(({ id }) => id === scheduler.id)).toMatchObject({
      id: scheduler.id,
      name: scheduler.name,
      status: "failed",
      failureCount: 1,
      lastAttemptAt: expect.any(String),
      lastSuccessfulAt: null,
    });
    expect(JSON.stringify(failed)).not.toContain("password");
    expect(JSON.stringify(failed)).not.toContain("private-host");

    await registerReminderScheduler(scheduler, async () => undefined);

    const recovered = getReminderSchedulerRegistrationHealth();
    expect(recovered.schedulers.find(({ id }) => id === scheduler.id)).toMatchObject({
      status: "registered",
      failureCount: 0,
      lastSuccessfulAt: expect.any(String),
    });
    expect(recovered.failedCount).toBe(0);
  });

  it("reports next runs, most recent execution outcome, missing schedulers, and delays", async () => {
    const boarding = REMINDER_SCHEDULERS.boardingReminderDaily;
    const payment = REMINDER_SCHEDULERS.paymentReminderDaily;
    const now = Date.now();
    const queue = {
      getJobSchedulers: vi.fn().mockResolvedValue([
        { id: boarding.id, name: boarding.name, next: now + 60 * 60_000 },
        { id: payment.id, name: payment.name, next: now - 10 * 60_000 },
      ]),
      getJobs: vi.fn(async (types: string[]) => (
        types.includes("failed")
          ? [{
              name: boarding.name,
              repeatJobKey: `repeat:${boarding.id}:1710000000000`,
              finishedOn: now - 30_000,
              failedReason: "provider error",
            }]
          : [{
              name: boarding.name,
              repeatJobKey: `repeat:${boarding.id}:1700000000000`,
              finishedOn: now - 60_000,
            }]
      )),
    };

    const health = await getReminderSchedulerRunHealth(queue as never, "America/Sao_Paulo");
    const boardingHealth = health.schedulers.find(({ id }) => id === boarding.id);
    const paymentHealth = health.schedulers.find(({ id }) => id === payment.id);
    const missingHealth = health.schedulers.find(({ id }) => id === REMINDER_SCHEDULERS.npsDispatchHourly.id);

    expect(health.timezone).toBe("America/Sao_Paulo");
    expect(boardingHealth).toMatchObject({
      scheduleStatus: "healthy",
      nextRunAt: new Date(now + 60 * 60_000).toISOString(),
      lastRunAt: new Date(now - 30_000).toISOString(),
      lastRunStatus: "failed",
    });
    expect(paymentHealth?.scheduleStatus).toBe("delayed");
    expect(missingHealth?.scheduleStatus).toBe("missing");
  });

  it("retains the latest execution from worker events when the queue has pruned its job", async () => {
    const scheduler = REMINDER_SCHEDULERS.npsDispatchHourly;
    const finishedAt = Date.now() - 20_000;
    recordReminderSchedulerExecution(
      {
        name: scheduler.name,
        repeatJobKey: `repeat:${scheduler.id}:1700000000000`,
      },
      "completed",
      finishedAt,
    );

    const health = await getReminderSchedulerRunHealth({
      getJobSchedulers: vi.fn().mockResolvedValue([
        { id: scheduler.id, name: scheduler.name, next: Date.now() + 60_000 },
      ]),
      getJobs: vi.fn().mockResolvedValue([]),
    } as never, "America/Sao_Paulo");

    expect(health.schedulers.find(({ id }) => id === scheduler.id)).toMatchObject({
      lastRunAt: new Date(finishedAt).toISOString(),
      lastRunStatus: "completed",
    });
  });
});
