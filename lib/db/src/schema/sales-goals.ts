import { pgTable, text, timestamp, numeric, integer, boolean } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

export const salesGoalsTable = pgTable("sales_goals", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  periodType: text("period_type").notNull().default("monthly"),
  year: integer("year"),
  month: text("month"),
  monthInt: integer("month_int"),
  quarter: integer("quarter"),
  goalAmount: numeric("goal_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  achievedAmount: numeric("achieved_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  goalQuantity: numeric("goal_quantity", { precision: 10, scale: 0 }),
  achievedQuantity: numeric("achieved_quantity", { precision: 10, scale: 0 }).default("0"),
  progressPercentage: numeric("progress_percentage", { precision: 5, scale: 2 }).default("0"),
  bonusAmount: numeric("bonus_amount", { precision: 10, scale: 2 }),
  bonusPaid: boolean("bonus_paid").notNull().default(false),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type SalesGoal = typeof salesGoalsTable.$inferSelect;
export type InsertSalesGoal = typeof salesGoalsTable.$inferInsert;
