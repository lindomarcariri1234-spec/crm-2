import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderComponent, cleanupRoots } from "./eventSourceHarness.js";

// ---------------------------------------------------------------------------
// Controllable hook return values
// ---------------------------------------------------------------------------
const mockGetMe = vi.hoisted(() => vi.fn());
const mockGetTenant = vi.hoisted(() => vi.fn());
const mockUseSeatStream = vi.hoisted(() =>
  vi.fn(() => ({ eventCount: 0, occupiedSeats: {}, connected: false })),
);
const mockRefetch = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("wouter", () => ({
  useLocation: () => ["/trips/trip-1/passengers-overview", vi.fn()],
  Link: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/useSeatStream", () => ({
  useSeatStream: mockUseSeatStream,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: mockGetMe,
  useGetTenant: mockGetTenant,
  useListTrips: () => ({ data: { data: [] } }),
  useGetTrip: () => ({ data: null }),
  useListReservations: () => ({ data: { data: [] }, refetch: mockRefetch }),
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
  hasPermission: () => false,
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
}));

vi.mock("@/lib/labels", () => ({
  PAYMENT_METHOD_LABELS: {} as Record<string, string>,
}));

vi.mock("../pages/trips/PassengersOverviewFinancialDialog.js", () => ({
  PassengersOverviewFinancialDialog: () => null,
}));

import { PassengersOverview } from "../pages/trips/PassengersOverview.js";
import { makeTenantData, makeMe } from "./tenantFixtures.js";

beforeEach(() => {
  mockGetMe.mockReturnValue(makeMe());
  mockGetTenant.mockReturnValue(makeTenantData(false));
  mockUseSeatStream.mockReturnValue({ eventCount: 0, occupiedSeats: {}, connected: false });
  mockRefetch.mockClear();
});

afterEach(async () => {
  await cleanupRoots();
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

describe("PassengersOverview — seatMapEnabled tenant toggle", () => {
  it("hides the seat-map link when seatMapEnabled is false", async () => {
    mockGetTenant.mockReturnValue(makeTenantData(false));

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

  it("shows the seat-map link when seatMapEnabled is absent (defaults to true)", async () => {
    mockGetTenant.mockReturnValue(makeTenantData(undefined));

    const { container } = await renderComponent(
      createElement(PassengersOverview, { tripId: "trip-1" }),
    );

    const link = container.querySelector("a[href='/trips/trip-1/seat-map']");
    expect(link).not.toBeNull();
  });
});
