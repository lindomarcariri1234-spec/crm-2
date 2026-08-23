import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import type { ReferralAnalyticsData } from "@workspace/api-client-react";
import { cleanupRoots, renderComponent } from "./eventSourceHarness.js";

vi.mock("recharts", () => ({
  BarChart: () => null,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
  ResponsiveContainer: () => null,
  PieChart: () => null,
  Pie: () => null,
  Cell: () => null,
  Sector: () => null,
}));

import { ReferralAnalyticsCharts } from "../components/referral-analytics-charts.js";

const emptyAnalytics: ReferralAnalyticsData = {
  series: [],
  monthly: [],
  funnel: { created: 0, visited: 0, converted: 0, bonusPaid: 0 },
  trackingFunnel: { uniqueVisitors: 0, checkoutStarts: 0, converted: 0 },
  channels: [],
  roi: { totalBonusPaid: 0, totalReferredRevenue: 0 },
  currentMonth: { referrals: 0, conversions: 0, bonusPaid: 0, bonusPaidAmount: 0 },
  prevMonth: { referrals: 0, conversions: 0, bonusPaid: 0, bonusPaidAmount: 0 },
  summary: {
    validReferrals: 0,
    attributedRevenue: 0,
    rewardsPaid: 0,
    rewardsPending: 0,
    discountGiven: 0,
    acquisitionCost: 0,
    cac: 0,
    roiPercent: 0,
    roiMultiple: 0,
  },
  ranking: [],
  conversionRate: 0,
  prevConversionRate: 0,
  discountGiven: 0,
};

afterEach(async () => {
  await cleanupRoots();
});

describe("ReferralAnalyticsCharts", () => {
  it("renders zero-cost and empty-period states without misleading ROI", async () => {
    const { container } = await renderComponent(
      createElement(ReferralAnalyticsCharts, {
        data: emptyAnalytics,
        period: 30,
        analyticsExportUrl: "/api/referrals/analytics/export?period=30",
      }),
    );

    expect(container.textContent).toContain("Aguardando custo de aquisição");
    expect(container.textContent).toContain("Sem dados suficientes para exibição");
    expect(container.textContent).toContain("Nenhuma conversão registrada neste período.");
  });
});