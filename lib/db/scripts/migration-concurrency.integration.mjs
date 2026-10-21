import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { runMigrationPipeline } from "./prepare-empty-migrations.mjs";

const adminUrl = process.env.MIGRATION_CONCURRENCY_TEST_ADMIN_URL;
if (!adminUrl) {
  throw new Error("MIGRATION_CONCURRENCY_TEST_ADMIN_URL must point to a disposable local PostgreSQL instance");
}
const parsedAdminUrl = new URL(adminUrl);
assert.ok(
  ["localhost", "127.0.0.1", "::1"].includes(parsedAdminUrl.hostname),
  "This test only creates and drops databases on a local PostgreSQL server",
);

const dbPackageDir = resolve(import.meta.dirname, "..");
const workspaceRoot = resolve(dbPackageDir, "../..");
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const testDatabase = `visitecrm_migration_race_${process.pid}_${Date.now()}`;
const timeoutDatabase = `${testDatabase}_timeout`;
const recoveryDatabase = `${testDatabase}_recovery`;
const crashDatabase = `${testDatabase}_crash`;
const apiStartupDatabase = `${testDatabase}_api_startup`;
const trackingDatabase = `${testDatabase}_tracking`;
const legacyDatabase = `${testDatabase}_legacy`;
const publishDatabase = `${testDatabase}_publish`;
const adminPool = new Pool({ connectionString: adminUrl });
let runtimePool;
let timeoutPool;
let recoveryPool;
let trackingPool;
let legacyPool;
let publishPool;
let legacyStartupPool;
let lockHolderPool;
let cliProcess;
let crashHolderProcess;
let crashPool;
let apiStartupPool;
let apiStartupProcess;
let recoveryTempDirectory;
const testDatabases = [testDatabase];
const previousStartupLockTimeout = process.env.MIGRATION_LOCK_TIMEOUT_MS;
process.env.MIGRATION_LOCK_TIMEOUT_MS = "900";

function runCliMigration(databaseUrl, timeoutMs) {
  return new Promise((resolveRun, rejectRun) => {
    const env = { ...process.env, DATABASE_URL: databaseUrl };
    if (timeoutMs !== undefined) env.MIGRATION_LOCK_TIMEOUT_MS = String(timeoutMs);
    cliProcess = spawn(
      "pnpm",
      ["--filter", "@workspace/db", "run", "migrate"],
      {
        cwd: workspaceRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    cliProcess.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    cliProcess.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    cliProcess.once("error", rejectRun);
    cliProcess.once("exit", (code, signal) => {
      if (code === 0) resolveRun({ output });
      else rejectRun(new Error(`Concurrent CLI migration exited with ${code ?? signal}`));
    });
  });
}

function runCliMigrationWithTimeout(databaseUrl, timeoutMs) {
  return new Promise((resolveRun, rejectRun) => {
    cliProcess = spawn(
      "pnpm",
      ["--filter", "@workspace/db", "run", "migrate"],
      {
        cwd: workspaceRoot,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          MIGRATION_LOCK_TIMEOUT_MS: String(timeoutMs),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    cliProcess.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    cliProcess.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
    cliProcess.once("error", rejectRun);
    cliProcess.once("exit", (code, signal) => {
      resolveRun({ code, signal, output });
    });
  });
}

async function findMigrationSessionPid(databaseName, applicationName) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { rows } = await adminPool.query(
      `SELECT pid
       FROM pg_catalog.pg_stat_activity
       WHERE datname = $1 AND application_name = $2`,
      [databaseName, applicationName],
    );
    if (rows.length === 1) return Number(rows[0].pid);
    await delay(25);
  }
  assert.fail(`Expected one migration session named ${applicationName} in ${databaseName}`);
}

async function assertIdlePoolSessionHasApplicationName(pid, expectedApplicationName) {
  const { rows } = await adminPool.query(
    `SELECT state, application_name
     FROM pg_catalog.pg_stat_activity
     WHERE pid = $1`,
    [pid],
  );
  assert.equal(rows.length, 1, `Expected migration backend ${pid} to remain in the pool`);
  assert.equal(rows[0].state, "idle", `Expected migration backend ${pid} to be idle in the pool`);
  assert.equal(rows[0].application_name, expectedApplicationName);
}

function waitForOutputMarker(child, marker) {
  return new Promise((resolveMarker, rejectMarker) => {
    let output = "";
    const timeout = setTimeout(() => {
      rejectMarker(new Error("Migration crash-test process did not report that it acquired the lock"));
    }, 10_000);
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes(marker)) {
        clearTimeout(timeout);
        resolveMarker();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", () => {
      clearTimeout(timeout);
      rejectMarker(new Error("Migration crash-test process exited before acquiring the lock"));
    });
  });
}

async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
  return address.port;
}

function startApiProcess(databaseUrl, port) {
  const child = spawn(
    process.execPath,
    ["--enable-source-maps", "dist/index.mjs"],
    {
      cwd: resolve(workspaceRoot, "artifacts/api-server"),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        NODE_ENV: "development",
        RUN_STARTUP_MIGRATIONS: "true",
        PORT: String(port),
        LOG_LEVEL: "info",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  return { child, get output() { return output; } };
}

function waitForApiOutput(api, marker, timeoutMs = 30_000) {
  if (api.output.includes(marker)) return Promise.resolve();
  return new Promise((resolveMarker, rejectMarker) => {
    const timeout = setTimeout(() => {
      rejectMarker(new Error(`API did not report ${marker} before the startup timeout`));
    }, timeoutMs);
    const checkOutput = () => {
      if (!api.output.includes(marker)) return;
      clearTimeout(timeout);
      resolveMarker();
    };
    const onExit = (code, signal) => {
      clearTimeout(timeout);
      rejectMarker(new Error(`API exited with ${code ?? signal} before reporting ${marker}`));
    };
    api.child.stdout.on("data", checkOutput);
    api.child.stderr.on("data", checkOutput);
    api.child.once("exit", onExit);
  });
}

function waitForApiExit(api, timeoutMs = 30_000) {
  if (api.child.exitCode !== null || api.child.signalCode !== null) {
    return Promise.resolve({ code: api.child.exitCode, signal: api.child.signalCode });
  }
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      api.child.kill("SIGKILL");
      rejectExit(new Error("API process did not exit before the startup failure timeout"));
    }, timeoutMs);
    api.child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolveExit({ code, signal });
    });
  });
}

