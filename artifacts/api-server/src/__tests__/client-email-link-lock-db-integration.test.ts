/**
 * Real PostgreSQL integration test for the client email advisory-lock trigger.
 *
 * One connection inserts a same-email client in another tenant and keeps its
 * transaction open. A concurrent login-style lock must wait for that insert to
 * commit, then its protected global recheck must observe both client records.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientsTable,
  db,
  pool,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { generateId } from "../lib/id";

const TENANT_A_ID = `test-email-lock-tenant-a-${generateId()}`;
const TENANT_B_ID = `test-email-lock-tenant-b-${generateId()}`;
const USER_A_ID = `test-email-lock-user-a-${generateId()}`;
const USER_B_ID = `test-email-lock-user-b-${generateId()}`;
const CLIENT_A_ID = `test-email-lock-client-a-${generateId()}`;
const CLIENT_B_ID = `test-email-lock-client-b-${generateId()}`;
const TEST_EMAIL = `client-email-lock-${generateId()}@example.com`;

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error(
      "DATABASE_URL must be set to run the client email lock DB integration test",
    );
  }

  await db.insert(tenantsTable).values([
    {
      id: TENANT_A_ID,
      name: "Client Email Lock Test A",
      slug: `client-email-lock-a-${generateId()}`,
      email: `agency-a-${generateId()}@example.com`,
    },
    {
      id: TENANT_B_ID,
      name: "Client Email Lock Test B",
      slug: `client-email-lock-b-${generateId()}`,
      email: `agency-b-${generateId()}@example.com`,
    },
  ]);

  await db.insert(usersTable).values([
    {
      id: USER_A_ID,
      clerkId: `clerk-email-lock-a-${generateId()}`,
      tenantId: TENANT_A_ID,
      name: "Email Lock User A",
      email: `user-a-${generateId()}@example.com`,
      referralCode: `EL-A-${generateId()}`,
    },
    {
      id: USER_B_ID,
      clerkId: `clerk-email-lock-b-${generateId()}`,
      tenantId: TENANT_B_ID,
      name: "Email Lock User B",
      email: `user-b-${generateId()}@example.com`,
      referralCode: `EL-B-${generateId()}`,
    },
  ]);

  await db.insert(clientsTable).values({
    id: CLIENT_A_ID,
    tenantId: TENANT_A_ID,
    name: "Existing Client",
    email: TEST_EMAIL,
    whatsapp: "11999990001",
    createdById: USER_A_ID,
  });
});

afterAll(async () => {
  await db
    .delete(tenantsTable)
    .where(inArray(tenantsTable.id, [TENANT_A_ID, TENANT_B_ID]));
});

describe("client normalized-email advisory lock — real DB", () => {
  it("makes the login recheck wait for a concurrent cross-tenant duplicate", async () => {
    const insertingConnection = await pool.connect();
    const loginConnection = await pool.connect();
    let insertTransactionOpen = false;
    let loginTransactionOpen = false;

    try {
      await insertingConnection.query("BEGIN");
      insertTransactionOpen = true;
      await insertingConnection.query(
        `INSERT INTO clients
          (id, tenant_id, name, email, whatsapp, created_by_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          CLIENT_B_ID,
          TENANT_B_ID,
          "Concurrent Duplicate",
          `  ${TEST_EMAIL.toUpperCase()}  `,
          "11999990002",
          USER_B_ID,
        ],
      );

      await loginConnection.query("BEGIN");
      loginTransactionOpen = true;
      let loginLockAcquired = false;
      const protectedRecheck = (async () => {
        await loginConnection.query(
          `SELECT pg_advisory_xact_lock(
             hashtextextended(lower(btrim($1)), 0)
           )`,
          [TEST_EMAIL],
        );
        loginLockAcquired = true;
        return loginConnection.query<{ id: string }>(
          `SELECT id
             FROM clients
            WHERE lower(btrim(email)) = lower(btrim($1))
            LIMIT 2`,
          [TEST_EMAIL],
        );
      })();

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(loginLockAcquired).toBe(false);

      await insertingConnection.query("COMMIT");
      insertTransactionOpen = false;

      const matches = await protectedRecheck;
      expect(loginLockAcquired).toBe(true);
      expect(matches.rows.map((row) => row.id).sort()).toEqual(
        [CLIENT_A_ID, CLIENT_B_ID].sort(),
      );

      await loginConnection.query("ROLLBACK");
      loginTransactionOpen = false;
    } finally {
      if (insertTransactionOpen) {
        await insertingConnection.query("ROLLBACK");
      }
      if (loginTransactionOpen) {
        await loginConnection.query("ROLLBACK");
      }
      insertingConnection.release();
      loginConnection.release();
      await db.delete(clientsTable).where(eq(clientsTable.id, CLIENT_B_ID));
    }
  });
});