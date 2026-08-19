#!/usr/bin/env node
/**
 * validate-coverage.mjs
 *
 * Checks that every column added by an incremental migration (ALTER TABLE … ADD COLUMN)
 * to a table that ALREADY EXISTS in the squash baseline is also defined inside that
 * baseline's CREATE TABLE block.
 *
 * When a column is ONLY in an incremental migration, fresh databases are incomplete
 * until that specific migration runs. This is fragile — if the migration is somehow
 * skipped (applied-watermark mismatch, deployment race, etc.), the column is absent
 * and causes 500 errors.
 *
 * Usage:
 *   node lib/db/scripts/validate-coverage.mjs
 *
 * Exit 0 = OK, Exit 1 = baseline has gaps (fix: see instructions printed on stderr).
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(__dirname, "../drizzle");

const baselineRaw = readFileSync(
  join(drizzleDir, "0000_squash_baseline.sql"),
  "utf8"
);
const baseline = baselineRaw.toLowerCase();

// ─── Build a map: tableName → Set<columnName> from the baseline CREATE TABLE blocks ───

function buildBaselineColumnMap(sql) {
  const map = new Map();
  // Each CREATE TABLE block runs until the next CREATE TABLE or end of string.
  // We split on the statement-breakpoint comment that drizzle uses.
  const blockRe = /create table if not exists\s+"([^"]+)"\s*\(([\s\S]*?)\);;/gi;
  let m;
  while ((m = blockRe.exec(sql)) !== null) {
    const table = m[1];
    const body = m[2];
    const colNames = new Set();
    // Match column definitions: "col_name" <type>
    const colRe =
      /"([a-z][a-z0-9_]*)"\s+(?:text|integer|boolean|numeric|json|jsonb|timestamp|timestamptz|uuid|bigint|smallint|real|double|date)/gi;
    let cm;
    while ((cm = colRe.exec(body)) !== null) {
      colNames.add(cm[1]);
    }
    map.set(table, colNames);
  }
  return map;
}

const baselineTables = buildBaselineColumnMap(baseline);

// ─── Scan incremental migrations for ADD COLUMN statements ─────────────────────

const migFiles = readdirSync(drizzleDir)
  .filter((f) => /^0[0-9]{3}_(?!squash).*\.sql$/.test(f))
  .sort();

const addColRe =
  /alter table\s+"?([a-z][a-z0-9_]*)"?\s+add column\s+(?:if not exists\s+)?"?([a-z][a-z0-9_]*)"?/gi;

/** table.column pairs that are in an existing baseline table but NOT in the baseline block */
const missingFromBaseline = [];
/** table.column pairs for tables that don't exist in baseline (new tables — expected) */
const newTableCols = [];

for (const file of migFiles) {
  const sql = readFileSync(join(drizzleDir, file), "utf8");
  let m;
  while ((m = addColRe.exec(sql)) !== null) {
    const table = m[1];
    const col = m[2];

    const baselineCols = baselineTables.get(table);
    if (!baselineCols) {
      // Table was added by an incremental migration — this is expected for new tables.
      newTableCols.push({ file, table, col });
      continue;
    }

    if (!baselineCols.has(col)) {
      missingFromBaseline.push({ file, table, col });
    }
  }
}

// Deduplicate: same column may be referenced in multiple migrations (e.g. 0004 + 0019).
const seen = new Set();
const uniqueMissing = missingFromBaseline.filter(({ table, col }) => {
  const key = `${table}.${col}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

// ─── Report ────────────────────────────────────────────────────────────────────

let exitCode = 0;

if (uniqueMissing.length > 0) {
  console.error(
    "\n❌ Columns present in incremental migrations but MISSING from 0000_squash_baseline.sql:\n"
  );
  for (const { file, table, col } of uniqueMissing) {
    console.error(`   [${file}]  ${table}.${col}`);
  }
  console.error(`
How to fix:
  1. Add these columns to the matching CREATE TABLE blocks in 0000_squash_baseline.sql
     (use the same type/default as in the incremental migration).
  2. Add a new catch-all migration (e.g. 0020_catch_all.sql) with
     ALTER TABLE … ADD COLUMN IF NOT EXISTS for each missing column.
  3. Re-run this script — it must exit 0 before merging.
`);
  exitCode = 1;
} else {
  console.log(
    "✅  All columns from incremental migrations are present in 0000_squash_baseline.sql."
  );
  console.log(
    "    Fresh databases built from the baseline alone will have a complete schema."
  );
}

if (newTableCols.length > 0) {
  const tables = [...new Set(newTableCols.map((x) => x.table))];
  console.log(
    `\nℹ️   ${tables.length} table(s) exist only in incremental migrations (expected for tables added after the baseline):`
  );
  tables.forEach((t) => console.log(`    ${t}`));
}

process.exit(exitCode);
