import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { tenantsTable } from "./tenants";

export const clientFavoritesTable = pgTable(
  "client_favorites",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    itemType: text("item_type").notNull(),
    itemId: text("item_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lowAvailabilityNotifiedAt: timestamp("low_availability_notified_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("client_favorites_unique_idx").on(table.clientId, table.itemType, table.itemId),
    index("client_favorites_client_idx").on(table.clientId, table.createdAt),
  ],
);

export type ClientFavorite = typeof clientFavoritesTable.$inferSelect;
