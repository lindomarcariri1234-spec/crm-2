/**
 * Tests that PassengersList auto-refetches the boarding panel whenever the
 * seat SSE stream delivers an event (Task #146 / Task #145 regression guard).
 *
 * The SSE hook itself is unit-tested in useSeatStream.test.ts.
 * Here we verify the component wires eventCount → refetch correctly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderComponent, cleanupRoots } from "./eventSourceHarness.js";

// ---------------------------------------------------------------------------
// Controllable mocks
// ---------------------------------------------------------------------------
const mockUseSeatStream = vi.hoisted(() =>
  vi.fn(() => ({ eventCount: 0, occupiedSeats: {}, connected: false })),
);
const mockRefetch = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("wouter", () => ({
  useLocation: () => ["", vi.fn()],
  Link: ({ href, children }: { href: string; children: unknown }) =>
    createElement("a", { href }, children as never),
}));

vi.mock("@/hooks/useSeatStream", () => ({
  useSeatStream: mockUseSeatStream,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetTrip: () => ({ data: null }),
  useGetTripBoardingPanel: () => ({
    data: null,
    isLoading: false,
    refetch: mockRefetch,
  }),
  useCheckInPassenger: () => ({ mutateAsync: vi.fn() }),
  useUndoCheckInPassenger: () => ({ mutateAsync: vi.fn() }),
  useSyncTripPassengers: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdatePassengerBoarding: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@workspace/permissions", () => ({
  RESERVATION_STATUS: { CONFIRMED: "confirmed", PENDING: "pending" },
}));

vi.mock("@/lib/storeApi", () => ({
  storeApi: { post: vi.fn() },
}));

vi.mock("date-fns", () => ({
  format: (d: unknown) => String(d),
  parseISO: (s: string) => s,
}));

vi.mock("date-fns/locale", () => ({
  ptBR: {},
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return { ...actual };
});

vi.mock("../pages/trips/PassengerObsModal.js", () => ({
  PassengerObsModal: () => null,
}));

vi.mock("../pages/trips/PassengersListManifest.js", () => ({
  printPassengersManifest: vi.fn(),
}));

vi.mock("../pages/trips/PassengersListShareDialog.js", () => ({
  PassengersListShareDialog: () => null,
}));

vi.mock("../pages/trips/WhatsAppBroadcastModal.js", () => ({
  WhatsAppBroadcastModal: () => null,
}));

vi.mock("@/lib/utils", () => ({
  formatCpf: (s: string) => s,
  formatDate: (s: string) => s,
}));

vi.mock("@/lib/labels", () => ({
  AGE_CATEGORY_LABELS: {} as Record<string, string>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children }: { children: unknown }) =>
    createElement("button", null, children as never),
}));
vi.mock("@/components/ui/input", () => ({
  Input: () => createElement("input"),
}));
vi.mock("@/components/ui/label", () => ({
  Label: ({ children }: { children: unknown }) =>
    createElement("label", null, children as never),
}));
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: () => createElement("div"),
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  TabsContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  TabsList: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  TabsTrigger: ({ children }: { children: unknown }) =>
    createElement("button", null, children as never),
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

import { PassengersList } from "../pages/trips/PassengersList.js";

beforeEach(() => {
  mockUseSeatStream.mockReturnValue({ eventCount: 0, occupiedSeats: {}, connected: false });
  mockRefetch.mockClear();
});

afterEach(async () => {
  await cleanupRoots();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("PassengersList — SSE-triggered refetch", () => {
  it("does not call refetch on initial render when eventCount is 0", async () => {
    await renderComponent(createElement(PassengersList, { tripId: "trip-1" }));
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("calls refetch on the boarding panel when seatEventCount transitions from 0 to 1", async () => {
    const { rerender } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );
    expect(mockRefetch).not.toHaveBeenCalled();

    mockUseSeatStream.mockReturnValue({ eventCount: 1, occupiedSeats: {}, connected: true });
    await rerender(createElement(PassengersList, { tripId: "trip-1" }));

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("calls refetch again on each subsequent SSE event", async () => {
    const { rerender } = await renderComponent(
      createElement(PassengersList, { tripId: "trip-1" }),
    );

    mockUseSeatStream.mockReturnValue({ eventCount: 1, occupiedSeats: {}, connected: true });
    await rerender(createElement(PassengersList, { tripId: "trip-1" }));

    mockUseSeatStream.mockReturnValue({ eventCount: 2, occupiedSeats: {}, connected: true });
    await rerender(createElement(PassengersList, { tripId: "trip-1" }));

    expect(mockRefetch).toHaveBeenCalledTimes(2);
  });
});
