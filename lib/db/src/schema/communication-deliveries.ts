import { relations } from "drizzle-orm";
import { boolean, index, integer, json, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const OUTBOUND_DELIVERY_CHANNELS = ["email", "whatsapp"] as const;
export type OutboundDeliveryChannel = (typeof OUTBOUND_DELIVERY_CHANNELS)[number];

export const OUTBOUND_DELIVERY_STATUSES = ["pending", "processing", "accepted", "failed", "skipped"] as const;
export type OutboundDeliveryStatus = (typeof OUTBOUND_DELIVERY_STATUSES)[number];

export const OUTBOUND_BOUNCE_TYPES = ["permanent", "temporary"] as const;
export type OutboundBounceType = (typeof OUTBOUND_BOUNCE_TYPES)[number];

export const OUTBOUND_MESSAGE_STATUSES = ["pending", "processing", "accepted", "partial", "failed", "skipped"] as const;
export type OutboundMessageStatus = (typeof OUTBOUND_MESSAGE_STATUSES)[number];

export const outboundMessagesTable = pgTable(
  "outbound_messages",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    eventType: text("event_type").notNull(),
    origin: text("origin").notNull().default("system"),
    originChannel: text("origin_channel"),
    recipientType: text("recipient_type").notNull(),
    recipientId: text("recipient_id"),
    recipientName: text("recipient_name"),
    emailAddress: text("email_address"),
    whatsappNumber: text("whatsapp_number"),
    emailSubject: text("email_subject"),
    emailHtml: text("email_html"),
    whatsappText: text("whatsapp_text"),
    senderName: text("sender_name"),
    status: text("status").$type<OutboundMessageStatus>().notNull().default("pending"),
    isReplication: boolean("is_replication").notNull().default(false),
    replicatedFromId: text("replicated_from_id"),
    createdById: text("created_by_id"),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("outbound_messages_tenant_idempotency_unique").on(table.tenantId, table.idempotencyKey),
    index("outbound_messages_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("outbound_messages_tenant_status_idx").on(table.tenantId, table.status, table.createdAt),
  ],
);

export const outboundDeliveriesTable = pgTable(
  "outbound_deliveries",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    outboundMessageId: text("outbound_message_id").notNull().references(() => outboundMessagesTable.id, { onDelete: "cascade" }),
    channel: text("channel").$type<OutboundDeliveryChannel>().notNull(),
    recipient: text("recipient"),
    subject: text("subject"),
    content: text("content").notNull(),
    status: text("status").$type<OutboundDeliveryStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    provider: text("provider"),
    externalId: text("external_id"),
    bounceType: text("bounce_type").$type<OutboundBounceType>(),
    lastError: text("last_error"),
    skippedReason: text("skipped_reason"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("outbound_deliveries_message_channel_unique").on(table.outboundMessageId, table.channel),
    index("outbound_deliveries_tenant_status_next_idx").on(table.tenantId, table.status, table.nextAttemptAt),
    index("outbound_deliveries_tenant_message_idx").on(table.tenantId, table.outboundMessageId),
  ],
);

export const outboundDeliveryAttemptsTable = pgTable(
  "outbound_delivery_attempts",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    deliveryId: text("delivery_id").notNull().references(() => outboundDeliveriesTable.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    provider: text("provider"),
    status: text("status").notNull(),
    externalId: text("external_id"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("outbound_delivery_attempts_delivery_number_unique").on(table.deliveryId, table.attemptNumber),
    index("outbound_delivery_attempts_tenant_started_idx").on(table.tenantId, table.startedAt),
  ],
);

export const outboundMessagesRelations = relations(outboundMessagesTable, ({ one, many }) => ({
  tenant: one(tenantsTable, { fields: [outboundMessagesTable.tenantId], references: [tenantsTable.id] }),
  deliveries: many(outboundDeliveriesTable),
}));

export const outboundDeliveriesRelations = relations(outboundDeliveriesTable, ({ one, many }) => ({
  tenant: one(tenantsTable, { fields: [outboundDeliveriesTable.tenantId], references: [tenantsTable.id] }),
  message: one(outboundMessagesTable, { fields: [outboundDeliveriesTable.outboundMessageId], references: [outboundMessagesTable.id] }),
  attempts: many(outboundDeliveryAttemptsTable),
}));

export const outboundDeliveryAttemptsRelations = relations(outboundDeliveryAttemptsTable, ({ one }) => ({
  tenant: one(tenantsTable, { fields: [outboundDeliveryAttemptsTable.tenantId], references: [tenantsTable.id] }),
  delivery: one(outboundDeliveriesTable, { fields: [outboundDeliveryAttemptsTable.deliveryId], references: [outboundDeliveriesTable.id] }),
}));

export type OutboundMessage = typeof outboundMessagesTable.$inferSelect;
export type InsertOutboundMessage = typeof outboundMessagesTable.$inferInsert;
export type OutboundDelivery = typeof outboundDeliveriesTable.$inferSelect;
export type InsertOutboundDelivery = typeof outboundDeliveriesTable.$inferInsert;
export type OutboundDeliveryAttempt = typeof outboundDeliveryAttemptsTable.$inferSelect;