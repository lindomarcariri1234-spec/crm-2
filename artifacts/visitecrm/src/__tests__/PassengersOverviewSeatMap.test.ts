import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderComponent, cleanupRoots, flushAct } from "./eventSourceHarness.js";

// ---------------------------------------------------------------------------
// Controllable hook return values
// ---------------------------------------------------------------------------
const mockGetMe = vi.hoisted(() => vi.fn());
const mockGetTenant = vi.hoisted(() => vi.fn());
const mockGetTrip = vi.hoisted(() => vi.fn());
const mockListReservations = vi.hoisted(() => vi.fn());
const mockUseQuery = vi.hoisted(() => vi.fn());
const mockHasPermission = vi.hoisted(() => vi.fn(() => false));
const mockUseSeatStream = vi.hoisted(() =>
  vi.fn(() => ({ eventCount: 0, occupiedSeats: {}, connected: false })),
);
const mockRefetch = vi.hoisted(() => vi.fn());
const mockNavigate = vi.hoisted(() => vi.fn());
const mockTripSelectOnChange = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("wouter", () => ({
  useLocation: () => ["/trips/trip-1/passengers-overview", mockNavigate],
  Link: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mockUseQuery,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/useSeatStream", () => ({
  useSeatStream: mockUseSeatStream,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: mockGetMe,
  useGetTenant: mockGetTenant,
  useGetTripRoomAllocationSummary: vi.fn(() => ({ data: null })),
  useListTrips: () => ({ data: { data: [] } }),
  useGetTrip: mockGetTrip,
  useListReservations: mockListReservations,
  useUpdateReservation: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@workspace/permissions", () => ({
  RESERVATION_STATUS: {
    CONFIRMED: "confirmed",
    PENDING: "pending",
    CANCELLED: "cancelled",
    COMPLETED: "completed",
  },
  TRIP_STATUS: {
    CANCELLED: "cancelled",
    DRAFT: "draft",
  },
  hasPermission: mockHasPermission,
  RESOURCES: { FINANCIAL: "financial" },
  ACTIONS: { VIEW: "view" },
}));

vi.mock("@/components/client360-modal", () => ({
  Client360Modal: () => null,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...rest }: { children: unknown; [k: string]: unknown }) =>
    createElement("button", rest, children as never),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: unknown;
    value?: string;
    onValueChange?: (value: string) => void;
  }) => {
    if (value === "trip-1" && onValueChange) {
      mockTripSelectOnChange.mockImplementation(onValueChange);
    }
    return createElement("div", null, children as never);
  },
  SelectContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectItem: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectTrigger: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  SelectValue: () => null,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogHeader: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogTitle: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  AlertDialogAction: ({ children }: { children: unknown }) =>
    createElement("button", null, children as never),
  AlertDialogCancel: ({ children }: { children: unknown }) =>
    createElement("button", null, children as never),
  AlertDialogContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  AlertDialogDescription: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  AlertDialogFooter: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  AlertDialogHeader: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  AlertDialogTitle: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
}));

// Using importOriginal so any new icon added to PassengersOverview.tsx
// passes through automatically — no need to maintain a hand-written list.
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return { ...actual };
});

vi.mock("../pages/trips/constants.js", () => ({
  STATUS_MAP: {} as Record<string, { label: string; color: string }>,
}));

vi.mock("../pages/trips/utils.js", () => ({
  formatCurrency: (v: number) => `R$ ${v}`,
  formatDate: (d: string) => d,
  formatTripDateRange: () => "1–2 de janeiro",
}));

vi.mock("@/lib/labels", () => ({
  PAYMENT_METHOD_LABELS: {} as Record<string, string>,
}));

vi.mock("../pages/trips/PassengersOverviewFinancialDialog.js", () => ({
  PassengersOverviewFinancialDialog: ({
    open,
    onClose,
    financialReport,
  }: {
    open: boolean;
    onClose: (open: boolean) => void;
    financialReport?: { totalRevenue: number };
  }) => open
    ? createElement("section", { "data-testid": "financial-report-dialog" },
      createElement("span", { "data-testid": "financial-report-total" }, String(financialReport?.totalRevenue ?? "")),
      createElement("button", {
        "data-testid": "button-close-financial-report",
        onClick: () => onClose(false),
      }, "Fechar"),
    )
    : null,
}));

