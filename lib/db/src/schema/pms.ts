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
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { accommodationsTable, accommodationRoomsTable } from "./registrations";

/**
 * PMS core tables.
 *
 * The legacy accommodation tables remain the source for existing CRM and
 * excursion flows. These tables are the additive model used by direct
 * lodging sales and are linked back to legacy records during migration.
 */
export const propertiesTable = pgTable("properties", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  legacyAccommodationId: text("legacy_accommodation_id")
    .references(() => accommodationsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  tradeName: text("trade_name"),
  propertyType: text("property_type").notNull().default("OTHER"),
  description: text("description"),
  documentNumber: text("document_number"),
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  timezone: text("timezone").notNull().default("America/Sao_Paulo"),
  currency: text("currency").notNull().default("BRL"),
  locale: text("locale").notNull().default("pt-BR"),
  checkInTime: text("check_in_time").notNull().default("14:00"),
  checkOutTime: text("check_out_time").notNull().default("12:00"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("properties_tenant_legacy_accommodation_unique").on(table.tenantId, table.legacyAccommodationId),
  index("properties_tenant_status_idx").on(table.tenantId, table.status),
]);

export const roomTypesTable = pgTable("room_types", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => propertiesTable.id, { onDelete: "cascade" }),
  legacyCategory: text("legacy_category"),
  name: text("name").notNull(),
  code: text("code").notNull(),
  description: text("description"),
  maxOccupancy: integer("max_occupancy").notNull().default(1),
  baseOccupancy: integer("base_occupancy").notNull().default(1),
  defaultPrice: numeric("default_price", { precision: 12, scale: 2 }),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("room_types_property_code_unique").on(table.propertyId, table.code),
  index("room_types_tenant_property_idx").on(table.tenantId, table.propertyId),
]);

export const accommodationUnitsTable = pgTable("accommodation_units", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => propertiesTable.id, { onDelete: "cascade" }),
  roomTypeId: text("room_type_id").notNull().references(() => roomTypesTable.id, { onDelete: "restrict" }),
  legacyRoomId: text("legacy_room_id").references(() => accommodationRoomsTable.id, { onDelete: "set null" }),
  unitNumber: text("unit_number").notNull(),
  name: text("name").notNull(),
  floor: text("floor"),
  maxOccupancy: integer("max_occupancy").notNull().default(1),
  status: text("status").notNull().default("active"),
  housekeepingStatus: text("housekeeping_status").notNull().default("CLEAN"),
  maintenanceStatus: text("maintenance_status").notNull().default("AVAILABLE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("accommodation_units_property_number_unique").on(table.propertyId, table.unitNumber),
  uniqueIndex("accommodation_units_tenant_legacy_room_unique").on(table.tenantId, table.legacyRoomId),
  index("accommodation_units_tenant_type_idx").on(table.tenantId, table.roomTypeId),
]);

export const ratePlansTable = pgTable("rate_plans", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => propertiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  pricingModel: text("pricing_model").notNull().default("PER_ROOM"),
  mealPlan: text("meal_plan"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("rate_plans_property_code_unique").on(table.propertyId, table.code),
  index("rate_plans_tenant_property_idx").on(table.tenantId, table.propertyId),
]);

export const rateRulesTable = pgTable("rate_rules", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  ratePlanId: text("rate_plan_id").notNull().references(() => ratePlansTable.id, { onDelete: "cascade" }),
  roomTypeId: text("room_type_id").notNull().references(() => roomTypesTable.id, { onDelete: "cascade" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  minimumStay: integer("minimum_stay"),
  maximumStay: integer("maximum_stay"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("rate_rules_lookup_idx").on(table.tenantId, table.ratePlanId, table.roomTypeId, table.startDate, table.endDate),
]);

export const inventoryCalendarTable = pgTable("inventory_calendar", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => propertiesTable.id, { onDelete: "cascade" }),
  roomTypeId: text("room_type_id").notNull().references(() => roomTypesTable.id, { onDelete: "cascade" }),
  unitId: text("unit_id").references(() => accommodationUnitsTable.id, { onDelete: "cascade" }),
  inventoryDate: date("inventory_date").notNull(),
  available: integer("available").notNull().default(0),
  reserved: integer("reserved").notNull().default(0),
  blocked: integer("blocked").notNull().default(0),
  outOfOrder: integer("out_of_order").notNull().default(0),
  maintenance: integer("maintenance").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("inventory_calendar_unit_date_unique").on(table.unitId, table.inventoryDate),
  index("inventory_calendar_property_date_idx").on(table.tenantId, table.propertyId, table.inventoryDate),
]);

