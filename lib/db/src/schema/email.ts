import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const emailLogsTable = pgTable("email_logs", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  reservationId: text("reservation_id"),
  referralId: text("referral_id"),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  status: text("status").notNull(),
  messageId: text("message_id"),
  errorMessage: text("error_message"),
  isAutoRetry: boolean("is_auto_retry").notNull().default(false),
  retriesExhaustedAt: timestamp("retries_exhausted_at", { withTimezone: true }),
  retriesResolvedAt: timestamp("retries_resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("email_logs_retries_exhausted_idx")
    .on(table.tenantId, table.reservationId)
    .where(sql`${table.retriesExhaustedAt} IS NOT NULL`),
]);

export type EmailLog = typeof emailLogsTable.$inferSelect;
export type InsertEmailLog = typeof emailLogsTable.$inferInsert;
