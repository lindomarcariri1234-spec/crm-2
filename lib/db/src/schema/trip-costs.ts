import { pgTable, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { tripsTable } from "./trips";

export const tripCostsTable = pgTable("trip_costs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  tripId: text("trip_id").notNull().references(() => tripsTable.id, { onDelete: "cascade" }),
  category: text("category").notNull(),
  description: text("description").notNull(),
  supplierId: text("supplier_id"),
  supplierName: text("supplier_name"),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"),
  dueDate: timestamp("due_date", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTripCostSchema = createInsertSchema(tripCostsTable).omit({ createdAt: true, updatedAt: true });
export type InsertTripCost = z.infer<typeof insertTripCostSchema>;
export type TripCost = typeof tripCostsTable.$inferSelect;

export const tripCostsRelations = relations(tripCostsTable, ({ one }) => ({
  tenant: one(tenantsTable, { fields: [tripCostsTable.tenantId], references: [tenantsTable.id] }),
  trip: one(tripsTable, { fields: [tripCostsTable.tripId], references: [tripsTable.id] }),
}));
