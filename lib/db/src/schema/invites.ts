import { pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import type { Role } from "@workspace/permissions";
import { tenantsTable } from "./tenants";

export const invitesTable = pgTable("invites", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").$type<Role>().notNull().default("vendedor"),
  invitedBy: text("invited_by"),
  token: text("token").notNull().unique(),
  accepted: boolean("accepted").notNull().default(false),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Invite = typeof invitesTable.$inferSelect;
