import { pgTable, text, timestamp, numeric, integer, boolean, json, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const campaignsTable = pgTable("campaigns", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("email"),
  status: text("status").notNull().default("draft"),
  targetSegment: json("target_segment").$type<Record<string, unknown>>().notNull().default({}),
  subject: text("subject"),
  content: text("content").notNull(),
  mediaUrl: text("media_url"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  recipientsCount: integer("recipients_count").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  deliveredCount: integer("delivered_count").notNull().default(0),
  openedCount: integer("opened_count").notNull().default(0),
  clickedCount: integer("clicked_count").notNull().default(0),
  triggerType: text("trigger_type").notNull().default("manual"),
  triggerConfig: json("trigger_config").$type<Record<string, unknown>>(),
  autoEnabled: boolean("auto_enabled").notNull().default(false),
  createdById: text("created_by_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ createdAt: true, updatedAt: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;

export const campaignSendsTable = pgTable(
  "campaign_sends",
  {
    id: text("id").primaryKey(),
    campaignId: text("campaign_id").notNull(),
    clientId: text("client_id").notNull(),
    tenantId: text("tenant_id").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("sent"),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("campaign_sends_unique").on(t.campaignId, t.clientId),
    index("campaign_sends_tenant_idx").on(t.tenantId, t.sentAt),
  ]
);

export type CampaignSend = typeof campaignSendsTable.$inferSelect;

export const npsResponsesTable = pgTable("nps_responses", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  orderId: text("order_id"),
  score: integer("score").notNull(),
  classification: text("classification").notNull(),
  feedback: text("feedback"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNpsResponseSchema = createInsertSchema(npsResponsesTable).omit({ createdAt: true });
export type InsertNpsResponse = z.infer<typeof insertNpsResponseSchema>;
export type NpsResponse = typeof npsResponsesTable.$inferSelect;

export const productsTable = pgTable("products", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  shortDescription: text("short_description"),
  type: text("type").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
  promotionalPrice: numeric("promotional_price", { precision: 10, scale: 2 }),
  cost: numeric("cost", { precision: 10, scale: 2 }),
  stock: integer("stock"),
  trackStock: boolean("track_stock").notNull().default(true),
  active: boolean("active").notNull().default(true),
  featured: boolean("featured").notNull().default(false),
  metaTitle: text("meta_title"),
  metaDescription: text("meta_description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ createdAt: true, updatedAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;

export const ordersTable = pgTable("orders", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  userId: text("user_id").notNull(),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull(),
  discountApplied: numeric("discount_applied", { precision: 10, scale: 2 }).notNull().default("0"),
  bonusUsed: numeric("bonus_used", { precision: 10, scale: 2 }).notNull().default("0"),
  shippingCost: numeric("shipping_cost", { precision: 10, scale: 2 }).notNull().default("0"),
  finalAmount: numeric("final_amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"),
  paymentStatus: text("payment_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ createdAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;

export const orderItemsTable = pgTable("order_items", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  productId: text("product_id").notNull(),
  quantity: integer("quantity").notNull(),
  price: numeric("price", { precision: 10, scale: 2 }).notNull(),
});

export const insertOrderItemSchema = createInsertSchema(orderItemsTable);
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type OrderItem = typeof orderItemsTable.$inferSelect;
