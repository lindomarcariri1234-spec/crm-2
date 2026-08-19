import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const gemeoAlertsTable = pgTable(
  "gemeo_alerts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    category: text("category").notNull(),
    severity: text("severity").notNull().default("medium"),
    actionUrl: text("action_url"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("gemeo_alerts_tenant_idx").on(table.tenantId, table.generatedAt),
  ],
);

export type GemeoAlert = typeof gemeoAlertsTable.$inferSelect;
export type InsertGemeoAlert = typeof gemeoAlertsTable.$inferInsert;

export const gemeoOpportunitiesTable = pgTable(
  "gemeo_opportunities",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    actionUrl: text("action_url"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("gemeo_opportunities_tenant_idx").on(table.tenantId, table.generatedAt),
  ],
);

export type GemeoOpportunity = typeof gemeoOpportunitiesTable.$inferSelect;
export type InsertGemeoOpportunity = typeof gemeoOpportunitiesTable.$inferInsert;
