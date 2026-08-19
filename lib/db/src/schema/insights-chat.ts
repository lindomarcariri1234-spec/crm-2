import { pgTable, text, json, timestamp, unique } from "drizzle-orm/pg-core";

export interface InsightsChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const insightsChatHistoryTable = pgTable(
  "insights_chat_history",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    userId: text("user_id").notNull(),
    chatType: text("chat_type").notNull(),
    messages: json("messages")
      .notNull()
      .$type<InsightsChatMessage[]>()
      .default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("insights_chat_history_unique").on(t.tenantId, t.userId, t.chatType)],
);
