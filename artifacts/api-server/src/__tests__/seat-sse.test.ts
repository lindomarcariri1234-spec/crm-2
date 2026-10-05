/**
 * Unit tests for the real-time seat-availability broadcaster:
 *   artifacts/api-server/src/lib/seat-sse.ts
 *
 * emitSeatUpdate is the half of the SSE flow Task #38 did not cover (it tested
 * the HTTP lifecycle — store/trip validation, registration, cleanup). Here we
 * exercise the broadcast itself: every connected customer for a trip must
 * receive the live update, dead connections must be pruned, and emitting to a
 * trip nobody is watching must be a safe no-op. A regression here would let a
 * customer pick a seat someone else just booked.
 *
 * The module has no DB/Clerk dependency and keeps its client registry in
 * module-level state, so we drive the real functions directly with fake
 * Response-like objects and clean up registered clients after every test.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Response } from "express";
import {
  addSeatClient,
  tryAddSeatClient,
  removeSeatClient,
  emitSeatUpdate,
  emitSeatRefresh,
  isValidSeatTripId,
  parseSeatUpdatePayload,
  seatStreamLimits,
  SEAT_UPDATE_MAX_SEATS,
  SEAT_UPDATE_MAX_SEAT_NUMBER_LENGTH,
  SEAT_UPDATE_MAX_SEAT_STATUS_LENGTH,
  SEAT_UPDATE_MAX_TRIP_ID_LENGTH,
  type SeatUpdatePayload,
} from "../lib/seat-sse.js";

// Track every client we register so module-level state never leaks between
// tests (a stray registration would corrupt the "no clients" assertions).
const registered: Array<{ tripId: string; res: Response }> = [];

function makeClient(write?: () => void): Response {
  return { write: vi.fn(write) } as unknown as Response;
}

function register(tripId: string, res: Response): Response {
  addSeatClient(tripId, res);
  registered.push({ tripId, res });
  return res;
}

afterEach(() => {
  for (const { tripId, res } of registered) removeSeatClient(tripId, res);
  registered.length = 0;
});

const samplePayload = (tripId: string): SeatUpdatePayload => ({
  tripId,
  seats: [
    { number: "1", status: "occupied" },
    { number: "2", status: "available" },
  ],
});

describe("emitSeatUpdate", () => {
  it("writes the SSE-formatted payload to every client registered for the tripId", () => {
    const tripId = "trip-write-all";
    const a = register(tripId, makeClient());
    const b = register(tripId, makeClient());

    const payload = samplePayload(tripId);
    emitSeatUpdate(payload);

    const expected = `data: ${JSON.stringify(payload)}\n\n`;
    expect(a.write).toHaveBeenCalledTimes(1);
    expect(a.write).toHaveBeenCalledWith(expected);
    expect(b.write).toHaveBeenCalledTimes(1);
    expect(b.write).toHaveBeenCalledWith(expected);
  });

  it("only notifies clients registered for the targeted tripId", () => {
    const target = register("trip-target", makeClient());
    const other = register("trip-other", makeClient());

    emitSeatUpdate(samplePayload("trip-target"));

    expect(target.write).toHaveBeenCalledTimes(1);
    expect(other.write).not.toHaveBeenCalled();
  });

  it("sends each seat stream a refresh hint containing only its own trip id", () => {
    const firstTripClient = register("trip-refresh-one", makeClient());
    const secondClientForTrip = register("trip-refresh-one", makeClient());
    const otherTripClient = register("trip-refresh-two", makeClient());

    emitSeatRefresh();

    expect(firstTripClient.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ type: "refresh", tripId: "trip-refresh-one" })}\n\n`,
    );
    expect(secondClientForTrip.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ type: "refresh", tripId: "trip-refresh-one" })}\n\n`,
    );
    expect(otherTripClient.write).toHaveBeenCalledWith(
      `data: ${JSON.stringify({ type: "refresh", tripId: "trip-refresh-two" })}\n\n`,
    );
  });

  it("prunes a dead client whose write throws and keeps delivering to healthy ones", () => {
    const tripId = "trip-prune";
    const dead = register(
      tripId,
      makeClient(() => {
        throw new Error("EPIPE: broken pipe");
      }),
    );
    const live = register(tripId, makeClient());

    // First emit: dead.write throws → that client is pruned; live still gets it.
    emitSeatUpdate(samplePayload(tripId));
    expect(dead.write).toHaveBeenCalledTimes(1);
    expect(live.write).toHaveBeenCalledTimes(1);

    // Second emit: the pruned client is gone, so only the live client is hit.
    emitSeatUpdate(samplePayload(tripId));
    expect(dead.write).toHaveBeenCalledTimes(1); // not called again
    expect(live.write).toHaveBeenCalledTimes(2);
  });

  it("is a safe no-op when no clients are registered for the tripId", () => {
    expect(() => emitSeatUpdate(samplePayload("trip-empty"))).not.toThrow();
  });

  it("preserves the valid frame at every configured seat-update limit", () => {
    const tripId = "t".repeat(SEAT_UPDATE_MAX_TRIP_ID_LENGTH);
    const response = makeClient();
    const payload = {
      tripId,
      seats: Array.from({ length: SEAT_UPDATE_MAX_SEATS }, (_, index) => ({
        number: index === 0
          ? "n".repeat(SEAT_UPDATE_MAX_SEAT_NUMBER_LENGTH)
          : `seat-${index}`,
        status: index === 0
          ? "s".repeat(SEAT_UPDATE_MAX_SEAT_STATUS_LENGTH)
          : "occupied",
        internalMetadata: "must-not-be-forwarded",
      })),
      internalMetadata: "must-not-be-forwarded",
    };
    const expected = {
      tripId,
      seats: payload.seats.map(({ number, status }) => ({ number, status })),
    };

    expect(isValidSeatTripId(tripId)).toBe(true);
    expect(parseSeatUpdatePayload(payload)).toEqual(expected);
    expect(register(tripId, response)).toBe(response);

    emitSeatUpdate(payload as unknown as SeatUpdatePayload);

    expect(response.write).toHaveBeenCalledOnce();
    expect(response.write).toHaveBeenCalledWith(`data: ${JSON.stringify(expected)}\n\n`);
  });

  it("rejects oversized trip IDs, seat lists, seat numbers, and statuses before fan-out", () => {
    const response = register("trip-invalid-bounds", makeClient());
    const invalidPayloads: unknown[] = [
      { tripId: "t".repeat(SEAT_UPDATE_MAX_TRIP_ID_LENGTH + 1), seats: [] },
      {
        tripId: "trip-too-many-seats",
        seats: Array.from({ length: SEAT_UPDATE_MAX_SEATS + 1 }, (_, index) => ({
          number: `seat-${index}`,
          status: "occupied",
        })),
      },
      {
        tripId: "trip-long-seat-number",
        seats: [{ number: "n".repeat(SEAT_UPDATE_MAX_SEAT_NUMBER_LENGTH + 1), status: "free" }],
      },
      {
        tripId: "trip-long-seat-status",
        seats: [{ number: "1A", status: "s".repeat(SEAT_UPDATE_MAX_SEAT_STATUS_LENGTH + 1) }],
      },
    ];

    for (const payload of invalidPayloads) {
      expect(parseSeatUpdatePayload(payload)).toBeNull();
      expect(() => emitSeatUpdate(payload as SeatUpdatePayload)).toThrow(
        "Invalid seat update payload",
      );
    }

    expect(response.write).not.toHaveBeenCalled();
  });

  it("is a safe no-op after the last client for a tripId has been pruned", () => {
    const tripId = "trip-drains";
    const dead = register(
      tripId,
      makeClient(() => {
        throw new Error("write after end");
      }),
    );

    // Pruning the only client deletes the trip's registry entry.
    emitSeatUpdate(samplePayload(tripId));
    expect(dead.write).toHaveBeenCalledTimes(1);

    // No clients remain → emit must not throw and must not touch the dead client.
    expect(() => emitSeatUpdate(samplePayload(tripId))).not.toThrow();
    expect(dead.write).toHaveBeenCalledTimes(1);
  });
});

/**
 * tryAddSeatClient enforces the DoS guard: the anonymous public seat stream is
 * held open indefinitely, so we bound concurrent connections per IP and per
 * trip. These tests register via tryAddSeatClient (tracking everything for
 * cleanup) and assert the caps reject excess attempts without registering them.
 */
