import { logger } from "../lib/logger.js";

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

type ReminderSchedulerRegistration = {
  status: Exclude<ReminderSchedulerStatus, "not_attempted">;
  lastAttemptAt: string;
  lastSuccessfulAt: string | null;
  failureCount: number;
};

const registrationState = new Map<string, ReminderSchedulerRegistration>();

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

export const REMINDER_SCHEDULER_NAME_BY_ID = new Map<string, string>(
  REMINDER_SCHEDULER_DEFINITIONS.map(({ id, name }) => [id, name]),
);

export function isKnownReminderSchedulerJob(job: { name: string; repeatJobKey?: string }): boolean {
  return REMINDER_SCHEDULER_DEFINITIONS.some(
    ({ id, name }) => job.name === name && job.repeatJobKey?.includes(id),
  );
}
