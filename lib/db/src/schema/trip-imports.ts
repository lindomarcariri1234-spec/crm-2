import { pgTable, text, timestamp, json, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tenantsTable } from "./tenants";

export interface TripImportResult {
  line: number;
  name: string;
  status: "created" | "duplicate" | "error";
  tripId?: string;
  error?: string;
}

export const tripImportBatchesTable = pgTable("trip_import_batches", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  status: text("status").notNull().default("completed"),
  results: json("results").$type<TripImportResult[]>().notNull().default([]),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("trip_import_batches_tenant_key_unique").on(table.tenantId, table.idempotencyKey),
]);

export const tripImportBatchesRelations = relations(tripImportBatchesTable, ({ one }) => ({
  tenant: one(tenantsTable, { fields: [tripImportBatchesTable.tenantId], references: [tenantsTable.id] }),
}));

export type TripImportBatch = typeof tripImportBatchesTable.$inferSelect;