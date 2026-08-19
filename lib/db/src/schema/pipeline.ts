import { pgTable, text, timestamp, boolean, numeric, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import type { DealStatus } from "@workspace/permissions";
import { tenantsTable } from "./tenants";
import { clientsTable } from "./clients";
import { tripsTable } from "./trips";
import { usersTable } from "./users";

export const pipelinesTable = pgTable("pipelines", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPipelineSchema = createInsertSchema(pipelinesTable).omit({ createdAt: true, updatedAt: true });
export type InsertPipeline = z.infer<typeof insertPipelineSchema>;
export type Pipeline = typeof pipelinesTable.$inferSelect;

export const pipelineStagesTable = pgTable("pipeline_stages", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  pipelineId: text("pipeline_id").notNull().references(() => pipelinesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull(),
  order: integer("order").notNull(),
  isFinal: boolean("is_final").notNull().default(false),
  isDefaultWeb: boolean("is_default_web").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("pipeline_stages_pipeline_id_name_idx").on(table.pipelineId, table.name),
]);

export const insertPipelineStageSchema = createInsertSchema(pipelineStagesTable).omit({ createdAt: true });
export type InsertPipelineStage = z.infer<typeof insertPipelineStageSchema>;
export type PipelineStage = typeof pipelineStagesTable.$inferSelect;

export const dealsTable = pgTable("deals", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  stageId: text("stage_id").notNull().references(() => pipelineStagesTable.id),
  title: text("title").notNull(),
  description: text("description"),
  value: numeric("value", { precision: 10, scale: 2 }).notNull(),
  clientId: text("client_id").references(() => clientsTable.id),
  leadName: text("lead_name"),
  leadEmail: text("lead_email"),
  leadWhatsapp: text("lead_whatsapp"),
  tripId: text("trip_id").references(() => tripsTable.id),
  ownerId: text("owner_id").notNull().references(() => usersTable.id),
  expectedCloseDate: timestamp("expected_close_date", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  status: text("status").$type<DealStatus>().notNull().default("open"),
  lostReason: text("lost_reason"),
  travelReason: text("travel_reason"),
  followUpNote: text("follow_up_note"),
  reservationId: text("reservation_id"),
  source: text("source").notNull().default("manual"),
  autoCreated: boolean("auto_created").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // Partial unique index: at most ONE open deal per (client, trip, tenant).
  // Closed deals for the same client+trip are allowed (e.g. lost, won).
  uniqueIndex("pipeline_deal_dup_guard").on(table.clientId, table.tripId, table.tenantId)
    .where(sql`${table.status} = 'open'`),
]);

export const insertDealSchema = createInsertSchema(dealsTable).omit({ createdAt: true, updatedAt: true });
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Deal = typeof dealsTable.$inferSelect;

// ─── Relations ────────────────────────────────────────────────────────────────
export const pipelinesRelations = relations(pipelinesTable, ({ one, many }) => ({
  tenant: one(tenantsTable, { fields: [pipelinesTable.tenantId], references: [tenantsTable.id] }),
  stages: many(pipelineStagesTable),
  deals: many(dealsTable),
}));

export const pipelineStagesRelations = relations(pipelineStagesTable, ({ one, many }) => ({
  tenant: one(tenantsTable, { fields: [pipelineStagesTable.tenantId], references: [tenantsTable.id] }),
  pipeline: one(pipelinesTable, { fields: [pipelineStagesTable.pipelineId], references: [pipelinesTable.id] }),
  deals: many(dealsTable),
}));

export const dealsRelations = relations(dealsTable, ({ one }) => ({
  tenant: one(tenantsTable, { fields: [dealsTable.tenantId], references: [tenantsTable.id] }),
  stage: one(pipelineStagesTable, { fields: [dealsTable.stageId], references: [pipelineStagesTable.id] }),
  client: one(clientsTable, { fields: [dealsTable.clientId], references: [clientsTable.id] }),
  trip: one(tripsTable, { fields: [dealsTable.tripId], references: [tripsTable.id] }),
  owner: one(usersTable, { fields: [dealsTable.ownerId], references: [usersTable.id] }),
}));
