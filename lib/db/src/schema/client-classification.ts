import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { tenantsTable } from "./tenants";

export const clientClassificationEventsTable = pgTable("client_classification_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clientId: text("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  eventType: text("event_type").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id"),
  actorId: text("actor_id"),
  previousClassification: text("previous_classification"),
  newClassification: text("new_classification"),
  reason: text("reason").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("client_classification_events_tenant_idempotency_unique").on(table.tenantId, table.idempotencyKey),
  index("client_classification_events_client_occurred_idx").on(table.tenantId, table.clientId, table.occurredAt),
]);

export type ClientClassificationEvent = typeof clientClassificationEventsTable.$inferSelect;
export type InsertClientClassificationEvent = typeof clientClassificationEventsTable.$inferInsert;