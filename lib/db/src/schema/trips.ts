import { pgTable, text, timestamp, boolean, numeric, integer, json, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import type { TripStatus } from "@workspace/permissions";
import { tenantsTable } from "./tenants";

export interface FixedCostItem { id: string; category: string; description: string; value: number; }
export interface VariableCostItem { id: string; category: string; description: string; valuePax: number; }
export interface FreePassenger { id: string; name: string; cpf: string; whatsapp: string; role: "organizer" | "guide"; seatNumber: string | null; checkedInAt?: string | null; }

export const tripsTable = pgTable("trips", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  shortDescription: text("short_description"),
  destination: text("destination").notNull(),
  destinationCity: text("destination_city").notNull(),
  destinationState: text("destination_state").notNull(),
  destinationCountry: text("destination_country").default("Brasil"),
  originCity: text("origin_city"),
  originState: text("origin_state"),
  type: text("type").notNull(),
  category: text("category").notNull(),
  departureDate: timestamp("departure_date", { withTimezone: true }).notNull(),
  returnDate: timestamp("return_date", { withTimezone: true }),
  registrationDeadline: timestamp("registration_deadline", { withTimezone: true }),
  departureTime: text("departure_time"),
  returnTime: text("return_time"),
  totalCapacity: integer("total_capacity").notNull(),
  availableSeats: integer("available_seats").notNull(),
  reservedSeats: integer("reserved_seats").notNull().default(0),
  confirmedSeats: integer("confirmed_seats").notNull().default(0),
  seatMap: json("seat_map").$type<Record<string, unknown>>().notNull().default({}),
  seatLayout: text("seat_layout").default("2x2"),
  priceAdult: numeric("price_adult", { precision: 10, scale: 2 }).notNull(),
  priceChild: numeric("price_child", { precision: 10, scale: 2 }),
  priceInfant: numeric("price_infant", { precision: 10, scale: 2 }),
  priceSenior: numeric("price_senior", { precision: 10, scale: 2 }),
  reservationFee: numeric("reservation_fee", { precision: 10, scale: 2 }),
  inclusions: text("inclusions").array().notNull().default([]),
  exclusions: text("exclusions").array().notNull().default([]),
  itinerary: json("itinerary"),
  boardingPoints: json("boarding_points").$type<{ id: string; name: string; time: string; address: string }[]>().default([]),
  coverImage: text("cover_image"),
  gallery: text("gallery").array().notNull().default([]),
  videos: text("videos").array().notNull().default([]),
  status: text("status").$type<TripStatus>().notNull().default("draft"),
  isPublic: boolean("is_public").notNull().default(false),
  isFeatured: boolean("is_featured").notNull().default(false),
  isAvailableInShop: boolean("is_available_in_shop").notNull().default(false),
  vehiclePlate: text("vehicle_plate"),
  vehicleId: text("vehicle_id"),
  vehicleType: text("vehicle_type"),
  driverName: text("driver_name"),
  tourGuide: text("tour_guide"),
  tripOrganizer: text("trip_organizer"),
  driverCnh: text("driver_cnh"),
  driverPhone: text("driver_phone"),
  driver1Cpf: text("driver1_cpf"),
  driver1Cnh: text("driver1_cnh"),
  driver1CnhCategory: text("driver1_cnh_category"),
  driver1CnhExpiry: text("driver1_cnh_expiry"),
  driver2Name: text("driver2_name"),
  driver2Cpf: text("driver2_cpf"),
  driver2Cnh: text("driver2_cnh"),
  driver2CnhCategory: text("driver2_cnh_category"),
  driver2CnhExpiry: text("driver2_cnh_expiry"),
  tourGuideCpf: text("tour_guide_cpf"),
  tourGuideRegistration: text("tour_guide_registration"),
  manifestNumber: text("manifest_number"),
  fixedCosts: json("fixed_costs").$type<FixedCostItem[]>().default([]),
  variableCosts: json("variable_costs").$type<VariableCostItem[]>().default([]),
  freeOrganizers: integer("free_organizers"),
  freeGuides: integer("free_guides"),
  freePassengers: json("free_passengers").$type<FreePassenger[]>().default([]),
  cancellationPolicy: text("cancellation_policy"),
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  layoutId: text("layout_id"),
  showSeatMap: boolean("show_seat_map").notNull().default(true),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("trips_tenant_id_departure_date_idx").on(t.tenantId, t.departureDate),
  index("trips_tenant_id_status_idx").on(t.tenantId, t.status),
  index("trips_slug_idx").on(t.slug),
]);

export const insertTripSchema = createInsertSchema(tripsTable).omit({ createdAt: true, updatedAt: true });
export type InsertTrip = typeof tripsTable.$inferInsert;
export type Trip = typeof tripsTable.$inferSelect;

export const tripsRelations = relations(tripsTable, ({ one }) => ({
  tenant: one(tenantsTable, { fields: [tripsTable.tenantId], references: [tenantsTable.id] }),
}));

