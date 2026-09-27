import { db, type TenantStateHistoryEvent } from "@workspace/db";
import { sql } from "drizzle-orm";

export interface TenantMetricsMonth {
  key: string;
  label: string;
  start: Date;
  endExclusive: Date;
}

export interface MetricPoint {
  label: string;
  value: number;
}

export interface TenantMetricsSeries {
  mrr: MetricPoint[];
  churn: MetricPoint[];
  growth: MetricPoint[];
}

/**
 * Loads one state per tenant before the reporting window, then only transitions
 * inside the window. This keeps the query bounded as the append-only ledger grows.
 */
export async function loadTenantStateHistoryForMetrics(
  buckets: TenantMetricsMonth[],
): Promise<TenantStateHistoryEvent[]> {
  if (buckets.length === 0) return [];

  const windowStart = buckets[0]!.start;
  const windowEnd = buckets[buckets.length - 1]!.endExclusive;
  const result = await db.execute(sql`
    WITH initial_state AS (
      SELECT DISTINCT ON (tenant_id)
        id,
        tenant_id AS "tenantId",
        plan_id AS "planId",
        status,
        monthly_price AS "monthlyPrice",
        changed_at AS "changedAt",
        status_changed AS "statusChanged",
        source,
        is_inferred AS "isInferred"
      FROM tenant_state_history
      WHERE changed_at < ${windowStart}
      ORDER BY tenant_id ASC, changed_at DESC, id DESC
    ),
    window_events AS (
      SELECT
        id,
        tenant_id AS "tenantId",
        plan_id AS "planId",
        status,
        monthly_price AS "monthlyPrice",
        changed_at AS "changedAt",
        status_changed AS "statusChanged",
        source,
        is_inferred AS "isInferred"
      FROM tenant_state_history
      WHERE changed_at >= ${windowStart}
        AND changed_at < ${windowEnd}
    )
    SELECT * FROM initial_state
    UNION ALL
    SELECT * FROM window_events
    ORDER BY "changedAt" ASC, id ASC
  `);

  return result.rows as unknown as TenantStateHistoryEvent[];
}

export function buildTenantMetricsSeries(
  buckets: TenantMetricsMonth[],
  history: TenantStateHistoryEvent[],
): TenantMetricsSeries {
  const events = [...history].sort((a, b) => (
    a.changedAt.getTime() - b.changedAt.getTime() || a.id - b.id
  ));
  const currentStateByTenant = new Map<string, TenantStateHistoryEvent>();
  const mrr: MetricPoint[] = [];
  const churn: MetricPoint[] = [];
  const growth: MetricPoint[] = [];
  let eventIndex = 0;

  for (const bucket of buckets) {
    while (
      eventIndex < events.length
      && events[eventIndex]!.changedAt < bucket.endExclusive
    ) {
      const event = events[eventIndex++]!;
      currentStateByTenant.set(event.tenantId, event);
    }

    let mrrCents = 0;
    let activeTenants = 0;
    for (const state of currentStateByTenant.values()) {
      if (state.status !== "active") continue;
      activeTenants++;

      const monthlyPrice = Number(state.monthlyPrice);
      if (!Number.isFinite(monthlyPrice)) {
        throw new Error(`Invalid monthly price in tenant state history for ${state.tenantId}`);
      }
      mrrCents += Math.round(monthlyPrice * 100);
    }

    const churnedTenants = new Set(
      events
        .filter((event) => (
          event.statusChanged
          && event.status === "suspended"
          && event.changedAt >= bucket.start
          && event.changedAt < bucket.endExclusive
        ))
        .map((event) => event.tenantId),
    );
    const totalTenants = currentStateByTenant.size;
    const churnRate = totalTenants === 0
      ? 0
      : Number(((churnedTenants.size / totalTenants) * 100).toFixed(2));

    mrr.push({ label: bucket.label, value: mrrCents / 100 });
    churn.push({ label: bucket.label, value: churnRate });
    growth.push({ label: bucket.label, value: activeTenants });
  }

  return { mrr, churn, growth };
}