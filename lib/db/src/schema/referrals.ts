import { pgTable, text, timestamp, numeric, boolean, integer, json, jsonb, index, uniqueIndex, check, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { reservationsTable } from "./reservations";

export interface ReferralTierConfig {
  level: string;
  label: string;
  minReferrals: number;
  bonusMultiplier: number;
}

export const referralsTable = pgTable("referrals", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
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
  /** Campaign policy selected when this referral converted; immutable attribution. */
  campaignId: text("campaign_id"),
  /** Normalized tracking channel (source or source:medium) carried from the referral cookie. */
  attributionChannel: text("attribution_channel"),
  visitsCount: integer("visits_count").notNull().default(0),
  firstVisit: timestamp("first_visit", { withTimezone: true }),
  lastVisit: timestamp("last_visit", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isActive: boolean("is_active").notNull().default(true),
  reservationId: text("reservation_id").references(() => reservationsTable.id, { onDelete: "set null" }),
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
}, (t) => [
  check("referrals_status_check", sql`${t.status} IN ('pending', 'completed', 'converted', 'expired', 'reversed')`),
  check("referrals_nonnegative_amounts_check", sql`
    ${t.bonusAmount} >= 0
    AND ${t.discountValue} >= 0
    AND (${t.discountAmount} IS NULL OR ${t.discountAmount} >= 0)
    AND (${t.bonusCreditUsedAmount} IS NULL OR ${t.bonusCreditUsedAmount} >= 0)
    AND ${t.visitsCount} >= 0
  `),
  check("referrals_bonus_payment_consistency_check", sql`
    (${t.bonusPaid} = false AND ${t.bonusPaidAt} IS NULL)
    OR (${t.bonusPaid} = true AND ${t.bonusPaidAt} IS NOT NULL)
  `),
  check("referrals_conversion_consistency_check", sql`
    (${t.status} IN ('completed', 'converted', 'reversed') AND ${t.convertedAt} IS NOT NULL)
    OR (${t.status} IN ('pending', 'expired') AND ${t.convertedAt} IS NULL)
  `),
  check("referrals_reversal_consistency_check", sql`${t.status} <> 'reversed' OR ${t.reversalAt} IS NOT NULL`),
  index("referrals_tenant_created_idx").on(t.tenantId, t.createdAt),
  index("referrals_tenant_status_expires_idx").on(t.tenantId, t.status, t.expiresAt),
  index("referrals_tenant_reservation_idx").on(t.tenantId, t.reservationId),
  index("referrals_tenant_code_idx").on(t.tenantId, t.code),
  uniqueIndex("referrals_tenant_id_unique").on(t.tenantId, t.id),
  index("referrals_financial_bonus_paid_idx").on(t.tenantId, t.status, t.bonusPaidAt),
  index("referrals_financial_credit_used_idx").on(t.tenantId, t.status, t.bonusCreditUsedAt),
]);

export const insertReferralSchema = createInsertSchema(referralsTable).omit({ createdAt: true, updatedAt: true });
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Referral = typeof referralsTable.$inferSelect;

/**
 * Append-only audit record for a financial reversal of a bonus that was
 * already paid. The referral row remains the source of the original fact;
 * this table records the compensating operation and its operator.
 */
export const referralBonusReversalsTable = pgTable("referral_bonus_reversals", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  referralId: text("referral_id").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  initiatedById: text("initiated_by_id").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("referral_bonus_reversals_positive_amount_check", sql`${t.amount} > 0`),
  foreignKey({
    name: "referral_bonus_reversals_tenant_referral_fkey",
    columns: [t.tenantId, t.referralId],
    foreignColumns: [referralsTable.tenantId, referralsTable.id],
  }).onDelete("restrict"),
  uniqueIndex("referral_bonus_reversals_tenant_referral_unique").on(t.tenantId, t.referralId),
  index("referral_bonus_reversals_tenant_created_idx").on(t.tenantId, t.createdAt),
]);

export const insertReferralBonusReversalSchema = createInsertSchema(referralBonusReversalsTable).omit({ createdAt: true });
export type InsertReferralBonusReversal = z.infer<typeof insertReferralBonusReversalSchema>;
export type ReferralBonusReversal = typeof referralBonusReversalsTable.$inferSelect;

export const referralTrackingTable = pgTable("referral_tracking", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  cookieId: text("cookie_id").notNull(),
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
}, (t) => [
  check("referral_tracking_nonnegative_visits_check", sql`${t.visitsCount} >= 0`),
  check("referral_tracking_conversion_consistency_check", sql`
    (${t.converted} = false AND ${t.convertedAt} IS NULL)
    OR (${t.converted} = true AND ${t.convertedAt} IS NOT NULL)
  `),
  uniqueIndex("referral_tracking_tenant_cookie_unique").on(t.tenantId, t.cookieId),
  index("referral_tracking_tenant_code_idx").on(t.tenantId, t.referralCode),
]);

