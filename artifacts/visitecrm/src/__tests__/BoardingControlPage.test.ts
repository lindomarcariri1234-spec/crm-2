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

// wouter's useLocation and the toast hook are irrelevant to the SSE behaviour;
// stub them so the page renders standalone. The returned values MUST be stable
// across renders: fetchData's useCallback depends on `toast`, so a fresh toast
// per render would re-create fetchData every render and loop the effects forever.
const navigate = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/trips/trip-1/boarding", navigate],
}));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

// Leaflet is dynamically imported inside an effect and only manipulates a map we
// never assert on. Provide a chainable stub so the import resolves cleanly.
vi.mock("leaflet", () => {
  const map = {
    setView: () => map,
    remove: () => {},
  };
  const L = {
    Icon: { Default: { prototype: {}, mergeOptions: () => {} } },
    map: () => map,
    tileLayer: () => ({ addTo: () => {} }),
    divIcon: () => ({}),
    marker: () => ({ addTo: () => ({ bindPopup: () => {} }), setLatLng: () => {} }),
  };
  return { ...L, default: L };
});

import { BoardingControlPage } from "../pages/trips/BoardingControlPage.js";

function boardingData(overrides: Record<string, unknown> = {}) {
  return {
    tripId: "trip-1",
    tripName: "Praia Grande",
    status: "boarding",
    checkedIn: 2,
    absent: 0,
    pending: 3,
    total: 5,
    absentPassengers: [],
    guideLocation: null,
    boardingPoints: [],
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
const fetchHost = globalThis as unknown as { fetch?: unknown };
let originalFetch: unknown;

beforeEach(() => {
  installMockEventSource();
  originalFetch = fetchHost.fetch;
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => boardingData(),
  });
  fetchHost.fetch = fetchMock;
});

afterEach(async () => {
  await cleanupRoots();
  restoreEventSource();
  fetchHost.fetch = originalFetch;
});

describe("BoardingControlPage — SSE wiring", () => {
  it("opens the boarding-live stream for the trip with credentials", async () => {
    await renderComponent(createElement(BoardingControlPage, { tripId: "trip-1" }));

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.last().url).toBe("/api/trips/trip-1/boarding-live/stream");
    expect(MockEventSource.last().withCredentials).toBe(true);
  });

  it("renders the initial live counts fetched on mount", async () => {
    const { container } = await renderComponent(
      createElement(BoardingControlPage, { tripId: "trip-1" }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/trips/trip-1/boarding-live",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(container.textContent).toContain("Praia Grande");
  });

  it("re-fetches and updates the UI when a refresh event arrives", async () => {
    const { container } = await renderComponent(
      createElement(BoardingControlPage, { tripId: "trip-1" }),
    );

    const callsAfterMount = fetchMock.mock.calls.length;

    // Next fetch returns a fully-boarded trip.
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => boardingData({ checkedIn: 5, pending: 0 }),
    });

    await flushAct(() =>
      MockEventSource.last().emitMessage(JSON.stringify({ type: "refresh" })),
    );

    expect(fetchMock.mock.calls.length).toBe(callsAfterMount + 1);
    expect(container.textContent).toContain("Embarque completo — pode partir!");
  });

  it("ignores events without a refresh type", async () => {
    await renderComponent(createElement(BoardingControlPage, { tripId: "trip-1" }));
    const callsAfterMount = fetchMock.mock.calls.length;

    await flushAct(() =>
      MockEventSource.last().emitMessage(JSON.stringify({ type: "heartbeat" })),
    );

    expect(fetchMock.mock.calls.length).toBe(callsAfterMount);
  });

  it("ignores malformed (non-JSON) events without throwing", async () => {
    await renderComponent(createElement(BoardingControlPage, { tripId: "trip-1" }));
    const callsAfterMount = fetchMock.mock.calls.length;

    await flushAct(() => MockEventSource.last().emitMessage("not-json{"));

    expect(fetchMock.mock.calls.length).toBe(callsAfterMount);
  });

  it("closes the stream on unmount (no leaked connection)", async () => {
    const handle = await renderComponent(
      createElement(BoardingControlPage, { tripId: "trip-1" }),
    );
    const es = MockEventSource.last();

    await handle.unmount();

    expect(es.closeCount).toBe(1);
  });

  it("reopens the stream when the trip id changes", async () => {
    const handle = await renderComponent(
      createElement(BoardingControlPage, { tripId: "trip-1" }),
    );
    const first = MockEventSource.last();

    await handle.rerender(createElement(BoardingControlPage, { tripId: "trip-2" }));

    expect(first.closeCount).toBe(1);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.last().url).toBe("/api/trips/trip-2/boarding-live/stream");
  });
});
