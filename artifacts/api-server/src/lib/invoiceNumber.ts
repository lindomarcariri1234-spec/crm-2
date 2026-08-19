import { db, invoicesTable } from "@workspace/db";
import { eq, count, sql } from "drizzle-orm";

export async function generateInvoiceNumber(tenantId: string, year: number): Promise<string> {
  const [row] = await db
    .select({ cnt: count() })
    .from(invoicesTable)
    .where(eq(invoicesTable.tenantId, tenantId));
  const seq = (row?.cnt ?? 0) + 1;
  return `INV-${year}-${String(seq).padStart(4, "0")}`;
}
