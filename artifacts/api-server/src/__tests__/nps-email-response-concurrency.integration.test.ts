/**
 * Real PostgreSQL integration test for concurrent public NPS email responses.
 *
 * A temporary trigger holds inserts at a transaction-scoped advisory lock so
 * both requests reach the unique reservation response at the same time. This
 * deterministically exercises PostgreSQL's ON CONFLICT path.
 */
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientNpsResponsesTable,
  clientsTable,
  db,
  npsInvitationsTable,
  pool,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateId } from "../lib/id";
import npsRouter from "../routes/nps.js";

const suffix = generateId().replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
const TENANT_ID = `test-nps-email-tenant-${generateId()}`;
const USER_ID = `test-nps-email-user-${generateId()}`;
const CLIENT_ID = `test-nps-email-client-${generateId()}`;
const INVITATION_ID = `test-nps-email-invitation-${generateId()}`;
const RESERVATION_ID = `test-nps-email-reservation-${generateId()}`;
const INVITATION_TOKEN = `test-nps-email-token-${generateId()}`;
const NPS_BARRIER_FUNCTION = `nps_response_barrier_fn_${suffix}`;
const NPS_BARRIER_TRIGGER = `nps_response_barrier_${suffix}`;

const app = express();
app.use(npsRouter);

async function waitForBlockedResponses(blockerPid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ waitingCount: string }>(
      `SELECT count(*) AS "waitingCount"
         FROM pg_stat_activity activity
        WHERE activity.pid <> $1
          AND $1 = ANY(pg_blocking_pids(activity.pid))`,
      [blockerPid],
    );
    if (Number(rows[0]?.waitingCount ?? 0) >= 2) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Both NPS responses did not reach the PostgreSQL insert barrier.");
}

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL must be set to run the NPS email concurrency integration test");
  }

  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "NPS Email Concurrency Test",
    slug: `nps-email-concurrency-${generateId()}`,
    email: `nps-email-concurrency-${generateId()}@example.com`,
  });

  await db.insert(usersTable).values({
    id: USER_ID,
    clerkId: `clerk-nps-email-${generateId()}`,
    tenantId: TENANT_ID,
    name: "NPS Email Test User",
    email: `nps-email-user-${generateId()}@example.com`,
    referralCode: `NPS-${generateId()}`,
  });

  await db.insert(clientsTable).values({
    id: CLIENT_ID,
    tenantId: TENANT_ID,
    name: "NPS Email Test Client",
    email: `nps-email-client-${generateId()}@example.com`,
    whatsapp: "11999990001",
    createdById: USER_ID,
  });

  await db.insert(npsInvitationsTable).values({
    id: INVITATION_ID,
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    reservationId: RESERVATION_ID,
    token: INVITATION_TOKEN,
  });
});

afterAll(async () => {
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

describe("public NPS email response concurrency — real PostgreSQL", () => {
  it("returns success for concurrent responses and keeps the winning score on retry", async () => {
    const blocker = await pool.connect();
    let blockerTransactionOpen = false;
    let triggerCreated = false;
    let functionCreated = false;
    let pendingResponses: Promise<Array<{ status: number; text: string }>> | null = null;

    try {
      await pool.query(`
        CREATE FUNCTION public.${NPS_BARRIER_FUNCTION}() RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(hashtextextended(NEW.reservation_id, 0));
          RETURN NEW;
        END;
        $$
      `);
      functionCreated = true;
      await pool.query(`
        CREATE TRIGGER ${NPS_BARRIER_TRIGGER}
        BEFORE INSERT ON public.client_nps_responses
        FOR EACH ROW EXECUTE FUNCTION public.${NPS_BARRIER_FUNCTION}()
      `);
      triggerCreated = true;

      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      const { rows: blockerRows } = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      const blockerPid = Number(blockerRows[0]?.pid);
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [RESERVATION_ID],
      );

      const firstRequest = request(app)
        .get("/nps/respond")
        .query({ token: INVITATION_TOKEN, score: 2, comment: "Primeira nota concorrente" })
        .then((response) => ({ status: response.status, text: response.text }));
      const secondRequest = request(app)
        .get("/nps/respond")
        .query({ token: INVITATION_TOKEN, score: 10, comment: "Segunda nota concorrente" })
        .then((response) => ({ status: response.status, text: response.text }));
      const responsePromise = Promise.all([firstRequest, secondRequest]);
      pendingResponses = responsePromise;

      await waitForBlockedResponses(blockerPid);
      await blocker.query("COMMIT");
      blockerTransactionOpen = false;

      const responses = await responsePromise;
      expect(responses).toHaveLength(2);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);

      const savedResponses = await db
        .select({
          score: clientNpsResponsesTable.score,
          comment: clientNpsResponsesTable.comment,
        })
        .from(clientNpsResponsesTable)
        .where(eq(clientNpsResponsesTable.reservationId, RESERVATION_ID));
      expect(savedResponses).toHaveLength(1);
      const savedResponse = savedResponses[0]!;
      expect([2, 10]).toContain(savedResponse.score);
      expect(savedResponse.comment).toBe(
        savedResponse.score === 2 ? "Primeira nota concorrente" : "Segunda nota concorrente",
      );
      for (const response of responses) {
        expect(response.text).toContain(`<div class="score">${savedResponse.score}</div>`);
      }

      const [clientAfterConcurrentRequests] = await db
        .select({ npsScore: clientsTable.npsScore })
        .from(clientsTable)
        .where(eq(clientsTable.id, CLIENT_ID))
        .limit(1);
      expect(clientAfterConcurrentRequests?.npsScore).toBe(savedResponse.score);

      const retry = await request(app)
        .get("/nps/respond")
        .query({ token: INVITATION_TOKEN, score: 7, comment: "Nota de nova tentativa" });
      expect(retry.status).toBe(200);
      expect(retry.text).toContain(`<div class="score">${savedResponse.score}</div>`);

      const [responseAfterRetry] = await db
        .select({
          score: clientNpsResponsesTable.score,
          comment: clientNpsResponsesTable.comment,
        })
        .from(clientNpsResponsesTable)
        .where(eq(clientNpsResponsesTable.reservationId, RESERVATION_ID))
        .limit(1);
      expect(responseAfterRetry).toEqual(savedResponse);

      const [clientAfterRetry] = await db
        .select({ npsScore: clientsTable.npsScore })
        .from(clientsTable)
        .where(eq(clientsTable.id, CLIENT_ID))
        .limit(1);
      expect(clientAfterRetry?.npsScore).toBe(savedResponse.score);

      const [invitationAfterRetry] = await db
        .select({ respondedAt: npsInvitationsTable.respondedAt })
        .from(npsInvitationsTable)
        .where(eq(npsInvitationsTable.id, INVITATION_ID))
        .limit(1);
      expect(invitationAfterRetry?.respondedAt).toBeInstanceOf(Date);
    } finally {
      if (blockerTransactionOpen) {
        await blocker.query("ROLLBACK");
      }
      if (pendingResponses) {
        await pendingResponses.catch(() => undefined);
      }
      blocker.release();
      if (triggerCreated) {
        await pool.query(
          `DROP TRIGGER IF EXISTS ${NPS_BARRIER_TRIGGER} ON public.client_nps_responses`,
        );
      }
      if (functionCreated) {
        await pool.query(`DROP FUNCTION IF EXISTS public.${NPS_BARRIER_FUNCTION}()`);
      }
    }
  });
});