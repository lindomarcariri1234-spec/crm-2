import { readFileSync } from "node:fs";
import { join } from "node:path";

// The immutable baseline adds constraints to these tables before their
// original CREATE TABLE migrations run. On a genuinely empty database only,
// create them from those exact migration files before running the journal.
const prerequisiteMigrations = [
  "0009_referral_attempt_logs.sql",
  "0074_referral_bonus_reversals.sql",
];

const migrationLock = "hashtext('visitecrm:apply-migrations')";
// Keep the startup wait bounded while allowing the full journal to finish on
// slower deployments. CLI and API startup read the same process environment.
const defaultMigrationLockTimeoutMs = 120_000;

function getMigrationLockTimeoutMs() {
  const configured = process.env.MIGRATION_LOCK_TIMEOUT_MS;
  if (configured === undefined) return defaultMigrationLockTimeoutMs;
  if (!/^[1-9]\d*$/.test(configured)) {
    throw new Error("MIGRATION_LOCK_TIMEOUT_MS must be a positive safe integer in milliseconds");
  }
  const timeoutMs = Number(configured);
  if (!Number.isSafeInteger(timeoutMs)) {
    throw new Error("MIGRATION_LOCK_TIMEOUT_MS must be a positive safe integer in milliseconds");
  }
  return timeoutMs;
}

export class MigrationLockTimeoutError extends Error {
  constructor(timeoutMs) {
    super(
      `Timed out after ${timeoutMs} ms waiting for the database migration lock ` +
      `(MIGRATION_LOCK_TIMEOUT_MS). Another migration may still be running. ` +
      "Check active PostgreSQL sessions and retry; this attempt did not prepare or apply migrations.",
    );
    this.name = "MigrationLockTimeoutError";
    this.code = "ERR_MIGRATION_LOCK_TIMEOUT";
  }
}

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

/**
 * Hold a session-level PostgreSQL lock across both clean-schema preparation and
 * the entire migration runner. The runner can use another pool connection while
 * this lock connection remains checked out.
 */
export async function runMigrationPipeline(pool, migrationsFolder, applyMigrations) {
  const lockTimeoutMs = getMigrationLockTimeoutMs();
  const client = await pool.connect();
  let locked = false;
  let transactionStarted = false;
  let releaseError;
  try {
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      await client.query(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
      await client.query(`SELECT pg_advisory_lock(${migrationLock})`);
      locked = true;
      await client.query("COMMIT");
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query("ROLLBACK");
          transactionStarted = false;
        } catch (rollbackError) {
          releaseError = rollbackError;
          throw new AggregateError(
            [error, rollbackError],
            "Failed to roll back after acquiring the migration lock",
          );
        }
      }
      if (error?.code === "55P03") throw new MigrationLockTimeoutError(lockTimeoutMs);
      throw error;
    }
    await prepareEmptyMigrations(pool, migrationsFolder);
    return await applyMigrations();
  } finally {
    if (locked) {
      try {
        await client.query(`SELECT pg_advisory_unlock(${migrationLock})`);
      } catch (error) {
        releaseError = error instanceof Error ? error : new Error(String(error));
        throw error;
      }
    }
    client.release(releaseError);
  }
}