import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/logger.js", () => ({
  logger: { error: vi.fn() },
}));

import {
  getReminderSchedulerRegistrationHealth,
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
});
