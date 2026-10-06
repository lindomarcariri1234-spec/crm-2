import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  json,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { clientsTable } from "./clients";
import { usersTable } from "./users";

export const chatbotConversationsTable = pgTable("chatbot_conversations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  clientId: text("client_id"),
  channel: text("channel").notNull().default("webchat"),
  // Stable internal identity of the Evolution connection that received this
  // conversation. Kept as a snapshot (without FK) so revoking a connection
  // cannot silently route replies through a different number.
  whatsappIntegrationId: text("whatsapp_integration_id"),
  status: text("status").notNull().default("open"),
  assignedUserId: text("assigned_user_id"),
  sessionId: text("session_id"),
  metadata: json("metadata"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("chatbot_conversations_tenant_whatsapp_connection_idx")
    .on(table.tenantId, table.channel, table.whatsappIntegrationId, table.sessionId),
  index("chatbot_conversations_instagram_account_idx")
    .on(sql`(${table.metadata}->>'instagramUserId')`)
    .where(sql`${table.channel} = 'instagram'`),
]);

export const insertChatbotConversationSchema = createInsertSchema(chatbotConversationsTable).omit({ createdAt: true, startedAt: true });
export type InsertChatbotConversation = z.infer<typeof insertChatbotConversationSchema>;
export type ChatbotConversation = typeof chatbotConversationsTable.$inferSelect;

export const supportQueuesTable = pgTable(
  "support_queues",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("support_queues_tenant_slug_unique").on(table.tenantId, table.slug),
    uniqueIndex("support_queues_one_default_per_tenant_unique")
      .on(table.tenantId)
      .where(sql`${table.isDefault}`),
    index("support_queues_tenant_active_idx").on(table.tenantId, table.isActive, table.name),
  ],
);
export type SupportQueue = typeof supportQueuesTable.$inferSelect;

export type SupportTicketStatus = "pending" | "open" | "resolved";
export type SupportTicketPriority = "low" | "normal" | "high" | "urgent";

export const supportTicketsTable = pgTable(
  "support_tickets",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull()
      .references(() => chatbotConversationsTable.id, { onDelete: "cascade" }),
    // Copied from the conversation for durable ticket-level routing/display.
    whatsappIntegrationId: text("whatsapp_integration_id"),
    clientId: text("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
    queueId: text("queue_id").references(() => supportQueuesTable.id, { onDelete: "set null" }),
    assignedUserId: text("assigned_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    status: text("status").$type<SupportTicketStatus>().notNull().default("pending"),
    priority: text("priority").$type<SupportTicketPriority>().notNull().default("normal"),
    subject: text("subject"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("support_tickets_status_check", sql`${table.status} IN ('pending', 'open', 'resolved')`),
    check("support_tickets_priority_check", sql`${table.priority} IN ('low', 'normal', 'high', 'urgent')`),
    uniqueIndex("support_tickets_one_active_per_conversation_unique")
      .on(table.tenantId, table.conversationId)
      .where(sql`${table.status} <> 'resolved'`),
    index("support_tickets_tenant_status_activity_idx").on(table.tenantId, table.status, table.lastMessageAt),
    index("support_tickets_tenant_queue_status_activity_idx")
      .on(table.tenantId, table.queueId, table.status, table.lastMessageAt),
    index("support_tickets_tenant_assignee_status_activity_idx")
      .on(table.tenantId, table.assignedUserId, table.status, table.lastMessageAt),
  ],
);
export type SupportTicket = typeof supportTicketsTable.$inferSelect;

export const supportTicketEventsTable = pgTable(
  "support_ticket_events",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    ticketId: text("ticket_id").notNull().references(() => supportTicketsTable.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("support_ticket_events_tenant_ticket_created_idx").on(table.tenantId, table.ticketId, table.createdAt),
  ],
);

export const supportQuickRepliesTable = pgTable(
  "support_quick_replies",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    queueId: text("queue_id").references(() => supportQueuesTable.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    shortcut: text("shortcut").notNull(),
    content: text("content").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("support_quick_replies_tenant_shortcut_unique")
      .on(table.tenantId, sql`lower(${table.shortcut})`),
    index("support_quick_replies_tenant_active_idx").on(table.tenantId, table.isActive, table.title),
  ],
);

export const chatbotMessagesTable = pgTable(
  "chatbot_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    ticketId: text("ticket_id").references(() => supportTicketsTable.id, { onDelete: "set null" }),
    // Provider message IDs are the idempotency key for inbound WhatsApp
    // deliveries, which Evolution may replay after a timeout.
    sourceMessageId: text("source_message_id"),
    deliveryStatus: text("delivery_status").notNull().default("sent"),
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    deliveryUpdatedAt: timestamp("delivery_updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastDeliveryError: text("last_delivery_error"),
    role: text("role").notNull().default("user"),
    content: text("content").notNull(),
    mediaUrl: text("media_url"),
    mediaMimeType: text("media_mime_type"),
    mediaFileName: text("media_file_name"),
    mediaExpiredAt: timestamp("media_expired_at", { withTimezone: true }),
    isBot: boolean("is_bot").notNull().default(false),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chatbot_messages_media_retention_idx")
      .on(table.sentAt)
      .where(sql`${table.mediaUrl} IS NOT NULL AND ${table.mediaExpiredAt} IS NULL`),
    index("chatbot_messages_ticket_sent_idx").on(table.ticketId, table.sentAt),
    uniqueIndex("chatbot_messages_tenant_source_message_unique")
      .on(table.tenantId, table.sourceMessageId),
  ],
);

export const insertChatbotMessageSchema = createInsertSchema(chatbotMessagesTable).omit({ sentAt: true });
export type InsertChatbotMessage = z.infer<typeof insertChatbotMessageSchema>;
export type ChatbotMessage = typeof chatbotMessagesTable.$inferSelect;
