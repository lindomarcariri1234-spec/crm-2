import { clerkClient } from "@clerk/express";
import { db, auditLogsTable, clientsTable, usersTable } from "@workspace/db";
import { ROLES } from "@workspace/permissions";
import { and, eq, or, sql } from "drizzle-orm";
import { ForbiddenError } from "../lib/errors";
import { logger } from "../lib/logger";
import { unlinkClientFromTrips } from "./unlink-client-from-trips";

const ACTION = "client_account_deletion";
const LEASE_MS = 5 * 60_000;
type State = { clerkId: string; status: "pending" | "processing" | "done"; claimedAt?: string; lastError?: string };

/**
 * The audit row is a durable tombstone, not an ephemeral queue message. Never
 * delete it: it is also the only way to resume after the local user is removed.
 * Its deterministic primary key and the user row lock serialize concurrent
 * deletion attempts. No Clerk call occurs before this transaction commits.
 */
export async function prepareAccountDeletion(clerkId: string): Promise<{ id: string; tenantId: string | null; tripIds: string[] } | null> {
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.clerkId, clerkId)).limit(1).for("update");
    if (!user) return null;
    if (user.role !== ROLES.CLIENT) {
      throw new ForbiddenError("Apenas clientes podem excluir a própria conta pelo portal.", "FORBIDDEN_ROLE");
    }
    const id = `client-account-deletion:${user.id}`;
    const tripIds = new Set<string>();
    // A user may have several linked clients, including historical links in
    // other tenants. Process each under the client's actual tenant, not an
    // unscoped reservation update or an assumed single linked client.
    const linkedClients = await tx.select({ id: clientsTable.id, tenantId: clientsTable.tenantId })
      .from(clientsTable).where(eq(clientsTable.userId, user.id));
    for (const client of linkedClients) {
      for (const tripId of await unlinkClientFromTrips(tx, client.tenantId, client.id)) {
        tripIds.add(`${client.tenantId}\0${tripId}`);
      }
    }
    await tx.update(clientsTable).set({ userId: null }).where(eq(clientsTable.userId, user.id));
    await tx.insert(auditLogsTable).values({
      id,
      tenantId: user.tenantId ?? "__tenantless__",
      action: ACTION,
      entityType: "user",
      entityId: clerkId,
      after: { clerkId, status: "pending" } satisfies State,
    });
    await tx.delete(usersTable).where(eq(usersTable.id, user.id));
    return { id, tenantId: user.tenantId, tripIds: [...tripIds] };
  });
}

export function notifyDeletedClientTrips(tripIds: string[]): void {
  if (!tripIds.length) return;
  void Promise.all([
    import("../lib/realtime"),
    import("../lib/google-calendar/sync-service"),
  ]).then(([{ broadcastSeatUpdate }, { CalendarSyncService }]) => {
    for (const entry of tripIds) {
      const [tenantId, tripId] = entry.split("\0");
      if (!tenantId || !tripId) continue;
      broadcastSeatUpdate(tripId, tenantId).catch((err) =>
        logger.warn({ err, tripId, tenantId }, "[account-deletion] Seat broadcast failed"));
      CalendarSyncService.syncTrip(tripId).catch((err) =>
        logger.warn({ err, tripId, tenantId }, "[account-deletion] Calendar sync failed"));
    }
  }).catch((err) => logger.warn({ err }, "[account-deletion] Failed to load trip notifiers"));
}

export async function findAccountDeletion(clerkId: string): Promise<{ id: string; state: State } | null> {
  const [row] = await db.select({ id: auditLogsTable.id, after: auditLogsTable.after })
    .from(auditLogsTable)
    .where(and(eq(auditLogsTable.action, ACTION), eq(auditLogsTable.entityId, clerkId)))
    .limit(1);
  if (!row) return null;
  const state = row.after as State;
  if (state?.clerkId !== clerkId || !["pending", "processing", "done"].includes(state?.status)) {
    throw new Error("Invalid account deletion ledger entry");
  }
  return { id: row.id, state };
}

/**
 * A processing claim is a renewable lease. After a crash the next sweep may
 * retry a previously successful Clerk call; Clerk 404 is consequently success.
 */
export async function processAccountDeletion(id: string, clerkId: string): Promise<"done" | "pending"> {
  const claimedAt = new Date().toISOString();
  const [claimed] = await db.update(auditLogsTable).set({
    after: { clerkId, status: "processing", claimedAt } satisfies State,
  }).where(and(
    eq(auditLogsTable.id, id),
    eq(auditLogsTable.action, ACTION),
    eq(auditLogsTable.entityId, clerkId),
    or(
      sql`${auditLogsTable.after}->>'status' = 'pending'`,
      and(
        sql`${auditLogsTable.after}->>'status' = 'processing'`,
        sql`(${auditLogsTable.after}->>'claimedAt')::timestamptz < ${new Date(Date.now() - LEASE_MS)}`,
      ),
    ),
  )).returning({ id: auditLogsTable.id });
  if (!claimed) {
    const existing = await findAccountDeletion(clerkId);
    return existing?.state.status === "done" ? "done" : "pending";
  }

  try {
    await clerkClient.users.deleteUser(clerkId);
  } catch (err) {
    if ((err as { status?: number })?.status !== 404) {
      logger.warn({ err, id }, "[account-deletion] Clerk deletion failed; retry pending");
      await db.update(auditLogsTable).set({
        after: { clerkId, status: "pending", lastError: "clerk_delete_failed" } satisfies State,
      }).where(and(eq(auditLogsTable.id, id), sql`${auditLogsTable.after}->>'claimedAt' = ${claimedAt}`));
      return "pending";
    }
  }
  await db.update(auditLogsTable).set({
    after: { clerkId, status: "done" } satisfies State,
  }).where(and(eq(auditLogsTable.id, id), sql`${auditLogsTable.after}->>'claimedAt' = ${claimedAt}`));
  return "done";
}

/** Run on startup and via a distributed scheduled job; needs no user session. */
export async function retryPendingAccountDeletions(): Promise<number> {
  const rows = await db.select({ id: auditLogsTable.id, entityId: auditLogsTable.entityId })
    .from(auditLogsTable)
    .where(and(
      eq(auditLogsTable.action, ACTION),
      or(
        sql`${auditLogsTable.after}->>'status' = 'pending'`,
        and(
          sql`${auditLogsTable.after}->>'status' = 'processing'`,
          sql`(${auditLogsTable.after}->>'claimedAt')::timestamptz < ${new Date(Date.now() - LEASE_MS)}`,
        ),
      ),
    )).limit(100);
  for (const row of rows) {
    try {
      await processAccountDeletion(row.id, row.entityId);
    } catch (err) {
      logger.error({ err, id: row.id }, "[account-deletion] Retry failed; ledger remains pending");
    }
  }
  return rows.length;
}