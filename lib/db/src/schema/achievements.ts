import { pgTable, text, timestamp, index, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { tripsTable } from "./trips";
import { clientsTable } from "./clients";

export const tripMediaTable = pgTable(
  "trip_media",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => tripsTable.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    type: text("type").notNull().default("image"),
    caption: text("caption"),
    uploadedByUserId: text("uploaded_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_media_trip_idx").on(table.tripId, table.createdAt),
    index("trip_media_tenant_idx").on(table.tenantId),
  ],
);

export type TripMedia = typeof tripMediaTable.$inferSelect;

export const clientAchievementsTable = pgTable(
  "client_achievements",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    badgeKey: text("badge_key").notNull(),
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("client_achievements_tenant_client_idx").on(table.tenantId, table.clientId),
    unique("client_achievements_unique_badge").on(table.clientId, table.tenantId, table.badgeKey),
  ],
);

export type ClientAchievement = typeof clientAchievementsTable.$inferSelect;

export const clientDreamDestinationsTable = pgTable(
  "client_dream_destinations",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    destinationName: text("destination_name").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("client_dream_destinations_tenant_client_idx").on(table.tenantId, table.clientId),
  ],
);

export type ClientDreamDestination = typeof clientDreamDestinationsTable.$inferSelect;
