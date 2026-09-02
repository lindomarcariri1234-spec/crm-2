import { pgTable, text, timestamp, integer, json, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tenantsTable } from "./tenants";

export interface LinkedDataReconciliationCategorySummary {
  checked: number;
  repaired: number;
  issues: number;
  reasons: Record<string, number>;
}

export type LinkedDataReconciliationSummary = Record<string, LinkedDataReconciliationCategorySummary>;

/**
 * One row per completed integrity execution. The JSON payload is deliberately
 * aggregate-only: it contains category counts and reason codes, never record
 * ids, customer data, payment data, or provider credentials.
 */
export const linkedDataReconciliationRunsTable = pgTable("linked_data_reconciliation_runs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  mode: text("mode").notNull(),
  executedAt: timestamp("executed_at", { withTimezone: true }).notNull(),
  checkedCount: integer("checked_count").notNull().default(0),
  repairedCount: integer("repaired_count").notNull().default(0),
  issueCount: integer("issue_count").notNull().default(0),
  summary: json("summary").$type<LinkedDataReconciliationSummary>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("linked_data_reconciliation_runs_tenant_executed_idx").on(table.tenantId, table.executedAt),
]);

export const linkedDataReconciliationRunsRelations = relations(linkedDataReconciliationRunsTable, ({ one }) => ({
  tenant: one(tenantsTable, { fields: [linkedDataReconciliationRunsTable.tenantId], references: [tenantsTable.id] }),
}));

export type LinkedDataReconciliationRun = typeof linkedDataReconciliationRunsTable.$inferSelect;