import assert from "node:assert/strict";
import test from "node:test";
import {
  FINANCIAL_CATEGORY_MIGRATION_WHEN,
  verifyFinancialCategoryIntegrity,
} from "./verify-financial-category-integrity.mjs";

const cleanTotals = {
  expenses: "0",
  trip_costs: "0",
  fixed_costs: "0",
  variable_costs: "0",
};

function makeQuery({ migrationTable = true, migrationApplied = true, totals = cleanTotals } = {}) {
  const statements = [];
  const query = async (statement) => {
    statements.push(statement);
    if (statement.includes("to_regclass")) {
      return { rows: [{ present: migrationTable }] };
    }
    if (statement.includes("created_at")) {
      return { rows: [{ applied: migrationApplied }] };
    }
    return { rows: [totals] };
  };
  return { query, statements };
}

test("passes when migration 0101 is applied and all four totals are zero", async () => {
  const { query } = makeQuery();

  const result = await verifyFinancialCategoryIntegrity(query);

  assert.deepEqual(result, {
    migrationStatus: "applied",
    totals: {
      expenses: 0,
      trip_costs: 0,
      fixed_costs: 0,
      variable_costs: 0,
    },
    needsAlert: false,
  });
});

test("flags a missing migration even when all category totals are zero", async () => {
  const { query, statements } = makeQuery({
    migrationTable: false,
    migrationApplied: false,
  });

  const result = await verifyFinancialCategoryIntegrity(query);

  assert.equal(result.migrationStatus, "missing");
  assert.equal(result.needsAlert, true);
  assert.equal(statements.some((statement) => statement.includes("created_at")), false);
});

test("flags any nonzero total and returns only aggregate counts", async () => {
  const { query, statements } = makeQuery({
    totals: {
      expenses: "0",
      trip_costs: "2",
      fixed_costs: "0",
      variable_costs: "1",
    },
  });

  const result = await verifyFinancialCategoryIntegrity(query);

  assert.equal(result.needsAlert, true);
  assert.deepEqual(result.totals, {
    expenses: 0,
    trip_costs: 2,
    fixed_costs: 0,
    variable_costs: 1,
  });
  const checkedSql = statements.join("\n").toLowerCase();
  assert.match(checkedSql, /count\(\*\)/);
  assert.doesNotMatch(checkedSql, /\bdescription\b|\btenant_id\b|\bclient_id\b/);
});

test("uses the migration journal watermark configured for migration 0101", async () => {
  const { query, statements } = makeQuery({ migrationApplied: false });

  await verifyFinancialCategoryIntegrity(query);

  assert.ok(statements.some((statement) => statement.includes(String(FINANCIAL_CATEGORY_MIGRATION_WHEN))));
});

test("rejects invalid count data instead of silently treating it as zero", async () => {
  const { query } = makeQuery({
    totals: { ...cleanTotals, fixed_costs: "not-a-count" },
  });

  await assert.rejects(
    () => verifyFinancialCategoryIntegrity(query),
    /integrity_check_invalid_count:fixed_costs/,
  );
});