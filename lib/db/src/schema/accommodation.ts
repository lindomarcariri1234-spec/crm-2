import {
  pgTable,
  text,
  timestamp,
  date,
  numeric,
  integer,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { accommodationsTable, accommodationRoomsTable } from "./registrations";

export const tripAccommodationsTable = pgTable("trip_accommodations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  tripId: text("trip_id").notNull(),
  accommodationId: text("accommodation_id").notNull().references(() => accommodationsTable.id, { onDelete: "restrict" }),
  checkIn: date("check_in").notNull(),
  checkOut: date("check_out").notNull(),
  nights: integer("nights").notNull(),
  status: text("status").notNull().default("active"),
  isPrimary: boolean("is_primary").notNull().default(false),
  pricingPolicy: text("pricing_policy").notNull().default("CURRENT_RATE"),
  contractedPrice: numeric("contracted_price", { precision: 12, scale: 2 }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("trip_accommodations_tenant_trip_idx").on(table.tenantId, table.tripId),
  index("trip_accommodations_tenant_accommodation_idx").on(table.tenantId, table.accommodationId),
]);

export const insertTripAccommodationSchema = createInsertSchema(tripAccommodationsTable).omit({ createdAt: true, updatedAt: true });
export type InsertTripAccommodation = z.infer<typeof insertTripAccommodationSchema>;
export type TripAccommodation = typeof tripAccommodationsTable.$inferSelect;

export const accommodationRoomBedsTable = pgTable("accommodation_room_beds", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  roomId: text("room_id").notNull().references(() => accommodationRoomsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  bedType: text("bed_type").notNull().default("single"),
  capacity: integer("capacity").notNull().default(1),
  status: text("status").notNull().default("active"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("accommodation_room_beds_tenant_room_idx").on(table.tenantId, table.roomId),
  uniqueIndex("accommodation_room_beds_room_name_unique").on(table.roomId, table.name),
]);

export const insertAccommodationRoomBedSchema = createInsertSchema(accommodationRoomBedsTable).omit({ createdAt: true, updatedAt: true });
export type InsertAccommodationRoomBed = z.infer<typeof insertAccommodationRoomBedSchema>;
export type AccommodationRoomBed = typeof accommodationRoomBedsTable.$inferSelect;

export const accommodationRatesTable = pgTable("accommodation_rates", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  accommodationId: text("accommodation_id").notNull().references(() => accommodationsTable.id, { onDelete: "cascade" }),
  roomId: text("room_id").references(() => accommodationRoomsTable.id, { onDelete: "cascade" }),
  category: text("category"),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to").notNull(),
  pricingType: text("pricing_type").notNull().default("PER_ROOM"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  minNights: integer("min_nights"),
  maxNights: integer("max_nights"),
  minOccupancy: integer("min_occupancy"),
  maxOccupancy: integer("max_occupancy"),
  priority: integer("priority").notNull().default(0),
  status: text("status").notNull().default("active"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("accommodation_rates_lookup_idx").on(table.tenantId, table.accommodationId, table.validFrom, table.validTo),
  index("accommodation_rates_room_idx").on(table.roomId, table.validFrom, table.validTo),
]);

export const insertAccommodationRateSchema = createInsertSchema(accommodationRatesTable).omit({ createdAt: true, updatedAt: true });
export type InsertAccommodationRate = z.infer<typeof insertAccommodationRateSchema>;
export type AccommodationRate = typeof accommodationRatesTable.$inferSelect;

export const accommodationRateHistoryTable = pgTable("accommodation_rate_history", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  rateId: text("rate_id").notNull().references(() => accommodationRatesTable.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  previousValue: numeric("previous_value", { precision: 12, scale: 2 }),
  newValue: numeric("new_value", { precision: 12, scale: 2 }),
  previousPeriod: text("previous_period"),
  newPeriod: text("new_period"),
  changedBy: text("changed_by"),
  changeReason: text("change_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("accommodation_rate_history_rate_idx").on(table.tenantId, table.rateId, table.createdAt),
]);

export const accommodationRoomInventoryTable = pgTable("accommodation_room_inventory", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  roomId: text("room_id").notNull().references(() => accommodationRoomsTable.id, { onDelete: "cascade" }),
  inventoryDate: date("inventory_date").notNull(),
  status: text("status").notNull().default("available"),
  capacityOverride: integer("capacity_override"),
  blockedReason: text("blocked_reason"),
  maintenanceReason: text("maintenance_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("accommodation_room_inventory_room_date_unique").on(table.roomId, table.inventoryDate),
  index("accommodation_room_inventory_tenant_date_idx").on(table.tenantId, table.inventoryDate),
]);

export const accommodationRoomBlocksTable = pgTable("accommodation_room_blocks", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  accommodationId: text("accommodation_id").notNull().references(() => accommodationsTable.id, { onDelete: "cascade" }),
  roomId: text("room_id").references(() => accommodationRoomsTable.id, { onDelete: "cascade" }),
  bedId: text("bed_id").references(() => accommodationRoomBedsTable.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  blockType: text("block_type").notNull().default("maintenance"),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("active"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("accommodation_room_blocks_lookup_idx").on(table.tenantId, table.accommodationId, table.startDate, table.endDate),
]);

export const accommodationStaysTable = pgTable("accommodation_stays", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  accommodationId: text("accommodation_id").notNull().references(() => accommodationsTable.id, { onDelete: "restrict" }),
  tripAccommodationId: text("trip_accommodation_id").references(() => tripAccommodationsTable.id, { onDelete: "set null" }),
  tripId: text("trip_id"),
  reservationId: text("reservation_id"),
  storeOrderId: text("store_order_id"),
  clientId: text("client_id"),
  source: text("source").notNull().default("CRM_MANUAL"),
  checkIn: date("check_in").notNull(),
  checkOut: date("check_out").notNull(),
  nights: integer("nights").notNull(),
  status: text("status").notNull().default("draft"),
  pricingType: text("pricing_type"),
  contractedTotal: numeric("contracted_total", { precision: 12, scale: 2 }),
  frozenTotal: numeric("frozen_total", { precision: 12, scale: 2 }),
  actualCheckInAt: timestamp("actual_check_in_at", { withTimezone: true }),
  actualCheckOutAt: timestamp("actual_check_out_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("accommodation_stays_tenant_dates_idx").on(table.tenantId, table.accommodationId, table.checkIn, table.checkOut),
  index("accommodation_stays_trip_idx").on(table.tenantId, table.tripId),
  index("accommodation_stays_reservation_idx").on(table.tenantId, table.reservationId),
]);

export const insertAccommodationStaySchema = createInsertSchema(accommodationStaysTable).omit({ createdAt: true, updatedAt: true });
export type InsertAccommodationStay = z.infer<typeof insertAccommodationStaySchema>;
export type AccommodationStay = typeof accommodationStaysTable.$inferSelect;

export const accommodationStayGuestsTable = pgTable("accommodation_stay_guests", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  stayId: text("stay_id").notNull().references(() => accommodationStaysTable.id, { onDelete: "cascade" }),
  clientId: text("client_id"),
  passengerId: text("passenger_id"),
  name: text("name").notNull(),
  document: text("document"),
  guestType: text("guest_type").notNull().default("adult"),
  status: text("status").notNull().default("expected"),
  actualCheckInAt: timestamp("actual_check_in_at", { withTimezone: true }),
  actualCheckOutAt: timestamp("actual_check_out_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("accommodation_stay_guests_stay_idx").on(table.tenantId, table.stayId),
]);

export const accommodationStayRateLinesTable = pgTable("accommodation_stay_rate_lines", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  stayId: text("stay_id").notNull().references(() => accommodationStaysTable.id, { onDelete: "cascade" }),
  roomId: text("room_id").references(() => accommodationRoomsTable.id, { onDelete: "set null" }),
  stayGuestId: text("stay_guest_id").references(() => accommodationStayGuestsTable.id, { onDelete: "set null" }),
  rateId: text("rate_id").references(() => accommodationRatesTable.id, { onDelete: "set null" }),
  pricingType: text("pricing_type").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  quantity: integer("quantity").notNull(),
  nights: integer("nights").notNull(),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
  source: text("source").notNull().default("RATE"),
  isManualOverride: boolean("is_manual_override").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("accommodation_stay_rate_lines_stay_idx").on(table.tenantId, table.stayId),
]);

export const accommodationRoomAssignmentsTable = pgTable("accommodation_room_assignments", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  stayId: text("stay_id").notNull().references(() => accommodationStaysTable.id, { onDelete: "cascade" }),
  stayGuestId: text("stay_guest_id").notNull().references(() => accommodationStayGuestsTable.id, { onDelete: "cascade" }),
  roomId: text("room_id").notNull().references(() => accommodationRoomsTable.id, { onDelete: "restrict" }),
  bedId: text("bed_id").references(() => accommodationRoomBedsTable.id, { onDelete: "restrict" }),
  checkIn: date("check_in").notNull(),
  checkOut: date("check_out").notNull(),
  status: text("status").notNull().default("active"),
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  unassignedAt: timestamp("unassigned_at", { withTimezone: true }),
  assignedBy: text("assigned_by"),
  unassignedBy: text("unassigned_by"),
  changeReason: text("change_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("accommodation_room_assignments_stay_idx").on(table.tenantId, table.stayId),
  index("accommodation_room_assignments_room_dates_idx").on(table.tenantId, table.roomId, table.checkIn, table.checkOut),
  uniqueIndex("accommodation_room_assignments_active_guest_unique")
    .on(table.tenantId, table.stayGuestId)
    .where(sql`"unassigned_at" IS NULL`),
]);

export type AccommodationRoomInventory = typeof accommodationRoomInventoryTable.$inferSelect;
export type AccommodationRoomBlock = typeof accommodationRoomBlocksTable.$inferSelect;
export type AccommodationStayGuest = typeof accommodationStayGuestsTable.$inferSelect;
export type AccommodationStayRateLine = typeof accommodationStayRateLinesTable.$inferSelect;
export type AccommodationRoomAssignment = typeof accommodationRoomAssignmentsTable.$inferSelect;