import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockEmitSeatUpdate, mockResWhere, mockTripLimit, mockSelect, mockGetRedisConnection } =
  vi.hoisted(() => {
    // Chain 1: reservations query — .select().from().where() → awaitable
    const mockResWhere = vi.fn().mockResolvedValue([]);
    const mockResFrom = vi.fn(() => ({ where: mockResWhere }));

    // Chain 2: trip freePassengers query — .select().from().where().limit() → awaitable
    const mockTripLimit = vi.fn().mockResolvedValue([{ freePassengers: [] }]);
    const mockTripWhere = vi.fn(() => ({ limit: mockTripLimit }));
    const mockTripFrom = vi.fn(() => ({ where: mockTripWhere }));

    // mockSelect uses call count (cleared per test by vi.clearAllMocks) to pick chain:
    // call 1 = reservations, call 2 = trip
    const mockSelect = vi.fn(() => {
      const n = mockSelect.mock.calls.length;
      return n === 1 ? { from: mockResFrom } : { from: mockTripFrom };
    });

    const mockEmitSeatUpdate = vi.fn();

    // Default: no Redis connection (null → fallback path)
    const mockGetRedisConnection = vi.fn().mockReturnValue(null);

    return { mockEmitSeatUpdate, mockResWhere, mockTripLimit, mockSelect, mockGetRedisConnection };
  });

vi.mock("@workspace/db", () => ({
  db: { select: mockSelect },
  reservationsTable: {},
  tripsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock("../lib/seat-sse.js", () => ({
  emitSeatUpdate: mockEmitSeatUpdate,
}));

vi.mock("../lib/redis.js", () => ({
  getRedisConnection: mockGetRedisConnection,
}));

import { broadcastSeatUpdate, initSeatUpdateSubscriber, closeSeatUpdateSubscriber } from "../lib/realtime.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockResWhere.mockResolvedValue([]);
  mockTripLimit.mockResolvedValue([{ freePassengers: [] }]);
  // Default: no Redis (fallback path)
  mockGetRedisConnection.mockReturnValue(null);
});

describe("broadcastSeatUpdate — fallback (in-memory) path", () => {
  it("calls emitSeatUpdate with empty seats when no reservations exist", async () => {
    mockResWhere.mockResolvedValue([]);

    await broadcastSeatUpdate("trip-1", "tenant-1");

    expect(mockEmitSeatUpdate).toHaveBeenCalledOnce();
    const payload = mockEmitSeatUpdate.mock.calls[0][0];
    expect(payload.tripId).toBe("trip-1");
    expect(payload.seats).toHaveLength(0);
  });

  it("marks confirmed reservation seats as confirmed", async () => {
    mockResWhere.mockResolvedValue([
      { seats: ["1A", "2B"], status: "confirmed" },
    ]);

    await broadcastSeatUpdate("trip-2", "tenant-1");

    const payload = mockEmitSeatUpdate.mock.calls[0][0];
    expect(payload.seats).toContainEqual({ number: "1A", status: "confirmed" });
    expect(payload.seats).toContainEqual({ number: "2B", status: "confirmed" });
  });

  it("marks pending reservation seats as reserved", async () => {
    mockResWhere.mockResolvedValue([
      { seats: ["3C", "4D"], status: "pending" },
    ]);

    await broadcastSeatUpdate("trip-3", "tenant-1");

    const payload = mockEmitSeatUpdate.mock.calls[0][0];
    expect(payload.seats).toContainEqual({ number: "3C", status: "reserved" });
    expect(payload.seats).toContainEqual({ number: "4D", status: "reserved" });
  });

  it("merges seats from multiple reservations into a single map", async () => {
    mockResWhere.mockResolvedValue([
      { seats: ["1A"], status: "confirmed" },
      { seats: ["2B", "3C"], status: "pending" },
    ]);

    await broadcastSeatUpdate("trip-4", "tenant-1");

    const payload = mockEmitSeatUpdate.mock.calls[0][0];
    expect(payload.seats).toHaveLength(3);
    expect(payload.seats).toContainEqual({ number: "1A", status: "confirmed" });
    expect(payload.seats).toContainEqual({ number: "2B", status: "reserved" });
    expect(payload.seats).toContainEqual({ number: "3C", status: "reserved" });
  });

  it("confirmed status wins over pending when a seat appears in both reservations", async () => {
    mockResWhere.mockResolvedValue([
      { seats: ["5E"], status: "pending" },
      { seats: ["5E"], status: "confirmed" },
    ]);

    await broadcastSeatUpdate("trip-5", "tenant-1");

    const payload = mockEmitSeatUpdate.mock.calls[0][0];
    const seat5E = payload.seats.find((s: { number: string }) => s.number === "5E");
    expect(seat5E?.status).toBe("confirmed");
  });

  it("includes free-passenger seats as free in the payload", async () => {
    mockResWhere.mockResolvedValue([]);
    mockTripLimit.mockResolvedValue([
      { freePassengers: [{ seatNumber: "10A" }, { seatNumber: "11B" }] },
    ]);

    await broadcastSeatUpdate("trip-6", "tenant-1");

    const payload = mockEmitSeatUpdate.mock.calls[0][0];
    expect(payload.seats).toContainEqual({ number: "10A", status: "free" });
    expect(payload.seats).toContainEqual({ number: "11B", status: "free" });
  });
});

// ---------------------------------------------------------------------------
// Helper: build a fake subscriber (returned by conn.duplicate())
// ---------------------------------------------------------------------------
function makeFakeSubscriber() {
  const fake = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
  };
  return fake;
}

