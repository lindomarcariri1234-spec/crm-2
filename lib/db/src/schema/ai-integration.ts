import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

// Per-tenant AI provider configuration (one row per tenant). The API key is
// stored encrypted at rest (enc:v1: prefix) via the api-server crypto helpers;
// it is NEVER returned to the client in plaintext.
export const aiIntegrationsTable = pgTable("ai_integrations", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .unique()
    .references(() => tenantsTable.id, { onDelete: "cascade" }),

  // Optional human label for the integration.
  name: text("name"),

  // openai | anthropic | gemini | custom
  provider: text("provider").notNull().default("openai"),
  apiKeyEncrypted: text("api_key_encrypted"),
  // Separate access token for providers that use one alongside the API key.
  accessTokenEncrypted: text("access_token_encrypted"),
  baseUrl: text("base_url"),
  defaultModel: text("default_model"),

  // production | test
  environment: text("environment").notNull().default("production"),

  // When false, Insights falls back to the platform-managed AI proxy.
  enabled: boolean("enabled").notNull().default(false),

  // disconnected | connected | error — reflects the last Test Connection result.
  status: text("status").notNull().default("disconnected"),
  lastError: text("last_error"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type AiIntegration = typeof aiIntegrationsTable.$inferSelect;

// Append-only audit trail for AI integration changes (save / test / error).
export const aiIntegrationLogsTable = pgTable(
  "ai_integration_logs",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),

    // save | test | error
    event: text("event").notNull(),
    // info | warn | error
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),

    actorId: text("actor_id"),
    actorName: text("actor_name"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ai_integration_logs_tenant_idx").on(table.tenantId, table.createdAt),
  ],
);

export type AiIntegrationLog = typeof aiIntegrationLogsTable.$inferSelect;
