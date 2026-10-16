import { logger } from "../lib/logger.js";
import type { Queue } from "bullmq";

export const REMINDER_SCHEDULERS = {
  boardingReminderDaily: { id: "boarding-reminder-daily", name: "boarding_reminder" },
  paymentReminderDaily: { id: "payment-reminder-daily", name: "payment_reminder" },
  expiredReservationsCleanup: { id: "expired-reservations-cleanup", name: "expired_reservations_cleanup" },
  failedEmailRetry: { id: "failed-email-retry", name: "failed_email_retry" },
  referralExpiryNotificationDaily: { id: "referral-expiry-notification-daily", name: "referral_expiry_notification" },
  referralExpiryWarningDaily: { id: "referral-expiry-warning-daily", name: "referral_expiry_warning" },
  expiryWarningEmailRetry: { id: "expiry-warning-email-retry", name: "expiry_warning_email_retry" },
  referralBonusReleaseNotificationDaily: { id: "referral-bonus-release-notification-daily", name: "referral_bonus_release_notification" },
  npsDispatchHourly: { id: "nps-dispatch-hourly", name: "nps_dispatch" },
  installmentDueReminderDaily: { id: "installment-due-reminder-daily", name: "installment_due_reminder" },
  seatReconciliationDaily: { id: "seat-reconciliation-daily", name: "seat_reconciliation" },
  trialExpiryNotificationDaily: { id: "trial-expiry-notification-daily", name: "trial_expiry_notification" },
  uploadthingOrphanCleanupNightly: { id: "uploadthing-orphan-cleanup-nightly", name: "uploadthing_orphan_cleanup" },
  chatbotDeliveryRetry: { id: "chatbot-delivery-retry", name: "chatbot_delivery_retry" },
} as const;

export const REMINDER_SCHEDULER_DEFINITIONS = Object.values(REMINDER_SCHEDULERS);

export type ReminderSchedulerDefinition = (typeof REMINDER_SCHEDULER_DEFINITIONS)[number];
export type ReminderSchedulerStatus = "not_attempted" | "registered" | "failed";
export type ReminderSchedulerScheduleStatus =
  | "healthy"
  | "registration_failed"
  | "missing"
  | "delayed"
  | "unavailable";

type ReminderSchedulerRegistration = {
  status: Exclude<ReminderSchedulerStatus, "not_attempted">;
  lastAttemptAt: string;
  lastSuccessfulAt: string | null;
  failureCount: number;
};

type ReminderSchedulerLastRun = {
  lastRunAt: string;
  lastRunStatus: "completed" | "failed";
};

const registrationState = new Map<string, ReminderSchedulerRegistration>();
const lastRunState = new Map<string, ReminderSchedulerLastRun>();

export async function registerReminderScheduler(
  scheduler: ReminderSchedulerDefinition,
  register: () => Promise<unknown>,
): Promise<void> {
  const lastAttemptAt = new Date().toISOString();
  const previous = registrationState.get(scheduler.id);

  try {
    await register();
    registrationState.set(scheduler.id, {
      status: "registered",
      lastAttemptAt,
      lastSuccessfulAt: lastAttemptAt,
      failureCount: 0,
    });
  } catch {
    registrationState.set(scheduler.id, {
      status: "failed",
      lastAttemptAt,
      lastSuccessfulAt: previous?.lastSuccessfulAt ?? null,
      failureCount: (previous?.failureCount ?? 0) + 1,
    });
    // Do not log provider error text; Redis errors can contain connection details.
    logger.error(
      { schedulerId: scheduler.id, schedulerName: scheduler.name },
      "[reminders] Failed to register reminder scheduler",
    );
  }
}

export function recordReminderSchedulerExecution(
  job: { name: string; repeatJobKey?: string },
  status: ReminderSchedulerLastRun["lastRunStatus"],
  finishedAt = Date.now(),
): void {
  const scheduler = REMINDER_SCHEDULER_DEFINITIONS.find(
    ({ id, name }) => name === job.name && job.repeatJobKey?.includes(id),
  );
  if (!scheduler || !Number.isFinite(finishedAt)) return;
  lastRunState.set(scheduler.id, {
    lastRunAt: new Date(finishedAt).toISOString(),
    lastRunStatus: status,
  });
}

export function getReminderSchedulerRegistrationHealth() {
  const schedulers = REMINDER_SCHEDULER_DEFINITIONS.map((scheduler) => {
    const registration = registrationState.get(scheduler.id);
    return {
      id: scheduler.id,
      name: scheduler.name,
      status: registration?.status ?? "not_attempted" as const,
      lastAttemptAt: registration?.lastAttemptAt ?? null,
      lastSuccessfulAt: registration?.lastSuccessfulAt ?? null,
      failureCount: registration?.failureCount ?? 0,
    };
  });
  const failedCount = schedulers.filter((scheduler) => scheduler.status === "failed").length;
  const unattemptedCount = schedulers.filter((scheduler) => scheduler.status === "not_attempted").length;

  return {
    status: failedCount > 0 ? "degraded" as const : unattemptedCount > 0 ? "unknown" as const : "ok" as const,
    failedCount,
    unattemptedCount,
    schedulers,
  };
}

