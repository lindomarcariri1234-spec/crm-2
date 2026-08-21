import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { reservationsTable } from "./reservations";
import { tenantsTable } from "./tenants";

export type WhatsAppOutboxType = "reservation_confirmed";
export type WhatsAppOutboxStatus = "pending" | "enqueued" | "processing" | "sent";

/**
 * Durable, idempotent records for transactional WhatsApp notifications.
 *
 * The unique key makes a reservation-confirmation message a single logical
 * notification even when payment webhooks or post-payment effects are retried.
 */
export const whatsappNotificationOutboxTable = pgTable(
  "whatsapp_notification_outbox",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    reservationId: text("reservation_id")
      .notNull()
      .references(() => reservationsTable.id, { onDelete: "cascade" }),
    type: text("type").$type<WhatsAppOutboxType>().notNull(),
    status: text("status").$type<WhatsAppOutboxStatus>().notNull().default("pending"),
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("whatsapp_notification_outbox_reservation_type_unique").on(
      table.tenantId,
      table.reservationId,
      table.type,
    ),
    index("whatsapp_notification_outbox_pending_idx").on(table.status, table.createdAt),
  ],
);