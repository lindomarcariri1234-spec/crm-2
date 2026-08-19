#!/usr/bin/env node
/**
 * validate-columns.mjs
 *
 * Snapshot-based column drift check for pre-squash tables.
 *
 * PROBLEM THIS PREVENTS
 * ─────────────────────
 * When a developer adds a column to the Drizzle TypeScript schema and updates the
 * squash baseline manually without creating an incremental migration, the column
 * exists on fresh databases but NOT on existing production databases — causing 500
 * errors on every request that touches it.
 *
 * Real example: `clients.expo_push_token` (root cause of the Task #634 outage).
 *
 * WHAT THIS CHECK DOES
 * ────────────────────
 * "Pre-squash tables" = tables in the squash baseline that were NOT created by an
 * incremental migration's CREATE TABLE statement (i.e. tables that existed before
 * the squash was taken). For each such table:
 *
 *   new_columns = columns_in_snapshot[table] − columns_in_baseline[table]
 *
 * Each of those new columns must appear in an incremental migration as:
 *   ALTER TABLE … ADD COLUMN …
 *
 * If any new column has no corresponding ADD COLUMN → EXIT 1.
 *
 * NOTE: Tables created entirely by incremental migrations are excluded — their full
 * column list is already validated by validate-tables.mjs CHECK 2.
 *
 * CORRECT WORKFLOW
 * ────────────────
 * 1. Edit the Drizzle TypeScript schema.
 * 2. Run `pnpm --filter @workspace/db generate` to create the incremental migration.
 * 3. Commit BOTH the schema change and the migration file.
 * → This check will pass automatically.
 *
 * Usage:
 *   node lib/db/scripts/validate-columns.mjs
 *
 * Exit 0 = OK, Exit 1 = columns in snapshot have no ADD COLUMN migration.
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(__dirname, "../drizzle");
const metaDir = join(drizzleDir, "meta");

// ─── 1. Resolve latest snapshot by enumerating meta/ snapshot files ──────────
//
// NOTE: Snapshots are numbered by `drizzle-kit generate` invocations (0000, 0001, …),
// NOT by migration file numbers. Manual migrations added to _journal.json without
// running `drizzle-kit generate` do NOT create new snapshots. Find the highest-
// numbered snapshot file directly from the filesystem.

const snapFiles = readdirSync(metaDir)
  .filter((f) => /^\d+_snapshot\.json$/.test(f))
  .sort();

if (snapFiles.length === 0) {
  console.error("❌ No snapshot files found in drizzle/meta/");
  process.exit(1);
}

const latestSnapFile = snapFiles.at(-1);
const snapIndex = latestSnapFile.replace("_snapshot.json", "");
const snapshot = JSON.parse(readFileSync(join(metaDir, latestSnapFile), "utf8"));

// ─── 2. Build snapshot column map: tableName → Set<columnName> ──────────────

/** @type {Map<string, Set<string>>} */
const snapshotCols = new Map();
for (const tableObj of Object.values(snapshot.tables)) {
  const cols = new Set(Object.values(tableObj.columns).map((c) => c.name));
  snapshotCols.set(tableObj.name.toLowerCase(), cols);
}

// ─── 3. Build baseline column map: tableName → Set<columnName> ─────────────

const baselineSql = readFileSync(
  join(drizzleDir, "0000_squash_baseline.sql"),
  "utf8"
).toLowerCase();

/**
 * Extract column names from a CREATE TABLE body.
 * Broad pattern: any quoted identifier starting a non-constraint line.
 * Supports digit-containing names like driver1_cpf, is_child_under_7.
 */
function extractColumnsFromBody(body) {
  const cols = new Set();
  const colRe =
    /^\s{2,}"([a-z][a-z0-9_]*)"\s+(?!constraint\b|primary\b|foreign\b|unique\b|check\b|references\b)/gim;
  let m;
  while ((m = colRe.exec(body)) !== null) {
    cols.add(m[1]);
  }
  return cols;
}

/** @type {Map<string, Set<string>>} */
const baselineCols = new Map();
const blockRe = /create table if not exists\s+"([^"]+)"\s*\(([\s\S]*?)\);;/gi;
let bm;
while ((bm = blockRe.exec(baselineSql)) !== null) {
  baselineCols.set(bm[1].toLowerCase(), extractColumnsFromBody(bm[2]));
}

// ─── 4. Identify migration-created tables (excluded from this check) ─────────
//
// Tables with a CREATE TABLE in an incremental migration were added post-squash.
// Their columns are already validated by validate-tables.mjs CHECK 2.

