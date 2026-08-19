/**
 * Integration test: verifies the database-level CHECK constraint
 * `referrals_crm_requires_reservation_id` (migration 0071) is actually
 * enforced by PostgreSQL.
 *
 * Constraint: CHECK (source IS DISTINCT FROM 'crm' OR reservation_id IS NOT NULL)
 *   - source='crm'  + reservation_id=NULL  -> rejected (23514 check_violation)
 *   - source='store'+ reservation_id=NULL  -> allowed
 *   - source='crm'  + reservation_id set    -> allowed
 *   - source=NULL   + reservation_id=NULL  -> allowed (legacy rows)
 *
 * Unlike the other suites in this folder, this file deliberately does NOT mock
 * `@workspace/db` — it exercises the real connection (DATABASE_URL must be set)
 * so that the constraint is actually evaluated by Postgres.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db, referralsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";

import { generateId } from "../lib/id";

const CHECK_VIOLATION = "23514";
const CONSTRAINT_NAME = "referrals_crm_requires_reservation_id";

const TENANT_ID = `test-tenant-${generateId()}`;

// Track every id we insert so we can clean up regardless of pass/fail.
const insertedIds: string[] = [];

function baseRow(overrides: Partial<typeof referralsTable.$inferInsert>) {
  const id = generateId();
  insertedIds.push(id);
  return {
    id,
    tenantId: TENANT_ID,
    referrerId: `referrer-${generateId()}`,
    code: `CODE${generateId().slice(0, 6).toUpperCase()}`,
    ...overrides,
  } satisfies typeof referralsTable.$inferInsert;
}

interface PgError {
  code?: string;
  constraint?: string;
  cause?: PgError;
}

/**
 * Drizzle wraps the underlying node-postgres error, exposing the real PG error
 * (with `.code` / `.constraint`) on the `.cause` chain. Walk the chain to find
 * the first node that carries a PG error code.
 */
function unwrapPgError(err: PgError | undefined): PgError | undefined {
  let current = err;
  while (current) {
    if (current.code) return current;
    current = current.cause;
  }
  return err;
}

beforeAll(() => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL must be set to run the referral constraint integration test");
  }
});

afterEach(async () => {
  if (insertedIds.length > 0) {
    await db.delete(referralsTable).where(inArray(referralsTable.id, [...insertedIds]));
    insertedIds.length = 0;
  }
});

describe("referrals_crm_requires_reservation_id CHECK constraint", () => {
  it("rejects source='crm' with a null reservation_id", async () => {
    let caught: PgError | undefined;
    try {
      await db.insert(referralsTable).values(
        baseRow({ source: "crm", reservationId: null }),
      );
    } catch (err) {
      caught = err as PgError;
    }

    expect(caught).toBeDefined();
    const pgErr = unwrapPgError(caught);
    expect(pgErr?.code).toBe(CHECK_VIOLATION);
    expect(pgErr?.constraint).toBe(CONSTRAINT_NAME);
  });

  it("allows source='store' with a null reservation_id", async () => {
    await expect(
      db.insert(referralsTable).values(
        baseRow({ source: "store", reservationId: null }),
      ),
    ).resolves.toBeDefined();
  });

  it("allows source='crm' with a valid reservation_id", async () => {
    await expect(
      db.insert(referralsTable).values(
        baseRow({ source: "crm", reservationId: `res-${generateId()}` }),
      ),
    ).resolves.toBeDefined();
  });

  it("allows legacy rows with a null source and null reservation_id", async () => {
    await expect(
      db.insert(referralsTable).values(
        baseRow({ source: null, reservationId: null }),
      ),
    ).resolves.toBeDefined();
  });
});
