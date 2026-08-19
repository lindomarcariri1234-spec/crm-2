import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { db, tenantsTable } from "@workspace/db";
import { localToday } from "@workspace/shared";

const TRIP_TYPE_CODES: Record<string, string> = {
  excursion: "EXC",
  excursao: "EXC",
  package: "PCT",
  pacote: "PCT",
  day_trip: "BTV",
  bate_volta: "BTV",
  "bate-e-volta": "BTV",
  "bate-volta": "BTV",
};

export function tripTypeToCode(tripType: string | null | undefined): string {
  if (!tripType) return "RES";
  return TRIP_TYPE_CODES[tripType.toLowerCase()] ?? "RES";
}

export function derivePrefix(slug: string, name?: string | null): string {
  const source = slug || name || "AGE";
  const clean = source.replace(/[^a-zA-Z]/g, "").toUpperCase();
  return clean.slice(0, 3) || "AGE";
}

export function getYearMonth(date?: Date): string {
  if (!date) {
    // Use Brazil calendar so reservation numbers get the correct BRT month at 21h-midnight
    const today = localToday(); // "YYYY-MM-DD"
    return today.slice(0, 7).replace("-", ""); // "YYYYMM"
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}${month}`;
}

export async function getTenantReservationPrefix(tenantId: string): Promise<string> {
  const [tenant] = await db
    .select({ reservationPrefix: tenantsTable.reservationPrefix, slug: tenantsTable.slug, name: tenantsTable.name })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);

  if (!tenant) return "AGE";

  if (tenant.reservationPrefix) {
    return tenant.reservationPrefix.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 5) || "AGE";
  }

  return derivePrefix(tenant.slug, tenant.name);
}

export async function nextReservationSequence(
  tenantId: string,
  yearMonth: string,
  typeCode: string,
  tx: { execute: (query: ReturnType<typeof sql>) => Promise<unknown> }
): Promise<number> {
  const result = await tx.execute(sql`
    INSERT INTO reservation_sequences (tenant_id, year_month, type_code, last_num)
    VALUES (${tenantId}, ${yearMonth}, ${typeCode}, 1)
    ON CONFLICT (tenant_id, year_month, type_code)
    DO UPDATE SET last_num = reservation_sequences.last_num + 1
    RETURNING last_num
  `);
  const rows = (result as unknown as { rows: Array<{ last_num: number }> }).rows;
  return rows[0]?.last_num ?? 1;
}

export function buildReservationNumber(prefix: string, typeCode: string, yearMonth: string, seq: number): string {
  return `${prefix}-${typeCode}-${yearMonth}-${String(seq).padStart(5, "0")}`;
}
