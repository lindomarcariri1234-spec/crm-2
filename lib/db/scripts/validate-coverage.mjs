#!/usr/bin/env node
/**
 * validate-coverage.mjs
 *
 * Reports columns added by an incremental migration (ALTER TABLE … ADD COLUMN)
 * to a table that ALREADY EXISTS in the squash baseline.
 *
 * The squash baseline is historical and immutable. Therefore any schema change made
 * after it is intentionally absent from the baseline and must be supplied by its
 * ordered, idempotent incremental migration. `validate-columns.mjs` enforces the
 * inverse and authoritative coverage check: every current snapshot column must have
 * a matching incremental migration.
 *
 * Usage:
 *   node lib/db/scripts/validate-coverage.mjs
 *
 * Exit 0 = OK. Post-baseline additions are reported for audit visibility.
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

/** table.column pairs added after the immutable baseline */
const postBaselineAdditions = [];
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
      postBaselineAdditions.push({ file, table, col });
    }
  }
}

// Deduplicate: same column may be referenced in multiple migrations (e.g. 0004 + 0019).
const seen = new Set();
const uniquePostBaselineAdditions = postBaselineAdditions.filter(({ table, col }) => {
  const key = `${table}.${col}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

// ─── Report ────────────────────────────────────────────────────────────────────

if (uniquePostBaselineAdditions.length > 0) {
  console.log(
    "\nℹ️   Columns added after the immutable squash baseline (covered by incremental migrations):\n"
  );
  for (const { file, table, col } of uniquePostBaselineAdditions) {
    console.log(`   [${file}]  ${table}.${col}`);
  }
  console.log(
    "\n    Keep the migration idempotent and run validate-columns to confirm the current schema is covered."
  );
} else {
  console.log(
    "✅  No post-baseline column additions found."
  );
}

if (newTableCols.length > 0) {
  const tables = [...new Set(newTableCols.map((x) => x.table))];
  console.log(
    `\nℹ️   ${tables.length} table(s) exist only in incremental migrations (expected for tables added after the baseline):`
  );
  tables.forEach((t) => console.log(`    ${t}`));
}

process.exit(0);
