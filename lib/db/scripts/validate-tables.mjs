#!/usr/bin/env node
/**
 * validate-tables.mjs
 *
 * Two-part inverse coverage check for the Drizzle migration history:
 *
 * CHECK 1 — TABLES
 * Every table in 0000_squash_baseline.sql that is NOT in the pre-squash allowlist
 * (pre-squash-tables.json) AND NOT confirmed pre-squash via ALTER TABLE must have a
 * corresponding CREATE TABLE in an incremental migration (0001+).
 *
 * CHECK 2 — COLUMNS
 * For every table in 0000_squash_baseline.sql (including tables created by
 * incremental migrations), every column must be explained by one of:
 *   a) Pre-squash tables: column is in the per-table allowlist (pre-squash-columns.json)
 *   b) Migration-created tables: column is defined in the table's CREATE TABLE migration
 *   c) Any table: column was added via ALTER TABLE … ADD COLUMN in an incremental migration
 * Any column not covered by (a), (b), or (c) → EXIT 1.
 *
 * ## The problem these checks prevent
 * When a developer adds a new table or column to the Drizzle schema and only updates
 * the squash baseline WITHOUT creating an incremental migration, the table/column will
 * exist on fresh databases but NOT on existing production databases.
 *
 * Real examples (fixed in migration 0021):
 *   - Tables: ai_integrations, club_config, tenant_integrations, and 5 others
 *   - Column: clients.expo_push_token
 *
 * ## Correct workflow for adding a new table or column
 *   1. Edit the Drizzle TypeScript schema.
 *   2. Run `pnpm --filter @workspace/db generate` to create an incremental migration.
 *   3. Commit BOTH the schema change and the migration file.
 *   → Both checks will pass automatically.
 *
 * ## When these checks fail
 *   Create the appropriate migration (CREATE TABLE IF NOT EXISTS or ADD COLUMN IF NOT
 *   EXISTS) with the same definition as in the baseline, and register it in
 *   meta/_journal.json.
 *   DO NOT add new items to the allowlist files — those files must never grow.
 *
 * Usage:
 *   node lib/db/scripts/validate-tables.mjs
 *
 * Exit 0 = OK, Exit 1 = tables or columns missing incremental migration coverage.
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(__dirname, "../drizzle");
const scriptsDir = __dirname;

// ─── Load allowlists ────────────────────────────────────────────────────────────
// pre-squash-tables.json: tables that predate the incremental migration history.
// Safe to be baseline-only. DO NOT add new tables here — this list must never grow.
const preSquashTableAllowlist = new Set(
  JSON.parse(readFileSync(join(scriptsDir, "pre-squash-tables.json"), "utf8"))
);

// pre-squash-columns.json: per-table map of columns that are known-safe baseline-only.
// Captures columns that existed in production before the squash was introduced.
// DO NOT add new columns here — new columns MUST have ADD COLUMN migrations.
const preSquashColumnAllowlist = JSON.parse(
  readFileSync(join(scriptsDir, "pre-squash-columns.json"), "utf8")
);

// ─── Column extraction helpers ──────────────────────────────────────────────────

/**
 * Parse a CREATE TABLE body and extract column names.
 * Uses a broad pattern: any quoted [a-z_]+ identifier that starts a line
 * and is NOT immediately followed by SQL structural keywords.
 * @param {string} body - SQL body between the outer parentheses
 * @param {boolean} requireIndent - if true, require ≥2 leading spaces (for
 *   the squash baseline which always uses Drizzle's 2-space indentation).
 *   Set to false for hand-written incremental migrations that may have no
 *   indentation.
 */
function extractColumnsFromBody(body, requireIndent = true) {
  const cols = new Set();
  // Matches: leading whitespace + "col_name" + space + type_start
  // Supports digit-containing identifiers (e.g. driver1_cpf, is_child_under_7).
  // Excludes CONSTRAINT/PRIMARY KEY/FOREIGN KEY/UNIQUE/CHECK at line start.
  const prefix = requireIndent ? "\\s{2,}" : "\\s*";
  const colRe = new RegExp(
    `^${prefix}"([a-z][a-z0-9_]*)\"\\s+(?!constraint\\b|primary\\b|foreign\\b|unique\\b|check\\b|references\\b)`,
    "gim"
  );
  let m;
  while ((m = colRe.exec(body)) !== null) {
    cols.add(m[1]);
  }
  return cols;
}

/**
 * Parse CREATE TABLE blocks from the squash baseline SQL.
 * The squash baseline uses Drizzle's `;;` statement terminator.
 */
function parseBaselineBlocks(sql) {
  const map = new Map(); // table → Set<column>
  const blockRe =
    /create table if not exists\s+"([^"]+)"\s*\(([\s\S]*?)\);;/gi;
  let m;
  while ((m = blockRe.exec(sql)) !== null) {
    map.set(m[1].toLowerCase(), extractColumnsFromBody(m[2]));
  }
  return map;
}

