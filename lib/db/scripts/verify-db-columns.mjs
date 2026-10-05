#!/usr/bin/env node
/**
 * verify-db-columns.mjs
 *
 * POST-MIGRATE LIVE DB VERIFICATION
 * ──────────────────────────────────
 * Connects to the live database and confirms that every table + column defined
 * in the latest Drizzle snapshot exists, and that incremental CHECK constraints
 * are present with the definitions recorded in migration files.
 *
 * PROBLEM THIS PREVENTS
 * ─────────────────────
 * Static schema-drift checks (validate-columns.mjs, validate-coverage.mjs, etc.)
 * only analyse SQL migration FILES — they cannot detect the case where the Drizzle
 * migrations tracking table gets out of sync with the real database state. For
 * example: if a migration was marked "applied" in the __drizzle_migrations table
 * without actually executing the ALTER TABLE, the column is absent from the live DB
 * even though every static check passes. This causes 500 crashes on every request
 * that touches the missing column.
 *
 * WHAT THIS CHECK DOES
 * ────────────────────
 * 1. Reads the highest-numbered snapshot in drizzle/meta/ to enumerate all
 *    expected tables and columns.
 * 2. Queries information_schema.columns and pg_constraint in schema "public".
 * 3. Compares snapshot columns and incremental CHECK constraints with the live DB.
 *
 * Run it AFTER `pnpm --filter @workspace/db run migrate` so the migration has
 * already been applied before the check.
 *
 * Usage:
 *   node lib/db/scripts/verify-db-columns.mjs
 *   DATABASE_URL=... node lib/db/scripts/verify-db-columns.mjs
 *
 * Exit 0 = all expected columns and CHECK constraints are present in the live DB.
 * Exit 1 = static schema expectations could not be constructed.
 * Exit 4 = one or more expected columns or CHECK constraints differ from the live DB.
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import {
  applyIncrementalMigrationCheckConstraints,
  applyIncrementalMigrationColumns,
  compareCheckConstraints,
  compareSchemaRows,
} from "./schema-drift-compare.mjs";

const { Client } = pg;
const EXIT_STATIC = 1;
const EXIT_CONFIG = 2;
const EXIT_CONNECTION = 3;
const EXIT_DIVERGENCE = 4;

const __dirname = dirname(fileURLToPath(import.meta.url));
const metaDir = join(__dirname, "../drizzle/meta");

// ─── 1. Resolve the latest snapshot ─────────────────────────────────────────

const snapFiles = readdirSync(metaDir)
  .filter((f) => /^\d+_snapshot\.json$/.test(f))
  .sort();

if (snapFiles.length === 0) {
  console.error("❌ No snapshot files found in drizzle/meta/");
  process.exit(EXIT_STATIC);
}

const latestSnapFile = snapFiles.at(-1);
const snapshot = JSON.parse(
  readFileSync(join(metaDir, latestSnapFile), "utf8"),
);

// ─── 2. Build expected set: { table → Set<column> } from snapshot ────────────

/** @type {Map<string, Set<string>>} */
const expected = new Map();
/** @type {Map<string, {table: string, constraint: string, definition: string}>} */
const expectedCheckConstraints = new Map();

for (const tableObj of Object.values(snapshot.tables)) {
  const tableName = tableObj.name.toLowerCase();
  const cols = new Set(
    Object.values(tableObj.columns).map((c) => c.name.toLowerCase()),
  );
  expected.set(tableName, cols);
}

// Hand-written migrations do not always have a matching Drizzle snapshot.
// Include every incremental ADD COLUMN so a legitimate post-snapshot migration
// is not reported as an unexpected live column.
const migrationFiles = readdirSync(join(__dirname, "../drizzle"))
  .filter((file) => /^0[0-9]{3}_(?!squash).*\.sql$/.test(file))
  .sort();
for (const file of migrationFiles) {
  const migrationSql = readFileSync(
    join(__dirname, "../drizzle", file),
    "utf8",
  );
  applyIncrementalMigrationColumns(expected, migrationSql);
  applyIncrementalMigrationCheckConstraints(
    expectedCheckConstraints,
    migrationSql,
  );
}

