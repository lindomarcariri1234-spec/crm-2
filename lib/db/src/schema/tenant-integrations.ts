import { pgTable, text, timestamp, boolean, jsonb, index, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

// Generic per-tenant integration configuration (one row per tenant + type).
// Used by the integrations that share the secure foundation introduced with the
// AI integration: WhatsApp (Evolution API), Stripe (agency's own account) and
// Google Analytics. Secret fields are stored encrypted at rest (enc:v1: prefix)
// via the api-server crypto helpers and are NEVER returned to the client in
// plaintext. Non-secret display/config fields live in `config`.
export const tenantIntegrationsTable = pgTable(
  "tenant_integrations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),

    // whatsapp_evolution | stripe_account | google_analytics
    type: text("type").notNull(),

    // Optional human label for the integration.
    name: text("name"),

    // Non-secret display/config fields (baseUrl, instanceName, measurementId,
    // publicKey, propertyId, ...). Never holds secrets.
    config: jsonb("config").$type<Record<string, string>>().notNull().default({}),

    // Encrypted JSON blob of the secret fields (apiKey, accessToken, ...).
    secretsEncrypted: text("secrets_encrypted"),

    // production | test
    environment: text("environment").notNull().default("production"),

    // When false, the integration is configured but not active.
    enabled: boolean("enabled").notNull().default(false),

    // disconnected | connected | error — reflects the last Test Connection /
    // post-save verification result.
    status: text("status").notNull().default("disconnected"),
    lastError: text("last_error"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("tenant_integrations_tenant_type_uq").on(table.tenantId, table.type),
  ],
);

export type TenantIntegration = typeof tenantIntegrationsTable.$inferSelect;

// Append-only audit trail for generic integration changes (save / test / error
// / revoke), scoped by tenant + integration type.
export const tenantIntegrationLogsTable = pgTable(
  "tenant_integration_logs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    type: text("type").notNull(),

    // save | test | revoke | error
    event: text("event").notNull(),
    // info | warn | error
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),

    actorId: text("actor_id"),
    actorName: text("actor_name"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tenant_integration_logs_tenant_idx").on(table.tenantId, table.type, table.createdAt),
  ],
);

export type TenantIntegrationLog = typeof tenantIntegrationLogsTable.$inferSelect;
