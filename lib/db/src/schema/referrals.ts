import { pgTable, text, timestamp, numeric, boolean, integer, json, jsonb } from "drizzle-orm/pg-core";

import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export interface ReferralTierConfig {
  level: string;
  label: string;
  minReferrals: number;
  bonusMultiplier: number;
}

export const referralsTable = pgTable("referrals", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  referrerId: text("referrer_id").notNull(),
  referredId: text("referred_id"),
  referredEmail: text("referred_email"),
  referredName: text("referred_name"),
  referredPhone: text("referred_phone"),
  referrerName: text("referrer_name"),
  referrerEmail: text("referrer_email"),
  referrerPhone: text("referrer_phone"),
  code: text("code").notNull(),
  status: text("status").notNull().default("pending"),
  bonusAmount: numeric("bonus_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  bonusPaid: boolean("bonus_paid").notNull().default(false),
  bonusPaidAt: timestamp("bonus_paid_at", { withTimezone: true }),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  discountType: text("discount_type").notNull().default("percentage"),
  discountValue: numeric("discount_value", { precision: 5, scale: 2 }).notNull().default("5"),
  discountApplied: boolean("discount_applied").notNull().default(false),
  discountAmount: numeric("discount_amount", { precision: 10, scale: 2 }),
  cookieId: text("cookie_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  landingPage: text("landing_page"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  visitsCount: integer("visits_count").notNull().default(0),
  firstVisit: timestamp("first_visit", { withTimezone: true }),
  lastVisit: timestamp("last_visit", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  reservationId: text("reservation_id"),
  source: text("source"),
  notes: text("notes"),
  fraudFlag: boolean("fraud_flag").notNull().default(false),
  fraudReason: text("fraud_reason"),
  expiryWarning7SentAt: timestamp("expiry_warning_7_sent_at", { withTimezone: true }),
  expiryWarning1SentAt: timestamp("expiry_warning_1_sent_at", { withTimezone: true }),
  bonusReleaseNotifiedAt: timestamp("bonus_release_notified_at", { withTimezone: true }),
  bonusCreditUsedAt: timestamp("bonus_credit_used_at", { withTimezone: true }),
  bonusCreditOrderId: text("bonus_credit_order_id"),
  bonusCreditUsedAmount: numeric("bonus_credit_used_amount", { precision: 10, scale: 2 }),
  reversalWarningAcknowledgedAt: timestamp("reversal_warning_acknowledged_at", { withTimezone: true }),
  reversalReason: text("reversal_reason"),
  reversalAt: timestamp("reversal_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReferralSchema = createInsertSchema(referralsTable).omit({ createdAt: true, updatedAt: true });
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Referral = typeof referralsTable.$inferSelect;

export const referralTrackingTable = pgTable("referral_tracking", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  cookieId: text("cookie_id").notNull().unique(),
  referralCode: text("referral_code").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  deviceType: text("device_type"),
  browser: text("browser"),
  os: text("os"),
  firstVisit: timestamp("first_visit", { withTimezone: true }).notNull().defaultNow(),
  lastVisit: timestamp("last_visit", { withTimezone: true }).notNull().defaultNow(),
  visitsCount: integer("visits_count").notNull().default(1),
  pagesVisited: json("pages_visited").$type<string[]>(),
  converted: boolean("converted").notNull().default(false),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  reservationId: text("reservation_id"),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  utmTerm: text("utm_term"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReferralTrackingSchema = createInsertSchema(referralTrackingTable).omit({ createdAt: true, updatedAt: true });
export type InsertReferralTracking = z.infer<typeof insertReferralTrackingSchema>;
export type ReferralTracking = typeof referralTrackingTable.$inferSelect;

export const referralSettingsTable = pgTable("referral_settings", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().unique(),
  isEnabled: boolean("is_enabled").notNull().default(true),
  discountType: text("discount_type").notNull().default("percentage"),
  discountValue: numeric("discount_value", { precision: 5, scale: 2 }).notNull().default("5"),
  bonusType: text("bonus_type").notNull().default("credit"),
  bonusValue: numeric("bonus_value", { precision: 10, scale: 2 }).notNull().default("10"),
  expirationDays: integer("expiration_days").notNull().default(30),
  allowSelfReferral: boolean("allow_self_referral").notNull().default(false),
  requireFirstPurchase: boolean("require_first_purchase").notNull().default(true),
  shareMessage: text("share_message"),
  tiersConfig: jsonb("tiers_config").$type<ReferralTierConfig[]>(),
  whatsappEnabled: boolean("whatsapp_enabled").notNull().default(false),
  whatsappPhoneNumber: text("whatsapp_phone_number"),
  whatsappConvertedMessage: text("whatsapp_converted_message"),
  whatsappBonusPaidMessage: text("whatsapp_bonus_paid_message"),
  whatsappReversedMessage: text("whatsapp_reversed_message"),
  expiryWarning7DaysEnabled: boolean("expiry_warning_7_days_enabled").notNull().default(true),
  expiryWarning1DayEnabled: boolean("expiry_warning_1_day_enabled").notNull().default(true),
  bonusReleaseEmailEnabled: boolean("bonus_release_email_enabled").notNull().default(true),
  pointsPerReferral: integer("points_per_referral").notNull().default(0),
  loyaltyPointsEmailEnabled: boolean("loyalty_points_email_enabled").notNull().default(true),
  gracePeriodDays: integer("grace_period_days").notNull().default(30),
  bonusValidityDays: integer("bonus_validity_days").notNull().default(30),
  discountExpirationDays: integer("discount_expiration_days").notNull().default(30),
  minPurchaseAmount: numeric("min_purchase_amount", { precision: 10, scale: 2 }),
  maxReferralsPerUser: integer("max_referrals_per_user").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReferralSettingsSchema = createInsertSchema(referralSettingsTable).omit({ createdAt: true, updatedAt: true });
export type InsertReferralSettings = z.infer<typeof insertReferralSettingsSchema>;
export type ReferralSettings = typeof referralSettingsTable.$inferSelect;

export const referralCampaignsTable = pgTable("referral_campaigns", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  bonusType: text("bonus_type").notNull().default("multiplier"),
  bonusValue: numeric("bonus_value", { precision: 10, scale: 4 }).notNull().default("2"),
  bannerText: text("banner_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReferralCampaign = typeof referralCampaignsTable.$inferSelect;

export const referralAttemptLogsTable = pgTable("referral_attempt_logs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  clientId: text("client_id").notNull(),
  storeSlug: text("store_slug").notNull(),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReferralAttemptLog = typeof referralAttemptLogsTable.$inferSelect;
