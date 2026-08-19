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
  seatStreamLimits,
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
