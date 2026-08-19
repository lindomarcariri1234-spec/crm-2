import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSeatStream } from "../hooks/useSeatStream.js";
import {
  MockEventSource,
  installMockEventSource,
  restoreEventSource,
} from "./eventSourceHarness.js";

// The hook prefixes every URL with import.meta.env.BASE_URL (trailing slash
// stripped). Mirror that exactly so assertions stay correct regardless of the
// base configured for the test environment.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Opts = Parameters<typeof useSeatStream>[0];
type Result = ReturnType<typeof useSeatStream>;

// MockEventSource (the jsdom EventSource stub) lives in eventSourceHarness.ts —
// it is shared with the NotificationBell and BoardingControlPage SSE tests.

interface Handle {
  result: { current: Result };
  rerender: (props: Opts) => Promise<void>;
  unmount: () => Promise<void>;
}

// Roots created during a test are auto-unmounted in afterEach so an effect from
// one test can never leak into the next.
const activeRoots: Root[] = [];

// Minimal renderHook so we don't pull in @testing-library/react: render the hook
// inside a throwaway component and expose its latest return value.
async function renderSeatStream(initial: Opts): Promise<Handle> {
  const result = { current: undefined as unknown as Result };
  let props = initial;

  function TestComponent() {
    result.current = useSeatStream(props);
    return null;
  }

  const container = document.createElement("div");
  const root: Root = createRoot(container);
  activeRoots.push(root);
  await act(async () => {
    root.render(createElement(TestComponent));
  });

  return {
    result,
    rerender: async (next: Opts) => {
      props = next;
      await act(async () => {
        root.render(createElement(TestComponent));
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

async function emit(fn: (es: MockEventSource) => void): Promise<void> {
  await act(async () => {
    fn(MockEventSource.last());
  });
}

beforeEach(() => {
  installMockEventSource();
});

afterEach(async () => {
  for (const root of activeRoots) {
    await act(async () => {
      root.unmount();
    });
  }
  activeRoots.length = 0;

  restoreEventSource();
});

describe("useSeatStream — stream URL selection", () => {
  it("builds the public storefront URL when isPublic and slug are provided", async () => {
    await renderSeatStream({ tripId: "trip-1", slug: "loja-x", isPublic: true });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.last().url).toBe(
      `${BASE}/api/public/store/loja-x/trips/trip-1/seats/stream`,
    );
    expect(MockEventSource.last().withCredentials).toBe(true);
  });

  it("builds the authenticated admin URL when isPublic is false", async () => {
    await renderSeatStream({ tripId: "trip-1", slug: "loja-x", isPublic: false });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.last().url).toBe(`${BASE}/api/trips/trip-1/seats/stream`);
  });

  it("falls back to the admin URL when public is requested without a slug", async () => {
    await renderSeatStream({ tripId: "trip-1", isPublic: true });

    expect(MockEventSource.last().url).toBe(`${BASE}/api/trips/trip-1/seats/stream`);
  });

  it("URI-encodes the slug and trip id", async () => {
    await renderSeatStream({ tripId: "trip/1", slug: "minha loja", isPublic: true });

    expect(MockEventSource.last().url).toBe(
      `${BASE}/api/public/store/${encodeURIComponent("minha loja")}/trips/${encodeURIComponent("trip/1")}/seats/stream`,
    );
  });
});

describe("useSeatStream — disabled / missing trip", () => {
  it("does not open a connection when enabled is false", async () => {
    const { result } = await renderSeatStream({
      tripId: "trip-1",
      slug: "loja-x",
      isPublic: true,
      enabled: false,
    });

    expect(MockEventSource.instances).toHaveLength(0);
    expect(result.current.connected).toBe(false);
    expect(result.current.occupiedSeats).toEqual({});
  });

  it("does not open a connection when tripId is null", async () => {
    const { result } = await renderSeatStream({ tripId: null, slug: "loja-x" });

    expect(MockEventSource.instances).toHaveLength(0);
    expect(result.current.connected).toBe(false);
  });
});

describe("useSeatStream — incoming seat updates", () => {
  it("parses a seat-update event into the occupiedSeats map", async () => {
    const { result } = await renderSeatStream({ tripId: "trip-1", slug: "loja-x" });

    await emit((es) =>
      es.emitMessage(
        JSON.stringify({
          tripId: "trip-1",
          seats: [
            { number: "1A", status: "occupied" },
            { number: "2B", status: "reserved" },
          ],
        }),
      ),
    );

    expect(result.current.occupiedSeats).toEqual({ "1A": "occupied", "2B": "reserved" });
    expect(result.current.eventCount).toBe(1);
  });

  it("replaces the map and increments eventCount on each event", async () => {
    const { result } = await renderSeatStream({ tripId: "trip-1", slug: "loja-x" });

    await emit((es) =>
      es.emitMessage(JSON.stringify({ tripId: "trip-1", seats: [{ number: "1A", status: "occupied" }] })),
    );
    await emit((es) =>
      es.emitMessage(JSON.stringify({ tripId: "trip-1", seats: [{ number: "2B", status: "reserved" }] })),
    );

    expect(result.current.occupiedSeats).toEqual({ "2B": "reserved" });
    expect(result.current.eventCount).toBe(2);
  });

  it("ignores events whose tripId does not match the subscribed trip", async () => {
    const { result } = await renderSeatStream({ tripId: "trip-1", slug: "loja-x" });

    await emit((es) =>
      es.emitMessage(
        JSON.stringify({ tripId: "other-trip", seats: [{ number: "1A", status: "occupied" }] }),
      ),
    );

    expect(result.current.occupiedSeats).toEqual({});
    expect(result.current.eventCount).toBe(0);
  });

  it("ignores malformed (non-JSON) events without throwing", async () => {
    const { result } = await renderSeatStream({ tripId: "trip-1", slug: "loja-x" });

    await emit((es) => es.emitMessage("not-json{"));

    expect(result.current.occupiedSeats).toEqual({});
    expect(result.current.eventCount).toBe(0);
  });
});

describe("useSeatStream — connection state", () => {
  it("is disconnected until the stream opens, then connected on open", async () => {
    const { result } = await renderSeatStream({ tripId: "trip-1", slug: "loja-x" });
    expect(result.current.connected).toBe(false);

    await emit((es) => es.emitOpen());

    expect(result.current.connected).toBe(true);
  });

  it("marks disconnected on error but does NOT close (native auto-reconnect)", async () => {
    const { result } = await renderSeatStream({ tripId: "trip-1", slug: "loja-x" });
    await emit((es) => es.emitOpen());
    expect(result.current.connected).toBe(true);

    await emit((es) => es.emitError());

    expect(result.current.connected).toBe(false);
    expect(MockEventSource.last().closed).toBe(false);
  });
});

describe("useSeatStream — cleanup", () => {
  it("closes the EventSource on unmount", async () => {
    const handle = await renderSeatStream({ tripId: "trip-1", slug: "loja-x" });
    const es = MockEventSource.last();

    await handle.unmount();

    expect(es.closeCount).toBe(1);
  });

  it("closes the connection and resets state when enabled flips to false", async () => {
    const { result, rerender } = await renderSeatStream({ tripId: "trip-1", slug: "loja-x" });
    const es = MockEventSource.last();
    await emit((e) => e.emitOpen());
    await emit((e) =>
      e.emitMessage(JSON.stringify({ tripId: "trip-1", seats: [{ number: "1A", status: "occupied" }] })),
    );
    expect(result.current.occupiedSeats).toEqual({ "1A": "occupied" });

    await rerender({ tripId: "trip-1", slug: "loja-x", enabled: false });

    expect(es.closeCount).toBe(1);
    expect(MockEventSource.instances).toHaveLength(1); // no new connection
    expect(result.current.connected).toBe(false);
    expect(result.current.occupiedSeats).toEqual({});
  });

  it("closes the old connection and opens a new one when tripId changes", async () => {
    const { rerender } = await renderSeatStream({ tripId: "trip-1", slug: "loja-x" });
    const first = MockEventSource.last();

    await rerender({ tripId: "trip-2", slug: "loja-x" });

    expect(first.closeCount).toBe(1);
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.last().url).toBe(
      `${BASE}/api/public/store/loja-x/trips/trip-2/seats/stream`,
    );
  });
});
