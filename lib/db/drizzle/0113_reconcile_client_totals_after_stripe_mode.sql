WITH client_totals AS (
  SELECT
    c."id",
    c."tenant_id",
    COALESCE(SUM(p."amount"::numeric) FILTER (WHERE p."status" = 'paid'), 0) AS "total_spent",
    COALESCE(
      SUM(p."amount"::numeric) FILTER (WHERE p."status" IN ('pending', 'overdue')),
      0
    ) AS "outstanding_balance"
  FROM "clients" AS c
  LEFT JOIN "payments" AS p
    ON p."client_id" = c."id"
    AND p."tenant_id" = c."tenant_id"
    AND p."type" = 'receivable'
    AND p."is_test_mode" = false
  GROUP BY c."id", c."tenant_id"
)
UPDATE "clients" AS c
SET
  "total_spent" = client_totals."total_spent",
  "outstanding_balance" = client_totals."outstanding_balance"
FROM client_totals
WHERE c."id" = client_totals."id"
  AND c."tenant_id" = client_totals."tenant_id";
