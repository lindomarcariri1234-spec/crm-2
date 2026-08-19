import { pgTable, text, timestamp, numeric, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import type { CommissionStatus } from "@workspace/permissions";

export const commissionRulesTable = pgTable("commission_rules", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("percentage"),
  value: numeric("value", { precision: 10, scale: 4 }).notNull(),
  appliesTo: text("applies_to").notNull().default("all"),
  tripId: text("trip_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCommissionRuleSchema = createInsertSchema(commissionRulesTable).omit({ createdAt: true, updatedAt: true });
export type InsertCommissionRule = z.infer<typeof insertCommissionRuleSchema>;
export type CommissionRule = typeof commissionRulesTable.$inferSelect;

export const commissionsTable = pgTable("commissions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  ruleId: text("rule_id"),
  userId: text("user_id").notNull(),
  reservationId: text("reservation_id"),
  baseAmount: numeric("base_amount", { precision: 10, scale: 2 }).notNull(),
  commissionAmount: numeric("commission_amount", { precision: 10, scale: 2 }).notNull(),
  commissionRate: numeric("commission_rate", { precision: 8, scale: 4 }),
  commissionType: text("commission_type"),
  status: text("status").$type<CommissionStatus>().notNull().default("pending"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCommissionSchema = createInsertSchema(commissionsTable).omit({ createdAt: true });
export type InsertCommission = z.infer<typeof insertCommissionSchema>;
export type Commission = typeof commissionsTable.$inferSelect;
