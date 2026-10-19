import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanupRoots, renderComponent } from "./eventSourceHarness.js";
import {
  StorefrontAnalyticsSection,
  type StorefrontAnalyticsSummary,
} from "../components/storefront-analytics-section.js";

vi.mock("recharts", () => ({
  BarChart: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: () => null,
}));

afterEach(async () => {
  await cleanupRoots();
});

function summary(
  overrides: Partial<StorefrontAnalyticsSummary> = {},
): StorefrontAnalyticsSummary {
  return {
    pageViews: {
      total: 0,
      previousTotal: 0,
      byDay: [],
      byType: [
        { pageType: "home", count: 0 },
        { pageType: "catalog", count: 0 },
        { pageType: "product", count: 0 },
        { pageType: "checkout", count: 0 },
        { pageType: "other", count: 0 },
      ],
    },
    topProducts: [],
    groups: [
      { group: "travel", selections: 0, productOpens: 0, searches: 0, checkoutStarts: 0 },
      { group: "other", selections: 0, productOpens: 0, searches: 0, checkoutStarts: 0 },
      { group: "all", selections: 0, productOpens: 0, searches: 0, checkoutStarts: 0 },
      { group: "unknown", selections: 0, productOpens: 0, searches: 0, checkoutStarts: 0 },
    ],
    totals: { productOpens: 0, searches: 0, checkoutStarts: 0 },
    ...overrides,
  };
}

describe("StorefrontAnalyticsSection", () => {
  it("shows the no-group-activity state when page views exist but every group is zero", async () => {
    const data = summary({
      pageViews: {
        total: 3,
        previousTotal: 0,
        byDay: [{ date: "2026-10-18", home: 3, catalog: 0, product: 0, checkout: 0, other: 0 }],
        byType: [
          { pageType: "home", count: 3 },
          { pageType: "catalog", count: 0 },
          { pageType: "product", count: 0 },
          { pageType: "checkout", count: 0 },
          { pageType: "other", count: 0 },
        ],
      },
    });
    const { container } = await renderComponent(createElement(StorefrontAnalyticsSection, {
      data,
      loading: false,
      error: false,
      periodDays: 30,
      onRetry: () => undefined,
    }));

    expect(container.textContent).toContain("Sem atividade de grupos neste período.");
  });

  it("labels products with an unknown group as not identified", async () => {
    const data = summary({
      topProducts: [{ name: "Produto sem grupo", views: 5, group: "unknown" }],
    });
    const { container } = await renderComponent(createElement(StorefrontAnalyticsSection, {
      data,
      loading: false,
      error: false,
      periodDays: 30,
      onRetry: () => undefined,
    }));

    expect(container.textContent).toContain("Produto sem grupo");
    expect(container.textContent).toContain("Não identificado");
  });
});
