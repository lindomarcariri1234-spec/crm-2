/**
 * Stable identities for referral notifications.
 *
 * These values are persisted in email_logs.notification_type. Subject,
 * locale, recipient and rendered content are deliberately not part of the
 * identity because they can change without creating a new business event.
 */
export const REFERRAL_NOTIFICATION_TYPE = {
  // Keep the historical values for events already backfilled in email_logs.
  WELCOME: "welcome",
  CONVERTED: "converted",
  EXPIRED: "expired",
  EXPIRY_WARNING_7: "expiry_warning_7",
  EXPIRY_WARNING_1: "expiry_warning_1",
  BONUS_RELEASED: "bonus_released",
  BONUS_PAID: "bonus_paid",
  LOYALTY_POINTS: "loyalty_points",
  REVERSED: "reversed",
  TIER_UPGRADE: "tier_upgrade",
  CODE_SUSPENDED: "referral_code_suspended",
} as const;

export type ReferralNotificationType =
  (typeof REFERRAL_NOTIFICATION_TYPE)[keyof typeof REFERRAL_NOTIFICATION_TYPE];