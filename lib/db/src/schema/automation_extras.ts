import { pgTable, text, timestamp, boolean, json, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const automationActionsTable = pgTable("automation_actions", {
  id: text("id").primaryKey(),
  automationId: text("automation_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  type: text("type").notNull(),
  config: json("config").$type<Record<string, unknown>>().notNull().default({}),
  order: integer("order").notNull().default(1),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAutomationActionSchema = createInsertSchema(automationActionsTable).omit({ createdAt: true });
export type InsertAutomationAction = z.infer<typeof insertAutomationActionSchema>;
export type AutomationAction = typeof automationActionsTable.$inferSelect;

export const automationLogsTable = pgTable("automation_logs", {
  id: text("id").primaryKey(),
  automationId: text("automation_id").notNull(),
  tenantId: text("tenant_id").notNull(),
  status: text("status").notNull().default("success"),
  triggerData: json("trigger_data"),
  result: json("result"),
  errorMessage: text("error_message"),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAutomationLogSchema = createInsertSchema(automationLogsTable).omit({ executedAt: true });
export type InsertAutomationLog = z.infer<typeof insertAutomationLogSchema>;
export type AutomationLog = typeof automationLogsTable.$inferSelect;
