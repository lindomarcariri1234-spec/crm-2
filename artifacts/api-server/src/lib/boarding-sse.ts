import type { Response } from "express";

const clients = new Map<string, Set<Response>>();

/**
 * Per-IP and per-trip connection caps for the authenticated boarding-control
 * stream.
 *
 * The boarding-control SSE endpoint holds connections open indefinitely, so a
 * buggy or abusive client could exhaust server resources by opening many
 * concurrent streams. We bound the number of concurrent streams a single
 * client IP may hold, and the total number of streams attached to a single
 * trip. Both are configurable via env. Mirrors the public seat stream guard in
 * seat-sse.ts.
 */
const MAX_BOARDING_STREAM_CONN_PER_IP =
  Number(process.env.MAX_BOARDING_STREAM_CONN_PER_IP) > 0
    ? Number(process.env.MAX_BOARDING_STREAM_CONN_PER_IP)
    : 5;
const MAX_BOARDING_STREAM_CONN_PER_TRIP =
  Number(process.env.MAX_BOARDING_STREAM_CONN_PER_TRIP) > 0
    ? Number(process.env.MAX_BOARDING_STREAM_CONN_PER_TRIP)
    : 200;

const ipConnections = new Map<string, number>();
const responseIp = new WeakMap<Response, string>();

export const boardingStreamLimits = {
  perIp: MAX_BOARDING_STREAM_CONN_PER_IP,
  perTrip: MAX_BOARDING_STREAM_CONN_PER_TRIP,
};

/**
 * Attempts to register an SSE client for a trip, enforcing per-IP and per-trip
 * connection caps. Returns `true` when the client was accepted and added, or
 * `false` when a limit was reached (in which case nothing is registered and the
 * caller should reject the request without holding the connection open).
 */
export function tryAddBoardingClient(
  tripId: string,
  res: Response,
  ip: string | null,
): boolean {
  const tripCount = clients.get(tripId)?.size ?? 0;
  if (tripCount >= MAX_BOARDING_STREAM_CONN_PER_TRIP) return false;

  if (ip) {
    const ipCount = ipConnections.get(ip) ?? 0;
    if (ipCount >= MAX_BOARDING_STREAM_CONN_PER_IP) return false;
  }

  if (!clients.has(tripId)) clients.set(tripId, new Set());
  clients.get(tripId)!.add(res);

  if (ip) {
    ipConnections.set(ip, (ipConnections.get(ip) ?? 0) + 1);
    responseIp.set(res, ip);
  }
  return true;
}

export function addBoardingClient(tripId: string, res: Response): void {
  if (!clients.has(tripId)) clients.set(tripId, new Set());
  clients.get(tripId)!.add(res);
}

export function removeBoardingClient(tripId: string, res: Response): void {
  const set = clients.get(tripId);
  if (set) {
    set.delete(res);
    if (set.size === 0) clients.delete(tripId);
  }

  const ip = responseIp.get(res);
  if (ip) {
    const count = (ipConnections.get(ip) ?? 0) - 1;
    if (count <= 0) ipConnections.delete(ip);
    else ipConnections.set(ip, count);
    responseIp.delete(res);
  }
}

export function emitBoardingUpdate(tripId: string): void {
  const set = clients.get(tripId);
  if (!set || set.size === 0) return;
  const data = JSON.stringify({ type: "refresh", tripId });
  const dead: Response[] = [];
  for (const res of set) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch {
      dead.push(res);
    }
  }
  for (const res of dead) removeBoardingClient(tripId, res);
}
