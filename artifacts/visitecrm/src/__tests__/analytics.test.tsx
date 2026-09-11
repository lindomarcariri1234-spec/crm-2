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
const selectRegistry = vi.hoisted(() => ({
  handlers: [] as Array<((value: string) => void) | undefined>,
}));

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

vi.mock("@/components/ui/select", () => ({
  Select: ({
    onValueChange,
    children,
  }: {
    onValueChange?: (value: string) => void;
    children?: unknown;
  }) => {
    selectRegistry.handlers.push(onValueChange);
    return createElement("div", null, children as never);
  },
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: unknown;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        "data-period": value,
        onClick: () => {
          const handler =
            selectRegistry.handlers[selectRegistry.handlers.length - 1];
          handler?.(value);
        },
      },
      children as never,
    ),
}));

vi.mock("../lib/financial-metrics-api", () => ({
  useFinancialMetrics: mockUseFinancialMetrics,
  FINANCIAL_METRICS_PERIOD_LABELS: {
    "7d": "Últimos 7 dias",
    "30d": "Últimos 30 dias",
    "90d": "Últimos 90 dias",
    "12m": "Últimos 12 meses",
  },
}));

import Analytics from "../pages/analytics.js";

afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
  selectRegistry.handlers.length = 0;
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

  it("consulta novamente o gráfico quando o período é alterado", async () => {
    const requestedPeriods: string[] = [];
    const requestedFinancialPeriods: Array<string | undefined> = [];
    let chartPending = false;
    let financialPending = false;

    mockUseGetDashboardSummary.mockReturnValue(
      successfulQuery(mockRefetchSummary, {
        totalReservations: 2,
        confirmedReservations: 1,
        openDeals: 1,
        totalClients: 2,
        newClientsThisMonth: 1,
        activeTrips: 1,
        revenueThisMonth: 120,
        occupancyRate: 50,
      }),
    );
    mockUseGetDashboardRevenueChart.mockImplementation(
      ({ period }: { period: string }) => {
        requestedPeriods.push(period);
        const isPendingNewPeriod = period === "30d" && chartPending;
        return {
          ...successfulQuery(mockRefetchChart, [
            {
              label: isPendingNewPeriod ? "12m anterior" : `${period} atual`,
              revenue: period === "12m" || isPendingNewPeriod ? 120 : 30,
              expenses: 10,
            },
          ]),
          isFetching: isPendingNewPeriod,
        };
      },
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
    mockUseFinancialMetrics.mockImplementation((requestedPeriod?: string) => {
      requestedFinancialPeriods.push(requestedPeriod);
      const isPendingNewPeriod = requestedPeriod === "30d" && financialPending;
      return {
        ...successfulQuery(mockRefetchFinancialMetrics, {
          period: {
            start: "",
            end: "",
            label: isPendingNewPeriod ? "Últimos 12 meses" : requestedPeriod === "30d" ? "Últimos 30 dias" : "Últimos 12 meses",
            asOf: "",
          },
          timezone: "America/Sao_Paulo",
          contracts: {},
          totals: {
            grossBookedRevenue: 0,
            bookedRevenue: isPendingNewPeriod ? 200 : 75,
            receivedRevenue: isPendingNewPeriod ? 120 : 30,
            receivable: 0,
            overdueReceivable: 0,
            payable: 0,
            overduePayable: 0,
            discounts: 0,
            clientReferralBonuses: 0,
            clientReferralCredits: 0,
            sellerCommissions: 0,
            sellerCommissionsPaid: 0,
            referralCommissions: 0,
            referralCommissionsPaid: 0,
            expenses: 0,
            expensesPaid: 0,
            tripCosts: 0,
            tripCostsPaid: 0,
            userReferralBalance: 0,
            userDebt: 0,
            operatingCostsPaid: 0,
            profit: 0,
            margin: 0,
          },
          byTrip: [],
          byUser: [],
          diagnostics: {},
        }),
        isFetching: isPendingNewPeriod,
      };
    });

    const handle = await renderComponent(createElement(Analytics));

    expect(requestedPeriods).toEqual(["12m"]);
    expect(requestedFinancialPeriods).toEqual(["12m", "12m"]);
    expect(handle.container.textContent).toContain("12m");

    const thirtyDayOption = handle.container.querySelector(
      '[data-period="30d"]',
    ) as HTMLButtonElement | null;
    expect(thirtyDayOption).not.toBeNull();

    chartPending = true;
    financialPending = true;
    await flushAct(() => thirtyDayOption!.click());

    expect(requestedPeriods).toEqual(["12m", "30d"]);
    expect(requestedFinancialPeriods).toEqual(["12m", "12m", "30d", "30d"]);
    expect(handle.container.querySelector('[data-testid="revenue-line-chart-loading"]')).not.toBeNull();
    expect(handle.container.querySelector('[data-testid="revenue-line-chart"]')).toBeNull();
    expect(handle.container.textContent).toContain("Atualizando gráfico...");
    expect(handle.container.textContent).not.toContain("30d atual");
    expect(handle.container.querySelector('[data-testid="status-financial-metrics-loading"]')).not.toBeNull();
    expect(handle.container.textContent).toContain("Últimos 30 dias");
    expect(handle.container.textContent).not.toContain("Receita recebida");

    chartPending = false;
    financialPending = false;
    await handle.rerender(createElement(Analytics));

    expect(handle.container.querySelector('[data-testid="revenue-line-chart-loading"]')).toBeNull();
    expect(handle.container.querySelector('[data-testid="revenue-line-chart"]')).not.toBeNull();
    expect(handle.container.textContent).toContain("30d atual");
    expect(handle.container.querySelector('[data-testid="text-financial-metrics-period"]')?.textContent).toContain("Últimos 30 dias");
    expect(handle.container.querySelector('[data-testid="text-financial-metric-received"]')?.textContent).toContain("R$");
    expect(handle.container.textContent).toContain("30d");
  });
});