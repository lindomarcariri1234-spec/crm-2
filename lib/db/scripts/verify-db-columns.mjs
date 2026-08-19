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

const { Client } = pg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const metaDir = join(__dirname, "../drizzle/meta");

// ─── 1. Resolve the latest snapshot ─────────────────────────────────────────

const snapFiles = readdirSync(metaDir)
  .filter((f) => /^\d+_snapshot\.json$/.test(f))
  .sort();

if (snapFiles.length === 0) {
  console.error("❌ No snapshot files found in drizzle/meta/");
  process.exit(1);
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
  console.error("❌ DATABASE_URL is not set — cannot verify live DB columns.");
  process.exit(1);
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
  console.error(`❌ Failed to query information_schema.columns: ${err.message}`);
  await client.end().catch(() => {});
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}

// ─── 4. Build actual set from DB rows ────────────────────────────────────────

/** @type {Map<string, Set<string>>} */
const actual = new Map();
for (const row of rows) {
  const t = row.table_name.toLowerCase();
  if (!actual.has(t)) actual.set(t, new Set());
  actual.get(t).add(row.column_name.toLowerCase());
}

// ─── 5. Compare and report ───────────────────────────────────────────────────

/** @type {Array<{table: string, col: string}>} */
const missing = [];

for (const [table, cols] of expected) {
  const dbCols = actual.get(table);

  if (!dbCols) {
    // Entire table is missing — add all columns as missing
    for (const col of cols) {
      missing.push({ table, col, reason: "table missing from DB" });
    }
    continue;
  }

  for (const col of cols) {
    if (!dbCols.has(col)) {
      missing.push({ table, col, reason: "column missing from DB" });
    }
  }
}

missing.sort((a, b) =>
  a.table < b.table ? -1 : a.table > b.table ? 1 : a.col.localeCompare(b.col)
);

if (missing.length > 0) {
  console.error(
    "\n❌ Columns present in the Drizzle schema but MISSING from the live database:\n"
  );
  for (const { table, col, reason } of missing) {
    console.error(`   ${table}.${col}  (${reason})`);
  }
  console.error(`
Root cause: the migration that adds this column may have been silently skipped
or marked as "applied" in __drizzle_migrations without actually executing.

How to fix:
  1. Run the missing ALTER TABLE manually against the database, e.g.:
       ALTER TABLE "${missing[0].table}" ADD COLUMN IF NOT EXISTS "${missing[0].col}" <type>;
  2. Verify the column now appears:
       SELECT column_name FROM information_schema.columns
       WHERE table_name = '${missing[0].table}' AND column_name = '${missing[0].col}';
  3. Re-run this script — it must exit 0 before the post-merge is considered complete.

Snapshot used: ${latestSnapFile} (${expected.size} tables, ${[...expected.values()].reduce((n, s) => n + s.size, 0)} columns expected)
`);
  process.exit(1);
}

const totalTables = expected.size;
const totalCols = [...expected.values()].reduce((n, s) => n + s.size, 0);
console.log(
  `✅ Live DB column verification passed: ${totalTables} tables, ${totalCols} columns all present.`
);
console.log(`   Snapshot: ${latestSnapFile}`);
