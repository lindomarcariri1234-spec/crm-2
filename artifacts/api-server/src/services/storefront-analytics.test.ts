import { describe, expect, it } from "vitest";
import {
  buildStorefrontAnalyticsSummary,
  storefrontMetricEventSchema,
} from "./storefront-analytics.js";

type MetricRow = Parameters<typeof buildStorefrontAnalyticsSummary>[0][number];
type ProductRow = Parameters<typeof buildStorefrontAnalyticsSummary>[1][number];

function metric(overrides: Partial<MetricRow>): MetricRow {
  return {
    id: "metric-row",
    tenantId: "tenant",
    storeId: "store",
    metricDate: "2026-10-18",
    eventType: "page_view",
    pageType: "home",
    groupDimension: "none",
    sourceDimension: "none",
    count: 1,
    createdAt: new Date("2026-10-18T12:00:00Z"),
    updatedAt: new Date("2026-10-18T12:00:00Z"),
    ...overrides,
  };
}

describe("storefront analytics events", () => {
  it("accepts only controlled dimensions and rejects visitor/product identifiers or search text", () => {
    expect(storefrontMetricEventSchema.safeParse({
      event: "page_view",
      pageType: "product",
      group: "travel",
    }).success).toBe(true);
    expect(storefrontMetricEventSchema.safeParse({
      event: "search_submitted",
      group: "travel",
      source: "header_search",
      searchText: "personal query",
    }).success).toBe(false);
    expect(storefrontMetricEventSchema.safeParse({
      event: "product_opened",
      group: "travel",
      productId: "private-id",
    }).success).toBe(false);
    expect(storefrontMetricEventSchema.safeParse({
      event: "page_view",
      pageType: "/loja/private-store/produtos",
    }).success).toBe(false);
  });

  it("summarizes current and previous page views and group interest without exposing row identifiers", () => {
    const rows = [
      metric({ metricDate: "2026-10-18", pageType: "home", count: 2 }),
      metric({ metricDate: "2026-10-17", pageType: "product", count: 3 }),
      metric({ metricDate: "2026-09-18", pageType: "catalog", count: 9 }),
      metric({
        metricDate: "2026-10-18",
        eventType: "group_selected",
        pageType: "none",
        groupDimension: "travel",
        sourceDimension: "home_link",
        count: 4,
      }),
      metric({
        metricDate: "2026-10-18",
        eventType: "product_opened",
        pageType: "none",
        groupDimension: "travel",
        count: 5,
      }),
      metric({
        metricDate: "2026-10-18",
        eventType: "search_submitted",
        pageType: "none",
        groupDimension: "other",
        sourceDimension: "header_search",
        count: 2,
      }),
      metric({
        metricDate: "2026-10-18",
        eventType: "checkout_started",
        pageType: "none",
        groupDimension: "travel",
        count: 1,
      }),
    ] as MetricRow[];
    const products = [{
      name: "Rota do Cariri",
      viewsCount: 12,
      storefrontGroup: "other",
      tripId: "linked-trip",
    }] as ProductRow[];

    const summary = buildStorefrontAnalyticsSummary(rows, products, 30, "2026-10-18");

    expect(summary.pageViews.total).toBe(5);
    expect(summary.pageViews.previousTotal).toBe(9);
    expect(summary.pageViews.byType).toContainEqual({ pageType: "home", count: 2 });
    expect(summary.pageViews.byType).toContainEqual({ pageType: "product", count: 3 });
    expect(summary.groups.find((group) => group.group === "travel")).toMatchObject({
      selections: 4,
      productOpens: 5,
      checkoutStarts: 1,
    });
    expect(summary.groups.find((group) => group.group === "other")?.searches).toBe(2);
    expect(summary.topProducts).toEqual([{ name: "Rota do Cariri", views: 12, group: "travel" }]);
    expect(Object.keys(summary.topProducts[0] ?? {}).sort()).toEqual(["group", "name", "views"]);
  });
});
