import { pgTable, text, timestamp, json, uniqueIndex, index, integer } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tenantsTable } from "./tenants";

export type SpreadsheetImportEntity =
  | "clients"
  | "trips"
  | "reservations"
  | "payments"
  | "expenses"
  | "referrals"
  | "commissions"
  | "deals";
export type SpreadsheetImportRowAction = "created" | "updated" | "duplicate" | "ignored" | "rejected";

export interface SpreadsheetImportRowResult {
  line: number;
  sourceKey?: string;
  label?: string;
  action: SpreadsheetImportRowAction;
  reason?: string;
  targetId?: string;
}

export interface SpreadsheetImportReport {
  entity: SpreadsheetImportEntity;
  contractVersion: 1;
  filename: string;
  totalRows: number;
  results: SpreadsheetImportRowResult[];
}

export const spreadsheetImportBatchesTable = pgTable("spreadsheet_import_batches", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  entity: text("entity").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  fileHash: text("file_hash").notNull(),
  filename: text("filename").notNull(),
  status: text("status").notNull().default("completed"),
  report: json("report").$type<SpreadsheetImportReport>().notNull(),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("spreadsheet_import_batches_tenant_key_unique").on(table.tenantId, table.entity, table.idempotencyKey),
  index("spreadsheet_import_batches_tenant_created_idx").on(table.tenantId, table.createdAt),
]);

export const spreadsheetImportRecordsTable = pgTable("spreadsheet_import_records", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  entity: text("entity").notNull(),
  sourceKey: text("source_key").notNull(),
  targetId: text("target_id").notNull(),
  lastBatchId: text("last_batch_id").notNull(),
  lastLine: integer("last_line").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("spreadsheet_import_records_tenant_entity_key_unique").on(table.tenantId, table.entity, table.sourceKey),
  index("spreadsheet_import_records_target_idx").on(table.tenantId, table.entity, table.targetId),
]);

export const spreadsheetImportBatchesRelations = relations(spreadsheetImportBatchesTable, ({ one }) => ({
  tenant: one(tenantsTable, { fields: [spreadsheetImportBatchesTable.tenantId], references: [tenantsTable.id] }),
}));

export const spreadsheetImportRecordsRelations = relations(spreadsheetImportRecordsTable, ({ one }) => ({
  tenant: one(tenantsTable, { fields: [spreadsheetImportRecordsTable.tenantId], references: [tenantsTable.id] }),
}));