/**
 * Parse CREATE TABLE blocks from incremental migration SQL files.
 * Incremental migrations use a single `;` terminator (not `;;`).
 * We match up to the `);\n` pattern, stopping before any `DO $$ ... $$` blocks
 * or `-->`  statement-breakpoint markers.
 */
function parseMigrationCreateTableBlocks(sql) {
  const map = new Map(); // table → Set<column>
  // Match CREATE TABLE...); blocks — stop at the first line starting with `)`
  const blockRe =
    /create table if not exists\s+"([^"]+)"\s*\(([\s\S]*?)\n\);/gi;
  let m;
  while ((m = blockRe.exec(sql)) !== null) {
    // Hand-written incremental migrations may have no column indentation,
    // so we allow \s* (any amount of leading whitespace including zero).
    map.set(m[1].toLowerCase(), extractColumnsFromBody(m[2], false));
  }
  return map;
}

// ─── Parse squash baseline ──────────────────────────────────────────────────────

const baselineSql = readFileSync(
  join(drizzleDir, "0000_squash_baseline.sql"),
  "utf8"
);
const baselineMap = parseBaselineBlocks(baselineSql.toLowerCase());

// ─── Parse incremental migrations ──────────────────────────────────────────────

const migFiles = readdirSync(drizzleDir)
  .filter((f) => /^0[0-9]{3}_(?!squash).*\.sql$/.test(f))
  .sort();

// Tables created by incremental migrations
const migrationCreatedTables = new Set();
const tableSources = new Map(); // table → first migration that creates it

// Per-table columns from their CREATE TABLE migration (initial column set)
const migrationCreatedColumns = new Map(); // table → Set<col> from CREATE TABLE

// Tables confirmed pre-squash via ALTER TABLE references
const alteredByMigration = new Set();

// Columns added via ADD COLUMN in any incremental migration
const migrationAddedColumns = new Map(); // table → Set<col>

for (const file of migFiles) {
  const sql = readFileSync(join(drizzleDir, file), "utf8");
  const sqlLower = sql.toLowerCase();

  // Parse CREATE TABLE blocks
  const createdInFile = parseMigrationCreateTableBlocks(sqlLower);
  for (const [table, cols] of createdInFile) {
    migrationCreatedTables.add(table);
    if (!tableSources.has(table)) tableSources.set(table, file);
    if (!migrationCreatedColumns.has(table))
      migrationCreatedColumns.set(table, new Set());
    for (const c of cols) migrationCreatedColumns.get(table).add(c);
  }

  // ALTER TABLE references (pre-squash confirmation)
  const alterRe = /alter table\s+"?([a-z][a-z0-9_]*)"?\s+/gi;
  let m;
  while ((m = alterRe.exec(sqlLower)) !== null) {
    alteredByMigration.add(m[1]);
  }

  // ADD COLUMN statements
  const addColRe =
    /alter table\s+"?([a-z][a-z0-9_]*)"?\s+add column\s+(?:if not exists\s+)?"?([a-z][a-z0-9_]*)"?/gi;
  while ((m = addColRe.exec(sqlLower)) !== null) {
    const table = m[1];
    const col = m[2];
    if (!migrationAddedColumns.has(table))
      migrationAddedColumns.set(table, new Set());
    migrationAddedColumns.get(table).add(col);
  }
}

// ─── CHECK 1: Tables ───────────────────────────────────────────────────────────

const missingTableMigration = [];

for (const table of baselineMap.keys()) {
  if (preSquashTableAllowlist.has(table)) continue; // grandfathered pre-squash table
  if (alteredByMigration.has(table)) continue; // ALTER TABLE confirms it's pre-squash
  if (migrationCreatedTables.has(table)) continue; // has incremental CREATE TABLE
  missingTableMigration.push(table);
}

// ─── CHECK 2: Columns (all baseline tables — no skips) ─────────────────────────
// For every table in the squash baseline, every column must be explained by one of:
//   a) In preSquashColumnAllowlist[table]  → grandfathered baseline-only column
//   b) In migrationCreatedColumns[table]   → defined in the table's CREATE TABLE migration
//   c) In migrationAddedColumns[table]     → added via ADD COLUMN migration
// Any column not covered → ERROR.

const missingColumnMigration = []; // { table, col }

for (const [table, baselineCols] of baselineMap) {
  const allowedCols = new Set(preSquashColumnAllowlist[table] ?? []);
  const createCols = migrationCreatedColumns.get(table) ?? new Set();
  const addCols = migrationAddedColumns.get(table) ?? new Set();

  for (const col of baselineCols) {
    if (allowedCols.has(col)) continue; // (a) grandfathered
    if (createCols.has(col)) continue; // (b) defined in CREATE TABLE migration
    if (addCols.has(col)) continue; // (c) added via ADD COLUMN migration
    missingColumnMigration.push({ table, col });
  }
}

// ─── Also check: tables in Drizzle snapshot not covered by any migration ───────

const latestSnapshotFiles = readdirSync(join(drizzleDir, "meta"))
  .filter((f) => /^\d{4}_snapshot\.json$/.test(f))
  .sort();

