import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set to verify migrations");
}

const journal = JSON.parse(readFileSync(
  resolve(import.meta.dirname, "../drizzle/meta/_journal.json"),
  "utf8",
));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const { rows: migrationRows } = await pool.query(
    'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
  );
  assert.equal(
    migrationRows[0].count,
    journal.entries.length,
    "The clean database must apply every journal entry",
  );

  const required = [
    "referral_attempt_logs_tenant_id_fkey",
    "referral_bonus_reversals_tenant_id_fkey",
    "referral_bonus_reversals_tenant_referral_validated_fkey",
    "referral_bonus_reversals_positive_amount_check",
    "referral_bonus_reversals_tenant_referral_unique",
  ];
  const { rows: constraintRows } = await pool.query(`
    SELECT con.conname
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname IN ('referral_attempt_logs', 'referral_bonus_reversals')
  `);
  const actual = new Set(constraintRows.map((row) => row.conname));
  for (const name of required) {
    assert.ok(actual.has(name), `Missing constraint after clean migration: ${name}`);
  }
  console.log(`Clean migration verified: ${journal.entries.length} journal entries and referral constraints.`);
} finally {
  await pool.end();
}