describe("tryAddSeatClient — connection caps", () => {
  function tryRegister(tripId: string, ip: string | null, res?: Response): { ok: boolean; res: Response } {
    const client = res ?? makeClient();
    const ok = tryAddSeatClient(tripId, client, ip);
    if (ok) registered.push({ tripId, res: client });
    return { ok, res: client };
  }

  it("does not register a trip ID beyond the seat-stream limit", () => {
    const tripId = "t".repeat(SEAT_UPDATE_MAX_TRIP_ID_LENGTH + 1);
    const response = makeClient();

    expect(isValidSeatTripId(tripId)).toBe(false);
    expect(tryAddSeatClient(tripId, response, null)).toBe(false);
    expect(() => addSeatClient(tripId, response)).toThrow("Invalid trip ID for seat stream");
  });

  it("accepts connections up to the per-IP cap, then rejects further ones from the same IP", () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < seatStreamLimits.perIp; i++) {
      expect(tryRegister(`trip-ip-${i}`, ip).ok).toBe(true);
    }
    // One more from the same IP (even on a fresh trip) must be rejected.
    expect(tryRegister("trip-ip-over", ip).ok).toBe(false);
  });

  it("frees an IP slot when a client disconnects, allowing a new connection", () => {
    const ip = "203.0.113.20";
    const opened: Response[] = [];
    for (let i = 0; i < seatStreamLimits.perIp; i++) {
      const { ok, res } = tryRegister(`trip-free-${i}`, ip);
      expect(ok).toBe(true);
      opened.push(res);
    }
    // At cap → next is rejected.
    expect(tryAddSeatClient("trip-free-over", makeClient(), ip)).toBe(false);

    // Disconnect one → a slot frees up.
    removeSeatClient("trip-free-0", opened[0]);
    expect(tryRegister("trip-free-again", ip).ok).toBe(true);
  });

  it("does not count connections without an IP against the per-IP cap", () => {
    for (let i = 0; i < seatStreamLimits.perIp + 3; i++) {
      expect(tryRegister(`trip-noip-${i}`, null).ok).toBe(true);
    }
  });

  it("rejects connections beyond the per-trip cap regardless of IP", () => {
    const tripId = "trip-crowded";
    // Each connection uses a distinct IP so the per-IP cap is never the limiter.
    for (let i = 0; i < seatStreamLimits.perTrip; i++) {
      expect(tryRegister(tripId, `198.51.100.${i}`).ok).toBe(true);
    }
    expect(tryRegister(tripId, "198.51.100.250").ok).toBe(false);
  });
});
