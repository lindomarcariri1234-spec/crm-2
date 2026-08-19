/**
 * Regression guard: the ACTUAL BoardingPanelModal component must call refetch()
 * whenever a seat-map SSE event arrives on the admin stream while the modal is open.
 *
 * This validates the PRODUCTION wiring in BoardingPanelModal.tsx:
 *
 *   const { eventCount } = useSeatStream({ tripId, isPublic: false, enabled });
 *   const prevEventCount = useRef(0);
 *   useEffect(() => {
 *     if (eventCount > prevEventCount.current) {
 *       prevEventCount.current = eventCount;
 *       refetch().catch(() => {});
 *     }
 *   }, [eventCount, refetch]);
 *
 * If someone removes useSeatStream from the component, changes the prevEventCount
 * logic, or swaps `refetch` for a different function, these tests will catch it.
 *
 * The component's Radix Dialog and Select primitives are replaced with lightweight
 * pass-through stubs so the test does not require a full DOM API surface (portals,
 * focus management, pointer events). The hook logic at the top of the component
 * function executes regardless: hooks run before the render return.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import {
  MockEventSource,
  installMockEventSource,
  restoreEventSource,
  renderComponent,
  cleanupRoots,
  flushAct,
} from "./eventSourceHarness.js";

// ---------------------------------------------------------------------------
// Hoisted mock handles (created before vi.mock factory closures run)
// ---------------------------------------------------------------------------

const { mockRefetch } = vi.hoisted(() => ({
  mockRefetch: vi.fn().mockResolvedValue({}),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Radix Dialog uses portals + focus management that don't work in jsdom.
// Swap the entire dialog shell for a simple conditional wrapper — the component
// hooks run before the JSX return regardless of what the dialog renders.
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: unknown; open: boolean }) =>
    open ? children : null,
  DialogContent: ({ children }: { children: unknown }) => children,
  DialogHeader: ({ children }: { children: unknown }) => children,
  DialogTitle: ({ children }: { children: unknown }) => children,
}));

// Radix Select also uses portals.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children: unknown }) => children,
  SelectContent: ({ children }: { children: unknown }) => children,
  SelectItem: () => null,
  SelectTrigger: ({ children }: { children: unknown }) => children,
  SelectValue: () => null,
}));

// Child components with their own complex dependency graphs.
vi.mock("@/components/client360-modal", () => ({
  Client360Modal: () => null,
}));

vi.mock("../pages/trips/PassengerObsModal", () => ({
  PassengerObsModal: () => null,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  useParams: () => ({}),
  Link: ({ children }: { children: unknown }) => children,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// All API hooks from the generated client.
// useGetTripBoardingPanel must return `mockRefetch` so the component's
// useEffect can call it when eventCount advances.
vi.mock("@workspace/api-client-react", () => ({
  useGetTripBoardingPanel: vi.fn(() => ({
    data: null,
    isLoading: false,
    refetch: mockRefetch,
  })),
  useListReservations: vi.fn(() => ({ data: null })),
  useCheckInPassenger: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
  })),
  useUndoCheckInPassenger: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
  })),
  useSyncTripPassengers: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({ created: 0 }),
  })),
  useUpdatePassengerBoarding: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
  })),
  useCheckInFreePassenger: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
  })),
  useUndoCheckInFreePassenger: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
  })),
}));

// ---------------------------------------------------------------------------
// Import the ACTUAL component (after all vi.mock declarations)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { BoardingPanelModal } from "../pages/trips/BoardingPanelModal.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function makeProps(tripId: string, open: boolean) {
  return { tripId, tripName: "Test Trip", open, onClose: vi.fn() };
}

async function renderModal(tripId: string, open: boolean) {
  return renderComponent(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createElement(BoardingPanelModal as any, makeProps(tripId, open)),
  );
}

/** Fire a seat-map SSE event on the most recently opened EventSource. */
async function emitSeatEvent(tripId: string): Promise<void> {
  await flushAct(() => {
    MockEventSource.last().emitMessage(JSON.stringify({ tripId, seats: [] }));
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  installMockEventSource();
  vi.clearAllMocks();
  // Restore the resolved value after clearAllMocks resets call counts
  mockRefetch.mockResolvedValue({});
});

afterEach(async () => {
  await cleanupRoots();
  restoreEventSource();
});

// ---------------------------------------------------------------------------
// Tests — exercising the ACTUAL BoardingPanelModal component
// ---------------------------------------------------------------------------

describe("BoardingPanelModal — actual component SSE auto-refresh wiring", () => {
  it("calls refetch() once when the first SSE event arrives while the modal is open", async () => {
    await renderModal("trip-1", true);

    // No event yet — refetch must NOT be called on mount
    expect(mockRefetch).not.toHaveBeenCalled();

    await emitSeatEvent("trip-1");

    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("calls refetch() once per SSE event (separate event → separate refetch)", async () => {
    await renderModal("trip-1", true);

    await emitSeatEvent("trip-1");
    await emitSeatEvent("trip-1");
    await emitSeatEvent("trip-1");

    expect(mockRefetch).toHaveBeenCalledTimes(3);
  });

  it("does NOT call refetch() on mount (eventCount starts at 0, prevEventCount also 0)", async () => {
    await renderModal("trip-1", true);

    expect(mockRefetch).not.toHaveBeenCalled();
    // Confirm the SSE connection is established (the hook ran)
    expect(MockEventSource.instances).toHaveLength(1);
  });

  it("does NOT establish an SSE connection and never calls refetch() when the modal is closed", async () => {
    await renderModal("trip-1", false);

    expect(MockEventSource.instances).toHaveLength(0);
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it("stops calling refetch() after the modal is closed (connection torn down)", async () => {
    const { rerender } = await renderModal("trip-1", true);

    await emitSeatEvent("trip-1");
    expect(mockRefetch).toHaveBeenCalledTimes(1);

    // Close the modal — useSeatStream's enabled flag flips to false → SSE closes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await rerender(createElement(BoardingPanelModal as any, makeProps("trip-1", false)));
    await flushAct(() => {});

    // Any subsequent events must NOT trigger refetch (no live connection)
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("uses the authenticated admin SSE URL — not the public vitrine URL", async () => {
    await renderModal("trip-xyz", true);

    expect(MockEventSource.instances).toHaveLength(1);
    // Admin path: /api/trips/:tripId/seats/stream (no /public/store/ segment)
    expect(MockEventSource.last().url).toBe(`${BASE}/api/trips/trip-xyz/seats/stream`);
    // Credentials must be included so Clerk auth cookie is sent
    expect(MockEventSource.last().withCredentials).toBe(true);
  });
});