try {
  await adminPool.query(`CREATE DATABASE "${testDatabase}"`);
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${testDatabase}`;
  const databaseUrl = testUrl.toString();
  runtimePool = new Pool({
    connectionString: databaseUrl,
    application_name: "visitecrm-runtime-original",
  });
  runtimePool.on("error", (error) => {
    console.error(`[migration concurrency test] isolated pool error: ${error.code ?? error.name}`);
  });
  const runtimeDb = drizzle(runtimePool);

  let signalRuntimeHasLock;
  let runtimeLockPid;
  const runtimeHasLock = new Promise((resolveSignal) => {
    signalRuntimeHasLock = resolveSignal;
  });
  const runtimeMigration = runMigrationPipeline(
    runtimePool,
    migrationsFolder,
    async () => {
      runtimeLockPid = await findMigrationSessionPid(testDatabase, "visitecrm-runtime-test");
      signalRuntimeHasLock();
      // Ensure the CLI reaches PostgreSQL and waits on the session lock before
      // the first migrator applies the baseline.
      await delay(600);
      await migrate(runtimeDb, { migrationsFolder });
    },
    { applicationName: "visitecrm-runtime-test" },
  );

  await Promise.race([
    runtimeHasLock,
    runtimeMigration.then(() => {
      throw new Error("Runtime migration finished before acquiring its migration lock");
    }),
  ]);
  const cliMigration = runCliMigration(databaseUrl, 900);

  let observedWaiter = false;
  const waitDeadline = Date.now() + 5000;
  while (Date.now() < waitDeadline) {
    const { rows } = await adminPool.query(
      `SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_locks locks
        JOIN pg_catalog.pg_stat_activity activity USING (pid)
        WHERE activity.datname = $1
          AND locks.locktype = 'advisory'
          AND NOT locks.granted
      ) AS waiting,
      EXISTS (
        SELECT 1
        FROM pg_catalog.pg_locks locks
        JOIN pg_catalog.pg_stat_activity activity USING (pid)
        WHERE activity.datname = $1
          AND locks.locktype = 'advisory'
          AND locks.granted
          AND activity.application_name = 'visitecrm-runtime-test'
      ) AS labeled_holder`,
      [testDatabase],
    );
    if (rows[0].waiting && rows[0].labeled_holder) {
      observedWaiter = true;
      break;
    }
    await delay(25);
  }
  assert.ok(observedWaiter, "The concurrent CLI must wait on the held migration lock");

  const [, cliResult] = await Promise.all([runtimeMigration, cliMigration]);
  assert.match(cliResult.output, /waiting for the database migration lock/);
  assert.match(cliResult.output, /still waiting for the database migration lock .*elapsed=\d+ms/);
  assert.doesNotMatch(cliResult.output, /postgres(?:ql)?:\/\/|SELECT |password|DATABASE_URL/i);
  await assertIdlePoolSessionHasApplicationName(runtimeLockPid, "visitecrm-runtime-original");
  const { rows: appliedRows } = await runtimePool.query(
    "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
  );
  const journal = JSON.parse(await readFile(
    resolve(migrationsFolder, "meta/_journal.json"),
    "utf8",
  ));
  assert.equal(appliedRows[0].count, journal.entries.length);
  console.log(`Concurrent CLI/API startup applied ${journal.entries.length} migrations exactly once.`);

  recoveryTempDirectory = await mkdtemp(join(tmpdir(), "visitecrm-migration-recovery-"));

  // Reproduce the state after Replit Publish adds phase-1 schema constraints
  // but before the API's journaled migration runner advances its history.
  // This database is disposable and local; production is never contacted.
  await adminPool.query(`CREATE DATABASE "${publishDatabase}"`);
  testDatabases.push(publishDatabase);
  const publishUrl = new URL(adminUrl);
  publishUrl.pathname = `/${publishDatabase}`;
  publishPool = new Pool({ connectionString: publishUrl.toString() });
  publishPool.on("error", (error) => {
    console.error(`[publish migration compatibility test] isolated pool error: ${error.code ?? error.name}`);
  });
  const publishMigrationsFolder = join(recoveryTempDirectory, "publish-stage1-drizzle");
  await cp(migrationsFolder, publishMigrationsFolder, { recursive: true });
  const tripRelationshipMigrationIndex = journal.entries.findIndex(
    (entry) => entry.tag === "0120_trip_tenant_relationship_constraints",
  );
  assert.ok(tripRelationshipMigrationIndex > 0, "The Publish compatibility test needs migration 0120");
  const publishJournalPath = join(publishMigrationsFolder, "meta/_journal.json");
  await writeFile(
    publishJournalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, tripRelationshipMigrationIndex) }, null, 2),
  );
  const publishDb = drizzle(publishPool);
  await runMigrationPipeline(
    publishPool,
    publishMigrationsFolder,
    async () => migrate(publishDb, { migrationsFolder: publishMigrationsFolder }),
    { applicationName: "visitecrm-publish-prefix-test" },
  );
  const { rows: [publishPrefixState] } = await publishPool.query(
    "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
  );
  assert.equal(publishPrefixState.count, tripRelationshipMigrationIndex);

  // Mirror the successful phase-1 Publish diff: NOT NULL plus table-level
  // UNIQUE constraints whose backing indexes have the same names as the
  // indexes expected by migrations 0120 and 0121.
  await publishPool.query(`
    ALTER TABLE "trip_checkins"
      ALTER COLUMN "reservation_id" SET NOT NULL;
    ALTER TABLE "reservations"
      ADD CONSTRAINT "reservations_id_trip_tenant_unique"
      UNIQUE ("id", "trip_id", "tenant_id");
    ALTER TABLE "trips"
      ADD CONSTRAINT "trips_id_tenant_id_unique"
      UNIQUE ("id", "tenant_id");
    ALTER TABLE "passengers"
      ADD CONSTRAINT "passengers_id_reservation_unique"
      UNIQUE ("id", "reservation_id");
  `);

  await writeFile(publishJournalPath, JSON.stringify(journal, null, 2));
  await runMigrationPipeline(
    publishPool,
    publishMigrationsFolder,
    async () => migrate(publishDb, { migrationsFolder: publishMigrationsFolder }),
    { applicationName: "visitecrm-publish-compatibility-test" },
  );
  const { rows: [publishRecoveredState] } = await publishPool.query(`
    SELECT
      (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS applied_count,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.trips'::regclass
          AND conname = 'trips_id_tenant_id_unique'
          AND contype = 'u'
      ) AS trip_unique_constraint,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.reservations'::regclass
          AND conname = 'reservations_id_trip_tenant_unique'
          AND contype = 'u'
      ) AS reservation_unique_constraint,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.passengers'::regclass
          AND conname = 'passengers_id_reservation_unique'
          AND contype = 'u'
      ) AS passenger_unique_constraint,
      (SELECT attnotnull
       FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.trip_checkins'::regclass
         AND attname = 'reservation_id'
         AND NOT attisdropped) AS reservation_id_not_null,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.reservations'::regclass
          AND conname = 'reservations_trip_id_trips_id_fk'
          AND contype = 'f'
      ) AS simple_reservation_trip_fk,
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid = 'public.trip_checkins'::regclass
          AND conname = 'trip_checkins_trip_id_trips_id_fk'
          AND contype = 'f'
      ) AS simple_checkin_trip_fk,
      NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conrelid IN (
          'public.reservations'::regclass,
          'public.trip_checkins'::regclass
        )
          AND conname IN (
            'reservations_trip_tenant_fk',
            'trip_checkins_trip_tenant_fk',
            'trip_checkins_reservation_trip_tenant_fk',
            'trip_checkins_passenger_reservation_fk'
          )
      ) AS composite_foreign_keys_removed
  `);
  assert.equal(publishRecoveredState.applied_count, journal.entries.length);
  assert.equal(publishRecoveredState.trip_unique_constraint, true);
  assert.equal(publishRecoveredState.reservation_unique_constraint, true);
  assert.equal(publishRecoveredState.passenger_unique_constraint, true);
  assert.equal(publishRecoveredState.reservation_id_not_null, true);
  assert.equal(publishRecoveredState.simple_reservation_trip_fk, true);
  assert.equal(publishRecoveredState.simple_checkin_trip_fk, true);
  assert.equal(publishRecoveredState.composite_foreign_keys_removed, true);
  console.log("The API migration journal completed after a Publish-shaped schema was applied first.");

  await adminPool.query(`CREATE DATABASE "${recoveryDatabase}"`);
  testDatabases.push(recoveryDatabase);
  const recoveryUrl = new URL(adminUrl);
  recoveryUrl.pathname = `/${recoveryDatabase}`;
  recoveryPool = new Pool({ connectionString: recoveryUrl.toString() });
  recoveryPool.on("error", (error) => {
    console.error(`[migration recovery test] isolated pool error: ${error.code ?? error.name}`);
  });
  const recoveryMigrationsFolder = join(recoveryTempDirectory, "drizzle");
  await cp(migrationsFolder, recoveryMigrationsFolder, { recursive: true });
  let failingEntry;
  let originalFailingMigration;
  for (const entry of [...journal.entries].reverse()) {
    const candidate = await readFile(join(recoveryMigrationsFolder, `${entry.tag}.sql`), "utf8");
    if (/ALTER TABLE "expenses"/.test(candidate)
      && /CREATE UNIQUE INDEX IF NOT EXISTS "expenses_linked_trip_cost_id_unique"/.test(candidate)) {
      failingEntry = entry;
      originalFailingMigration = candidate;
      break;
    }
  }
  assert.ok(failingEntry, "The recovery test needs the expense-link migration to fail");
  const failingMigrationPath = join(recoveryMigrationsFolder, `${failingEntry.tag}.sql`);
  assert.match(originalFailingMigration, /ALTER TABLE "expenses"/);
  assert.match(originalFailingMigration, /CREATE UNIQUE INDEX IF NOT EXISTS "expenses_linked_trip_cost_id_unique"/);
  await writeFile(
    failingMigrationPath,
    `${originalFailingMigration}\n--> statement-breakpoint\nSELECT 1 / 0;\n`,
  );
  const baselineSql = await readFile(join(migrationsFolder, "0000_squash_baseline.sql"), "utf8");
  const tenantTableStatement = baselineSql.split("--> statement-breakpoint", 1)[0];
  assert.match(tenantTableStatement, /CREATE TABLE IF NOT EXISTS "tenants"/);
  const recoveryMarker = {
    id: "migration-recovery-attempt",
    tenantId: "migration-recovery-tenant",
    clientId: "migration-recovery-client",
    storeSlug: "migration-recovery-store",
  };
  const recoveryDb = drizzle(recoveryPool);

  await assert.rejects(
    runMigrationPipeline(
      recoveryPool,
      recoveryMigrationsFolder,
      async () => {
        const { rows: [lockState] } = await recoveryPool.query(`
          SELECT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_locks
            WHERE locktype = 'advisory'
              AND granted
              AND pid <> pg_backend_pid()
          ) AS migration_lock_held
        `);
        assert.equal(lockState.migration_lock_held, true);
        // Seed a valid application record after the pipeline's prerequisite
        // preparation commits, but before the journal's transaction can fail.
        await recoveryPool.query(tenantTableStatement);
        await recoveryPool.query(
          `INSERT INTO "tenants" ("id", "name", "slug", "email")
           VALUES ($1, $2, $3, $4)`,
          [
            recoveryMarker.tenantId,
            "Migration Recovery Test",
            "migration-recovery-test",
            "migration-recovery@example.test",
          ],
        );
        await recoveryPool.query(
          `INSERT INTO "referral_attempt_logs" ("id", "tenant_id", "client_id", "store_slug")
           VALUES ($1, $2, $3, $4)`,
          [recoveryMarker.id, recoveryMarker.tenantId, recoveryMarker.clientId, recoveryMarker.storeSlug],
        );
        await migrate(recoveryDb, { migrationsFolder: recoveryMigrationsFolder });
      },
      { applicationName: "visitecrm-failed-runtime-test" },
    ),
    (error) => error?.cause?.code === "22012" && /division by zero/i.test(error.cause.message),
  );
  const { rows: [preparedState] } = await recoveryPool.query(`
    SELECT
      to_regclass('public.referral_attempt_logs') IS NOT NULL AS attempts_prepared,
      to_regclass('public.referral_bonus_reversals') IS NOT NULL AS reversals_prepared
  `);
  assert.equal(preparedState.attempts_prepared, true);
  assert.equal(preparedState.reversals_prepared, true);
  const { rows: [recordAfterFailure] } = await recoveryPool.query(
    `SELECT "tenant_id" AS "tenantId", "client_id" AS "clientId", "store_slug" AS "storeSlug"
     FROM "referral_attempt_logs" WHERE "id" = $1`,
    [recoveryMarker.id],
  );
  assert.deepEqual(recordAfterFailure, {
    tenantId: recoveryMarker.tenantId,
    clientId: recoveryMarker.clientId,
    storeSlug: recoveryMarker.storeSlug,
  });
  const { rows: [ddlAfterFailure] } = await recoveryPool.query(`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'expenses'
          AND column_name = 'linked_trip_cost_id'
      ) AS linked_column_exists,
      to_regclass('public.expenses_linked_trip_cost_id_unique') IS NOT NULL AS linked_index_exists
  `);
  assert.equal(ddlAfterFailure.linked_column_exists, false, "DDL from the failed migration must roll back");
  assert.equal(ddlAfterFailure.linked_index_exists, false, "Indexes from the failed migration must roll back");
  const { rows: [partialState] } = await recoveryPool.query(
    "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
  );
  assert.ok(partialState.count < journal.entries.length, "The failed process must leave work for the retry");

  // Retry the same database without dropping it or rerunning preparation by hand.
  await runCliMigration(recoveryUrl.toString(), 5000);
  const { rows: [recoveredState] } = await recoveryPool.query(
    "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
  );
  assert.equal(recoveredState.count, journal.entries.length);
  const { rows: [recoveredPrerequisites] } = await recoveryPool.query(`
    SELECT
      to_regclass('public.referral_attempt_logs') IS NOT NULL AS attempts_preserved,
      to_regclass('public.referral_bonus_reversals') IS NOT NULL AS reversals_preserved
  `);
  assert.equal(recoveredPrerequisites.attempts_preserved, true);
  assert.equal(recoveredPrerequisites.reversals_preserved, true);
  const { rows: [recordAfterRetry] } = await recoveryPool.query(
    `SELECT "tenant_id" AS "tenantId", "client_id" AS "clientId", "store_slug" AS "storeSlug"
     FROM "referral_attempt_logs" WHERE "id" = $1`,
    [recoveryMarker.id],
  );
  assert.deepEqual(recordAfterRetry, {
    tenantId: recoveryMarker.tenantId,
    clientId: recoveryMarker.clientId,
    storeSlug: recoveryMarker.storeSlug,
  });
  const { rows: [ddlAfterRetry] } = await recoveryPool.query(`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'expenses'
          AND column_name = 'linked_trip_cost_id'
      ) AS linked_column_exists,
      to_regclass('public.expenses_linked_trip_cost_id_unique') IS NOT NULL AS linked_index_exists
  `);
  assert.equal(ddlAfterRetry.linked_column_exists, true);
  assert.equal(ddlAfterRetry.linked_index_exists, true);
  console.log(`A fresh CLI process completed the journal after a controlled SQL migration failure without resetting the database.`);

  await adminPool.query(`CREATE DATABASE "${crashDatabase}"`);
  testDatabases.push(crashDatabase);
  const crashUrl = new URL(adminUrl);
  crashUrl.pathname = `/${crashDatabase}`;
  crashPool = new Pool({ connectionString: crashUrl.toString() });
  const { rows: [crashDatabaseBefore] } = await adminPool.query(
    "SELECT oid FROM pg_catalog.pg_database WHERE datname = $1",
    [crashDatabase],
  );
  const crashHolderSource = `
    import { Pool } from "pg";
    import { runMigrationPipeline } from "./scripts/prepare-empty-migrations.mjs";
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await runMigrationPipeline(pool, "./drizzle", async () => {
      await pool.query("CREATE TABLE public.migration_crash_marker (id text PRIMARY KEY, value text NOT NULL)");
      await pool.query("INSERT INTO public.migration_crash_marker (id, value) VALUES ('preserve', 'survives')");
      process.stdout.write("MIGRATION_LOCK_HELD");
      await new Promise(() => {});
    }, { applicationName: "visitecrm-crash-holder" });
  `;
  crashHolderProcess = spawn(
    process.execPath,
    ["--input-type=module", "-e", crashHolderSource],
    {
      cwd: dbPackageDir,
      env: {
        ...process.env,
        DATABASE_URL: crashUrl.toString(),
        MIGRATION_LOCK_TIMEOUT_MS: "5000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const crashMarker = waitForOutputMarker(crashHolderProcess, "MIGRATION_LOCK_HELD");
  const crashHolderPid = await findMigrationSessionPid(crashDatabase, "visitecrm-crash-holder");
  await crashMarker;
  const { rows: [crashLockState] } = await adminPool.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_catalog.pg_locks
       WHERE pid = $1 AND locktype = 'advisory' AND granted
     ) AS lock_held`,
    [crashHolderPid],
  );
  assert.equal(crashLockState.lock_held, true, "The child must hold the migration lock before it is killed");
  const crashHolderExit = new Promise((resolveExit) => {
    crashHolderProcess.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  assert.equal(crashHolderProcess.kill("SIGKILL"), true);
  const crashExit = await crashHolderExit;
  assert.equal(crashExit.signal, "SIGKILL", "The lock holder must be interrupted without cleanup");
  crashHolderProcess = null;

  let crashedSessionStillConnected = true;
  const lockReleaseDeadline = Date.now() + 5000;
  while (Date.now() < lockReleaseDeadline) {
    const { rows } = await adminPool.query(
      "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid = $1) AS connected",
      [crashHolderPid],
    );
    crashedSessionStillConnected = rows[0].connected;
    if (!crashedSessionStillConnected) break;
    await delay(25);
  }
  assert.equal(crashedSessionStillConnected, false, "PostgreSQL must close the killed process's session");

  await runCliMigration(crashUrl.toString(), 10_000);
  const { rows: [crashJournalState] } = await crashPool.query(
    "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
  );
  assert.equal(crashJournalState.count, journal.entries.length);
  const { rows: [crashMarkerState] } = await crashPool.query(
    "SELECT value FROM public.migration_crash_marker WHERE id = 'preserve'",
  );
  assert.equal(crashMarkerState.value, "survives");
  const { rows: [crashDatabaseAfter] } = await adminPool.query(
    "SELECT oid FROM pg_catalog.pg_database WHERE datname = $1",
    [crashDatabase],
  );
  assert.equal(crashDatabaseAfter.oid, crashDatabaseBefore.oid, "The retry must use the same database");
  console.log("A fresh CLI process completed the journal after SIGKILL released the migration lock, preserving the database.");

  await adminPool.query(`CREATE DATABASE "${apiStartupDatabase}"`);
  testDatabases.push(apiStartupDatabase);
  const apiStartupUrl = new URL(adminUrl);
  apiStartupUrl.pathname = `/${apiStartupDatabase}`;
  apiStartupPool = new Pool({ connectionString: apiStartupUrl.toString() });
  const expenseLinkMigrationIndex = journal.entries.findIndex(
    (entry) => entry.tag === "0096_link_expense_trip_costs",
  );
  assert.ok(expenseLinkMigrationIndex > 0, "The API startup test requires migration 0096");
  const apiStartupMigrationsFolder = join(recoveryTempDirectory, "api-startup-drizzle");
  await cp(migrationsFolder, apiStartupMigrationsFolder, { recursive: true });
  const apiStartupJournalPath = join(apiStartupMigrationsFolder, "meta/_journal.json");
  await writeFile(
    apiStartupJournalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, expenseLinkMigrationIndex) }, null, 2),
  );
  await runMigrationPipeline(
    apiStartupPool,
    apiStartupMigrationsFolder,
    async () => migrate(drizzle(apiStartupPool), { migrationsFolder: apiStartupMigrationsFolder }),
    { applicationName: "visitecrm-api-startup-prefix-test" },
  );
  const startupLegacyRows = {
    tenantId: "api-startup-legacy-tenant",
    userId: "api-startup-legacy-user",
    expenseId: "api-startup-legacy-expense",
    orphanTripCostId: "missing-legacy-trip-cost",
  };
  await apiStartupPool.query(
    `INSERT INTO "tenants" ("id", "name", "slug", "email")
     VALUES ($1, 'API startup legacy tenant', 'api-startup-legacy-tenant', 'api-startup-legacy@example.test')`,
    [startupLegacyRows.tenantId],
  );
  await apiStartupPool.query(
    `INSERT INTO "users" ("id", "clerk_id", "tenant_id", "name", "email", "referral_code")
     VALUES ($1, 'api-startup-legacy-clerk-user', $2, 'API startup legacy user', 'api-startup-user@example.test', 'API-STARTUP-LEGACY')`,
    [startupLegacyRows.userId, startupLegacyRows.tenantId],
  );
  await apiStartupPool.query(
    `ALTER TABLE "expenses"
       ADD COLUMN IF NOT EXISTS "linked_trip_cost_id" text;
     ALTER TABLE "expenses"
       DROP CONSTRAINT IF EXISTS "expenses_linked_trip_cost_id_trip_costs_id_fk";
     DROP INDEX IF EXISTS "expenses_linked_trip_cost_id_unique"`,
  );
  await apiStartupPool.query(
    `INSERT INTO "expenses"
       ("id", "tenant_id", "category", "description", "amount", "due_date", "created_by_id", "linked_trip_cost_id")
     VALUES ($1, $2, 'legacy', 'Pre-migration expense', 10, now(), $3, $4)`,
    [
      startupLegacyRows.expenseId,
      startupLegacyRows.tenantId,
      startupLegacyRows.userId,
      startupLegacyRows.orphanTripCostId,
    ],
  );

  const apiStartupPort = await getAvailablePort();
  apiStartupProcess = startApiProcess(apiStartupUrl.toString(), apiStartupPort);
  const failedApiExit = await waitForApiExit(apiStartupProcess);
  assert.equal(failedApiExit.code, 1, "The API must exit unsuccessfully when startup migration fails");
  assert.match(apiStartupProcess.output, /Drizzle migration failed/);
  assert.match(apiStartupProcess.output, /API startup failed before serving/);
  assert.doesNotMatch(apiStartupProcess.output, /Server listening/);
  const { rows: [failedApiJournal] } = await apiStartupPool.query(
    "SELECT count(*)::int AS applied_count FROM drizzle.__drizzle_migrations",
  );
  assert.equal(failedApiJournal.applied_count, expenseLinkMigrationIndex);
  assert.ok(
    failedApiJournal.applied_count < journal.entries.length,
    "A failed migration must not leave the journal marked complete",
  );
  const { rows: [failedApiConstraint] } = await apiStartupPool.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_catalog.pg_constraint
       WHERE conname = 'expenses_linked_trip_cost_id_trip_costs_id_fk'
         AND conrelid = 'public.expenses'::regclass
     ) AS exists`,
  );
  assert.equal(failedApiConstraint.exists, false, "The failed migration must not be journaled as complete");

  await apiStartupPool.query(
    `UPDATE "expenses" SET "linked_trip_cost_id" = NULL WHERE "id" = $1`,
    [startupLegacyRows.expenseId],
  );
  apiStartupProcess = startApiProcess(apiStartupUrl.toString(), apiStartupPort);
  await waitForApiOutput(apiStartupProcess, "Server listening");
  assert.equal(apiStartupProcess.child.exitCode, null, "The repaired API process must remain initialized");
  const { rows: [repairedApiJournal] } = await apiStartupPool.query(
    "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
  );
  assert.equal(repairedApiJournal.count, journal.entries.length);
  const { rows: [repairedApiConstraints] } = await apiStartupPool.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint
        WHERE conname = 'expenses_linked_trip_cost_id_trip_costs_id_fk'
          AND conrelid = 'public.expenses'::regclass
      ) AS foreign_key_exists,
      to_regclass('public.expenses_linked_trip_cost_id_unique') IS NOT NULL AS unique_index_exists
  `);
  assert.equal(repairedApiConstraints.foreign_key_exists, true);
  assert.equal(repairedApiConstraints.unique_index_exists, true);
  apiStartupProcess.child.kill("SIGKILL");
  await waitForApiExit(apiStartupProcess);
  apiStartupProcess = null;
  console.log("The API exited on a legacy-data migration failure, then stayed initialized after repair and a complete retry.");

  await adminPool.query(`CREATE DATABASE "${trackingDatabase}"`);
  testDatabases.push(trackingDatabase);
  const trackingUrl = new URL(adminUrl);
  trackingUrl.pathname = `/${trackingDatabase}`;
  trackingPool = new Pool({
    connectionString: trackingUrl.toString(),
    application_name: "visitecrm-tracking-original",
  });
  trackingPool.on("error", (error) => {
    console.error(`[tracking index recovery test] isolated pool error: ${error.code ?? error.name}`);
  });
  const trackingMigrationIndex = journal.entries.findIndex(
    (entry) => entry.tag === "0086_referral_integrity_indexes",
  );
  assert.ok(trackingMigrationIndex > 0, "The tracking recovery test needs migration 0086");
  const trackingMigrationsFolder = join(recoveryTempDirectory, "tracking-drizzle");
  await cp(migrationsFolder, trackingMigrationsFolder, { recursive: true });
  const trackingJournalPath = join(trackingMigrationsFolder, "meta/_journal.json");
  await writeFile(
    trackingJournalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, trackingMigrationIndex) }, null, 2),
  );
  const trackingDb = drizzle(trackingPool);
  await runMigrationPipeline(
    trackingPool,
    trackingMigrationsFolder,
    async () => migrate(trackingDb, { migrationsFolder: trackingMigrationsFolder }),
    { applicationName: "visitecrm-tracking-index-prefix-test" },
  );
  let failedMigrationPid;
  await assert.rejects(
    runMigrationPipeline(
      trackingPool,
      trackingMigrationsFolder,
      async () => {
        failedMigrationPid = await findMigrationSessionPid(
          trackingDatabase,
          "visitecrm-tracking-error-test",
        );
        throw new Error("intentional migration callback failure");
      },
      { applicationName: "visitecrm-tracking-error-test" },
    ),
    /intentional migration callback failure/,
  );
  await assertIdlePoolSessionHasApplicationName(failedMigrationPid, "visitecrm-tracking-original");

  const duplicateCookieRows = [
    {
      id: "legacy-tracking-cookie-a",
      tenantId: "legacy-tracking-tenant",
      cookieId: "duplicate-legacy-cookie",
      referralCode: "LEGACY-TRACKING-CODE",
    },
    {
      id: "legacy-tracking-cookie-b",
      tenantId: "legacy-tracking-tenant",
      cookieId: "duplicate-legacy-cookie",
      referralCode: "LEGACY-TRACKING-CODE",
    },
  ];
  // The squashed baseline already has the current composite index. Remove it
  // to model a legacy database missing that guard before inserting old conflicts.
  await trackingPool.query(
    `ALTER TABLE "referral_tracking"
     DROP CONSTRAINT IF EXISTS "referral_tracking_tenant_cookie_unique"`,
  );
  await trackingPool.query(
    `INSERT INTO "tenants" ("id", "name", "slug", "email")
     VALUES ($1, 'Legacy Tracking Tenant', 'legacy-tracking-tenant', 'legacy-tracking@example.test')`,
    [duplicateCookieRows[0].tenantId],
  );
  await trackingPool.query(
    `INSERT INTO "referral_tracking" ("id", "tenant_id", "cookie_id", "referral_code")
     VALUES ($1, $2, $3, $4), ($5, $2, $3, $4)`,
    [
      duplicateCookieRows[0].id,
      duplicateCookieRows[0].tenantId,
      duplicateCookieRows[0].cookieId,
      duplicateCookieRows[0].referralCode,
      duplicateCookieRows[1].id,
    ],
  );

  await assert.rejects(
    trackingPool.query(
      `CREATE UNIQUE INDEX "referral_tracking_tenant_cookie_unique"
       ON "referral_tracking" ("tenant_id", "cookie_id")`,
    ),
    (error) => error?.code === "23505"
      && error.constraint === "referral_tracking_tenant_cookie_unique",
  );
  const duplicateCookieMigration = await runCliMigrationWithTimeout(trackingUrl.toString(), 5000);
  assert.notEqual(duplicateCookieMigration.code, 0, "Migration 0086 must fail on duplicate tenant/cookie pairs");
  const { rows: [trackingFailureState] } = await trackingPool.query(`
    SELECT
      (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS applied_count,
      (SELECT count(*)::int FROM referral_tracking) AS record_count,
      to_regclass('public.referral_tracking_tenant_cookie_unique') IS NOT NULL AS tracking_index_exists
  `);
  assert.equal(trackingFailureState.applied_count, trackingMigrationIndex);
  assert.equal(trackingFailureState.record_count, duplicateCookieRows.length);
  assert.equal(trackingFailureState.tracking_index_exists, false);
  const { rows: duplicateRowsAfterFailure } = await trackingPool.query(
    `SELECT "id", "tenant_id" AS "tenantId", "cookie_id" AS "cookieId", "referral_code" AS "referralCode"
     FROM "referral_tracking"
     WHERE "id" = ANY($1)
     ORDER BY "id"`,
    [duplicateCookieRows.map((row) => row.id)],
  );
  assert.deepEqual(
    duplicateRowsAfterFailure,
    [...duplicateCookieRows]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, tenantId, cookieId, referralCode }) => ({ id, tenantId, cookieId, referralCode })),
  );

  const { rowCount: repairedTrackingRows } = await trackingPool.query(
    `UPDATE "referral_tracking" SET "cookie_id" = $1 WHERE "id" = $2`,
    ["repaired-legacy-cookie", duplicateCookieRows[1].id],
  );
  assert.equal(repairedTrackingRows, 1, "A conflicting tracking row must be repairable without deleting it");
  const { rows: trackingRowsAfterRepair } = await trackingPool.query(
    `SELECT "id", "tenant_id" AS "tenantId", "cookie_id" AS "cookieId"
     FROM "referral_tracking"
     WHERE "id" = ANY($1)
     ORDER BY "id"`,
    [duplicateCookieRows.map((row) => row.id)],
  );
  assert.deepEqual(trackingRowsAfterRepair, [
    {
      id: duplicateCookieRows[0].id,
      tenantId: duplicateCookieRows[0].tenantId,
      cookieId: duplicateCookieRows[0].cookieId,
    },
    {
      id: duplicateCookieRows[1].id,
      tenantId: duplicateCookieRows[1].tenantId,
      cookieId: "repaired-legacy-cookie",
    },
  ]);

  await runCliMigration(trackingUrl.toString(), 5000);
  const { rows: [trackingRecoveredState] } = await trackingPool.query(`
    SELECT
      (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS applied_count,
      (SELECT count(*)::int FROM referral_tracking) AS record_count,
      to_regclass('public.referral_tracking_tenant_cookie_unique') IS NOT NULL AS tracking_index_exists
  `);
  assert.equal(trackingRecoveredState.applied_count, journal.entries.length);
  assert.equal(trackingRecoveredState.record_count, duplicateCookieRows.length);
  assert.equal(trackingRecoveredState.tracking_index_exists, true);
  const { rows: trackingRowsAfterRetry } = await trackingPool.query(
    `SELECT "id", "tenant_id" AS "tenantId", "cookie_id" AS "cookieId"
     FROM "referral_tracking"
     WHERE "id" = ANY($1)
     ORDER BY "id"`,
    [duplicateCookieRows.map((row) => row.id)],
  );
  assert.deepEqual(trackingRowsAfterRetry, trackingRowsAfterRepair);
  console.log("The CLI migration preserved duplicate tracking history on failure, then completed after one cookie value was repaired.");

  await adminPool.query(`CREATE DATABASE "${legacyDatabase}"`);
  testDatabases.push(legacyDatabase);
  const legacyUrl = new URL(adminUrl);
  legacyUrl.pathname = `/${legacyDatabase}`;
  legacyPool = new Pool({ connectionString: legacyUrl.toString() });
  legacyPool.on("error", (error) => {
    console.error(`[legacy migration recovery test] isolated pool error: ${error.code ?? error.name}`);
  });
  const legacyMigrationsFolder = join(recoveryTempDirectory, "legacy-drizzle");
  await cp(migrationsFolder, legacyMigrationsFolder, { recursive: true });
  const constraintMigrationIndex = journal.entries.findIndex(
    (entry) => entry.tag === "0087_referral_integrity_constraints",
  );
  const validationMigrationIndex = journal.entries.findIndex(
    (entry) => entry.tag === "0091_referral_validated_tenant_fks",
  );
  assert.ok(constraintMigrationIndex > 0, "The legacy fixture needs the pre-constraint journal boundary");
  assert.ok(validationMigrationIndex > constraintMigrationIndex, "The validated foreign-key migration must follow the legacy fixture boundary");
  const legacyJournalPath = join(legacyMigrationsFolder, "meta/_journal.json");
  await writeFile(
    legacyJournalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, constraintMigrationIndex) }, null, 2),
  );
  const legacyDb = drizzle(legacyPool);
  await runMigrationPipeline(
    legacyPool,
    legacyMigrationsFolder,
    async () => migrate(legacyDb, { migrationsFolder: legacyMigrationsFolder }),
    { applicationName: "visitecrm-legacy-prefix-test" },
  );
  const { rows: [legacyPrefixState] } = await legacyPool.query(
    "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
  );
  assert.equal(legacyPrefixState.count, constraintMigrationIndex);

  const legacyRecord = {
    referralId: "legacy-migration-referral",
    commissionId: "legacy-migration-commission",
    referralTenantId: "legacy-migration-referral-tenant",
    commissionTenantId: "legacy-migration-commission-tenant",
  };
  // The old production shape did not enforce the composite tenant/referral
  // relationship. Recreate that state so the later VALIDATED FK encounters
  // a genuine pre-existing cross-tenant row.
  await legacyPool.query(
    `ALTER TABLE "referral_commissions"
     DROP CONSTRAINT "referral_commissions_referral_id_fkey"`,
  );
  await legacyPool.query(
    `INSERT INTO "tenants" ("id", "name", "slug", "email")
     VALUES
       ($1, 'Legacy Referral Tenant', 'legacy-referral-tenant', 'legacy-referral@example.test'),
       ($2, 'Legacy Commission Tenant', 'legacy-commission-tenant', 'legacy-commission@example.test')`,
    [legacyRecord.referralTenantId, legacyRecord.commissionTenantId],
  );
  await legacyPool.query(
    `INSERT INTO "referrals" ("id", "tenant_id", "referrer_id", "code")
     VALUES ($1, $2, 'legacy-referrer', 'LEGACY-MIGRATION-CODE')`,
    [legacyRecord.referralId, legacyRecord.referralTenantId],
  );
  await legacyPool.query(
    `INSERT INTO "referral_commissions"
       ("id", "tenant_id", "referral_id", "referrer_id", "recipient_id", "amount", "basis")
     VALUES ($1, $2, $3, 'legacy-referrer', 'legacy-recipient', 25, 'legacy migration fixture')`,
    [legacyRecord.commissionId, legacyRecord.commissionTenantId, legacyRecord.referralId],
  );
  await writeFile(
    legacyJournalPath,
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, validationMigrationIndex) }, null, 2),
  );
  await runMigrationPipeline(
    legacyPool,
    legacyMigrationsFolder,
    async () => migrate(legacyDb, { migrationsFolder: legacyMigrationsFolder }),
    { applicationName: "visitecrm-legacy-unvalidated-test" },
  );
  const { rows: [legacyUnvalidatedState] } = await legacyPool.query(
    "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
  );
  assert.equal(legacyUnvalidatedState.count, validationMigrationIndex);

  await writeFile(legacyJournalPath, JSON.stringify(journal, null, 2));
  legacyStartupPool = new Pool({ connectionString: legacyUrl.toString() });
  legacyStartupPool.on("error", (error) => {
    console.error(`[legacy API startup test] isolated pool error: ${error.code ?? error.name}`);
  });
  const failedStartupDb = drizzle(legacyStartupPool);
  await assert.rejects(
    runMigrationPipeline(
      legacyStartupPool,
      legacyMigrationsFolder,
      async () => migrate(failedStartupDb, { migrationsFolder: legacyMigrationsFolder }),
      { applicationName: "visitecrm-api-migrations" },
    ),
    (error) => error?.cause?.code === "23503"
      && /referral_commissions_tenant_referral_validated_fkey/.test(error.cause.message),
  );
  await legacyStartupPool.end();
  legacyStartupPool = undefined;
  const { rows: [legacyCommissionAfterFailure] } = await legacyPool.query(
    `SELECT commission."tenant_id" AS "commissionTenantId",
            commission."referral_id" AS "referralId",
            referral."tenant_id" AS "referralTenantId"
     FROM "referral_commissions" AS commission
     JOIN "referrals" AS referral ON referral."id" = commission."referral_id"
     WHERE commission."id" = $1`,
    [legacyRecord.commissionId],
  );
  assert.deepEqual(legacyCommissionAfterFailure, {
    commissionTenantId: legacyRecord.commissionTenantId,
    referralId: legacyRecord.referralId,
    referralTenantId: legacyRecord.referralTenantId,
  });
  const { rows: [legacyFailureState] } = await legacyPool.query(`
    SELECT
      (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS applied_count,
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.referral_commissions'::regclass
          AND conname = 'referral_commissions_tenant_referral_fkey'
          AND NOT convalidated
      ) AS legacy_commission_fk_preserved,
      NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.referral_commissions'::regclass
          AND conname = 'referral_commissions_tenant_referral_validated_fkey'
      ) AS validated_commission_fk_rolled_back,
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.referral_bonus_reversals'::regclass
          AND conname = 'referral_bonus_reversals_tenant_referral_fkey'
          AND NOT convalidated
      ) AS legacy_reversal_fk_preserved,
      NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.referral_bonus_reversals'::regclass
          AND conname = 'referral_bonus_reversals_tenant_referral_validated_fkey'
      ) AS validated_reversal_fk_rolled_back
  `);
  assert.equal(legacyFailureState.applied_count, validationMigrationIndex);
  assert.equal(legacyFailureState.legacy_commission_fk_preserved, true);
  assert.equal(legacyFailureState.validated_commission_fk_rolled_back, true);
  assert.equal(legacyFailureState.legacy_reversal_fk_preserved, true);
  assert.equal(legacyFailureState.validated_reversal_fk_rolled_back, true);

  const { rowCount: repairedRows } = await legacyPool.query(
    `UPDATE "referral_commissions" SET "tenant_id" = $1 WHERE "id" = $2`,
    [legacyRecord.referralTenantId, legacyRecord.commissionId],
  );
  assert.equal(repairedRows, 1, "The legacy commission must be repairable without deleting it");
  // API startup calls runMigrations(), which uses this same pipeline and app
  // name. A fresh pool models the next service process after the failed boot.
  legacyStartupPool = new Pool({ connectionString: legacyUrl.toString() });
  legacyStartupPool.on("error", (error) => {
    console.error(`[legacy API recovery test] isolated pool error: ${error.code ?? error.name}`);
  });
  const recoveredStartupDb = drizzle(legacyStartupPool);
  await runMigrationPipeline(
    legacyStartupPool,
    legacyMigrationsFolder,
    async () => migrate(recoveredStartupDb, { migrationsFolder: legacyMigrationsFolder }),
    { applicationName: "visitecrm-api-migrations" },
  );
  const { rows: [legacyRecoveredState] } = await legacyPool.query(
    "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
  );
  assert.equal(legacyRecoveredState.count, journal.entries.length);
  const { rows: [legacyCommissionAfterRetry] } = await legacyPool.query(
    `SELECT commission."tenant_id" AS "commissionTenantId",
            commission."referral_id" AS "referralId",
            referral."tenant_id" AS "referralTenantId"
     FROM "referral_commissions" AS commission
     JOIN "referrals" AS referral ON referral."id" = commission."referral_id"
     WHERE commission."id" = $1`,
    [legacyRecord.commissionId],
  );
  assert.deepEqual(legacyCommissionAfterRetry, {
    commissionTenantId: legacyRecord.referralTenantId,
    referralId: legacyRecord.referralId,
    referralTenantId: legacyRecord.referralTenantId,
  });
  const { rows: [validatedLegacyConstraints] } = await legacyPool.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.referral_commissions'::regclass
          AND conname = 'referral_commissions_tenant_referral_validated_fkey'
          AND convalidated
      ) AS commission_fk_validated,
      EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.referral_bonus_reversals'::regclass
          AND conname = 'referral_bonus_reversals_tenant_referral_validated_fkey'
          AND convalidated
      ) AS reversal_fk_validated
  `);
  assert.equal(validatedLegacyConstraints.commission_fk_validated, true);
  assert.equal(validatedLegacyConstraints.reversal_fk_validated, true);
  console.log("A legacy row caused API startup migration to fail; a fresh runtime startup completed the repaired database without data loss.");

  await adminPool.query(`CREATE DATABASE "${timeoutDatabase}"`);
  testDatabases.push(timeoutDatabase);
  const timeoutUrl = new URL(adminUrl);
  timeoutUrl.pathname = `/${timeoutDatabase}`;
  const timeoutPoolUrl = timeoutUrl.toString();
  timeoutPool = new Pool({
    connectionString: timeoutPoolUrl,
    application_name: "visitecrm-timeout-original",
  });
  timeoutPool.on("error", (error) => {
    console.error(`[migration lock timeout test] isolated pool error: ${error.code ?? error.name}`);
  });
  const lockHolderUrl = new URL(timeoutPoolUrl);
  lockHolderUrl.searchParams.set("application_name", "visitecrm-migration-lock-holder-test");
  lockHolderPool = new Pool({ connectionString: lockHolderUrl.toString() });
  const lockHolder = await lockHolderPool.connect();
  const { rows: [lockHolderIdentity] } = await lockHolder.query("SELECT pg_backend_pid() AS pid");
  await lockHolder.query("SELECT pg_advisory_lock(hashtext('visitecrm:apply-migrations'))");

  const previousTimeout = process.env.MIGRATION_LOCK_TIMEOUT_MS;
  process.env.MIGRATION_LOCK_TIMEOUT_MS = "3000";
  try {
    const runtimeTimeout = runMigrationPipeline(timeoutPool, migrationsFolder, async () => {
      assert.fail("runtime migration must not start without acquiring its advisory lock");
    }, { applicationName: "visitecrm-runtime-timeout-test" });
    const timeoutMigrationPid = await findMigrationSessionPid(
      timeoutDatabase,
      "visitecrm-runtime-timeout-test",
    );
    await assert.rejects(
      runtimeTimeout,
      (error) => error.code === "ERR_MIGRATION_LOCK_TIMEOUT"
        && /MIGRATION_LOCK_TIMEOUT_MS/.test(error.message)
        && error.blockers.some((blocker) => blocker.pid === lockHolderIdentity.pid
          && blocker.applicationName === "visitecrm-migration-lock-holder-test"),
    );
    await assertIdlePoolSessionHasApplicationName(timeoutMigrationPid, "visitecrm-timeout-original");
    let { rows } = await timeoutPool.query(
      "SELECT count(*)::int AS count FROM pg_catalog.pg_tables WHERE schemaname = 'public'",
    );
    assert.equal(rows[0].count, 0, "Runtime timeout must leave the public schema untouched");

    const cliTimeout = await runCliMigrationWithTimeout(timeoutPoolUrl, 3000);
    assert.notEqual(cliTimeout.code, 0, "CLI migration must fail when its lock wait expires");
    assert.match(cliTimeout.output, /MIGRATION_LOCK_TIMEOUT_MS/);
    assert.match(cliTimeout.output, /did not prepare or apply migrations/);
    assert.match(cliTimeout.output, new RegExp(`pid=${lockHolderIdentity.pid}, application_name=visitecrm-migration-lock-holder-test`));
    assert.doesNotMatch(cliTimeout.output, /postgres(?:ql)?:\/\//);
    assert.doesNotMatch(cliTimeout.output, /SELECT /i);
    ({ rows } = await timeoutPool.query(
      "SELECT count(*)::int AS count FROM pg_catalog.pg_tables WHERE schemaname = 'public'",
    ));
    assert.equal(rows[0].count, 0, "CLI timeout must leave the public schema untouched");

    const runtimeWaitWarnings = [];
    const originalConsoleWarn = console.warn;
    console.warn = (...args) => runtimeWaitWarnings.push(args.join(" "));
    try {
      const runtimeMigrationAfterRelease = runMigrationPipeline(
        timeoutPool,
        migrationsFolder,
        () => migrate(drizzle(timeoutPool), { migrationsFolder }),
        { applicationName: "visitecrm-runtime-normal-release-test" },
      );
      // The wait log interval is one third of the configured 3000 ms timeout.
      // Hold the lock beyond one interval so the periodic warning is observable.
      const releaseLock = delay(1200).then(() =>
        lockHolder.query("SELECT pg_advisory_unlock(hashtext('visitecrm:apply-migrations'))"),
      );
      await Promise.all([runtimeMigrationAfterRelease, releaseLock]);
    } finally {
      console.warn = originalConsoleWarn;
    }
    assert.ok(
      runtimeWaitWarnings.some((warning) => /waiting for the database migration lock/.test(warning)),
      "Runtime startup must announce that it is waiting",
    );
    assert.ok(
      runtimeWaitWarnings.some((warning) => /still waiting for the database migration lock .*elapsed=\d+ms/.test(warning)),
      "Runtime startup must periodically report elapsed wait time",
    );
    assert.doesNotMatch(runtimeWaitWarnings.join("\n"), /postgres(?:ql)?:\/\/|SELECT |password|DATABASE_URL/i);
    console.log("CLI and API startup waits report safe elapsed-time updates and resume after lock release.");
  } finally {
    if (previousTimeout === undefined) delete process.env.MIGRATION_LOCK_TIMEOUT_MS;
    else process.env.MIGRATION_LOCK_TIMEOUT_MS = previousTimeout;
    await lockHolder.query("SELECT pg_advisory_unlock(hashtext('visitecrm:apply-migrations'))");
    lockHolder.release();
  }
} finally {
  if (previousStartupLockTimeout === undefined) delete process.env.MIGRATION_LOCK_TIMEOUT_MS;
  else process.env.MIGRATION_LOCK_TIMEOUT_MS = previousStartupLockTimeout;
  if (cliProcess && cliProcess.exitCode === null) {
    cliProcess.kill("SIGTERM");
  }
  if (crashHolderProcess && crashHolderProcess.exitCode === null && crashHolderProcess.signalCode === null) {
    crashHolderProcess.kill("SIGKILL");
    await new Promise((resolveExit) => crashHolderProcess.once("exit", resolveExit));
  }
  if (apiStartupProcess && apiStartupProcess.child.exitCode === null && apiStartupProcess.child.signalCode === null) {
    apiStartupProcess.child.kill("SIGKILL");
    await new Promise((resolveExit) => apiStartupProcess.child.once("exit", resolveExit));
  }
  await Promise.all([runtimePool, timeoutPool, recoveryPool, crashPool, apiStartupPool, trackingPool, legacyPool, publishPool, legacyStartupPool, lockHolderPool].filter(Boolean).map((pool) => pool.end()));
  try {
    for (const database of testDatabases) {
      let remainingConnections = 0;
      const deadline = Date.now() + 5000;
      do {
        const { rows } = await adminPool.query(
          "SELECT count(*)::int AS count FROM pg_catalog.pg_stat_activity WHERE datname = $1",
          [database],
        );
        remainingConnections = rows[0].count;
        if (remainingConnections === 0) break;
        await delay(25);
      } while (Date.now() < deadline);
      assert.equal(remainingConnections, 0, "All test database connections must close before cleanup");
      await adminPool.query(`DROP DATABASE IF EXISTS "${database}"`);
    }
  } finally {
    if (recoveryTempDirectory) {
      await rm(recoveryTempDirectory, { recursive: true, force: true });
    }
    await adminPool.end();
  }
}