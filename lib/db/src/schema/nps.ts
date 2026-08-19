import { pgTable, text, timestamp, integer, index, unique } from "drizzle-orm/pg-core";
import { tenantsTable } from "./tenants";
import { clientsTable } from "./clients";

export const clientNpsResponsesTable = pgTable(
  "client_nps_responses",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
    reservationId: text("reservation_id").notNull().unique(),
    tripId: text("trip_id"),
    score: integer("score").notNull(),
    scoreTransport: integer("score_transport"),
    scoreService: integer("score_service"),
    scoreOrganization: integer("score_organization"),
    scoreGuide: integer("score_guide"),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("client_nps_client_id_idx").on(table.clientId, table.createdAt),
    index("client_nps_tenant_id_idx").on(table.tenantId, table.createdAt),
  ],
);

export type ClientNpsResponse = typeof clientNpsResponsesTable.$inferSelect;
export type InsertClientNpsResponse = typeof clientNpsResponsesTable.$inferInsert;

export const npsInvitationsTable = pgTable(
  "nps_invitations",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull().references(() => tenantsTable.id, { onDelete: "cascade" }),
    clientId: text("client_id").notNull().references(() => clientsTable.id, { onDelete: "cascade" }),
    reservationId: text("reservation_id").notNull(),
    tripId: text("trip_id"),
    token: text("token").notNull(),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (table) => [
    unique("nps_invitations_token_unique").on(table.token),
    unique("nps_invitations_reservation_id_unique").on(table.reservationId),
    index("nps_inv_tenant_idx").on(table.tenantId, table.invitedAt),
  ],
);

export type NpsInvitation = typeof npsInvitationsTable.$inferSelect;
export type InsertNpsInvitation = typeof npsInvitationsTable.$inferInsert;
