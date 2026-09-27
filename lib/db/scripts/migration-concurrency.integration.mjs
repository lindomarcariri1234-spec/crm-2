import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
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
const adminPool = new Pool({ connectionString: adminUrl });
let runtimePool;
let timeoutPool;
let lockHolderPool;
let cliProcess;
const testDatabases = [testDatabase];

function runCliMigration(databaseUrl) {
  return new Promise((resolveRun, rejectRun) => {
    cliProcess = spawn(
      "pnpm",
      ["--filter", "@workspace/db", "run", "migrate"],
      {
        cwd: workspaceRoot,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "inherit",
      },
    );
    cliProcess.once("error", rejectRun);
    cliProcess.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
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

try {
  await adminPool.query(`CREATE DATABASE "${testDatabase}"`);
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${testDatabase}`;
  const databaseUrl = testUrl.toString();
  runtimePool = new Pool({ connectionString: databaseUrl });
  runtimePool.on("error", (error) => {
    console.error(`[migration concurrency test] isolated pool error: ${error.code ?? error.name}`);
  });
  const runtimeDb = drizzle(runtimePool);

  let signalRuntimeHasLock;
  const runtimeHasLock = new Promise((resolveSignal) => {
    signalRuntimeHasLock = resolveSignal;
  });
  const runtimeMigration = runMigrationPipeline(
    runtimePool,
    migrationsFolder,
    async () => {
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
  const cliMigration = runCliMigration(databaseUrl);

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

  await Promise.all([runtimeMigration, cliMigration]);
  const { rows: appliedRows } = await runtimePool.query(
    "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
  );
  const journal = JSON.parse(await readFile(
    resolve(migrationsFolder, "meta/_journal.json"),
    "utf8",
  ));
  assert.equal(appliedRows[0].count, journal.entries.length);
  console.log(`Concurrent CLI/API startup applied ${journal.entries.length} migrations exactly once.`);

  await adminPool.query(`CREATE DATABASE "${timeoutDatabase}"`);
  testDatabases.push(timeoutDatabase);
  const timeoutUrl = new URL(adminUrl);
  timeoutUrl.pathname = `/${timeoutDatabase}`;
  const timeoutPoolUrl = timeoutUrl.toString();
  timeoutPool = new Pool({ connectionString: timeoutPoolUrl });
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
  process.env.MIGRATION_LOCK_TIMEOUT_MS = "100";
  try {
    await assert.rejects(
      runMigrationPipeline(timeoutPool, migrationsFolder, async () => {
        assert.fail("runtime migration must not start without acquiring its advisory lock");
      }),
      (error) => error.code === "ERR_MIGRATION_LOCK_TIMEOUT"
        && /MIGRATION_LOCK_TIMEOUT_MS/.test(error.message)
        && error.blockers.some((blocker) => blocker.pid === lockHolderIdentity.pid
          && blocker.applicationName === "visitecrm-migration-lock-holder-test"),
      { applicationName: "visitecrm-runtime-timeout-test" },
    );
    let { rows } = await timeoutPool.query(
      "SELECT count(*)::int AS count FROM pg_catalog.pg_tables WHERE schemaname = 'public'",
    );
    assert.equal(rows[0].count, 0, "Runtime timeout must leave the public schema untouched");

    const cliTimeout = await runCliMigrationWithTimeout(timeoutPoolUrl, 100);
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
    console.log("CLI and runtime migration lock timeouts failed clearly without schema changes.");
  } finally {
    if (previousTimeout === undefined) delete process.env.MIGRATION_LOCK_TIMEOUT_MS;
    else process.env.MIGRATION_LOCK_TIMEOUT_MS = previousTimeout;
    await lockHolder.query("SELECT pg_advisory_unlock(hashtext('visitecrm:apply-migrations'))");
    lockHolder.release();
  }
} finally {
  if (cliProcess && cliProcess.exitCode === null) {
    cliProcess.kill("SIGTERM");
  }
  await Promise.all([runtimePool, timeoutPool, lockHolderPool].filter(Boolean).map((pool) => pool.end()));
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
    await adminPool.end();
  }
}