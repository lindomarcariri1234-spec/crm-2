import { pgTable, text, timestamp, boolean, integer, json, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const chatbotConversationsTable = pgTable("chatbot_conversations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  clientId: text("client_id"),
  channel: text("channel").notNull().default("webchat"),
  status: text("status").notNull().default("open"),
  assignedUserId: text("assigned_user_id"),
  sessionId: text("session_id"),
  metadata: json("metadata"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertChatbotConversationSchema = createInsertSchema(chatbotConversationsTable).omit({ createdAt: true, startedAt: true });
export type InsertChatbotConversation = z.infer<typeof insertChatbotConversationSchema>;
export type ChatbotConversation = typeof chatbotConversationsTable.$inferSelect;

export const chatbotMessagesTable = pgTable(
  "chatbot_messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull(),
    tenantId: text("tenant_id").notNull(),
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
    isBot: boolean("is_bot").notNull().default(false),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("chatbot_messages_tenant_source_message_unique")
      .on(table.tenantId, table.sourceMessageId),
  ],
);

export const insertChatbotMessageSchema = createInsertSchema(chatbotMessagesTable).omit({ sentAt: true });
export type InsertChatbotMessage = z.infer<typeof insertChatbotMessageSchema>;
export type ChatbotMessage = typeof chatbotMessagesTable.$inferSelect;
