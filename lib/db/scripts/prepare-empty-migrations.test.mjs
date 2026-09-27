import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  prepareEmptyMigrations,
  runMigrationPipeline,
} from "./prepare-empty-migrations.mjs";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

function fakePool(hasPublicTables, failOnCreate = false, lockUnavailable = false, lockBlockers = []) {
  const queries = [];
  let released = false;
  const client = {
    async query(query) {
      queries.push(query);
      if (lockUnavailable && query.includes("pg_advisory_lock(")) {
        throw Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
      }
      if (query.includes("FROM pg_catalog.pg_locks AS pg_lock")) {
        return { rows: lockBlockers };
      }
      if (query.includes("current_setting('application_name')")) {
        return { rows: [{ application_name: "test-original-name" }] };
      }
      if (query.includes("AS has_public_tables")) {
        return { rows: [{ has_public_tables: hasPublicTables }] };
      }
      if (failOnCreate && query.startsWith("CREATE TABLE")) {
        throw new Error("test DDL failure");
      }
      return { rows: [] };
    },
    release() {
      released = true;
    },
  };
  return {
    pool: { async connect() { return client; } },
    queries,
    get released() { return released; },
  };
}

describe("empty-database migration preparation", () => {
  it("uses the existing CREATE TABLE migrations only on an empty public schema", async () => {
    const state = fakePool(false);
    await prepareEmptyMigrations(state.pool, migrationsFolder);
    assert.equal(state.queries.filter((query) => query.startsWith("CREATE TABLE")).length, 2);
    assert.match(state.queries.join("\n"), /CREATE TABLE IF NOT EXISTS "referral_attempt_logs"/);
    assert.match(state.queries.join("\n"), /CREATE TABLE IF NOT EXISTS "referral_bonus_reversals"/);
    assert.equal(state.queries.at(-1), "COMMIT");
    assert.equal(state.released, true);
  });

  it("does not change a populated database", async () => {
    const state = fakePool(true);
    await prepareEmptyMigrations(state.pool, migrationsFolder);
    assert.equal(state.queries.some((query) => query.startsWith("CREATE TABLE")), false);
    assert.equal(state.queries.at(-1), "COMMIT");
    assert.equal(state.released, true);
  });

  it("rolls back both prerequisite tables if one fails", async () => {
    const state = fakePool(false, true);
    await assert.rejects(prepareEmptyMigrations(state.pool, migrationsFolder), /test DDL failure/);
    assert.equal(state.queries.at(-1), "ROLLBACK");
    assert.equal(state.released, true);
  });

  it("holds the advisory lock through the full migration callback", async () => {
    const state = fakePool(false);
    const result = await runMigrationPipeline(state.pool, migrationsFolder, async () => {
      state.queries.push("APPLY_JOURNAL");
      return "applied";
    });

    const lockIndex = state.queries.findIndex((query) => query.includes("pg_advisory_lock("));
    const journalIndex = state.queries.indexOf("APPLY_JOURNAL");
    const unlockIndex = state.queries.findIndex((query) => query.includes("pg_advisory_unlock("));
    assert.equal(result, "applied");
    assert.ok(lockIndex >= 0 && lockIndex < journalIndex);
    assert.ok(journalIndex < unlockIndex);
    assert.equal(state.released, true);
  });

  it("releases the advisory lock after a migration error", async () => {
    const state = fakePool(true);
    await assert.rejects(
      runMigrationPipeline(state.pool, migrationsFolder, async () => {
        throw new Error("test migration failure");
      }),
      /test migration failure/,
    );
    assert.ok(state.queries.some((query) => query.includes("pg_advisory_unlock(")));
    assert.equal(state.released, true);
  });

  it("fails clearly after the configured wait and does not prepare the schema", async () => {
    const state = fakePool(false, false, true, [
      { pid: 4321, application_name: "migration-api-2" },
      { pid: 4322, application_name: "postgresql://must-not-leak" },
    ]);
    const previousTimeout = process.env.MIGRATION_LOCK_TIMEOUT_MS;
    process.env.MIGRATION_LOCK_TIMEOUT_MS = "5";
    let timeoutError;
    try {
      await assert.rejects(
        runMigrationPipeline(state.pool, migrationsFolder, async () => {
          assert.fail("migration callback must not run without the advisory lock");
        }),
        (error) => {
          timeoutError = error;
          return error.code === "ERR_MIGRATION_LOCK_TIMEOUT"
            && /MIGRATION_LOCK_TIMEOUT_MS/.test(error.message)
            && /did not prepare or apply migrations/.test(error.message);
        },
      );
    } finally {
      if (previousTimeout === undefined) delete process.env.MIGRATION_LOCK_TIMEOUT_MS;
      else process.env.MIGRATION_LOCK_TIMEOUT_MS = previousTimeout;
    }

    assert.equal(state.queries.some((query) => query.includes("AS has_public_tables")), false);
    assert.equal(state.queries.some((query) => query.includes("pg_advisory_unlock(")), false);
    assert.equal(state.released, true);
    assert.deepEqual(timeoutError.blockers, [
      { pid: 4321, applicationName: "migration-api-2" },
      { pid: 4322, applicationName: "redacted" },
    ]);
    assert.match(timeoutError.message, /pid=4321, application_name=migration-api-2/);
    assert.doesNotMatch(timeoutError.message, /postgresql:\/\//);
    assert.doesNotMatch(timeoutError.message, /SELECT /i);
  });

  it("rejects an invalid migration lock timeout before connecting", async () => {
    const state = fakePool(true);
    const previousTimeout = process.env.MIGRATION_LOCK_TIMEOUT_MS;
    process.env.MIGRATION_LOCK_TIMEOUT_MS = "forever";
    try {
      await assert.rejects(
        runMigrationPipeline(state.pool, migrationsFolder, async () => undefined),
        /MIGRATION_LOCK_TIMEOUT_MS must be a positive safe integer/,
      );
    } finally {
      if (previousTimeout === undefined) delete process.env.MIGRATION_LOCK_TIMEOUT_MS;
      else process.env.MIGRATION_LOCK_TIMEOUT_MS = previousTimeout;
    }
    assert.equal(state.queries.length, 0);
    assert.equal(state.released, false);
  });

  it("rejects an unsafe migration application name before connecting", async () => {
    const state = fakePool(true);
    await assert.rejects(
      runMigrationPipeline(state.pool, migrationsFolder, async () => undefined, {
        applicationName: "postgresql://do-not-log",
      }),
      /Migration application name must be 1-63 safe alphanumeric/,
    );
    assert.equal(state.queries.length, 0);
    assert.equal(state.released, false);
  });
});