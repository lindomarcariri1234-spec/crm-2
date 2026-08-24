import { index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { reservationsTable } from "./reservations";
import { tenantsTable } from "./tenants";

export type WhatsAppOutboxType =
  | "reservation_confirmed"
  | "boarding_reminder"
  | "payment_pending";
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
    // Calendar day in America/Sao_Paulo for reminder types. Confirmation uses
    // the stable "confirmation" value so all notification variants share the
    // same durable outbox without weakening their idempotency key.
    referenceDate: text("reference_date").notNull().default("confirmation"),
    status: text("status").$type<WhatsAppOutboxStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    provider: text("provider"),
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("whatsapp_notification_outbox_reservation_type_reference_unique").on(
      table.tenantId,
      table.reservationId,
      table.type,
      table.referenceDate,
    ),
    index("whatsapp_notification_outbox_pending_idx").on(table.status, table.createdAt),
  ],
);