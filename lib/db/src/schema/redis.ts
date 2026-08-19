import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const redisAlertLogTable = pgTable("redis_alert_log", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  alertStatus: text("alert_status"),
  emailTo: text("email_to"),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RedisAlertLog = typeof redisAlertLogTable.$inferSelect;
