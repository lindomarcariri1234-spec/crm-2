import { pgTable, text, timestamp, integer, json } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tenantsTable } from "./tenants";

export const vehicleLayoutsTable = pgTable("vehicle_layouts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  vehicleType: text("vehicle_type"),
  rows: integer("rows").notNull().default(12),
  cols: integer("cols").notNull().default(4),
  floors: integer("floors").notNull().default(1),
  numberingType: text("numbering_type").notNull().default("sequential"),
  cells: json("cells").$type<LayoutCell[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type LayoutCell = {
  row: number;
  col: number;
  floor: number;
  type: "seat" | "vip" | "accessible" | "wc" | "stairs" | "fridge" | "empty" | "blocked";
  label?: string;
};

export type VehicleLayout = typeof vehicleLayoutsTable.$inferSelect;
export type InsertVehicleLayout = typeof vehicleLayoutsTable.$inferInsert;

export const vehicleLayoutsRelations = relations(vehicleLayoutsTable, ({ one }) => ({
  tenant: one(tenantsTable, { fields: [vehicleLayoutsTable.tenantId], references: [tenantsTable.id] }),
}));
