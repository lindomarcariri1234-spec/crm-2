import { pgTable, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { clientsTable } from "./clients";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export type ClientNotificationType =
  | "referral_converted"
  | "referral_bonus_released"
  | "referral_bonus_paid"
  | "referral_link_clicked"
  | "reservation_cancelled"
  | "loyalty_tier_upgraded";

export interface ClientNotificationPayload {
  referredName?: string;
  referralCode?: string;
  bonusAmount?: number;
  agencyName?: string;
  voucherCode?: string;
  loyaltyPointsRefunded?: number;
  // loyalty_tier_upgraded
  newTier?: string;
  newTierLabel?: string;
  totalPoints?: number;
  nextTierLabel?: string | null;
}

export const clientNotificationsTable = pgTable(
  "client_notifications",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").notNull(),
    type: text("type").$type<ClientNotificationType>().notNull(),
    payload: jsonb("payload").$type<ClientNotificationPayload>(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("client_notifications_client_id_idx").on(table.clientId, table.createdAt),
    index("client_notifications_unread_idx")
      .on(table.clientId, table.createdAt)
      .where(sql`read_at IS NULL`),
  ],
);

export const insertClientNotificationSchema = createInsertSchema(clientNotificationsTable);
export type InsertClientNotification = z.infer<typeof insertClientNotificationSchema>;
export type ClientNotification = typeof clientNotificationsTable.$inferSelect;
