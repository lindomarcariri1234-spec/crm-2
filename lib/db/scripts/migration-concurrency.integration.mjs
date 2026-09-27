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
const adminPool = new Pool({ connectionString: adminUrl });
let runtimePool;
let cliProcess;

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
      ) AS waiting`,
      [testDatabase],
    );
    if (rows[0].waiting) {
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
} finally {
  if (cliProcess && cliProcess.exitCode === null) {
    cliProcess.kill("SIGTERM");
  }
  await runtimePool?.end();
  try {
    let remainingConnections = 0;
    const deadline = Date.now() + 5000;
    do {
      const { rows } = await adminPool.query(
        "SELECT count(*)::int AS count FROM pg_catalog.pg_stat_activity WHERE datname = $1",
        [testDatabase],
      );
      remainingConnections = rows[0].count;
      if (remainingConnections === 0) break;
      await delay(25);
    } while (Date.now() < deadline);
    assert.equal(remainingConnections, 0, "All test database connections must close before cleanup");
    await adminPool.query(`DROP DATABASE IF EXISTS "${testDatabase}"`);
  } finally {
    await adminPool.end();
  }
}