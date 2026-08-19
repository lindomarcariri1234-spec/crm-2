import { pgTable, text, timestamp, boolean, json, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const plansTable = pgTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  monthlyPrice: numeric("monthly_price", { precision: 10, scale: 2 }).notNull().default("0"),
  annualPrice: numeric("annual_price", { precision: 10, scale: 2 }).notNull().default("0"),
  maxUsers: integer("max_users").notNull().default(5),
  maxClients: integer("max_clients").notNull().default(100),
  maxTrips: integer("max_trips").notNull().default(20),
  features: json("features").$type<string[]>().notNull().default([]),
  supportedFeatures: json("supported_features").$type<string[]>().notNull().default([]),
  isActive: boolean("is_active").notNull().default(true),
  isFeatured: boolean("is_featured").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  trialDays: integer("trial_days").notNull().default(0),
  paymentRequired: boolean("payment_required").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPlanSchema = createInsertSchema(plansTable).omit({ createdAt: true, updatedAt: true });
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = typeof plansTable.$inferSelect;

export const invoicesTable = pgTable("invoices", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  planId: text("plan_id"),
  invoiceNumber: text("invoice_number"),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("BRL"),
  status: text("status").notNull().default("pending"),
  paymentMethod: text("payment_method"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  description: text("description"),
  billingPeriodStart: timestamp("billing_period_start", { withTimezone: true }),
  billingPeriodEnd: timestamp("billing_period_end", { withTimezone: true }),
  notes: text("notes"),
  pixCode: text("pix_code"),
  pixQrCodeUrl: text("pix_qr_code_url"),
  pixExpiresAt: timestamp("pix_expires_at", { withTimezone: true }),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeInvoiceId: text("stripe_invoice_id"),
  paymentId: text("payment_id"),
  taxAmount: numeric("tax_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ createdAt: true, updatedAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;

export const featureFlagsTable = pgTable("feature_flags", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  rolloutPercent: integer("rollout_percent").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertFeatureFlagSchema = createInsertSchema(featureFlagsTable).omit({ createdAt: true, updatedAt: true });
export type InsertFeatureFlag = z.infer<typeof insertFeatureFlagSchema>;
export type FeatureFlag = typeof featureFlagsTable.$inferSelect;

export const subscriptionsTable = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  planId: text("plan_id").notNull(),
  status: text("status").notNull().default("active"),
  billingCycle: text("billing_cycle").notNull().default("monthly"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull().defaultNow(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull().defaultNow(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  trialEnd: timestamp("trial_end", { withTimezone: true }),
  trialStart: timestamp("trial_start", { withTimezone: true }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  externalId: text("external_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ createdAt: true, updatedAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;

export const platformSettingsTable = pgTable("platform_settings", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value"),
  label: text("label").notNull(),
  description: text("description"),
  type: text("type").notNull().default("string"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPlatformSettingSchema = createInsertSchema(platformSettingsTable).omit({ updatedAt: true });
export type InsertPlatformSetting = z.infer<typeof insertPlatformSettingSchema>;
export type PlatformSetting = typeof platformSettingsTable.$inferSelect;

export const usageTrackingTable = pgTable("usage_tracking", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  subscriptionId: text("subscription_id"),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  usersCount: integer("users_count").notNull().default(0),
  clientsCount: integer("clients_count").notNull().default(0),
  tripsCount: integer("trips_count").notNull().default(0),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUsageTrackingSchema = createInsertSchema(usageTrackingTable).omit({ recordedAt: true });
export type InsertUsageTracking = z.infer<typeof insertUsageTrackingSchema>;
export type UsageTracking = typeof usageTrackingTable.$inferSelect;
