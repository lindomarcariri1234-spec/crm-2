import { pgTable, text, timestamp, numeric, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { tripsTable } from "./trips";
import { reservationsTable, passengersTable } from "./reservations";

export const tripCheckinsTable = pgTable("trip_checkins", {
  id: text("id").primaryKey(),
  tripId: text("trip_id").notNull(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  passengerId: text("passenger_id").notNull(),
  reservationId: text("reservation_id").notNull(),
  checkedInByUserRef: text("checked_in_by_user_ref"),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
  status: text("status").notNull().default("present"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    name: "trip_checkins_trip_tenant_fk",
    columns: [t.tripId, t.tenantId],
    foreignColumns: [tripsTable.id, tripsTable.tenantId],
  }).onDelete("cascade"),
  foreignKey({
    name: "trip_checkins_reservation_trip_tenant_fk",
    columns: [t.reservationId, t.tripId, t.tenantId],
    foreignColumns: [reservationsTable.id, reservationsTable.tripId, reservationsTable.tenantId],
  }).onDelete("cascade"),
  foreignKey({
    name: "trip_checkins_passenger_reservation_fk",
    columns: [t.passengerId, t.reservationId],
    foreignColumns: [passengersTable.id, passengersTable.reservationId],
  }).onDelete("cascade"),
]);

export type TripCheckin = typeof tripCheckinsTable.$inferSelect;
export type InsertTripCheckin = typeof tripCheckinsTable.$inferInsert;

export const tripGuideLocationsTable = pgTable("trip_guide_locations", {
  tripId: text("trip_id").notNull().references(() => tripsTable.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  guideUserRef: text("guide_user_ref"),
  guideName: text("guide_name"),
  lat: numeric("lat", { precision: 10, scale: 6 }).notNull(),
  lng: numeric("lng", { precision: 10, scale: 6 }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("trip_guide_locations_pkey_idx").on(table.tripId, table.tenantId),
]);

export type TripGuideLocation = typeof tripGuideLocationsTable.$inferSelect;

export const tripGuideTokensTable = pgTable("trip_guide_tokens", {
  id: text("id").primaryKey(),
  tripId: text("trip_id").notNull().references(() => tripsTable.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  guideName: text("guide_name").notNull(),
  token: text("token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdByUserId: text("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("trip_guide_tokens_token_uniq").on(table.token),
]);

export type TripGuideToken = typeof tripGuideTokensTable.$inferSelect;
