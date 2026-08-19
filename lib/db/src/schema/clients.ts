import { pgTable, text, timestamp, boolean, numeric, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { sql, relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";


export const clientsTable = pgTable("clients", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  whatsapp: text("whatsapp").notNull(),
  phone: text("phone"),
  cpf: text("cpf"),
  rg: text("rg"),
  birthDate: timestamp("birth_date", { withTimezone: true }),
  gender: text("gender"),
  maritalStatus: text("marital_status"),
  photoUrl: text("photo_url"),
  instagram: text("instagram"),
  origin: text("origin"),
  addressZipcode: text("address_zipcode"),
  addressStreet: text("address_street"),
  addressNumber: text("address_number"),
  addressComplement: text("address_complement"),
  addressNeighborhood: text("address_neighborhood"),
  addressCity: text("address_city"),
  addressState: text("address_state"),
  addressCountry: text("address_country").default("Brasil"),
  totalSpent: numeric("total_spent", { precision: 10, scale: 2 }).notNull().default("0"),
  outstandingBalance: numeric("outstanding_balance", { precision: 10, scale: 2 }).notNull().default("0"),
  observations: text("observations"),
  npsScore: integer("nps_score"),
  companyFeedback: text("company_feedback"),
  dreamDestinations: text("dream_destinations").array().notNull().default([]),
  professionalArea: text("professional_area"),
  favoriteDrink: text("favorite_drink"),
  numberOfChildren: integer("number_of_children"),
  travelPreference: text("travel_preference"),
  musicalPreferences: text("musical_preferences"),
  foodPreferences: text("food_preferences"),
  travelInterests: text("travel_interests").array().notNull().default([]),
  likesPhotosVideos: boolean("likes_photos_videos"),
  preferredDestinationTypes: text("preferred_destination_types").array().notNull().default([]),
  internalRating: integer("internal_rating"),
  companyNps: integer("company_nps"),
  classification: text("classification").notNull().default("new"),
  status: text("status").notNull().default("active"),
  tags: text("tags").array().notNull().default([]),
  pipelineStage: text("pipeline_stage").notNull().default("novo"),
  createdById: text("created_by_id").notNull(),
  userId: text("user_id"),
  referralCode: text("referral_code"),
  referralCodeGeneratedAt: timestamp("referral_code_generated_at", { withTimezone: true }),
  referralCodeStatus: text("referral_code_status").notNull().default("active"),
  referredById: text("referred_by_id"),
  totalReferrals: integer("total_referrals").notNull().default(0),
  successfulReferrals: integer("successful_referrals").notNull().default(0),
  referralEarnings: numeric("referral_earnings", { precision: 10, scale: 2 }).notNull().default("0"),
  referralWelcomeEmailSentAt: timestamp("referral_welcome_email_sent_at", { withTimezone: true }),
  referralSuspendedAttemptAt: timestamp("referral_suspended_attempt_at", { withTimezone: true }),
  referralSuspendedAttemptCount: integer("referral_suspended_attempt_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
  whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(true),
  emailOptIn: boolean("email_opt_in").notNull().default(true),
  ambassadorOptIn: boolean("ambassador_opt_in").notNull().default(false),
  customerCode: text("customer_code"),
  expoPushToken: text("expo_push_token"),
}, (table) => [
  uniqueIndex("clients_tenant_cpf_unique").on(table.tenantId, table.cpf).where(sql`${table.cpf} IS NOT NULL`),
  uniqueIndex("clients_tenant_referral_code_unique").on(table.tenantId, table.referralCode).where(sql`${table.referralCode} IS NOT NULL`),
  uniqueIndex("clients_customer_code_unique").on(table.customerCode).where(sql`${table.customerCode} IS NOT NULL`),
]);

export const insertClientSchema = createInsertSchema(clientsTable).omit({ createdAt: true, updatedAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;

export const clientsRelations = relations(clientsTable, ({ one, many }) => ({
  tenant: one(tenantsTable, { fields: [clientsTable.tenantId], references: [tenantsTable.id] }),
}));
