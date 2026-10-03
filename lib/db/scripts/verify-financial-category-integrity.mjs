export const FINANCIAL_CATEGORY_MIGRATION_WHEN = 1809960001000;

const CANONICAL_CATEGORIES_SQL =
  "ARRAY['Transporte', 'Hospedagem', 'Alimentação', 'Marketing', 'Administrativo', 'Comissão', 'Outro']::text[]";

const MIGRATION_TABLE_QUERY =
  "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present";

const TOTALS_QUERY = `
  SELECT
    (
      SELECT count(*)::text
      FROM public.expenses
      WHERE NOT COALESCE(category = ANY(${CANONICAL_CATEGORIES_SQL}), false)
    ) AS expenses,
    (
      SELECT count(*)::text
      FROM public.trip_costs
      WHERE NOT COALESCE(category = ANY(${CANONICAL_CATEGORIES_SQL}), false)
    ) AS trip_costs,
    (
      SELECT count(*)::text
      FROM public.trips AS trip
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN json_typeof(trip.fixed_costs) = 'array' THEN trip.fixed_costs::jsonb
          ELSE '[]'::jsonb
        END
      ) AS item(value)
      WHERE NOT COALESCE(item.value->>'category' = ANY(${CANONICAL_CATEGORIES_SQL}), false)
    ) AS fixed_costs,
    (
      SELECT count(*)::text
      FROM public.trips AS trip
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN json_typeof(trip.variable_costs) = 'array' THEN trip.variable_costs::jsonb
          ELSE '[]'::jsonb
        END
      ) AS item(value)
      WHERE NOT COALESCE(item.value->>'category' = ANY(${CANONICAL_CATEGORIES_SQL}), false)
    ) AS variable_costs
`;

function toCount(value, field) {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`integrity_check_invalid_count:${field}`);
  }
  return count;
}

function firstRow(result) {
  if (!result || !Array.isArray(result.rows) || !result.rows[0]) {
    throw new Error("integrity_check_missing_query_result");
  }
  return result.rows[0];
}

/**
 * Checks the applied migration watermark and aggregate category counts.
 * `query` is injected so the same verifier can run from API startup, the
 * Vercel migration step, and isolated tests without exposing row-level data.
 */
export async function verifyFinancialCategoryIntegrity(query) {
  if (typeof query !== "function") {
    throw new TypeError("integrity_check_query_required");
  }

  const migrationTable = firstRow(await query(MIGRATION_TABLE_QUERY));
  let migrationApplied = false;

  if (migrationTable.present === true || migrationTable.present === "t") {
    const migration = firstRow(await query(
      `SELECT EXISTS (
         SELECT 1
         FROM drizzle.__drizzle_migrations
         WHERE created_at = ${FINANCIAL_CATEGORY_MIGRATION_WHEN}
       ) AS applied`,
    ));
    migrationApplied = migration.applied === true || migration.applied === "t";
  }

  const counts = firstRow(await query(TOTALS_QUERY));
  const totals = {
    expenses: toCount(counts.expenses, "expenses"),
    trip_costs: toCount(counts.trip_costs, "trip_costs"),
    fixed_costs: toCount(counts.fixed_costs, "fixed_costs"),
    variable_costs: toCount(counts.variable_costs, "variable_costs"),
  };

  return {
    migrationStatus: migrationApplied ? "applied" : "missing",
    totals,
    needsAlert:
      !migrationApplied ||
      Object.values(totals).some((count) => count > 0),
  };
}