import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyIncrementalMigrationCheckConstraints,
  applyIncrementalMigrationColumns,
  compareCheckConstraints,
  compareSchemaRows,
} from "./schema-drift-compare.mjs";

const script = fileURLToPath(new URL("./schema-drift.mjs", import.meta.url));

function runSchemaDrift(args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    env,
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
      ["reservations", new Set(["id"])],
      ["trips", new Set(["id", "starts_at"])],
    ]);
    const result = compareSchemaRows(expected, [
      { table_name: "clients", column_name: "id" },
      { table_name: "clients", column_name: "legacy_code" },
      { table_name: "trips", column_name: "id" },
    ]);

    assert.deepEqual(result.missing, [
      { table: "clients", col: "name", reason: "column missing from DB" },
      { table: "reservations", col: "id", reason: "table missing from DB" },
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

  it("compares CHECK constraints and reports missing or changed definitions", () => {
    const constraint = {
      table: "tenants",
      constraint: "tenants_id_max_bytes_check",
      definition: "CHECK (octet_length(id) <= 64)",
    };
    const expected = new Map([
      ["tenants.tenants_id_max_bytes_check", constraint],
    ]);

    assert.deepEqual(compareCheckConstraints(expected, []), {
      missing: [
        {
          table: "tenants",
          constraint: "tenants_id_max_bytes_check",
          reason: "CHECK constraint missing from DB",
        },
      ],
      changed: [],
      unvalidated: [],
    });
    assert.deepEqual(
      compareCheckConstraints(expected, [
        {
          table_name: "tenants",
          constraint_name: "tenants_id_max_bytes_check",
          definition: "CHECK ((octet_length(id) < 64))",
        },
      ]),
      {
        missing: [],
        changed: [
          {
            table: "tenants",
            constraint: "tenants_id_max_bytes_check",
            reason: "CHECK constraint definition differs from migrations",
          },
        ],
        unvalidated: [],
      },
    );
    assert.deepEqual(
      compareCheckConstraints(expected, [
        {
          table_name: "tenants",
          constraint_name: "tenants_id_max_bytes_check",
          definition: 'CHECK ((octet_length("id") <= 64))',
        },
      ]),
      { missing: [], changed: [], unvalidated: [] },
    );
  });

  it("accepts PostgreSQL text-membership rendering but detects changed and unvalidated rules", () => {
    const constraint = {
      table: "support_tickets",
      constraint: "support_tickets_status_check",
      definition: `CHECK ("status" IN ('pending', 'open', 'resolved'))`,
      validated: true,
    };
    const expected = new Map([
      ["support_tickets.support_tickets_status_check", constraint],
    ]);
    const postgresDefinition =
      "CHECK ((status = ANY (ARRAY['pending'::text, 'open'::text, 'resolved'::text])))";

    assert.deepEqual(
      compareCheckConstraints(expected, [
        {
          table_name: "support_tickets",
          constraint_name: "support_tickets_status_check",
          definition: postgresDefinition,
          validated: true,
        },
      ]),
      { missing: [], changed: [], unvalidated: [] },
    );

    assert.deepEqual(
      compareCheckConstraints(expected, [
        {
          table_name: "support_tickets",
          constraint_name: "support_tickets_status_check",
          definition:
            "CHECK (status = ANY (ARRAY['pending'::text, 'open'::text, 'closed'::text]))",
          validated: true,
        },
      ]),
      {
        missing: [],
        changed: [
          {
            table: "support_tickets",
            constraint: "support_tickets_status_check",
            reason: "CHECK constraint definition differs from migrations",
          },
        ],
        unvalidated: [],
      },
    );

    assert.deepEqual(
      compareCheckConstraints(expected, [
        {
          table_name: "support_tickets",
          constraint_name: "support_tickets_status_check",
          definition: postgresDefinition,
          validated: false,
        },
      ]),
      {
        missing: [],
        changed: [],
        unvalidated: [
          {
            table: "support_tickets",
            constraint: "support_tickets_status_check",
            reason: "CHECK constraint is not validated in DB",
          },
        ],
      },
    );
  });

  it("extracts nested CHECK expressions from incremental ALTER TABLE migrations", () => {
    const expected = new Map();
    applyIncrementalMigrationCheckConstraints(
      expected,
      `DO $$
      BEGIN
        ALTER TABLE public.tenants
          ADD CONSTRAINT tenants_id_max_bytes_check
          CHECK (octet_length(id) <= 64) NOT VALID;
      END $$;
      ALTER TABLE public.tenants
        VALIDATE CONSTRAINT tenants_id_max_bytes_check;`,
    );

    assert.deepEqual(
      [...expected.values()],
      [
        {
          table: "tenants",
          constraint: "tenants_id_max_bytes_check",
          definition: "CHECK (octet_length(id) <= 64)",
        },
      ],
    );
  });

  it("extracts validated named CHECK constraints from incremental CREATE TABLE migrations", () => {
    const expected = new Map();
    applyIncrementalMigrationCheckConstraints(
      expected,
      `CREATE TABLE IF NOT EXISTS "support_tickets" (
        "status" text NOT NULL,
        CONSTRAINT "support_tickets_status_check"
          CHECK ("status" IN ('pending', 'open', 'resolved')),
        CONSTRAINT "support_tickets_priority_check"
          CHECK ("status" <> 'invalid')
      );`,
    );

    assert.deepEqual([...expected.values()], [
      {
        table: "support_tickets",
        constraint: "support_tickets_status_check",
        definition: `CHECK ("status" IN ('pending', 'open', 'resolved'))`,
        validated: true,
      },
      {
        table: "support_tickets",
        constraint: "support_tickets_priority_check",
        definition: `CHECK ("status" <> 'invalid')`,
        validated: true,
      },
    ]);
  });

  it("includes multiline incremental ADD COLUMN migrations in live expectations", () => {
    const expected = new Map([["chatbot_messages", new Set(["id"])]]);
    applyIncrementalMigrationColumns(
      expected,
      `ALTER TABLE "chatbot_messages"
        ADD COLUMN IF NOT EXISTS "delivery_status" text NOT NULL,
        ADD COLUMN IF NOT EXISTS "delivery_attempts" integer NOT NULL;`,
    );

    assert.deepEqual([...expected.get("chatbot_messages")].sort(), [
      "delivery_attempts",
      "delivery_status",
      "id",
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
