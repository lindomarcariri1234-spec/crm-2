import { performance } from "node:perf_hooks";
import pg from "pg";
import {
  DEFAULT_FINANCIAL_CATEGORY_INTEGRITY_TIMEOUT_MS,
  FINANCIAL_CATEGORY_MIGRATION_WHEN,
  verifyFinancialCategoryIntegrity,
  verifyFinancialCategoryIntegrityInReadOnlyTransaction,
} from "./verify-financial-category-integrity.mjs";

const REQUIRED_DATABASE_NAME = "financial_integrity_benchmark";
const DEFAULT_VOLUMES = [1_000, 10_000, 50_000, 100_000];
const DEFAULT_SAMPLES = 3;
const DEFAULT_BUDGET_MS = 2_500;
const MAX_ROWS_PER_TABLE = 1_000_000;

function parseInteger(value, field, { min, max }) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`benchmark_invalid_${field}`);
  }
  return parsed;
}

function benchmarkVolumes() {
  const configured = process.env["FINANCIAL_CATEGORY_BENCH_VOLUMES"];
  if (!configured) return DEFAULT_VOLUMES;

  const volumes = configured.split(",").map((value) =>
    parseInteger(value.trim(), "volume", {
      min: 1,
      max: MAX_ROWS_PER_TABLE,
    }),
  );
  if (
    volumes.length < 2 ||
    volumes.some((value, index) => index > 0 && value <= volumes[index - 1])
  ) {
    throw new Error("benchmark_volumes_must_be_strictly_increasing");
  }
  return volumes;
}

function isLoopbackAddress(address) {
  return (
    address === null ||
    address === "::1" ||
    address.startsWith("127.") ||
    address.startsWith("::ffff:127.")
  );
}

async function assertDisposableLocalDatabase(client) {
  const result = await client.query(
    `SELECT
       current_database() AS database_name,
       inet_server_addr()::text AS server_address,
       pg_is_in_recovery() AS is_replica`,
  );
  const row = result.rows[0];
  if (row?.database_name !== REQUIRED_DATABASE_NAME) {
    throw new Error(
      `benchmark_refusing_database; use a disposable local database named ${REQUIRED_DATABASE_NAME}`,
    );
  }
  const serverAddress = row.server_address;
  if (
    serverAddress !== null &&
    (typeof serverAddress !== "string" || !isLoopbackAddress(serverAddress))
  ) {
    throw new Error("benchmark_refusing_non_local_database");
  }
  if (row.is_replica !== false && row.is_replica !== "f") {
    throw new Error("benchmark_refusing_replica_database");
  }
}

async function createTemporaryTables(client) {
  await client.query(
    "CREATE TEMP TABLE expenses (category text NOT NULL, row_padding text NOT NULL)",
  );
  await client.query(
    "CREATE TEMP TABLE trip_costs (category text NOT NULL, row_padding text NOT NULL)",
  );
  await client.query(
    "CREATE TEMP TABLE trips (fixed_costs json NOT NULL, variable_costs json NOT NULL, row_padding text NOT NULL)",
  );
  await client.query(
    "CREATE TEMP TABLE __drizzle_migrations (created_at bigint NOT NULL)",
  );
  await client.query(
    "INSERT INTO pg_temp.__drizzle_migrations (created_at) VALUES ($1)",
    [FINANCIAL_CATEGORY_MIGRATION_WHEN],
  );
}

async function populateVolume(client, volume) {
  await client.query(
    "TRUNCATE pg_temp.expenses, pg_temp.trip_costs, pg_temp.trips",
  );
  await client.query(
    `INSERT INTO pg_temp.expenses (category, row_padding)
     SELECT
       CASE WHEN entry.number % 101 = 0 THEN 'legacy category' ELSE 'Transporte' END,
       repeat('x', 256)
     FROM generate_series(1, $1::integer) AS entry(number)`,
    [volume],
  );
  await client.query(
    `INSERT INTO pg_temp.trip_costs (category, row_padding)
     SELECT
       CASE WHEN entry.number % 97 = 0 THEN 'legacy category' ELSE 'Hospedagem' END,
       repeat('x', 256)
     FROM generate_series(1, $1::integer) AS entry(number)`,
    [volume],
  );
  await client.query(
    `INSERT INTO pg_temp.trips (fixed_costs, variable_costs, row_padding)
     SELECT
       json_build_array(
         json_build_object(
           'category',
           CASE WHEN entry.number % 89 = 0 THEN 'legacy category' ELSE 'Transporte' END,
           'amount',
           entry.number % 100 + 1
         ),
         json_build_object(
           'category',
           'Alimentação',
           'amount',
           entry.number % 50 + 1
         ),
         json_build_object(
           'category',
           CASE WHEN entry.number % 97 = 0 THEN 'legacy category' ELSE 'Comissão' END,
           'amount',
           entry.number % 25 + 1
         )
       ),
       json_build_array(
         json_build_object(
           'category',
           CASE WHEN entry.number % 101 = 0 THEN 'legacy category' ELSE 'Marketing' END,
           'amountPax',
           entry.number % 10 + 1
         ),
         json_build_object(
           'category',
           'Outro',
           'amountPax',
           entry.number % 5 + 1
         )
       ),
       repeat('x', 256)
     FROM generate_series(1, $1::integer) AS entry(number)`,
    [volume],
  );

  await client.query("ANALYZE pg_temp.expenses");
  await client.query("ANALYZE pg_temp.trip_costs");
  await client.query("ANALYZE pg_temp.trips");
}

