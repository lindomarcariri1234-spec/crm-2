import {
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { tenantsTable } from "./tenants";
import { clientsTable } from "./clients";
import { partnersTable } from "./partners";
import { storeOrderItemsTable, storeOrdersTable } from "./store";

/**
 * Immutable financial snapshot for one sold order item. This deliberately
 * stores the commercial values that applied at checkout, rather than deriving
 * them from a partner or product that can be edited later.
 */
export const settlementItemsTable = pgTable("settlement_items", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  orderId: text("order_id").notNull().references(() => storeOrdersTable.id, { onDelete: "cascade" }),
  orderItemId: text("order_item_id").notNull().references(() => storeOrderItemsTable.id, { onDelete: "cascade" }),
  clientId: text("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  sellerType: text("seller_type").notNull(),
  sellerId: text("seller_id"),
  sellerName: text("seller_name").notNull(),
  source: text("source").notNull(),
  grossAmount: numeric("gross_amount", { precision: 14, scale: 2 }).notNull(),
  discountAmount: numeric("discount_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  feeAmount: numeric("fee_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  commissionRate: numeric("commission_rate", { precision: 7, scale: 4 }).notNull().default("0"),
  commissionAmount: numeric("commission_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  sellerNetAmount: numeric("seller_net_amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("BRL"),
  settlementStatus: text("settlement_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("settlement_items_order_item_unique").on(table.orderItemId),
  index("settlement_items_tenant_order_idx").on(table.tenantId, table.orderId),
  index("settlement_items_tenant_seller_idx").on(table.tenantId, table.sellerType, table.sellerId),
]);

/**
 * Append-only participant ledger. Corrections are recorded as compensating
 * entries through reversalOfEntryId; original entries are never mutated.
 */
export const financialLedgerEntriesTable = pgTable("financial_ledger_entries", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
  settlementItemId: text("settlement_item_id").references(() => settlementItemsTable.id, { onDelete: "set null" }),
  orderId: text("order_id").references(() => storeOrdersTable.id, { onDelete: "set null" }),
  clientId: text("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  participantType: text("participant_type").notNull(),
  participantId: text("participant_id"),
  category: text("category").notNull(),
  direction: text("direction").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("BRL"),
  settlementStatus: text("settlement_status").notNull().default("available"),
  eventType: text("event_type").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  reversalOfEntryId: text("reversal_of_entry_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  availableAt: timestamp("available_at", { withTimezone: true }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("financial_ledger_tenant_idempotency_unique").on(table.tenantId, table.idempotencyKey),
  uniqueIndex("financial_ledger_one_reversal_per_entry").on(table.reversalOfEntryId),
  index("financial_ledger_tenant_order_idx").on(table.tenantId, table.orderId, table.occurredAt),
  index("financial_ledger_participant_idx").on(table.tenantId, table.participantType, table.participantId, table.occurredAt),
  index("financial_ledger_expiry_idx").on(table.tenantId, table.expiresAt),
]);

export const insertSettlementItemSchema = createInsertSchema(settlementItemsTable).omit({ createdAt: true });
export type InsertSettlementItem = z.infer<typeof insertSettlementItemSchema>;
export type SettlementItem = typeof settlementItemsTable.$inferSelect;

export const insertFinancialLedgerEntrySchema = createInsertSchema(financialLedgerEntriesTable).omit({ createdAt: true });
export type InsertFinancialLedgerEntry = z.infer<typeof insertFinancialLedgerEntrySchema>;
export type FinancialLedgerEntry = typeof financialLedgerEntriesTable.$inferSelect;