let snapshotTables = new Set();
if (latestSnapshotFiles.length > 0) {
  const latestSnapshot = JSON.parse(
    readFileSync(join(drizzleDir, "meta", latestSnapshotFiles.at(-1)), "utf8")
  );
  snapshotTables = new Set(
    Object.values(latestSnapshot.tables).map((t) => t.name.toLowerCase())
  );
}

const missingFromAllMigrations = [];
for (const table of snapshotTables) {
  if (baselineMap.has(table)) continue;
  if (migrationCreatedTables.has(table)) continue;
  missingFromAllMigrations.push(table);
}

// ─── Report ────────────────────────────────────────────────────────────────────

let exitCode = 0;

if (missingTableMigration.length > 0) {
  console.error(
    "\n❌ Tables in 0000_squash_baseline.sql WITHOUT a corresponding incremental migration:\n"
  );
  for (const table of missingTableMigration.sort()) {
    console.error(`   ${table}`);
  }
  console.error(`
These tables exist on fresh databases (built from the baseline) but will NOT
exist on production databases that were created BEFORE these tables were added
to the squash baseline.

How to fix:
  1. Create the next incremental migration (.sql file) with:

       CREATE TABLE IF NOT EXISTS "<table>" (
         -- same column definitions as in 0000_squash_baseline.sql
       );

  2. Register it in meta/_journal.json with the next idx.
  3. Re-run this script — it must exit 0 before merging.

DO NOT add to pre-squash-tables.json unless you are 100% certain the table
existed in production BEFORE the squash baseline was first introduced.
`);
  exitCode = 1;
}

if (missingColumnMigration.length > 0) {
  console.error(
    "\n❌ Columns in 0000_squash_baseline.sql WITHOUT a corresponding migration:\n"
  );
  for (const { table, col } of missingColumnMigration.sort(
    (a, b) => a.table.localeCompare(b.table) || a.col.localeCompare(b.col)
  )) {
    console.error(`   ${table}.${col}`);
  }
  console.error(`
These columns exist on fresh databases (built from the baseline) but will NOT
exist on production databases where the column was never applied via migration.

How to fix:
  1. Create the next incremental migration (.sql file) with:

       ALTER TABLE "<table>" ADD COLUMN IF NOT EXISTS "<col>" <type> <default>;

     Use the same type and default as in 0000_squash_baseline.sql.

  2. Register it in meta/_journal.json with the next idx.
  3. Re-run this script — it must exit 0 before merging.

DO NOT add to pre-squash-columns.json unless you are 100% certain the column
existed in production BEFORE the squash baseline was first introduced.
`);
  exitCode = 1;
}

if (missingFromAllMigrations.length > 0) {
  console.error(
    "\n❌ Tables in the Drizzle schema snapshot NOT covered by ANY migration:\n"
  );
  for (const table of missingFromAllMigrations.sort()) {
    console.error(`   ${table}`);
  }
  console.error(`
These tables are in the schema but were never added to any SQL migration. Run:
  pnpm --filter @workspace/db generate
to create an incremental migration, then commit both files.
`);
  exitCode = 1;
}

if (exitCode === 0) {
  const tableAllowlistCount = preSquashTableAllowlist.size;
  const alteredCount = [...alteredByMigration].filter(
    (t) => !preSquashTableAllowlist.has(t) && !migrationCreatedTables.has(t)
  ).length;
  const totalAllowlistCols = Object.values(preSquashColumnAllowlist).reduce(
    (s, cols) => s + cols.length,
    0
  );
  const totalMigCreateCols = [...migrationCreatedColumns.values()].reduce(
    (s, cols) => s + cols.size,
    0
  );
  const totalMigAddCols = [...migrationAddedColumns.values()].reduce(
    (s, cols) => s + cols.size,
    0
  );
  console.log(
    `✅  CHECK 1 — Tables: all baseline tables have incremental migration coverage.`
  );
  console.log(
    `    ${tableAllowlistCount} pre-squash allowlist + ${alteredCount} confirmed pre-squash via ALTER TABLE + ${migrationCreatedTables.size} tables with CREATE TABLE migrations.`
  );
  console.log(
    `✅  CHECK 2 — Columns: all baseline columns are covered by migrations or allowlists.`
  );
  console.log(
    `    ${totalAllowlistCols} grandfathered (pre-squash-columns.json) + ${totalMigCreateCols} via CREATE TABLE + ${totalMigAddCols} via ADD COLUMN.`
  );
  if (snapshotTables.size > 0) {
    console.log(
      `    ${snapshotTables.size} total tables in the Drizzle schema snapshot — all covered.`
    );
  }
}

if (migrationCreatedTables.size > 0) {
  console.log(
    `\nℹ️   ${migrationCreatedTables.size} table(s) properly covered by incremental migrations:`
  );
  [...migrationCreatedTables]
    .sort()
    .forEach((t) => console.log(`    ${t}  ← ${tableSources.get(t)}`));
}

process.exit(exitCode);
