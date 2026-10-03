import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";
import type { FinancialMetricsResponse } from "../lib/financial-metrics-api.js";

const mocks = vi.hoisted(() => ({
  useGetPaymentsSummary: vi.fn(),
  useListPayments: vi.fn(),
  useListExpenses: vi.fn(),
  useListCommissions: vi.fn(),
  useListCommissionRules: vi.fn(),
  useCreatePayment: vi.fn(),
  useUpdatePayment: vi.fn(),
  useCreateExpense: vi.fn(),
  useUpdateExpense: vi.fn(),
  useUpdateTripCost: vi.fn(),
  useUpdateCommission: vi.fn(),
  useCreateCommissionRule: vi.fn(),
  useUpdateCommissionRule: vi.fn(),
  useDeleteCommissionRule: vi.fn(),
  useGetDashboardRevenueChart: vi.fn(),
  useListClients: vi.fn(),
  useFinancialMetrics: vi.fn(),
  navigate: vi.fn(),
  search: "",
  can: vi.fn(() => true),
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListClientsQueryKey: (params: unknown) => ["/api/clients", params],
  getListCommissionRulesQueryKey: () => ["/api/commission-rules"],
  getListCommissionsQueryKey: () => ["/api/commissions"],
  getListExpensesQueryKey: (params: unknown) => ["/api/expenses", params],
  getListPaymentsQueryKey: (params: unknown) => ["/api/payments", params],
  useGetPaymentsSummary: mocks.useGetPaymentsSummary,
  useListPayments: mocks.useListPayments,
  useListExpenses: mocks.useListExpenses,
  useListCommissions: mocks.useListCommissions,
  useListCommissionRules: mocks.useListCommissionRules,
  useCreatePayment: mocks.useCreatePayment,
  useUpdatePayment: mocks.useUpdatePayment,
  useCreateExpense: mocks.useCreateExpense,
  useUpdateExpense: mocks.useUpdateExpense,
  useUpdateTripCost: mocks.useUpdateTripCost,
  useUpdateCommission: mocks.useUpdateCommission,
  useCreateCommissionRule: mocks.useCreateCommissionRule,
  useUpdateCommissionRule: mocks.useUpdateCommissionRule,
  useDeleteCommissionRule: mocks.useDeleteCommissionRule,
  useGetDashboardRevenueChart: mocks.useGetDashboardRevenueChart,
  useListClients: mocks.useListClients,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: unknown;
    className?: string;
    "data-testid"?: string;
  }) => createElement("a", { href, ...props }, children as never),
  useSearch: () => mocks.search,
  useLocation: () => ["/financeiro", mocks.navigate],
}));

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({ can: mocks.can }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("../lib/financial-metrics-api", () => ({
  FINANCIAL_METRICS_PERIOD_SELECTION_LABELS: {
    current: "Mês atual (BRT)",
    "7d": "Últimos 7 dias",
    "30d": "Últimos 30 dias",
    "90d": "Últimos 90 dias",
    "12m": "Últimos 12 meses",
  },
  useFinancialMetrics: mocks.useFinancialMetrics,
}));

vi.mock("../components/financial-metrics-overview", () => ({
  FinancialMetricsOverview: () =>
    createElement("section", null, "Visão financeira consolidada"),
}));

import Financial from "../pages/financial.js";
import { SettlementTab, type SettlementData } from "../components/financial/settlement-tab.js";

const emptyTotals: FinancialMetricsResponse["totals"] = {
  grossBookedRevenue: 0,
  bookedRevenue: 0,
  receivedRevenue: 0,
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
};

function financialMetrics(
  pmsPaymentAdjustments?: NonNullable<FinancialMetricsResponse["pmsPaymentAdjustments"]>,
): FinancialMetricsResponse {
  const response: FinancialMetricsResponse = {
    period: { start: "2026-09-01", end: "2026-09-30", label: "2026-09", asOf: "2026-09-26" },
    timezone: "America/Sao_Paulo",
    contracts: {},
    totals: emptyTotals,
    byTrip: [],
    byUser: [],
    diagnostics: {
      sourceRows: {},
      excluded: {},
      duplicateIdsIgnored: 0,
      unallocatedPaymentIds: [],
      ledgerEntriesNotIncludedInTotals: 0,
      potentialCrossSourceDuplicates: [],
    },
  };
  return pmsPaymentAdjustments === undefined
    ? response
    : { ...response, pmsPaymentAdjustments };
}

function setSuccessfulQueries() {
  const query = { data: { data: [], total: 0, page: 1, limit: 50 }, isLoading: false, isError: false, refetch: vi.fn() };
  const mutation = { mutateAsync: vi.fn(), isPending: false };

  mocks.useGetPaymentsSummary.mockReturnValue({ refetch: vi.fn() });
  mocks.useListPayments.mockReturnValue(query);
  mocks.useListExpenses.mockReturnValue(query);
  mocks.useListCommissions.mockReturnValue({ data: [], isLoading: false, refetch: vi.fn() });
  mocks.useListCommissionRules.mockReturnValue({ data: [], isLoading: false, refetch: vi.fn() });
  mocks.useCreatePayment.mockReturnValue(mutation);
  mocks.useUpdatePayment.mockReturnValue(mutation);
  mocks.useCreateExpense.mockReturnValue(mutation);
  mocks.useUpdateExpense.mockReturnValue(mutation);
  mocks.useUpdateTripCost.mockReturnValue(mutation);
  mocks.useUpdateCommission.mockReturnValue(mutation);
  mocks.useCreateCommissionRule.mockReturnValue(mutation);
  mocks.useUpdateCommissionRule.mockReturnValue(mutation);
  mocks.useDeleteCommissionRule.mockReturnValue(mutation);
  mocks.useGetDashboardRevenueChart.mockReturnValue({ data: [] });
  mocks.useListClients.mockReturnValue({ data: { data: [] } });
}

const settlementResponse: SettlementData = {
  summary: {
    agencyNet: 1200,
    partnerPayable: 450,
    walletOutstanding: 80,
    cashbackOutstanding: 30,
    reversals: 20,
  },
  entries: [{
    id: "settlement-1",
    participantType: "seller",
    category: "commission_payment",
    direction: "debit",
    amount: 80,
    settlementStatus: "reversed",
    eventType: "commission",
    occurredAt: "2026-09-12T15:30:00.000Z",
  }],
};

beforeEach(() => {
  mocks.search = "";
  mocks.can.mockReturnValue(true);
  setSuccessfulQueries();
  mocks.useFinancialMetrics.mockReturnValue({
    data: financialMetrics(),
    isLoading: false,
  });
});

afterEach(async () => {
  await cleanupRoots();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Financial page PMS payment adjustments", () => {
  it("keeps the financial page visible when the response omits the optional adjustment list", async () => {
    mocks.useFinancialMetrics.mockReturnValue({
      data: financialMetrics(),
      isLoading: false,
    });

    const handle = await renderComponent(createElement(Financial));

    expect(handle.container.textContent).toContain("Financeiro");
    expect(handle.container.textContent).toContain("Visão financeira consolidada");
    expect(handle.container.textContent).toContain("Resultado Financeiro");
    expect(handle.container.textContent).toContain("A Receber");
    expect(handle.container.querySelector('[data-testid="section-pms-payment-adjustments"]')).not.toBeNull();
    expect(handle.container.querySelector('[data-testid="status-pms-adjustments-empty"]')).not.toBeNull();
  });

  it("renders adjustment rows when the response includes PMS payment adjustments", async () => {
    mocks.useFinancialMetrics.mockReturnValue({
      data: financialMetrics([{
        id: "adjustment-1",
        reservationId: "reservation-1",
        reservationNumber: "PMS-204",
        previousPaidAmount: 180,
        newPaidAmount: 150,
        deltaAmount: -30,
        reason: "Correção de pagamento",
        adjustedByName: "Ana",
        createdAt: "2026-09-12T15:30:00.000Z",
      }]),
      isLoading: false,
    });

    const handle = await renderComponent(createElement(Financial));

    const row = handle.container.querySelector('[data-testid="row-pms-payment-adjustment-adjustment-1"]');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("PMS-204");
    expect(row?.textContent).toContain("Correção de pagamento");
    expect(row?.textContent).toContain("Ana");
  });

  it("sends due-date filters to the server and shows server-side pagination", async () => {
    mocks.search = "?tab=receivable&dateFrom=2026-09-10&dateTo=2026-09-30";
    mocks.useListPayments.mockReturnValue({
      data: { data: [], total: 124, page: 1, limit: 50 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    const handle = await renderComponent(createElement(Financial));

    expect(mocks.useListPayments).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "receivable",
        dueDateFrom: "2026-09-10",
        dueDateTo: "2026-09-30",
        page: 1,
        limit: 50,
      }),
      expect.objectContaining({ query: expect.objectContaining({ enabled: true }) }),
    );
    expect(handle.container.textContent).toContain("Página 1 de 3");
    expect(handle.container.textContent).toContain("Próxima");
  });

  it("renders the payable tab with the active payment query and pagination", async () => {
    mocks.search = "?tab=payable";
    mocks.useListPayments.mockReturnValue({
      data: { data: [], total: 124, page: 1, limit: 50 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    const handle = await renderComponent(createElement(Financial));

    expect(mocks.useListPayments).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: "payable",
        page: 1,
        limit: 50,
      }),
      expect.objectContaining({ query: expect.objectContaining({ enabled: true }) }),
    );
    expect(handle.container.textContent).toContain("Nenhum lançamento encontrado.");
    expect(handle.container.textContent).toContain("Página 1 de 3");
  });

  it("loads only the active tab's list data", async () => {
    mocks.search = "?tab=expenses";

    const handle = await renderComponent(createElement(Financial));

    expect(mocks.useListPayments).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }),
    );
    expect(mocks.useListExpenses).toHaveBeenCalledWith(
      expect.objectContaining({ includeTripCosts: true, page: 1, limit: 50 }),
      expect.objectContaining({ query: expect.objectContaining({ enabled: true }) }),
    );
    expect(mocks.useListCommissions).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }),
    );
    expect(mocks.useListCommissionRules).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }),
    );
    expect(mocks.useListClients).toHaveBeenCalledWith(
      { limit: 500, page: 1 },
      expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }),
    );
    expect(handle.container.textContent).toContain("Registrar Despesa");
    expect(handle.container.textContent).toContain("Nenhuma despesa ou custo de viagem encontrado.");
  });

  it("shows agency expenses and unlinked trip costs together with their origin", async () => {
    mocks.search = "?tab=expenses";
    mocks.useListExpenses.mockReturnValue({
      data: {
        data: [
          {
            id: "expense-agency-1",
            tripId: null,
            linkedTripCostId: null,
            category: "administrative",
            description: "Internet da agência",
            amount: 150,
            supplierId: null,
            supplierName: null,
            paymentMethod: null,
            paymentDate: null,
            dueDate: "2026-09-30",
            status: "pending",
            notes: null,
            createdAt: "2026-09-01T12:00:00.000Z",
            source: "agency",
          },
          {
            id: "trip-cost-1",
            tripId: "trip-1",
            linkedTripCostId: null,
            category: "transport",
            description: "Ônibus fretado",
            amount: 1300,
            supplierId: null,
            supplierName: "Transportadora",
            paymentMethod: null,
            paymentDate: null,
            dueDate: null,
            status: "pending",
            notes: null,
            createdAt: "2026-09-02T12:00:00.000Z",
            source: "trip",
          },
        ],
        total: 2,
        page: 1,
        limit: 50,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    const handle = await renderComponent(createElement(Financial));

    expect(mocks.useListExpenses).toHaveBeenCalledWith(
      expect.objectContaining({ includeTripCosts: true, page: 1, limit: 50 }),
      expect.objectContaining({ query: expect.objectContaining({ enabled: true }) }),
    );
    expect(handle.container.querySelector('[data-testid="text-expense-source-agency-expense-agency-1"]')?.textContent)
      .toContain("Despesa da agência");
    expect(handle.container.querySelector('[data-testid="text-expense-source-trip-trip-cost-1"]')?.textContent)
      .toContain("Custo da viagem");
    expect(handle.container.querySelector('[data-testid="row-expense-trip-trip-cost-1"]')?.textContent)
      .toContain("Ônibus fretado");
  });

  it("paginates the consolidated expense list using server pages", async () => {
    mocks.search = "?tab=expenses";
    mocks.useListExpenses.mockReturnValue({
      data: { data: [], total: 52, page: 1, limit: 50 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    const handle = await renderComponent(createElement(Financial));
    const nextButton = [...handle.container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Próxima"));

    expect(handle.container.textContent).toContain("Página 1 de 2");
    await flushAct(() => nextButton?.click());

    expect(mocks.useListExpenses).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeTripCosts: true, page: 2, limit: 50 }),
      expect.objectContaining({ query: expect.objectContaining({ enabled: true }) }),
    );
    expect(handle.container.textContent).toContain("Página 2 de 2");
  });

  it("marks an unlinked trip cost paid through the trip-cost endpoint", async () => {
    mocks.search = "?tab=expenses";
    const updateTripCost = { mutateAsync: vi.fn().mockResolvedValue({}), isPending: false };
    mocks.useUpdateTripCost.mockReturnValue(updateTripCost);
    mocks.useListExpenses.mockReturnValue({
      data: {
        data: [{
          id: "trip-cost-2",
          tripId: "trip-2",
          linkedTripCostId: null,
          category: "transport",
          description: "Van",
          amount: 400,
          supplierId: null,
          supplierName: null,
          paymentMethod: null,
          paymentDate: null,
          dueDate: "2026-09-20",
          status: "pending",
          notes: null,
          createdAt: "2026-09-02T12:00:00.000Z",
          source: "trip",
        }],
        total: 1,
        page: 1,
        limit: 50,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    const handle = await renderComponent(createElement(Financial));
    const markPaidButton = handle.container.querySelector(
      '[data-testid="button-mark-expense-paid-trip-trip-cost-2"]',
    ) as HTMLButtonElement | null;

    expect(markPaidButton).not.toBeNull();
    await flushAct(() => markPaidButton?.click());

    expect(updateTripCost.mutateAsync).toHaveBeenCalledWith({
      id: "trip-2",
      costId: "trip-cost-2",
      data: { status: "paid" },
    });
  });

  it("requires managing a linked expense before changing its status", async () => {
    mocks.search = "?tab=expenses";
    mocks.useListExpenses.mockReturnValue({
      data: {
        data: [{
          id: "expense-linked-1",
          tripId: "trip-3",
          linkedTripCostId: "trip-cost-linked-1",
          category: "accommodation",
          description: "Hotel da excursão",
          amount: 800,
          supplierId: null,
          supplierName: null,
          paymentMethod: null,
          paymentDate: null,
          dueDate: "2026-09-20",
          status: "pending",
          notes: null,
          createdAt: "2026-09-02T12:00:00.000Z",
          source: "agency",
        }],
        total: 1,
        page: 1,
        limit: 50,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    const handle = await renderComponent(createElement(Financial));

    expect(handle.container.querySelector('[data-testid="button-mark-expense-paid-agency-expense-linked-1"]')).toBeNull();
    expect(handle.container.querySelector('[data-testid="link-manage-expense-agency-expense-linked-1"]')?.getAttribute("href"))
      .toBe("/financeiro/expenses");
    expect(handle.container.textContent).toContain("Vinculada ao custo da viagem");
  });

  it("renders the commissions tab and only enables its list query", async () => {
    mocks.search = "?tab=commissions";

    const handle = await renderComponent(createElement(Financial));

    expect(mocks.useListCommissions).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ enabled: true }) }),
    );
    expect(mocks.useListExpenses).toHaveBeenCalledWith(
      expect.objectContaining({ includeTripCosts: true, page: 1, limit: 50 }),
      expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }),
    );
    expect(mocks.useListCommissionRules).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }),
    );
    expect(handle.container.textContent).toContain("Total de Comissões");
    expect(handle.container.textContent).toContain("Nenhuma comissão registrada.");
  });

  it("renders commission rules and only enables the rules query", async () => {
    mocks.search = "?tab=rules";

    const handle = await renderComponent(createElement(Financial));

    expect(mocks.useListCommissionRules).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ enabled: true }) }),
    );
    expect(mocks.useListExpenses).toHaveBeenCalledWith(
      expect.objectContaining({ includeTripCosts: true, page: 1, limit: 50 }),
      expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }),
    );
    expect(mocks.useListCommissions).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }),
    );
    expect(handle.container.textContent).toContain("Nova Regra");
    expect(handle.container.textContent).toContain("Nenhuma regra de comissão cadastrada.");
  });

  it("renders settlement summaries and refreshes from the settlement component", async () => {
    const onRefresh = vi.fn();
    const handle = await renderComponent(createElement(SettlementTab, {
      settlement: settlementResponse,
      isLoading: false,
      error: null,
      onRefresh,
    }));

    expect(handle.container.textContent).toContain("Receita da agência");
    expect(handle.container.textContent).toContain("Repasse a parceiros");
    expect(handle.container.textContent).toContain("commission payment");
    expect(handle.container.textContent).toContain("reversed");

    const refreshButton = [...handle.container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Atualizar"));
    expect(refreshButton).toBeDefined();
    await flushAct(() => refreshButton?.click());
    expect(onRefresh).toHaveBeenCalledOnce();

    await handle.rerender(createElement(SettlementTab, {
      settlement: settlementResponse,
      isLoading: true,
      error: null,
      onRefresh,
    }));
    const loadingRefreshButton = [...handle.container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Atualizar"));
    expect(loadingRefreshButton?.disabled).toBe(true);
  });

  it("shows a retry action after an initial network failure and clears it on success", async () => {
    mocks.search = "?tab=settlement";
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => settlementResponse,
      });
    vi.stubGlobal("fetch", fetchMock);

    const handle = await renderComponent(createElement(Financial));
    const initialRequest = fetchMock.mock.results[0]?.value as Promise<unknown>;
    await flushAct(async () => { await initialRequest.catch(() => undefined); });

    expect(handle.container.querySelector('[role="alert"]')?.textContent)
      .toContain("Não foi possível carregar os dados da liquidação.");
    expect(handle.container.textContent).toContain("Dados de liquidação indisponíveis.");

    const retryButton = [...handle.container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Tentar novamente"));
    expect(retryButton).toBeDefined();
    await flushAct(async () => {
      retryButton?.click();
      const retryRequest = fetchMock.mock.results[1]?.value as Promise<unknown>;
      await retryRequest;
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(handle.container.querySelector('[role="alert"]')).toBeNull();
    expect(handle.container.textContent).toContain("commission payment");
  });

  it("keeps previously loaded settlement data visible after an unsuccessful refresh", async () => {
    mocks.search = "?tab=settlement";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => settlementResponse,
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      });
    vi.stubGlobal("fetch", fetchMock);

    const handle = await renderComponent(createElement(Financial));
    const initialRequest = fetchMock.mock.results[0]?.value as Promise<unknown>;
    await flushAct(async () => { await initialRequest; });
    expect(handle.container.textContent).toContain("commission payment");

    const refreshButton = [...handle.container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Atualizar"));
    expect(refreshButton).toBeDefined();
    await flushAct(async () => {
      refreshButton?.click();
      const refreshRequest = fetchMock.mock.results[1]?.value as Promise<unknown>;
      await refreshRequest;
    });

    expect(handle.container.querySelector('[role="alert"]')?.textContent)
      .toContain("Não foi possível carregar os dados da liquidação.");
    expect(handle.container.textContent).toContain("commission payment");
    expect(handle.container.textContent).not.toContain("Dados de liquidação indisponíveis.");
  });

  it("hides financial mutation controls when the current role lacks permission", async () => {
    mocks.can.mockReturnValue(false);

    const handle = await renderComponent(createElement(Financial));

    expect(handle.container.textContent).not.toContain("Novo Lançamento");
    expect(handle.container.textContent).not.toContain("Nova Despesa");
    expect(handle.container.textContent).not.toContain("Nova Regra");
  });

  it("shows a retry action when the receivables request fails", async () => {
    mocks.useListPayments.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: vi.fn(),
    });

    const handle = await renderComponent(createElement(Financial));

    expect(handle.container.textContent).toContain("Não foi possível carregar os recebíveis.");
    expect(handle.container.textContent).toContain("Tentar novamente");
  });
});