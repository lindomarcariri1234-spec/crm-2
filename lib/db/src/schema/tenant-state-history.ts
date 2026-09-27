import { bigserial, boolean, index, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// This ledger intentionally has no tenant FK: deleting a tenant must not erase
// the state needed to keep historical SaaS metrics stable.
export const tenantStateHistoryTable = pgTable("tenant_state_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: text("tenant_id").notNull(),
  planId: text("plan_id").notNull(),
  status: text("status").notNull(),
  monthlyPrice: numeric("monthly_price", { precision: 10, scale: 2 }).notNull().default("0"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull(),
  statusChanged: boolean("status_changed").notNull().default(false),
  source: text("source").notNull(),
  isInferred: boolean("is_inferred").notNull().default(false),
}, (table) => [
  index("tenant_state_history_tenant_changed_idx").on(table.tenantId, table.changedAt, table.id),
  index("tenant_state_history_changed_idx").on(table.changedAt),
]);

export type TenantStateHistoryEvent = typeof tenantStateHistoryTable.$inferSelect;