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

export const REMINDER_SCHEDULER_NAME_BY_ID = new Map<string, string>(
  REMINDER_SCHEDULER_DEFINITIONS.map(({ id, name }) => [id, name]),
);

export function isKnownReminderSchedulerJob(job: { name: string; repeatJobKey?: string }): boolean {
  return REMINDER_SCHEDULER_DEFINITIONS.some(
    ({ id, name }) => job.name === name && job.repeatJobKey?.includes(id),
  );
}