// ---------------------------------------------------------------------------
// Helper: build a fake pub connection returned by getRedisConnection()
// ---------------------------------------------------------------------------
function makeFakePub(overrides: { status?: string; publishImpl?: () => Promise<number> } = {}) {
  const fakeSubscriber = makeFakeSubscriber();
  const fakePub = {
    status: overrides.status ?? "ready",
    publish: vi.fn().mockImplementation(overrides.publishImpl ?? (() => Promise.resolve(1))),
    duplicate: vi.fn().mockReturnValue(fakeSubscriber),
  };
  return { fakePub, fakeSubscriber };
}

describe("broadcastSeatUpdate — Redis pub/sub path", () => {
  afterEach(async () => {
    // Reset module-level _subscriber between Redis tests
    await closeSeatUpdateSubscriber();
  });

  it("publishes to Redis channel with correct payload when subscriber is active and connection is ready", async () => {
    const { fakePub } = makeFakePub();
    mockGetRedisConnection.mockReturnValue(fakePub);

    // Activate the subscriber so _subscriber becomes non-null
    initSeatUpdateSubscriber();

    mockResWhere.mockResolvedValue([{ seats: ["7A"], status: "confirmed" }]);

    await broadcastSeatUpdate("trip-redis-1", "tenant-1");

    expect(fakePub.publish).toHaveBeenCalledOnce();
    const [channel, rawPayload] = fakePub.publish.mock.calls[0] as [string, string];
    expect(channel).toBe("seat-updates");
    const payload = JSON.parse(rawPayload) as { tripId: string; seats: { number: string; status: string }[] };
    expect(payload.tripId).toBe("trip-redis-1");
    expect(payload.seats).toContainEqual({ number: "7A", status: "confirmed" });
  });

  it("does NOT call emitSeatUpdate directly when Redis publish succeeds", async () => {
    const { fakePub } = makeFakePub();
    mockGetRedisConnection.mockReturnValue(fakePub);

    initSeatUpdateSubscriber();

    await broadcastSeatUpdate("trip-redis-2", "tenant-1");

    // emitSeatUpdate is called by the subscriber's "message" handler, not directly
    expect(mockEmitSeatUpdate).not.toHaveBeenCalled();
  });

  it("falls back to direct emitSeatUpdate when Redis publish throws", async () => {
    const { fakePub } = makeFakePub({
      publishImpl: () => Promise.reject(new Error("Redis publish error")),
    });
    mockGetRedisConnection.mockReturnValue(fakePub);

    initSeatUpdateSubscriber();

    mockResWhere.mockResolvedValue([{ seats: ["8B"], status: "pending" }]);

    await broadcastSeatUpdate("trip-redis-3", "tenant-1");

    expect(mockEmitSeatUpdate).toHaveBeenCalledOnce();
    const payload = mockEmitSeatUpdate.mock.calls[0][0];
    expect(payload.tripId).toBe("trip-redis-3");
    expect(payload.seats).toContainEqual({ number: "8B", status: "reserved" });
  });

  it("falls back to direct emitSeatUpdate when connection status is not 'ready'", async () => {
    const { fakePub } = makeFakePub({ status: "connecting" });
    mockGetRedisConnection.mockReturnValue(fakePub);

    initSeatUpdateSubscriber();

    mockResWhere.mockResolvedValue([{ seats: ["9C"], status: "confirmed" }]);

    await broadcastSeatUpdate("trip-redis-4", "tenant-1");

    // publish must NOT have been attempted
    expect(fakePub.publish).not.toHaveBeenCalled();
    // direct emit must have been called instead
    expect(mockEmitSeatUpdate).toHaveBeenCalledOnce();
    const payload = mockEmitSeatUpdate.mock.calls[0][0];
    expect(payload.tripId).toBe("trip-redis-4");
    expect(payload.seats).toContainEqual({ number: "9C", status: "confirmed" });
  });

  it("falls back to direct emitSeatUpdate when getRedisConnection returns null for pub even though subscriber is set", async () => {
    // First call (initSeatUpdateSubscriber): return a real-ish connection so _subscriber is set
    const fakeSubscriber = makeFakeSubscriber();
    const fakeConnForInit = {
      status: "ready",
      publish: vi.fn(),
      duplicate: vi.fn().mockReturnValue(fakeSubscriber),
    };
    // Second call onwards (broadcastSeatUpdate): return null (simulates connection lost)
    mockGetRedisConnection
      .mockReturnValueOnce(fakeConnForInit)
      .mockReturnValue(null);

    initSeatUpdateSubscriber();

    await broadcastSeatUpdate("trip-redis-5", "tenant-1");

    expect(fakeConnForInit.publish).not.toHaveBeenCalled();
    expect(mockEmitSeatUpdate).toHaveBeenCalledOnce();
  });
});