import { PassengersOverview } from "../pages/trips/PassengersOverview.js";
import { makeTenantData, makeMe } from "./tenantFixtures.js";

beforeEach(() => {
  mockGetMe.mockReturnValue(makeMe());
  mockGetTenant.mockReturnValue(makeTenantData(false));
  mockGetTrip.mockReturnValue({ data: null });
  mockListReservations.mockReturnValue({ data: { data: [] }, refetch: mockRefetch });
  mockUseSeatStream.mockReturnValue({ eventCount: 0, occupiedSeats: {}, connected: false });
  mockRefetch.mockClear();
  mockNavigate.mockClear();
  mockTripSelectOnChange.mockReset();
  mockUseQuery.mockReturnValue({ data: undefined, isLoading: false });
  mockHasPermission.mockReturnValue(false);
});

afterEach(async () => {
  await cleanupRoots();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("PassengersOverview — SSE-triggered refetch", () => {
  it("does not call refetch on initial render when eventCount is 0", async () => {
    mockUseSeatStream.mockReturnValue({ eventCount: 0, occupiedSeats: {}, connected: false });
    await renderComponent(createElement(PassengersOverview, { tripId: "trip-1" }));
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("calls refetchReservations when seatEventCount transitions from 0 to 1", async () => {
    mockUseSeatStream.mockReturnValue({ eventCount: 0, occupiedSeats: {}, connected: false });
    const { rerender } = await renderComponent(
      createElement(PassengersOverview, { tripId: "trip-1" }),
    );
    expect(mockRefetch).not.toHaveBeenCalled();

    mockUseSeatStream.mockReturnValue({ eventCount: 1, occupiedSeats: {}, connected: true });
    await rerender(createElement(PassengersOverview, { tripId: "trip-1" }));

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("calls refetchReservations again on each subsequent SSE event", async () => {
    mockUseSeatStream.mockReturnValue({ eventCount: 0, occupiedSeats: {}, connected: false });
    const { rerender } = await renderComponent(
      createElement(PassengersOverview, { tripId: "trip-1" }),
    );

    mockUseSeatStream.mockReturnValue({ eventCount: 1, occupiedSeats: {}, connected: true });
    await rerender(createElement(PassengersOverview, { tripId: "trip-1" }));

    mockUseSeatStream.mockReturnValue({ eventCount: 2, occupiedSeats: {}, connected: true });
    await rerender(createElement(PassengersOverview, { tripId: "trip-1" }));

    expect(mockRefetch).toHaveBeenCalledTimes(2);
  });
});

describe("PassengersOverview — financial report refresh lifecycle", () => {
  it("loads and refreshes while open, then disables background polling on close", async () => {
    mockHasPermission.mockReturnValue(true);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ totalRevenue: 250 }),
    });
    vi.stubGlobal("fetch", fetchMock);
    mockUseQuery.mockReturnValue({ data: { totalRevenue: 100 }, isLoading: false });

    const view = await renderComponent(
      createElement(PassengersOverview, { tripId: "trip-1" }),
    );
    const closedOptions = mockUseQuery.mock.calls.at(-1)?.[0] as {
      enabled: boolean;
      refetchInterval: number | false;
    };
    expect(closedOptions.enabled).toBe(false);
    expect(closedOptions.refetchInterval).toBe(false);

    const openButton = view.container.querySelector(
      '[data-testid="button-open-trip-financial-report"]',
    ) as HTMLButtonElement | null;
    expect(openButton).not.toBeNull();
    await flushAct(() => openButton?.click());

    const openOptions = mockUseQuery.mock.calls.at(-1)?.[0] as {
      enabled: boolean;
      refetchInterval: number | false;
      queryFn: () => Promise<{ totalRevenue: number }>;
    };
    expect(openOptions.enabled).toBe(true);
    expect(openOptions.refetchInterval).toBe(30_000);

    const refreshedReport = await openOptions.queryFn();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/trips/trip-1/financial-report",
      { credentials: "include" },
    );
    expect(refreshedReport.totalRevenue).toBe(250);
    mockUseQuery.mockReturnValue({ data: refreshedReport, isLoading: false });
    await view.rerender(createElement(PassengersOverview, { tripId: "trip-1" }));
    expect(view.container.querySelector('[data-testid="financial-report-total"]')?.textContent).toBe("250");

    const closeButton = view.container.querySelector(
      '[data-testid="button-close-financial-report"]',
    ) as HTMLButtonElement | null;
    expect(closeButton).not.toBeNull();
    await flushAct(() => closeButton?.click());

    const closedAgainOptions = mockUseQuery.mock.calls.at(-1)?.[0] as {
      enabled: boolean;
      refetchInterval: number | false;
    };
    expect(closedAgainOptions.enabled).toBe(false);
    expect(closedAgainOptions.refetchInterval).toBe(false);
  });
});

describe("PassengersOverview — seatMapEnabled tenant toggle", () => {
  it("hides the seat-map link when seatMapEnabled is false", async () => {
    mockGetTenant.mockReturnValue(makeTenantData(false));

    const { container } = await renderComponent(
      createElement(PassengersOverview, { tripId: "trip-1" }),
    );

    const link = container.querySelector("a[href='/trips/trip-1/seat-map']");
    expect(link).toBeNull();
  });

  it("shows the seat-map link when seatMapEnabled is true", async () => {
    mockGetTenant.mockReturnValue(makeTenantData(true));

    const { container } = await renderComponent(
      createElement(PassengersOverview, { tripId: "trip-1" }),
    );

    const link = container.querySelector("a[href='/trips/trip-1/seat-map']");
    expect(link).not.toBeNull();
  });

  it("shows the seat-map link when seatMapEnabled is absent (defaults to true)", async () => {
    mockGetTenant.mockReturnValue(makeTenantData(undefined));

    const { container } = await renderComponent(
      createElement(PassengersOverview, { tripId: "trip-1" }),
    );

    const link = container.querySelector("a[href='/trips/trip-1/seat-map']");
    expect(link).not.toBeNull();
  });
});

describe("PassengersOverview — base do resumo de custos", () => {
  it("identifies the cost summary as a full-capacity projection", async () => {
    mockGetTrip.mockReturnValue({
      data: {
        id: "trip-1",
        totalCapacity: 50,
        fixedCosts: [
          { id: "fixed-transport", category: "Transporte", description: "Fretamento", value: 1000 },
          { id: "fixed-guide", category: "Equipe e guias", description: "Guia turístico", value: 300 },
        ],
        variableCosts: [
          { id: "variable-food", category: "Alimentação", description: "Alimentação dos passageiros", valuePax: 15 },
        ],
      },
    });

    const { container } = await renderComponent(
      createElement(PassengersOverview, { tripId: "trip-1" }),
    );

    expect(
      container.querySelector('[data-testid="text-cost-summary-basis"]')?.textContent,
    ).toBe(
      "Projeção pela capacidade total (50 vagas); a conciliação financeira usa apenas passageiros confirmados.",
    );
    expect(container.textContent).toContain("Custos Variáveis (50 vagas)");
    expect(container.textContent).toContain("Total projetado");
    expect(container.textContent).toContain("Média por vaga");
    expect(container.textContent).toContain("R$ 2050");
    expect(container.textContent).toContain("R$ 41");
  });
});

describe("PassengersOverview — route-synced trip selection", () => {
  it("navigates to the selected trip's passengers overview route", async () => {
    await renderComponent(createElement(PassengersOverview, { tripId: "trip-1" }));

    mockTripSelectOnChange("trip-2");

    expect(mockNavigate).toHaveBeenCalledWith("/trips/trip-2/passengers-overview");
  });

  it("uses a new trip ID when the same component receives a different route parameter", async () => {
    const { rerender } = await renderComponent(
      createElement(PassengersOverview, { tripId: "trip-1" }),
    );
    mockGetTrip.mockClear();
    mockListReservations.mockClear();

    await rerender(createElement(PassengersOverview, { tripId: "trip-2" }));

    expect(mockGetTrip).toHaveBeenCalledWith("trip-2", expect.any(Object));
    expect(mockListReservations).toHaveBeenCalledWith({ tripId: "trip-2", limit: 200 });
  });
});
