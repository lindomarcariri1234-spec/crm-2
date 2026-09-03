import { pgTable, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";

export type CalendarReconciliationStatus = "pending" | "associated" | "removed" | "dismissed";
export type CalendarReconciliationMatch = {
  id: string;
  type: "trip" | "payment" | "birthday";
  label: string;
};

/**
 * A review queue for events made before deterministic Google event IDs.
 *
 * Nothing in this table is treated as a calendar event until an agency admin
 * explicitly confirms the selected match.
 */
export const calendarReconciliationsTable = pgTable("calendar_reconciliations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  googleEventId: text("google_event_id").notNull(),
  calendarId: text("calendar_id").notNull().default("primary"),
  eventType: text("event_type").notNull(),
  status: text("status").$type<CalendarReconciliationStatus>().notNull().default("pending"),
  eventSummary: text("event_summary").notNull(),
  eventDescription: text("event_description"),
  eventLocation: text("event_location"),
  eventStartDate: timestamp("event_start_date", { withTimezone: true }).notNull(),
  eventEndDate: timestamp("event_end_date", { withTimezone: true }),
  candidateMatches: jsonb("candidate_matches").$type<CalendarReconciliationMatch[]>().notNull().default([]),
  selectedResourceId: text("selected_resource_id"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedById: text("resolved_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("calendar_reconciliations_user_google_event_unique").on(table.userId, table.googleEventId),
  index("calendar_reconciliations_tenant_status_idx").on(table.tenantId, table.status),
  index("calendar_reconciliations_user_status_idx").on(table.userId, table.status),
]);

export const insertCalendarReconciliationSchema = createInsertSchema(calendarReconciliationsTable)
  .omit({ createdAt: true, updatedAt: true });
export type InsertCalendarReconciliation = z.infer<typeof insertCalendarReconciliationSchema>;
export type CalendarReconciliation = typeof calendarReconciliationsTable.$inferSelect;

export const calendarReconciliationsRelations = relations(calendarReconciliationsTable, ({ one }) => ({
  tenant: one(tenantsTable, { fields: [calendarReconciliationsTable.tenantId], references: [tenantsTable.id] }),
  user: one(usersTable, { fields: [calendarReconciliationsTable.userId], references: [usersTable.id] }),
  resolvedBy: one(usersTable, { fields: [calendarReconciliationsTable.resolvedById], references: [usersTable.id] }),
}));