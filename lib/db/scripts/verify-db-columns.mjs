#!/usr/bin/env node
/**
 * verify-db-columns.mjs
 *
 * POST-MIGRATE LIVE DB VERIFICATION
 * ──────────────────────────────────
 * Connects to the live database and confirms that every table + column defined
 * in the latest Drizzle snapshot actually exists in information_schema.columns.
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
 * 2. Queries information_schema.columns for all tables in schema "public".
 * 3. Compares: any snapshot column not present in the live DB → EXIT 1.
 *
 * Run it AFTER `pnpm --filter @workspace/db run migrate` so the migration has
 * already been applied before the check.
 *
 * Usage:
 *   node lib/db/scripts/verify-db-columns.mjs
 *   DATABASE_URL=... node lib/db/scripts/verify-db-columns.mjs
 *
 * Exit 0 = all columns present in live DB.
 * Exit 1 = one or more columns missing — migration may have been silently skipped.
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { compareSchemaRows } from "./schema-drift-compare.mjs";

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
const snapshot = JSON.parse(readFileSync(join(metaDir, latestSnapFile), "utf8"));

// ─── 2. Build expected set: { table → Set<column> } from snapshot ────────────

/** @type {Map<string, Set<string>>} */
const expected = new Map();

for (const tableObj of Object.values(snapshot.tables)) {
  const tableName = tableObj.name.toLowerCase();
  const cols = new Set(
    Object.values(tableObj.columns).map((c) => c.name.toLowerCase())
  );
  expected.set(tableName, cols);
}

// ─── 3. Connect to the live DB and query information_schema.columns ──────────

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error(
    "SCHEMA_DRIFT_CONFIG_ERROR: DATABASE_URL is not set — cannot verify live DB columns.",
  );
  process.exit(EXIT_CONFIG);
}

const client = new Client({ connectionString: dbUrl });

let rows;
try {
  await client.connect();
  const result = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, column_name
  `);
  rows = result.rows;
} catch (err) {
  console.error(
    `SCHEMA_DRIFT_CONNECTION_ERROR: failed to query information_schema.columns (${err.message})`,
  );
  process.exit(EXIT_CONNECTION);
} finally {
  await client.end().catch(() => {});
}

// ─── 4. Compare and report ───────────────────────────────────────────────────

const { missing, unexpected } = compareSchemaRows(expected, rows);

if (missing.length > 0 || unexpected.length > 0) {
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
  console.error(`
The live database differs from the latest Drizzle snapshot. Do not edit the
immutable 0000_squash_baseline or use push-force. Review the difference and
create or apply an idempotent incremental migration when appropriate.

Snapshot used: ${latestSnapFile} (${expected.size} tables, ${[...expected.values()].reduce((n, s) => n + s.size, 0)} columns expected)
`);
  process.exit(EXIT_DIVERGENCE);
}

const totalTables = expected.size;
const totalCols = [...expected.values()].reduce((n, s) => n + s.size, 0);
console.log(
  `✅ Live DB column verification passed: ${totalTables} tables, ${totalCols} columns all present.`,
);
console.log(`   Snapshot: ${latestSnapFile}`);