const requiredTenantIdConstraint = "tenants.tenants_id_max_bytes_check";
if (!expectedCheckConstraints.has(requiredTenantIdConstraint)) {
  console.error(
    `SCHEMA_DRIFT_STATIC_ERROR: expected migration history to define ${requiredTenantIdConstraint}.`,
  );
  process.exit(EXIT_STATIC);
}
const expectedTenantIdConstraint = new Map([
  [
    requiredTenantIdConstraint,
    expectedCheckConstraints.get(requiredTenantIdConstraint),
  ],
]);

// ─── 3. Connect to the live DB and query columns and CHECK constraints ───────

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error(
    "SCHEMA_DRIFT_CONFIG_ERROR: DATABASE_URL is not set — cannot verify live DB columns.",
  );
  process.exit(EXIT_CONFIG);
}

const client = new Client({ connectionString: dbUrl });

let rows;
let checkConstraintRows;
try {
  await client.connect();
  const result = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, column_name
  `);
  rows = result.rows;
  const checkConstraintResult = await client.query(`
    SELECT
      relation.relname AS table_name,
      constraint_row.conname AS constraint_name,
      pg_get_constraintdef(constraint_row.oid, true) AS definition
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS relation
      ON relation.oid = constraint_row.conrelid
    JOIN pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND constraint_row.contype = 'c'
    ORDER BY relation.relname, constraint_row.conname
  `);
  checkConstraintRows = checkConstraintResult.rows;
} catch (err) {
  console.error(
    `SCHEMA_DRIFT_CONNECTION_ERROR: failed to query live schema metadata (${err.message})`,
  );
  process.exit(EXIT_CONNECTION);
} finally {
  await client.end().catch(() => {});
}

// ─── 4. Compare and report ───────────────────────────────────────────────────

const { missing, unexpected } = compareSchemaRows(expected, rows);
const checkConstraints = compareCheckConstraints(
  expectedTenantIdConstraint,
  checkConstraintRows,
);

if (
  missing.length > 0 ||
  unexpected.length > 0 ||
  checkConstraints.missing.length > 0 ||
  checkConstraints.changed.length > 0
) {
  if (missing.length > 0) {
    console.error(
      "\nSCHEMA_DRIFT_DIVERGENCE: columns/tables expected by Drizzle are missing from the live database:\n",
    );
    for (const { table, col, reason } of missing) {
      console.error(`   ${table}.${col}  (${reason})`);
    }
  }
  if (unexpected.length > 0) {
    console.error(
      "\nSCHEMA_DRIFT_DIVERGENCE: live database columns are absent from the Drizzle snapshot:\n",
    );
    for (const { table, col, reason } of unexpected) {
      console.error(`   ${table}.${col}  (${reason})`);
    }
  }
  if (checkConstraints.missing.length > 0) {
    console.error(
      "\nSCHEMA_DRIFT_DIVERGENCE: CHECK constraints expected by migrations are missing from the live database:\n",
    );
    for (const { table, constraint, reason } of checkConstraints.missing) {
      console.error(`   ${table}.${constraint}  (${reason})`);
    }
  }
  if (checkConstraints.changed.length > 0) {
    console.error(
      "\nSCHEMA_DRIFT_DIVERGENCE: live CHECK constraints differ from the migration definitions:\n",
    );
    for (const { table, constraint, reason } of checkConstraints.changed) {
      console.error(`   ${table}.${constraint}  (${reason})`);
    }
  }
  console.error(`
The live database differs from the expected Drizzle schema or migration history.
Do not edit the immutable 0000_squash_baseline or use push-force. Review the
difference and create or apply an idempotent incremental migration when appropriate.

Snapshot/migrations used: ${latestSnapFile} (${expected.size} tables, ${[...expected.values()].reduce((n, s) => n + s.size, 0)} columns, ${expectedTenantIdConstraint.size} tenant-ID CHECK constraint expected)
`);
  process.exit(EXIT_DIVERGENCE);
}

const totalTables = expected.size;
const totalCols = [...expected.values()].reduce((n, s) => n + s.size, 0);
console.log(
  `✅ Live DB schema verification passed: ${totalTables} tables, ${totalCols} columns, and ${expectedTenantIdConstraint.size} tenant-ID CHECK constraint all present.`,
);
console.log(`   Snapshot/migrations: ${latestSnapFile}`);
