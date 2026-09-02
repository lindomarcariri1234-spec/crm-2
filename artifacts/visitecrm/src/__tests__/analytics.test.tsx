import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";

const mockUseGetDashboardSummary = vi.hoisted(() => vi.fn());
const mockUseGetDashboardRevenueChart = vi.hoisted(() => vi.fn());
const mockUseGetPaymentsSummary = vi.hoisted(() => vi.fn());
const mockUseListTrips = vi.hoisted(() => vi.fn());
const mockUseListReservations = vi.hoisted(() => vi.fn());
const mockUseListCommissions = vi.hoisted(() => vi.fn());
const mockUseListExpenses = vi.hoisted(() => vi.fn());
const mockUseFinancialMetrics = vi.hoisted(() => vi.fn());

const mockRefetchSummary = vi.hoisted(() => vi.fn());
const mockRefetchChart = vi.hoisted(() => vi.fn());
const mockRefetchPayments = vi.hoisted(() => vi.fn());
const mockRefetchTrips = vi.hoisted(() => vi.fn());
const mockRefetchReservations = vi.hoisted(() => vi.fn());
const mockRefetchCommissions = vi.hoisted(() => vi.fn());
const mockRefetchExpenses = vi.hoisted(() => vi.fn());
const mockRefetchFinancialMetrics = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  useGetDashboardSummary: mockUseGetDashboardSummary,
  useGetDashboardRevenueChart: mockUseGetDashboardRevenueChart,
  useGetPaymentsSummary: mockUseGetPaymentsSummary,
  useListTrips: mockUseListTrips,
  useListReservations: mockUseListReservations,
  useListCommissions: mockUseListCommissions,
  useListExpenses: mockUseListExpenses,
}));

vi.mock("wouter", () => ({
  Link: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

vi.mock("../lib/financial-metrics-api", () => ({
  useFinancialMetrics: mockUseFinancialMetrics,
}));

import Analytics from "../pages/analytics.js";

afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
});

function successfulQuery(refetch: ReturnType<typeof vi.fn>, data: unknown = undefined) {
  return {
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch,
  };
}

describe("Analytics", () => {
  it("mostra o erro de uma consulta e refaz todas as consultas no retry", async () => {
    mockUseGetDashboardSummary.mockReturnValue(
      successfulQuery(mockRefetchSummary, {
        totalReservations: 0,
        confirmedReservations: 0,
        openDeals: 0,
        totalClients: 0,
        newClientsThisMonth: 0,
        activeTrips: 0,
        revenueThisMonth: 0,
        occupancyRate: 0,
      }),
    );
    mockUseGetDashboardRevenueChart.mockReturnValue(
      successfulQuery(mockRefetchChart, []),
    );
    mockUseGetPaymentsSummary.mockReturnValue(
      successfulQuery(mockRefetchPayments, {
        totalReceivable: 0,
        overdueReceivable: 0,
      }),
    );
    mockUseListTrips.mockReturnValue(successfulQuery(mockRefetchTrips, { data: [] }));
    mockUseListReservations.mockReturnValue(
      successfulQuery(mockRefetchReservations, { data: [] }),
    );
    mockUseListCommissions.mockReturnValue(successfulQuery(mockRefetchCommissions, []));
    mockUseListExpenses.mockReturnValue(
      successfulQuery(mockRefetchExpenses, { data: [] }),
    );
    mockUseFinancialMetrics.mockReturnValue(
      successfulQuery(mockRefetchFinancialMetrics, {
        period: { start: "", end: "", label: "2026-08", asOf: "" },
        timezone: "America/Sao_Paulo",
        contracts: {},
        totals: {},
        byTrip: [],
        byUser: [],
        diagnostics: {},
      }),
    );

    const failedQueryError = new Error("Falha temporária nos analíticos");
    mockUseGetPaymentsSummary.mockReturnValue({
      ...successfulQuery(mockRefetchPayments),
      isError: true,
      error: failedQueryError,
    });

    const handle = await renderComponent(createElement(Analytics));

    expect(handle.container.textContent).toContain(
      "Não foi possível carregar os dados analíticos",
    );
    expect(handle.container.textContent).toContain(failedQueryError.message);

    const retry = Array.from(handle.container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Tentar novamente"),
    );
    expect(retry).toBeDefined();

    await flushAct(() => retry!.click());

    expect(mockRefetchSummary).toHaveBeenCalledTimes(1);
    expect(mockRefetchChart).toHaveBeenCalledTimes(1);
    expect(mockRefetchPayments).toHaveBeenCalledTimes(1);
    expect(mockRefetchTrips).toHaveBeenCalledTimes(1);
    expect(mockRefetchReservations).toHaveBeenCalledTimes(1);
    expect(mockRefetchCommissions).toHaveBeenCalledTimes(1);
    expect(mockRefetchExpenses).toHaveBeenCalledTimes(1);
    expect(mockRefetchFinancialMetrics).toHaveBeenCalledTimes(1);
  });
});