import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const birthdayMessagesTable = pgTable("birthday_messages", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  clientId: text("client_id").notNull(),
  birthdayYear: integer("birthday_year").notNull(),
  sentWhatsapp: boolean("sent_whatsapp").notNull().default(false),
  sentEmail: boolean("sent_email").notNull().default(false),
  whatsappSentAt: timestamp("whatsapp_sent_at", { withTimezone: true }),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  whatsappError: text("whatsapp_error"),
  emailError: text("email_error"),
  couponId: text("coupon_id"),
  couponCode: text("coupon_code"),
  emailOpened: boolean("email_opened").notNull().default(false),
  emailOpenedAt: timestamp("email_opened_at", { withTimezone: true }),
  converted: boolean("converted").notNull().default(false),
  isManual: boolean("is_manual").notNull().default(false),
  sentById: text("sent_by_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBirthdayMessageSchema = createInsertSchema(birthdayMessagesTable).omit({ createdAt: true });
export type InsertBirthdayMessage = z.infer<typeof insertBirthdayMessageSchema>;
export type BirthdayMessage = typeof birthdayMessagesTable.$inferSelect;
