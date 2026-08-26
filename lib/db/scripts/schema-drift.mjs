#!/usr/bin/env node
/**
 * Reproducible local schema-drift entry point.
 *
 * Modes:
 *   schema-drift                  static checks + live DB verification
 *   schema-drift --static-only    static checks without DATABASE_URL
 *   schema-drift --live-only      live DB verification only
 *
 * Exit codes:
 *   0 = all requested checks passed
 *   1 = static migration check failed
 *   2 = DATABASE_URL is missing
 *   3 = the live database could not be reached or queried
 *   4 = live schema differs from the Drizzle snapshot and incremental migrations
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXIT = {
  OK: 0,
  STATIC: 1,
  CONFIG: 2,
  CONNECTION: 3,
  DIVERGENCE: 4,
};

const rawArgs = process.argv.slice(2);
if (rawArgs[0] === "--") rawArgs.shift();
const args = new Set(rawArgs);
const validArgs = new Set(["--static-only", "--live-only"]);
const invalidArgs = [...args].filter((arg) => !validArgs.has(arg));
const staticOnly = args.has("--static-only");
const liveOnly = args.has("--live-only");

if (invalidArgs.length > 0 || (staticOnly && liveOnly)) {
  console.error(
    "Uso: node scripts/schema-drift.mjs [--static-only|--live-only]",
  );
  process.exit(EXIT.STATIC);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = join(__dirname, "..");

function runStep(label, command, commandArgs, env = {}) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, commandArgs, {
    cwd: packageDir,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });

  if (result.error) {
    console.error(
      `SCHEMA_DRIFT_STATIC_ERROR: ${label} could not start (${result.error.message}).`,
    );
    return false;
  }
  if (result.status !== 0) {
    console.error(
      `SCHEMA_DRIFT_STATIC_ERROR: ${label} failed with exit code ${result.status ?? "unknown"}.`,
    );
    return false;
  }
  return true;
}

function runStaticChecks() {
  const steps = [
    [
      "migration consistency",
      "pnpm",
      ["exec", "drizzle-kit", "check", "--config", "./drizzle.config.ts"],
    ],
    [
      "baseline coverage",
      process.execPath,
      ["scripts/validate-coverage.mjs"],
    ],
    [
      "snapshot column coverage",
      process.execPath,
      ["scripts/validate-columns.mjs"],
    ],
    [
      "table and column coverage",
      process.execPath,
      ["scripts/validate-tables.mjs"],
    ],
  ];

  for (const [label, command, commandArgs] of steps) {
    if (
      !runStep(label, command, commandArgs, {
        // drizzle-kit check only needs the local migration files. This keeps
        // static validation independent from any database-diff endpoint.
        DRIZZLE_SCHEMA_ONLY: "1",
      })
    ) {
      return false;
    }
  }

  console.log("\nSCHEMA_DRIFT_STATIC_OK: local migration checks passed.");
  return true;
}

if (!liveOnly && !runStaticChecks()) {
  process.exit(EXIT.STATIC);
}

if (staticOnly) {
  process.exit(EXIT.OK);
}

if (!process.env.DATABASE_URL) {
  console.error(
    "SCHEMA_DRIFT_CONFIG_ERROR: DATABASE_URL is not set. Use --static-only for checks that do not require a database.",
  );
  process.exit(EXIT.CONFIG);
}

const liveResult = spawnSync(
  process.execPath,
  ["scripts/verify-db-columns.mjs"],
  {
    cwd: packageDir,
    env: process.env,
    stdio: "inherit",
  },
);

if (liveResult.error || liveResult.status === 3) {
  process.exit(EXIT.CONNECTION);
}
if (liveResult.status === 2) {
  process.exit(EXIT.CONFIG);
}
if (liveResult.status === 4) {
  process.exit(EXIT.DIVERGENCE);
}
if (liveResult.status !== 0) {
  process.exit(EXIT.STATIC);
}

console.log("\nSCHEMA_DRIFT_OK: static and live schema checks passed.");