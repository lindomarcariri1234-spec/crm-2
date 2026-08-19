import { pgTable, text, timestamp, numeric, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const loyaltyProgramsTable = pgTable("loyalty_programs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  pointsPerReal: numeric("points_per_real", { precision: 10, scale: 4 }).notNull().default("1"),
  realPerPoint: numeric("real_per_point", { precision: 10, scale: 4 }).notNull().default("0.01"),
  minRedeemPoints: integer("min_redeem_points").notNull().default(100),
  isActive: boolean("is_active").notNull().default(true),
  tierBenefits: jsonb("tier_benefits"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertLoyaltyProgramSchema = createInsertSchema(loyaltyProgramsTable).omit({ createdAt: true, updatedAt: true });
export type InsertLoyaltyProgram = z.infer<typeof insertLoyaltyProgramSchema>;
export type LoyaltyProgram = typeof loyaltyProgramsTable.$inferSelect;

export const loyaltyMembersTable = pgTable("loyalty_members", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  programId: text("program_id").notNull(),
  clientId: text("client_id").notNull(),
  totalPoints: integer("total_points").notNull().default(0),
  availablePoints: integer("available_points").notNull().default(0),
  tier: text("tier").notNull().default("bronze"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
});

export const insertLoyaltyMemberSchema = createInsertSchema(loyaltyMembersTable).omit({ joinedAt: true });
export type InsertLoyaltyMember = z.infer<typeof insertLoyaltyMemberSchema>;
export type LoyaltyMember = typeof loyaltyMembersTable.$inferSelect;

export const loyaltyTransactionsTable = pgTable("loyalty_transactions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  memberId: text("member_id").notNull(),
  type: text("type").notNull(),
  points: integer("points").notNull(),
  description: text("description").notNull(),
  referenceId: text("reference_id"),
  referenceType: text("reference_type"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLoyaltyTransactionSchema = createInsertSchema(loyaltyTransactionsTable).omit({ createdAt: true });
export type InsertLoyaltyTransaction = z.infer<typeof insertLoyaltyTransactionSchema>;
export type LoyaltyTransaction = typeof loyaltyTransactionsTable.$inferSelect;