export const pmsReservationsTable = pgTable("pms_reservations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  propertyId: text("property_id").notNull().references(() => propertiesTable.id, { onDelete: "restrict" }),
  legacyReservationId: text("legacy_reservation_id"),
  clientId: text("client_id"),
  reservationNumber: text("reservation_number").notNull(),
  source: text("source").notNull().default("DIRECT"),
  channel: text("channel").notNull().default("CRM"),
  status: text("status").notNull().default("HELD"),
  checkIn: date("check_in").notNull(),
  checkOut: date("check_out").notNull(),
  adults: integer("adults").notNull().default(1),
  children: integer("children").notNull().default(0),
  infants: integer("infants").notNull().default(0),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  balanceAmount: numeric("balance_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("BRL"),
  notes: text("notes"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("pms_reservations_tenant_number_unique").on(table.tenantId, table.reservationNumber),
  index("pms_reservations_tenant_dates_idx").on(table.tenantId, table.propertyId, table.checkIn, table.checkOut),
  index("pms_reservations_tenant_status_idx").on(table.tenantId, table.status),
]);

export const pmsReservationUnitsTable = pgTable("reservation_units", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  reservationId: text("reservation_id").notNull().references(() => pmsReservationsTable.id, { onDelete: "cascade" }),
  roomTypeId: text("room_type_id").notNull().references(() => roomTypesTable.id, { onDelete: "restrict" }),
  unitId: text("unit_id").references(() => accommodationUnitsTable.id, { onDelete: "restrict" }),
  ratePlanId: text("rate_plan_id").references(() => ratePlansTable.id, { onDelete: "set null" }),
  checkIn: date("check_in").notNull(),
  checkOut: date("check_out").notNull(),
  adults: integer("adults").notNull().default(1),
  children: integer("children").notNull().default(0),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("reservation_units_tenant_reservation_idx").on(table.tenantId, table.reservationId),
  index("reservation_units_tenant_type_dates_idx").on(table.tenantId, table.roomTypeId, table.checkIn, table.checkOut),
  index("reservation_units_tenant_unit_dates_idx").on(table.tenantId, table.unitId, table.checkIn, table.checkOut),
]);

export const guestProfilesTable = pgTable("guest_profiles", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  fullName: text("full_name").notNull(),
  documentType: text("document_type"),
  documentNumber: text("document_number"),
  birthDate: date("birth_date"),
  nationality: text("nationality"),
  email: text("email"),
  phone: text("phone"),
  preferences: text("preferences"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("guest_profiles_tenant_name_idx").on(table.tenantId, table.fullName),
  index("guest_profiles_tenant_document_idx").on(table.tenantId, table.documentNumber),
]);

export const pmsReservationGuestsTable = pgTable("reservation_guests", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  reservationId: text("reservation_id").notNull().references(() => pmsReservationsTable.id, { onDelete: "cascade" }),
  reservationUnitId: text("reservation_unit_id").references(() => pmsReservationUnitsTable.id, { onDelete: "set null" }),
  guestProfileId: text("guest_profile_id").references(() => guestProfilesTable.id, { onDelete: "set null" }),
  fullName: text("full_name").notNull(),
  documentType: text("document_type"),
  documentNumber: text("document_number"),
  birthDate: date("birth_date"),
  guestType: text("guest_type").notNull().default("ADULT"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("reservation_guests_tenant_reservation_idx").on(table.tenantId, table.reservationId),
]);

export const insertPropertySchema = createInsertSchema(propertiesTable).omit({ createdAt: true, updatedAt: true });
export const insertRoomTypeSchema = createInsertSchema(roomTypesTable).omit({ createdAt: true, updatedAt: true });
export const insertAccommodationUnitSchema = createInsertSchema(accommodationUnitsTable).omit({ createdAt: true, updatedAt: true });
export const insertRatePlanSchema = createInsertSchema(ratePlansTable).omit({ createdAt: true, updatedAt: true });
export const insertRateRuleSchema = createInsertSchema(rateRulesTable).omit({ createdAt: true, updatedAt: true });
export const insertInventoryCalendarSchema = createInsertSchema(inventoryCalendarTable).omit({ createdAt: true, updatedAt: true });
export const insertPmsReservationSchema = createInsertSchema(pmsReservationsTable).omit({ createdAt: true, updatedAt: true });
export const insertPmsReservationUnitSchema = createInsertSchema(pmsReservationUnitsTable).omit({ createdAt: true, updatedAt: true });
export const insertGuestProfileSchema = createInsertSchema(guestProfilesTable).omit({ createdAt: true, updatedAt: true });
export const insertPmsReservationGuestSchema = createInsertSchema(pmsReservationGuestsTable).omit({ createdAt: true, updatedAt: true });

export type Property = typeof propertiesTable.$inferSelect;
export type RoomType = typeof roomTypesTable.$inferSelect;
export type AccommodationUnit = typeof accommodationUnitsTable.$inferSelect;
export type RatePlan = typeof ratePlansTable.$inferSelect;
export type RateRule = typeof rateRulesTable.$inferSelect;
export type InventoryCalendar = typeof inventoryCalendarTable.$inferSelect;
export type PmsReservation = typeof pmsReservationsTable.$inferSelect;
export type PmsReservationUnit = typeof pmsReservationUnitsTable.$inferSelect;
export type GuestProfile = typeof guestProfilesTable.$inferSelect;
export type PmsReservationGuest = typeof pmsReservationGuestsTable.$inferSelect;