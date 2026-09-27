import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { prepareEmptyMigrations } from "./prepare-empty-migrations.mjs";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

function fakePool(hasPublicTables, failOnCreate = false) {
  const queries = [];
  let released = false;
  const client = {
    async query(query) {
      queries.push(query);
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
});