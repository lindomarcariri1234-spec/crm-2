import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";

export const instagramOAuthStatesTable = pgTable(
  "instagram_oauth_states",
  {
    stateHash: text("state_hash").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenantsTable.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("instagram_oauth_states_tenant_expiry_idx").on(table.tenantId, table.expiresAt),
  ],
);

export const instagramDataDeletionRequestsTable = pgTable(
  "instagram_data_deletion_requests",
  {
    confirmationCode: text("confirmation_code").primaryKey(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
