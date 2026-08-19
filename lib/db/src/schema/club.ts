import { pgTable, text, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";

export const clubConfigTable = pgTable("club_config", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  clubName: text("club_name").notNull().default("Clube Visite"),
  description: text("description"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("club_config_tenant_unique").on(table.tenantId),
]);

export const insertClubConfigSchema = createInsertSchema(clubConfigTable);
export type InsertClubConfig = z.infer<typeof insertClubConfigSchema>;
export type ClubConfig = typeof clubConfigTable.$inferSelect;

export const clubBenefitsTable = pgTable("club_benefits", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  tier: text("tier").notNull(),
  benefitKey: text("benefit_key").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  value: text("value"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("club_benefits_tenant_tier_idx").on(table.tenantId, table.tier),
]);

export const insertClubBenefitSchema = createInsertSchema(clubBenefitsTable);
export type InsertClubBenefit = z.infer<typeof insertClubBenefitSchema>;
export type ClubBenefit = typeof clubBenefitsTable.$inferSelect;
