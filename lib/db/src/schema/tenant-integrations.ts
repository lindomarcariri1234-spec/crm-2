import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

// Generic per-tenant integration configuration. Most types have one row per
// tenant; Evolution WhatsApp may have multiple independent connections.
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

    // whatsapp_evolution | instagram_messaging | stripe_account | google_analytics
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

    // Only used by WhatsApp Evolution to select the default sender for
    // non-conversation-specific messages. Ticket replies use their stored
    // conversation connection instead.
    isDefault: boolean("is_default").notNull().default(false),

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
    uniqueIndex("tenant_integrations_tenant_type_uq")
      .on(table.tenantId, table.type)
      .where(sql`${table.type} <> 'whatsapp_evolution'`),
    uniqueIndex("tenant_integrations_whatsapp_default_uq")
      .on(table.tenantId)
      .where(sql`${table.type} = 'whatsapp_evolution' AND ${table.isDefault}`),
    uniqueIndex("tenant_integrations_whatsapp_instance_uq")
      .on(table.tenantId, sql`(${table.config} ->> 'instanceName')`)
      .where(sql`${table.type} = 'whatsapp_evolution' AND ${table.config} ? 'instanceName'`),
    uniqueIndex("tenant_integrations_instagram_account_uq")
      .on(sql`(${table.config} ->> 'instagramUserId')`)
      .where(sql`${table.type} = 'instagram_messaging' AND ${table.config} ? 'instagramUserId'`),
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
