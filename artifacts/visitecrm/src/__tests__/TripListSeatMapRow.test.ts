import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderComponent, cleanupRoots, flushAct } from "./eventSourceHarness.js";

// ---------------------------------------------------------------------------
// Controllable hook return values
// ---------------------------------------------------------------------------
const mockGetMe = vi.hoisted(() => vi.fn());
const mockGetTenant = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("wouter", () => ({
  useLocation: () => ["/trips", vi.fn()],
  Link: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: mockGetMe,
  useGetTenant: mockGetTenant,
}));

vi.mock("@/hooks/useTrips", () => ({
  useTrips: () => ({
    trips: [
      {
        id: "trip-1",
        name: "Viagem Teste",
        destination: "São Paulo",
        destinationCity: "São Paulo",
        destinationState: "SP",
        originCity: null,
        originState: null,
        departureDate: "2026-08-01",
        departureTime: null,
        returnDate: null,
        returnTime: null,
        status: "upcoming",
        type: "excursion",
        totalCapacity: 40,
        availableSeats: 20,
        reservedSeats: 15,
        confirmedSeats: 5,
        priceAdult: 300,
        coverImage: null,
        tenantId: "tenant-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    isLoading: false,
    totalPages: 1,
    upcomingTrips: [],
    stats: { total: 1, active: 1, occupancyRate: 50, totalRevenue: 0 },
    me: { tenantId: "tenant-1", role: "admin" },
    isVendedor: false,
    search: "",
    setSearch: vi.fn(),
    statusFilter: "all",
    setStatusFilter: vi.fn(),
    typeFilter: "all",
    setTypeFilter: vi.fn(),
    dateFilter: "",
    setDateFilter: vi.fn(),
    page: 1,
    setPage: vi.fn(),
    refetch: vi.fn(),
    deleteTrip: { mutateAsync: vi.fn() },
    handleDuplicate: vi.fn(),
    handleDelete: vi.fn(),
  }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, className, ...rest }: { children: unknown; onClick?: () => void; className?: string; [k: string]: unknown }) =>
    createElement("button", { onClick, className, ...rest }, children as never),
}));

vi.mock("@/components/ui/input", () => ({
  Input: () => createElement("input"),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: unknown }) =>
    createElement("span", null, children as never),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => null,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
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

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return { ...actual };
});

vi.mock("../pages/trips/constants.js", () => ({
  STATUS_MAP: { upcoming: { label: "Próxima", color: "bg-blue-100 text-blue-800" } } as Record<string, { label: string; color: string }>,
  TRIP_TYPES: [],
  TRIP_TYPE_LABELS: {} as Record<string, string>,
}));

vi.mock("../pages/trips/utils.js", () => ({
  formatCurrency: (v: number) => `R$ ${v}`,
  formatDate: (d: string) => d,
}));

vi.mock("../pages/trips/TripCountdown.js", () => ({
  TripCountdown: () => null,
  OccupancyBar: () => null,
}));

vi.mock("../pages/trips/BoardingPanelModal.js", () => ({
  BoardingPanelModal: () => null,
}));

vi.mock("../pages/trips/TripCard.js", () => ({
  TripCard: () => createElement("div", { "data-testid": "trip-card" }),
  PublishToStoreDialog: () => null,
}));

import { TripList } from "../pages/trips/TripList.js";
import { makeTenantData, makeMe } from "./tenantFixtures.js";

async function renderInListMode(seatMapEnabled: boolean | undefined) {
  mockGetTenant.mockReturnValue(makeTenantData(seatMapEnabled));
  const handle = await renderComponent(createElement(TripList));

  // Switch to list view using the stable data-testid attribute
  const listToggle = handle.container.querySelector<HTMLButtonElement>("[data-testid='view-list']");
  if (!listToggle) throw new Error("List-mode toggle button not found");

  await flushAct(() => {
    listToggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  return handle;
}

// ---------------------------------------------------------------------------
beforeEach(() => {
  mockGetMe.mockReturnValue(makeMe());
  mockGetTenant.mockReturnValue(makeTenantData(false));
});

afterEach(async () => {
  await cleanupRoots();
});

// ---------------------------------------------------------------------------
describe("TripList list-row — seatMapEnabled tenant toggle", () => {
  it("hides the seat-map icon button in list-row when seatMapEnabled is false", async () => {
    const { container } = await renderInListMode(false);
    const link = container.querySelector("a[href='/trips/trip-1/seat-map']");
    expect(link).toBeNull();
  });

  it("shows the seat-map icon button in list-row when seatMapEnabled is true", async () => {
    const { container } = await renderInListMode(true);
    const link = container.querySelector("a[href='/trips/trip-1/seat-map']");
    expect(link).not.toBeNull();
  });

  it("shows the seat-map icon button in list-row when seatMapEnabled is absent (defaults to true)", async () => {
    const { container } = await renderInListMode(undefined);
    const link = container.querySelector("a[href='/trips/trip-1/seat-map']");
    expect(link).not.toBeNull();
  });
});
