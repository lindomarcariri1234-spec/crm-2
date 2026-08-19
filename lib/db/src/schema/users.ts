import { pgTable, text, timestamp, boolean, numeric } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import type { Role } from "@workspace/permissions";
import { tenantsTable } from "./tenants";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  tenantId: text("tenant_id").references(() => tenantsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  cpf: text("cpf"),
  avatarUrl: text("avatar_url"),
  role: text("role").$type<Role>().notNull().default("agencia"),
  isActive: boolean("is_active").notNull().default(true),
  referralCode: text("referral_code").notNull().unique(),
  referralBalance: numeric("referral_balance", { precision: 10, scale: 2 }).notNull().default("0"),
  commissionType: text("commission_type").notNull().default("percentage"),
  commissionRate: numeric("commission_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  commissionFixed: numeric("commission_fixed", { precision: 10, scale: 2 }).notNull().default("0"),
  monthlyGoal: numeric("monthly_goal", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  googleAccessToken: text("google_access_token"),
  googleRefreshToken: text("google_refresh_token"),
  googleTokenExpiry: timestamp("google_token_expiry", { withTimezone: true }),
  googleCalendarEnabled: boolean("google_calendar_enabled").notNull().default(false),
  googleCalendarStatus: text("google_calendar_status").notNull().default("disconnected"),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true, updatedAt: true });
export type InsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;

export const usersRelations = relations(usersTable, ({ one }) => ({
  tenant: one(tenantsTable, { fields: [usersTable.tenantId], references: [tenantsTable.id] }),
}));