export const insertReferralTrackingSchema = createInsertSchema(referralTrackingTable).omit({ createdAt: true, updatedAt: true });
export type InsertReferralTracking = z.infer<typeof insertReferralTrackingSchema>;
export type ReferralTracking = typeof referralTrackingTable.$inferSelect;

export const referralSettingsTable = pgTable("referral_settings", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().unique().references(() => tenantsTable.id, { onDelete: "cascade" }),
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
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  bonusType: text("bonus_type").notNull().default("multiplier"),
  bonusValue: numeric("bonus_value", { precision: 10, scale: 4 }).notNull().default("2"),
  bannerText: text("banner_text"),
  eligibleStoreProductIds: jsonb("eligible_store_product_ids").$type<string[]>().notNull().default([]),
  eligibleTierLevels: jsonb("eligible_tier_levels").$type<string[]>().notNull().default([]),
  conversionCap: integer("conversion_cap"),
  budgetAmount: numeric("budget_amount", { precision: 12, scale: 2 }),
  shareMessage: text("share_message"),
  materialUrl: text("material_url"),
  publicRanking: boolean("public_ranking").notNull().default(false),
  /**
   * Empty means every activity level. Active: 3+ valid conversions; occasional:
   * 1-2 valid conversions; inactive: no valid conversion yet.
   */
  eligibleActivitySegments: jsonb("eligible_activity_segments").$type<string[]>().notNull().default([]),
  /** Empty means every source. Values are normalized sources or source:medium pairs. */
  eligibleChannels: jsonb("eligible_channels").$type<string[]>().notNull().default([]),
  commissionType: text("commission_type").notNull().default("none"),
  commissionValue: numeric("commission_value", { precision: 10, scale: 4 }).notNull().default("0"),
  /** A campaign pays either its eligible ambassador or its eligible product partner, never both. */
  commissionRecipientType: text("commission_recipient_type").notNull().default("ambassador"),
  eligiblePartnerIds: jsonb("eligible_partner_ids").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("referral_campaigns_nonnegative_values_check", sql`
    (${t.conversionCap} IS NULL OR ${t.conversionCap} > 0)
    AND (${t.budgetAmount} IS NULL OR ${t.budgetAmount} >= 0)
    AND ${t.commissionValue} >= 0
  `),
]);

export type ReferralCampaign = typeof referralCampaignsTable.$inferSelect;

/** Commercial commission, intentionally separate from the promotional referral bonus. */
export const referralCommissionsTable = pgTable("referral_commissions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  referralId: text("referral_id").notNull().unique(),
  referrerId: text("referrer_id").notNull(),
  campaignId: text("campaign_id"),
  recipientType: text("recipient_type").notNull().default("ambassador"),
  recipientId: text("recipient_id").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  basis: text("basis").notNull(),
  status: text("status").notNull().default("pending"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("referral_commissions_nonnegative_amount_check", sql`${t.amount} >= 0`),
  check("referral_commissions_status_check", sql`${t.status} IN ('pending', 'approved', 'paid', 'reversed')`),
  check("referral_commissions_pending_payment_check", sql`${t.status} NOT IN ('pending', 'approved') OR ${t.paidAt} IS NULL`),
  check("referral_commissions_reversal_consistency_check", sql`${t.status} <> 'reversed' OR ${t.reversedAt} IS NOT NULL`),
  foreignKey({
    name: "referral_commissions_tenant_referral_fkey",
    columns: [t.tenantId, t.referralId],
    foreignColumns: [referralsTable.tenantId, referralsTable.id],
  }).onDelete("restrict"),
  index("referral_commissions_financial_created_idx").on(t.tenantId, t.status, t.createdAt),
  index("referral_commissions_financial_paid_idx").on(t.tenantId, t.status, t.paidAt),
]);

export const insertReferralCommissionSchema = createInsertSchema(referralCommissionsTable).omit({ createdAt: true, updatedAt: true });
export type InsertReferralCommission = z.infer<typeof insertReferralCommissionSchema>;
export type ReferralCommission = typeof referralCommissionsTable.$inferSelect;

export const referralAttemptLogsTable = pgTable("referral_attempt_logs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: text("client_id").notNull(),
  storeSlug: text("store_slug").notNull(),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReferralAttemptLog = typeof referralAttemptLogsTable.$inferSelect;
