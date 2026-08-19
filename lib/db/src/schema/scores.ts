import { pgTable, text, timestamp, integer, numeric, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { clientsTable } from "./clients";
import { tripsTable } from "./trips";

export const clientScoresTable = pgTable(
  "client_scores",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    purchaseScore: integer("purchase_score").notNull().default(0),
    recompraScore: integer("recompra_score").notNull().default(0),
    churnScore: integer("churn_score").notNull().default(0),
    nboTripId: text("nbo_trip_id").references(() => tripsTable.id, { onDelete: "set null" }),
    nboReasoning: text("nbo_reasoning"),
    rfmR: integer("rfm_r"),
    rfmF: integer("rfm_f"),
    rfmM: numeric("rfm_m", { precision: 12, scale: 2 }),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("client_scores_client_tenant_unique").on(table.clientId, table.tenantId),
    index("client_scores_tenant_idx").on(table.tenantId, table.calculatedAt),
  ],
);

export type ClientScore = typeof clientScoresTable.$inferSelect;
