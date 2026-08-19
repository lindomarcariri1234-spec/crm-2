import { pgTable, text, timestamp, numeric, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const suppliersTable = pgTable("suppliers", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  cnpj: text("cnpj"),
  contactName: text("contact_name"),
  email: text("email"),
  whatsapp: text("whatsapp"),
  phone: text("phone"),
  addressStreet: text("address_street"),
  addressCity: text("address_city"),
  addressState: text("address_state"),
  bankName: text("bank_name"),
  bankAgency: text("bank_agency"),
  bankAccount: text("bank_account"),
  pixKey: text("pix_key"),
  pixType: text("pix_type"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSupplierSchema = createInsertSchema(suppliersTable).omit({ createdAt: true, updatedAt: true });
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliersTable.$inferSelect;

export const vehiclesTable = pgTable("vehicles", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  plate: text("plate").notNull(),
  capacity: integer("capacity").notNull(),
  model: text("model"),
  year: integer("year"),
  amenities: text("amenities").array().notNull().default([]),
  dailyRate: numeric("daily_rate", { precision: 10, scale: 2 }),
  ratePerKm: numeric("rate_per_km", { precision: 10, scale: 2 }),
  photoUrl: text("photo_url"),
  driverName: text("driver_name"),
  driverPhone: text("driver_phone"),
  seatLayout: text("seat_layout"),
  notes: text("notes"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({ createdAt: true, updatedAt: true });
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;

export const accommodationsTable = pgTable("accommodations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  contactName: text("contact_name"),
  phone: text("phone"),
  email: text("email"),
  totalRooms: integer("total_rooms"),
  amenities: text("amenities").array().notNull().default([]),
  pricePerNight: numeric("price_per_night", { precision: 10, scale: 2 }),
  coverImage: text("cover_image"),
  gallery: text("gallery").array().notNull().default([]),
  rating: numeric("rating", { precision: 3, scale: 2 }),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAccommodationSchema = createInsertSchema(accommodationsTable).omit({ createdAt: true, updatedAt: true });
export type InsertAccommodation = z.infer<typeof insertAccommodationSchema>;
export type Accommodation = typeof accommodationsTable.$inferSelect;

export const destinationsTable = pgTable("destinations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  country: text("country").notNull().default("Brasil"),
  description: text("description"),
  mainAttractions: text("main_attractions").array().notNull().default([]),
  bestSeason: text("best_season"),
  coverImage: text("cover_image"),
  gallery: text("gallery").array().notNull().default([]),
  rating: numeric("rating", { precision: 3, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertDestinationSchema = createInsertSchema(destinationsTable).omit({ createdAt: true, updatedAt: true });
export type InsertDestination = z.infer<typeof insertDestinationSchema>;
export type Destination = typeof destinationsTable.$inferSelect;
