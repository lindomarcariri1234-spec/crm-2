import { describe, expect, it } from "vitest";
import type { TenantStateHistoryEvent } from "@workspace/db";
import { buildTenantMetricsSeries, type TenantMetricsMonth } from "./tenant-state-metrics.js";

const months: TenantMetricsMonth[] = [
  {
    key: "2026-08",
    label: "ago. de 26",
    start: new Date("2026-08-01T03:00:00.000Z"),
    endExclusive: new Date("2026-09-01T03:00:00.000Z"),
  },
  {
    key: "2026-09",
    label: "set. de 26",
    start: new Date("2026-09-01T03:00:00.000Z"),
    endExclusive: new Date("2026-10-01T03:00:00.000Z"),
  },
];

function event(
  id: number,
  tenantId: string,
  status: string,
  monthlyPrice: string,
  changedAt: string,
  statusChanged = false,
  source = "test",
): TenantStateHistoryEvent {
  return {
    id,
    tenantId,
    planId: "pro",
    status,
    monthlyPrice,
    changedAt: new Date(changedAt),
    statusChanged,
    source,
    isInferred: false,
  };
}

describe("buildTenantMetricsSeries", () => {
  it("keeps a past suspension in that month after the tenant is reactivated", () => {
    const history = [
      event(1, "stable", "active", "100.00", "2026-01-01T00:00:00.000Z", false, "migration_baseline"),
      event(2, "changing", "active", "297.00", "2026-01-01T00:00:00.000Z", false, "migration_baseline"),
      event(3, "changing", "suspended", "297.00", "2026-08-15T12:00:00.000Z", true),
      event(4, "stable", "active", "200.00", "2026-09-05T12:00:00.000Z", false, "plan_price_change"),
      event(5, "changing", "active", "297.00", "2026-09-10T12:00:00.000Z", true),
    ];

    const series = buildTenantMetricsSeries(months, history);

    expect(series.mrr).toEqual([
      { label: "ago. de 26", value: 100 },
      { label: "set. de 26", value: 497 },
    ]);
    expect(series.churn).toEqual([
      { label: "ago. de 26", value: 50 },
      { label: "set. de 26", value: 0 },
    ]);
    expect(series.growth).toEqual([
      { label: "ago. de 26", value: 1 },
      { label: "set. de 26", value: 2 },
    ]);
  });

  it("does not count a suspension that starts exactly at the next month boundary in the prior month", () => {
    const history = [
      event(1, "a", "active", "297.00", "2026-01-01T00:00:00.000Z"),
      event(2, "a", "suspended", "297.00", "2026-09-01T03:00:00.000Z", true),
    ];

    const series = buildTenantMetricsSeries(months, history);

    expect(series.mrr.map((point) => point.value)).toEqual([297, 0]);
    expect(series.churn.map((point) => point.value)).toEqual([0, 100]);
  });
});