export async function getReminderSchedulerRunHealth(
  queue: Pick<Queue, "getJobSchedulers" | "getJobs"> | null,
  timezone: string,
) {
  const registrationHealth = getReminderSchedulerRegistrationHealth();
  let schedulerMetadata: Awaited<ReturnType<Queue["getJobSchedulers"]>> = [];
  type RecentRun = {
    job: Awaited<ReturnType<Queue["getJobs"]>>[number];
    status: "completed" | "failed";
  };
  let recentRuns: RecentRun[] = [];
  let inspectionAvailable = false;

  if (queue) {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const [metadata, completedJobs, failedJobs] = await Promise.race([
        Promise.all([
          queue.getJobSchedulers(),
          queue.getJobs(["completed"], 0, 99, false),
          queue.getJobs(["failed"], 0, 99, false),
        ]),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("scheduler-health-timeout")), 3_000);
        }),
      ]);
      schedulerMetadata = metadata;
      recentRuns = [
        ...completedJobs.map((job) => ({ job, status: "completed" as const })),
        ...failedJobs.map((job) => ({ job, status: "failed" as const })),
      ];
      inspectionAvailable = true;
    } catch {
      // Health output intentionally omits raw Redis errors and connection details.
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  const now = Date.now();
  const schedulers = registrationHealth.schedulers.map((scheduler) => {
    const metadata = schedulerMetadata.find(
      (candidate) => candidate.id === scheduler.id && candidate.name === scheduler.name,
    );
    const lastRun = recentRuns
      .filter(
        ({ job }) =>
          job.name === scheduler.name &&
          job.repeatJobKey?.includes(scheduler.id) &&
          typeof job.finishedOn === "number",
      )
      .sort((a, b) => (b.job.finishedOn ?? 0) - (a.job.finishedOn ?? 0))[0];
    const queueLastRunAt = typeof lastRun?.job.finishedOn === "number"
      ? lastRun.job.finishedOn
      : null;
    const trackedLastRun = lastRunState.get(scheduler.id);
    const trackedLastRunAt = trackedLastRun ? Date.parse(trackedLastRun.lastRunAt) : null;
    const useTrackedLastRun = trackedLastRunAt !== null &&
      (queueLastRunAt === null || trackedLastRunAt > queueLastRunAt);
    const nextRunAt = typeof metadata?.next === "number" && Number.isFinite(metadata.next)
      ? new Date(metadata.next).toISOString()
      : null;
    const lastRunAt = useTrackedLastRun
      ? trackedLastRun!.lastRunAt
      : queueLastRunAt !== null
      ? new Date(queueLastRunAt).toISOString()
      : null;

    let scheduleStatus: ReminderSchedulerScheduleStatus;
    if (scheduler.status === "failed") {
      scheduleStatus = "registration_failed";
    } else if (!inspectionAvailable) {
      scheduleStatus = "unavailable";
    } else if (!metadata) {
      scheduleStatus = "missing";
    } else if (nextRunAt === null) {
      scheduleStatus = "unavailable";
    } else if (metadata.next! < now - 5 * 60_000) {
      scheduleStatus = "delayed";
    } else {
      scheduleStatus = "healthy";
    }

    return {
      ...scheduler,
      scheduleStatus,
      nextRunAt,
      lastRunAt,
      lastRunStatus: useTrackedLastRun ? trackedLastRun!.lastRunStatus : lastRun?.status ?? null,
    };
  });
  const delayedCount = schedulers.filter(({ scheduleStatus }) => scheduleStatus === "delayed").length;
  const missingCount = schedulers.filter(({ scheduleStatus }) => scheduleStatus === "missing").length;
  const unavailableCount = schedulers.filter(({ scheduleStatus }) => scheduleStatus === "unavailable").length;
  const registrationFailureCount = schedulers.filter(({ scheduleStatus }) => scheduleStatus === "registration_failed").length;

  return {
    ...registrationHealth,
    status: delayedCount + missingCount + registrationFailureCount > 0
      ? "degraded" as const
      : unavailableCount > 0
      ? "unknown" as const
      : "ok" as const,
    timezone,
    delayedCount,
    missingCount,
    unavailableCount,
    schedulers,
  };
}

export const REMINDER_SCHEDULER_NAME_BY_ID = new Map<string, string>(
  REMINDER_SCHEDULER_DEFINITIONS.map(({ id, name }) => [id, name]),
);

export function isKnownReminderSchedulerJob(job: { name: string; repeatJobKey?: string }): boolean {
  return REMINDER_SCHEDULER_DEFINITIONS.some(
    ({ id, name }) => job.name === name && job.repeatJobKey?.includes(id),
  );
}
