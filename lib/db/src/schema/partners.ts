import { pgTable, text, timestamp, boolean, numeric, integer, json } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const partnersTable = pgTable("partners", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  cnpj: text("cnpj"),
  slug: text("slug").notNull(),
  description: text("description"),
  phone: text("phone"),
  logo: text("logo"),
  status: text("status").notNull().default("pending"),
  commissionPct: numeric("commission_pct", { precision: 5, scale: 2 }).notNull().default("30"),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPartnerSchema = createInsertSchema(partnersTable).omit({ createdAt: true, updatedAt: true });
export type InsertPartner = z.infer<typeof insertPartnerSchema>;
export type Partner = typeof partnersTable.$inferSelect;

export const partnerProductsTable = pgTable("partner_products", {
  id: text("id").primaryKey(),
  partnerId: text("partner_id").notNull().references(() => partnersTable.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("passeio"),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
  maxCapacity: integer("max_capacity").notNull().default(10),
  durationMinutes: integer("duration_minutes"),
  meetingPoint: text("meeting_point"),
  cancellationPolicy: text("cancellation_policy"),
  images: json("images").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPartnerProductSchema = createInsertSchema(partnerProductsTable).omit({ createdAt: true, updatedAt: true });
export type InsertPartnerProduct = z.infer<typeof insertPartnerProductSchema>;
export type PartnerProduct = typeof partnerProductsTable.$inferSelect;

export const partnerAvailabilityTable = pgTable("partner_availability", {
  id: text("id").primaryKey(),
  productId: text("product_id").notNull().references(() => partnerProductsTable.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  spotsTotal: integer("spots_total").notNull().default(10),
  spotsUsed: integer("spots_used").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPartnerAvailabilitySchema = createInsertSchema(partnerAvailabilityTable).omit({ createdAt: true, updatedAt: true });
export type InsertPartnerAvailability = z.infer<typeof insertPartnerAvailabilitySchema>;
export type PartnerAvailability = typeof partnerAvailabilityTable.$inferSelect;

export const partnerCommissionsTable = pgTable("partner_commissions", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  partnerId: text("partner_id").notNull().references(() => partnersTable.id, { onDelete: "cascade" }),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  grossAmount: numeric("gross_amount", { precision: 10, scale: 2 }).notNull(),
  partnerAmount: numeric("partner_amount", { precision: 10, scale: 2 }).notNull(),
  agencyAmount: numeric("agency_amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"),
  period: text("period").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPartnerCommissionSchema = createInsertSchema(partnerCommissionsTable).omit({ createdAt: true, updatedAt: true });
export type InsertPartnerCommission = z.infer<typeof insertPartnerCommissionSchema>;
export type PartnerCommission = typeof partnerCommissionsTable.$inferSelect;

export const partnersRelations = relations(partnersTable, ({ one, many }) => ({
  tenant: one(tenantsTable, { fields: [partnersTable.tenantId], references: [tenantsTable.id] }),
  products: many(partnerProductsTable),
  commissions: many(partnerCommissionsTable),
}));

export const partnerProductsRelations = relations(partnerProductsTable, ({ one, many }) => ({
  partner: one(partnersTable, { fields: [partnerProductsTable.partnerId], references: [partnersTable.id] }),
  tenant: one(tenantsTable, { fields: [partnerProductsTable.tenantId], references: [tenantsTable.id] }),
  availability: many(partnerAvailabilityTable),
}));

export const partnerAvailabilityRelations = relations(partnerAvailabilityTable, ({ one }) => ({
  product: one(partnerProductsTable, { fields: [partnerAvailabilityTable.productId], references: [partnerProductsTable.id] }),
}));

export const partnerCommissionsRelations = relations(partnerCommissionsTable, ({ one }) => ({
  partner: one(partnersTable, { fields: [partnerCommissionsTable.partnerId], references: [partnersTable.id] }),
  tenant: one(tenantsTable, { fields: [partnerCommissionsTable.tenantId], references: [tenantsTable.id] }),
}));
