import { pgTable, text, timestamp, boolean, integer, numeric, jsonb, index, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const distributionOffersTable = pgTable(
  "distribution_offers",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    integrationType: text("integration_type").notNull(),
    externalId: text("external_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    origin: text("origin"),
    destination: text("destination"),
    currency: text("currency").notNull().default("BRL"),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    priceValidUntil: timestamp("price_valid_until", { withTimezone: true }),
    availableUnits: integer("available_units"),
    cancellationPolicy: text("cancellation_policy"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    isActive: boolean("is_active").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("distribution_offers_tenant_provider_external_uq").on(table.tenantId, table.integrationType, table.externalId),
    index("distribution_offers_tenant_active_idx").on(table.tenantId, table.isActive, table.kind),
  ],
);

export const distributionOperationsTable = pgTable(
  "distribution_operations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    integrationType: text("integration_type").notNull(),
    operation: text("operation").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    offerId: text("offer_id").references(() => distributionOffersTable.id, { onDelete: "set null" }),
    externalId: text("external_id"),
    status: text("status").notNull().default("started"),
    response: jsonb("response").$type<Record<string, unknown>>(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("distribution_operations_tenant_provider_key_uq").on(table.tenantId, table.integrationType, table.idempotencyKey),
    index("distribution_operations_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("distribution_operations_status_idx").on(table.tenantId, table.status),
  ],
);

export const distributionBookingsTable = pgTable(
  "distribution_bookings",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    integrationType: text("integration_type").notNull(),
    externalOrderId: text("external_order_id").notNull(),
    offerId: text("offer_id").notNull().references(() => distributionOffersTable.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull().default("confirmed"),
    voucherCode: text("voucher_code"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("distribution_bookings_tenant_provider_order_uq").on(table.tenantId, table.integrationType, table.externalOrderId),
    index("distribution_bookings_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export type DistributionOffer = typeof distributionOffersTable.$inferSelect;
export type DistributionOperation = typeof distributionOperationsTable.$inferSelect;
export type DistributionBooking = typeof distributionBookingsTable.$inferSelect;