import { readFileSync } from "node:fs";
import { join } from "node:path";

// The immutable baseline adds constraints to these tables before their
// original CREATE TABLE migrations run. On a genuinely empty database only,
// create them from those exact migration files before running the journal.
const prerequisiteMigrations = [
  "0009_referral_attempt_logs.sql",
  "0074_referral_bonus_reversals.sql",
];

export async function prepareEmptyMigrations(pool, migrationsFolder) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('visitecrm:prepare-empty-migrations'))");
    const { rows } = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'public'
      ) AS has_public_tables
    `);
    if (!rows[0].has_public_tables) {
      for (const file of prerequisiteMigrations) {
        await client.query(readFileSync(join(migrationsFolder, file), "utf8"));
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}