import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { usersTable } from "./users";
import { clientsTable } from "./clients";
import { tripsTable } from "./trips";
import { paymentsTable } from "./payments";

export const calendarEventsTable = pgTable("calendar_events", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => usersTable.id, { onDelete: "cascade" }),
  clientId: text("client_id").references(() => clientsTable.id, { onDelete: "cascade" }),
  tripId: text("trip_id").references(() => tripsTable.id, { onDelete: "cascade" }),
  paymentId: text("payment_id").references(() => paymentsTable.id, { onDelete: "cascade" }),
  googleEventId: text("google_event_id").notNull(),
  calendarId: text("calendar_id").notNull().default("primary"),
  eventType: text("event_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }),
  location: text("location"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("calendar_events_tenant_idx").on(table.tenantId),
  index("calendar_events_user_idx").on(table.userId),
  index("calendar_events_google_event_idx").on(table.googleEventId),
  index("calendar_events_trip_idx").on(table.tripId),
  index("calendar_events_payment_idx").on(table.paymentId),
]);

export const insertCalendarEventSchema = createInsertSchema(calendarEventsTable).omit({ createdAt: true, updatedAt: true });
export type InsertCalendarEvent = z.infer<typeof insertCalendarEventSchema>;
export type CalendarEvent = typeof calendarEventsTable.$inferSelect;

export const calendarEventsRelations = relations(calendarEventsTable, ({ one }) => ({
  tenant: one(tenantsTable, { fields: [calendarEventsTable.tenantId], references: [tenantsTable.id] }),
  user: one(usersTable, { fields: [calendarEventsTable.userId], references: [usersTable.id] }),
  client: one(clientsTable, { fields: [calendarEventsTable.clientId], references: [clientsTable.id] }),
  trip: one(tripsTable, { fields: [calendarEventsTable.tripId], references: [tripsTable.id] }),
  payment: one(paymentsTable, { fields: [calendarEventsTable.paymentId], references: [paymentsTable.id] }),
}));