function remapTemporarySchema(statement) {
  return statement
    .replaceAll("public.expenses", "pg_temp.expenses")
    .replaceAll("public.trip_costs", "pg_temp.trip_costs")
    .replaceAll("public.trips", "pg_temp.trips")
    .replaceAll("drizzle.__drizzle_migrations", "pg_temp.__drizzle_migrations");
}

function expectedTotals(volume) {
  return {
    expenses: Math.floor(volume / 101),
    trip_costs: Math.floor(volume / 97),
    fixed_costs: Math.floor(volume / 89) + Math.floor(volume / 97),
    variable_costs: Math.floor(volume / 101),
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function benchmarkVolume(client, volume, samples, budgetMs) {
  await populateVolume(client, volume);
  const durations = [];

  for (let sample = 0; sample < samples; sample += 1) {
    const startedAt = performance.now();
    const result = await verifyFinancialCategoryIntegrityInReadOnlyTransaction(
      client,
      (query) =>
        verifyFinancialCategoryIntegrity((statement) =>
          query(remapTemporarySchema(statement)),
        ),
      {
        timeoutMs: DEFAULT_FINANCIAL_CATEGORY_INTEGRITY_TIMEOUT_MS,
      },
    );
    durations.push(performance.now() - startedAt);

    if (
      result.migrationStatus !== "applied" ||
      JSON.stringify(result.totals) !== JSON.stringify(expectedTotals(volume))
    ) {
      throw new Error("benchmark_aggregate_result_mismatch");
    }
  }

  const medianMs = median(durations);
  const maxMs = Math.max(...durations);
  console.log(
    JSON.stringify({
      rowsPerTable: volume,
      samples,
      medianMs: Math.round(medianMs * 100) / 100,
      maxMs: Math.round(maxMs * 100) / 100,
      budgetMs,
      status: maxMs <= budgetMs ? "PASS" : "BUDGET_EXCEEDED",
    }),
  );

  return maxMs <= budgetMs;
}

async function main() {
  const connectionString = process.env["FINANCIAL_CATEGORY_BENCH_DATABASE_URL"];
  if (!connectionString) {
    throw new Error(
      `set FINANCIAL_CATEGORY_BENCH_DATABASE_URL to a disposable local ${REQUIRED_DATABASE_NAME} database`,
    );
  }
  if (process.env["FINANCIAL_CATEGORY_BENCH_CONFIRM_DISPOSABLE"] !== "YES") {
    throw new Error(
      "set FINANCIAL_CATEGORY_BENCH_CONFIRM_DISPOSABLE=YES to confirm the target is disposable",
    );
  }

  const volumes = benchmarkVolumes();
  const samples = parseInteger(
    process.env["FINANCIAL_CATEGORY_BENCH_SAMPLES"] ?? DEFAULT_SAMPLES,
    "samples",
    { min: 1, max: 10 },
  );
  const budgetMs = parseInteger(
    process.env["FINANCIAL_CATEGORY_BENCH_BUDGET_MS"] ?? DEFAULT_BUDGET_MS,
    "budget_ms",
    { min: 1, max: DEFAULT_FINANCIAL_CATEGORY_INTEGRITY_TIMEOUT_MS },
  );

  const client = new pg.Client({ connectionString });
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await assertDisposableLocalDatabase(client);
    await createTemporaryTables(client);

    let allWithinBudget = true;
    for (const volume of volumes) {
      allWithinBudget =
        (await benchmarkVolume(client, volume, samples, budgetMs)) &&
        allWithinBudget;
    }
    if (!allWithinBudget) {
      throw new Error(
        `integrity_check_budget_exceeded:${budgetMs}ms; optimize the aggregate scans or JSON expansion before increasing the budget`,
      );
    }
  } finally {
    if (connected) await client.end();
  }
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : "unknown benchmark failure";
  console.error(`[financial-integrity-benchmark] ${message}`);
  process.exitCode = 1;
});