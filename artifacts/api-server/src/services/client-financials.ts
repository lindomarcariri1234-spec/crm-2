import { db, clientsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

type ClientFinancialExecutor = Pick<typeof db, "execute" | "update">;

/**
 * Rebuilds the denormalized client financial snapshot from receivable
 * payments. The executor argument lets payment writes and this snapshot share
 * one transaction when the caller already owns one.
 */
export async function recalculateClientFinancials(
  clientId: string,
  tenantId: string,
  executor: ClientFinancialExecutor = db,
): Promise<void> {
  const result = await executor.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN status = 'paid' THEN amount::numeric ELSE 0 END), 0) AS total_spent,
      COALESCE(SUM(CASE WHEN status IN ('pending', 'overdue') THEN amount::numeric ELSE 0 END), 0) AS outstanding_balance
    FROM payments
    WHERE client_id = ${clientId}
      AND tenant_id = ${tenantId}
      AND type = 'receivable'
  `);
  const row = (result as unknown as { rows: Array<{ total_spent: string; outstanding_balance: string }> }).rows[0];
  if (!row) return;

  await executor.update(clientsTable).set({
    totalSpent: row.total_spent,
    outstandingBalance: row.outstanding_balance,
  }).where(and(
    eq(clientsTable.id, clientId),
    eq(clientsTable.tenantId, tenantId),
  ));
}