/** @type {Set<string>} */
const migrationCreatedTables = new Set();

const migFiles = readdirSync(drizzleDir)
  .filter((f) => /^0[0-9]{3}_(?!squash).*\.sql$/.test(f))
  .sort();

const createRe =
  /create table if not exists\s+"?([a-z][a-z0-9_]*)"?\s*\(/gi;

/** @type {Map<string, Set<string>>} — table → Set of columns added via ADD COLUMN */
const addedColsByMig = new Map();

const addColRe =
  /alter table\s+"?([a-z][a-z0-9_]*)"?\s+add column\s+(?:if not exists\s+)?"?([a-z][a-z0-9_]*)"?/gi;

for (const file of migFiles) {
  const sql = readFileSync(join(drizzleDir, file), "utf8").toLowerCase();

  // Collect migration-created tables
  let cm;
  while ((cm = createRe.exec(sql)) !== null) {
    migrationCreatedTables.add(cm[1]);
  }

  // Collect ADD COLUMN migrations
  let am;
  while ((am = addColRe.exec(sql)) !== null) {
    const table = am[1];
    const col = am[2];
    if (!addedColsByMig.has(table)) addedColsByMig.set(table, new Set());
    addedColsByMig.get(table).add(col);
  }
}

// ─── 5. Determine pre-squash tables ─────────────────────────────────────────
//
// Pre-squash tables = tables in the squash baseline that were NOT created by an
// incremental migration's CREATE TABLE. This includes:
//   - The 81 tables in pre-squash-tables.json (grandfathered via allowlist)
//   - Tables confirmed pre-squash via ALTER TABLE (e.g. clients, tenants, referrals)

/** @type {Set<string>} */
const preSquashTables = new Set(
  [...baselineCols.keys()].filter((t) => !migrationCreatedTables.has(t))
);

// ─── 6. Compare snapshot vs baseline for pre-squash tables ──────────────────

/** @type {Array<{table: string, col: string}>} */
const missingMigration = [];

for (const [table, snapCols] of snapshotCols) {
  if (!preSquashTables.has(table)) continue; // skip migration-created tables

  const bCols = baselineCols.get(table) ?? new Set();
  const addCols = addedColsByMig.get(table) ?? new Set();

  for (const col of snapCols) {
    if (bCols.has(col)) continue; // in baseline → OK (was there at squash time)
    if (addCols.has(col)) continue; // has ADD COLUMN migration → OK
    missingMigration.push({ table, col });
  }
}

missingMigration.sort((a, b) =>
  a.table < b.table ? -1 : a.table > b.table ? 1 : a.col.localeCompare(b.col)
);

// ─── 7. Report ───────────────────────────────────────────────────────────────

if (missingMigration.length > 0) {
  console.error(
    "\n\u274c Columns present in the Drizzle snapshot but missing an ADD COLUMN migration:\n"
  );
  for (const { table, col } of missingMigration) {
    console.error(`   ${table}.${col}`);
  }
  console.error(`
These columns exist in the TypeScript schema and snapshot (${snapIndex}_snapshot.json)
but do NOT appear in any incremental migration as ALTER TABLE ... ADD COLUMN.

On existing production databases (which have NOT run a migration for this column),
every request that touches the column will fail with a 500 error.

How to fix:
  1. Run \`pnpm --filter @workspace/db generate\` to create the incremental migration.
     --- OR ---
     Manually create a migration file with:
       ALTER TABLE "<table>" ADD COLUMN IF NOT EXISTS "<col>" <type> <constraints>;
     and register it in meta/_journal.json.
  2. Add the new column to 0000_squash_baseline.sql in the table's CREATE TABLE block.
  3. Re-run this script -- it must exit 0 before merging.

DO NOT add these columns to pre-squash-columns.json.
`);
  process.exit(1);
}

const totalNew = [...snapshotCols.entries()]
  .filter(([t]) => preSquashTables.has(t))
  .reduce((sum, [t, cols]) => {
    const bCols = baselineCols.get(t) ?? new Set();
    return sum + [...cols].filter((c) => !bCols.has(c)).length;
  }, 0);

console.log(
  `\u2705  Snapshot vs baseline check passed for ${preSquashTables.size} pre-squash tables.`
);
console.log(
  `    ${totalNew} column(s) added after the squash baseline -- all have ADD COLUMN migrations.`
);
console.log(
  `    Snapshot: ${snapIndex}_snapshot.json (${snapshotCols.size} tables total)`
);
