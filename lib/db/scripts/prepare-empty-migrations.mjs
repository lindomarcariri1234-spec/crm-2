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
const defaultMigrationApplicationName = "visitecrm-migrations";

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

function sanitizeApplicationName(value) {
  if (typeof value !== "string" || value.length === 0) return "unset";
  if (value.length > 63 || !/^[A-Za-z0-9_.-]+$/.test(value)) return "redacted";
  return value;
}

async function findMigrationLockBlockers(client) {
  try {
    const { rows } = await client.query(`
      WITH requested_lock AS (
        SELECT hashtext('visitecrm:apply-migrations')::bigint AS value
      )
      SELECT activity.pid, activity.application_name
      FROM pg_catalog.pg_locks AS pg_lock
      JOIN pg_catalog.pg_stat_activity AS activity ON activity.pid = pg_lock.pid
      CROSS JOIN requested_lock
      WHERE pg_lock.locktype = 'advisory'
        AND pg_lock.granted
        AND pg_lock.objsubid = 1
        AND pg_lock.classid = ((requested_lock.value >> 32) & 4294967295)::oid
        AND pg_lock.objid = (requested_lock.value & 4294967295)::oid
        AND pg_lock.pid <> pg_backend_pid()
      ORDER BY activity.pid
    `);
    return rows.flatMap((row) => {
      const pid = Number(row.pid);
      if (!Number.isSafeInteger(pid) || pid <= 0) return [];
      return [{ pid, applicationName: sanitizeApplicationName(row.application_name) }];
    });
  } catch {
    // The timeout remains actionable even if PostgreSQL cannot provide a
    // snapshot of the lock owner at that instant.
    return [];
  }
}

export class MigrationLockTimeoutError extends Error {
  constructor(timeoutMs, blockers = []) {
    const blockerSummary = blockers.length
      ? ` Blocking PostgreSQL process(es): ${blockers
        .map(({ pid, applicationName }) => `pid=${pid}, application_name=${applicationName}`)
        .join("; ")}.`
      : " No active blocker was visible when diagnostics were collected.";
    super(
      `Timed out after ${timeoutMs} ms waiting for the database migration lock ` +
      `(MIGRATION_LOCK_TIMEOUT_MS). Another migration may still be running. ` +
      `Check active PostgreSQL sessions and retry; this attempt did not prepare or apply migrations.${blockerSummary}`,
    );
    this.name = "MigrationLockTimeoutError";
    this.code = "ERR_MIGRATION_LOCK_TIMEOUT";
    this.blockers = blockers;
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
export async function runMigrationPipeline(
  pool,
  migrationsFolder,
  applyMigrations,
  { applicationName = defaultMigrationApplicationName } = {},
) {
  const lockTimeoutMs = getMigrationLockTimeoutMs();
  if (typeof applicationName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(applicationName)) {
    throw new Error("Migration application name must be 1-63 safe alphanumeric, dot, underscore, or hyphen characters");
  }
  const client = await pool.connect();
  let locked = false;
  let applicationNameChanged = false;
  let previousApplicationName;
  let transactionStarted = false;
  let releaseError;
  try {
    const { rows: [settings] } = await client.query(
      "SELECT current_setting('application_name') AS application_name",
    );
    previousApplicationName = settings.application_name;
    await client.query("SELECT set_config('application_name', $1, false)", [applicationName]);
    applicationNameChanged = true;

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
      if (error?.code === "55P03") {
        const blockers = await findMigrationLockBlockers(client);
        throw new MigrationLockTimeoutError(lockTimeoutMs, blockers);
      }
      throw error;
    }
    await prepareEmptyMigrations(pool, migrationsFolder);
    return await applyMigrations();
  } finally {
    let unlockError;
    if (locked) {
      try {
        await client.query(`SELECT pg_advisory_unlock(${migrationLock})`);
      } catch (error) {
        releaseError = error instanceof Error ? error : new Error(String(error));
        unlockError = error;
      }
    }
    if (applicationNameChanged) {
      try {
        await client.query("SELECT set_config('application_name', $1, false)", [previousApplicationName]);
      } catch (error) {
        releaseError ??= error instanceof Error ? error : new Error(String(error));
      }
    }
    client.release(releaseError);
    if (unlockError) throw unlockError;
  }
}