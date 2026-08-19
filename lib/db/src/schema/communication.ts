import { pgTable, text, timestamp, boolean, integer, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const messagesTable = pgTable("messages", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  fromUserId: text("from_user_id"),
  toClientId: text("to_client_id"),
  channel: text("channel").notNull(),
  content: text("content").notNull(),
  mediaUrl: text("media_url"),
  mediaType: text("media_type"),
  status: text("status").notNull().default("sent"),
  externalId: text("external_id"),
  metadata: json("metadata"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ sentAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;

export const messageTemplatesTable = pgTable("message_templates", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  channel: text("channel").notNull(),
  subject: text("subject"),
  content: text("content").notNull(),
  variables: text("variables").array().notNull().default([]),
  category: text("category"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertMessageTemplateSchema = createInsertSchema(messageTemplatesTable).omit({ createdAt: true, updatedAt: true });
export type InsertMessageTemplate = z.infer<typeof insertMessageTemplateSchema>;
export type MessageTemplate = typeof messageTemplatesTable.$inferSelect;

export const automationsTable = pgTable("automations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  triggerType: text("trigger_type").notNull(),
  triggerConfig: json("trigger_config").$type<Record<string, unknown>>().notNull().default({}),
  conditions: json("conditions"),
  isActive: boolean("is_active").notNull().default(true),
  executionsCount: integer("executions_count").notNull().default(0),
  lastExecutedAt: timestamp("last_executed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAutomationSchema = createInsertSchema(automationsTable).omit({ createdAt: true, updatedAt: true });
export type InsertAutomation = z.infer<typeof insertAutomationSchema>;
export type Automation = typeof automationsTable.$inferSelect;
