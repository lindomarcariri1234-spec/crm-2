import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { compareSchemaRows } from "./schema-drift-compare.mjs";

const script = new URL("./schema-drift.mjs", import.meta.url);

function runSchemaDrift(args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("schema-drift local entry point", () => {
  it("passes static checks without DATABASE_URL", () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const result = runSchemaDrift(["--static-only"], env);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /SCHEMA_DRIFT_STATIC_OK/);
  });

  it("reports missing DATABASE_URL with a dedicated code", () => {
    const env = { ...process.env };
    delete env.DATABASE_URL;
    const result = runSchemaDrift([], env);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /SCHEMA_DRIFT_CONFIG_ERROR/);
  });

  it("reports an unavailable live database with a dedicated code", () => {
    const result = runSchemaDrift(["--live-only"], {
      DATABASE_URL:
        "postgresql://schema-test:schema-test@127.0.0.1:1/schema_test",
    });

    assert.equal(result.status, 3);
    assert.match(result.stderr, /SCHEMA_DRIFT_CONNECTION_ERROR/);
  });

  it("identifies missing tables, missing columns, and unexpected columns", () => {
    const expected = new Map([
      ["clients", new Set(["id", "name"])],
      ["trips", new Set(["id", "starts_at"])],
    ]);
    const result = compareSchemaRows(expected, [
      { table_name: "clients", column_name: "id" },
      { table_name: "clients", column_name: "legacy_code" },
      { table_name: "trips", column_name: "id" },
    ]);

    assert.deepEqual(result.missing, [
      { table: "clients", col: "name", reason: "column missing from DB" },
      { table: "trips", col: "starts_at", reason: "column missing from DB" },
    ]);
    assert.deepEqual(result.unexpected, [
      {
        table: "clients",
        col: "legacy_code",
        reason: "column not present in Drizzle snapshot",
      },
    ]);
  });

  it("rejects invalid mode combinations without contacting a database", () => {
    const result = runSchemaDrift(["--static-only", "--live-only"], {
      DATABASE_URL: "postgresql://unused",
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Uso:/);
  });
});