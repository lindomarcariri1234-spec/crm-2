import { pgTable, text, timestamp, boolean, json, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tenantsTable = pgTable("tenants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  email: text("email").notNull(),
  cnpj: text("cnpj"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  whatsapp: text("whatsapp"),
  phone: text("phone"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color").default("#3B82F6"),
  secondaryColor: text("secondary_color").default("#10B981"),
  planId: text("plan_id").notNull().default("starter"),
  pendingPlanId: text("pending_plan_id"),
  status: text("status").notNull().default("trial"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspensionReason: text("suspension_reason"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  limits: json("limits").$type<Record<string, number>>().notNull().default({}),
  settings: json("settings").$type<Record<string, unknown>>(),
  website: text("website"),
  reservationPrefix: text("reservation_prefix"),
  prefixLocked: boolean("prefix_locked").notNull().default(false),
  lastClientSeq: integer("last_client_seq").notNull().default(0),
  maxUsersOverride: integer("max_users_override"),
  maxClientsOverride: integer("max_clients_override"),
  maxTripsOverride: integer("max_trips_override"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTenantSchema = createInsertSchema(tenantsTable).omit({ createdAt: true, updatedAt: true });
export type InsertTenant = z.infer<typeof insertTenantSchema>;
export type Tenant = typeof tenantsTable.$inferSelect;

