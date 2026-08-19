import { db, clientsTable } from "@workspace/db";
import { eq, and, ilike } from "drizzle-orm";
import { sql } from "drizzle-orm";

export interface SegmentCriteria {
  gender?: string;
  ageMin?: number;
  ageMax?: number;
  inactiveDays?: number;
  tier?: string;
  minPurchaseScore?: number;
  maxChurnScore?: number;
  city?: string;
  origin?: string;
  tag?: string;
  tripId?: string;
  classification?: string;
  status?: string;
  travelPreference?: string;
}

type WhereArg = Parameters<typeof and>[0];

export async function resolveSegment(
  tenantId: string,
  criteria: SegmentCriteria
): Promise<{ count: number; clientIds: string[] }> {
  const conditions: WhereArg[] = [eq(clientsTable.tenantId, tenantId)];

  if (criteria.gender) {
    conditions.push(eq(clientsTable.gender, criteria.gender));
  }
  if (criteria.ageMin !== undefined) {
    conditions.push(
      sql`${clientsTable.birthDate} IS NOT NULL AND EXTRACT(YEAR FROM AGE(${clientsTable.birthDate})) >= ${criteria.ageMin}` as unknown as WhereArg
    );
  }
  if (criteria.ageMax !== undefined) {
    conditions.push(
      sql`${clientsTable.birthDate} IS NOT NULL AND EXTRACT(YEAR FROM AGE(${clientsTable.birthDate})) <= ${criteria.ageMax}` as unknown as WhereArg
    );
  }
  if (criteria.city) {
    conditions.push(ilike(clientsTable.addressCity, `%${criteria.city}%`));
  }
  if (criteria.origin) {
    conditions.push(ilike(clientsTable.origin, `%${criteria.origin}%`));
  }
  if (criteria.tag) {
    conditions.push(
      sql`${criteria.tag} = ANY(${clientsTable.tags})` as unknown as WhereArg
    );
  }
  if (criteria.classification) {
    conditions.push(eq(clientsTable.classification, criteria.classification));
  }
  if (criteria.status) {
    conditions.push(eq(clientsTable.status, criteria.status));
  }
  if (criteria.travelPreference) {
    conditions.push(ilike(clientsTable.travelPreference, `%${criteria.travelPreference}%`));
  }
  if (criteria.inactiveDays !== undefined) {
    const threshold = new Date(Date.now() - criteria.inactiveDays * 86400000).toISOString();
    conditions.push(
      sql`NOT EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.client_id = ${clientsTable.id}
          AND r.tenant_id = ${clientsTable.tenantId}
          AND r.status IN ('confirmed', 'completed')
          AND r.created_at >= ${threshold}::timestamptz
      )` as unknown as WhereArg
    );
  }
  if (criteria.tier) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM loyalty_members lm
        WHERE lm.client_id = ${clientsTable.id}
          AND lm.tenant_id = ${clientsTable.tenantId}
          AND lm.tier = ${criteria.tier}
      )` as unknown as WhereArg
    );
  }
  if (criteria.minPurchaseScore !== undefined) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM client_scores cs
        WHERE cs.client_id = ${clientsTable.id}
          AND cs.tenant_id = ${clientsTable.tenantId}
          AND cs.purchase_score >= ${criteria.minPurchaseScore}
      )` as unknown as WhereArg
    );
  }
  if (criteria.maxChurnScore !== undefined) {
    conditions.push(
      sql`NOT EXISTS (
        SELECT 1 FROM client_scores cs
        WHERE cs.client_id = ${clientsTable.id}
          AND cs.tenant_id = ${clientsTable.tenantId}
          AND cs.churn_score > ${criteria.maxChurnScore}
      )` as unknown as WhereArg
    );
  }
  if (criteria.tripId) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.client_id = ${clientsTable.id}
          AND r.tenant_id = ${clientsTable.tenantId}
          AND r.trip_id = ${criteria.tripId}
      )` as unknown as WhereArg
    );
  }

  const rows = await db
    .select({ id: clientsTable.id })
    .from(clientsTable)
    .where(and(...conditions));

  return { count: rows.length, clientIds: rows.map((r) => r.id) };
}
