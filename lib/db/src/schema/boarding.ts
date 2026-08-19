import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const boardingLocationsTable = pgTable("boarding_locations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  reference: text("reference"),
  departureTime: text("departure_time"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertBoardingLocationSchema = createInsertSchema(boardingLocationsTable).omit({ createdAt: true, updatedAt: true });
export type InsertBoardingLocation = z.infer<typeof insertBoardingLocationSchema>;
export type BoardingLocation = typeof boardingLocationsTable.$inferSelect;
