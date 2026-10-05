import type { Response } from "express";

const clients = new Map<string, Set<Response>>();

/**
 * Per-IP and per-trip connection caps for the anonymous public seat stream.
 *
 * The public SSE endpoint holds connections open indefinitely, so an attacker
 * could exhaust server resources by opening many connections. We bound the
 * number of concurrent streams a single client IP may hold, and the total
 * number of streams attached to a single trip. Both are configurable via env.
 */
const MAX_SEAT_STREAM_CONN_PER_IP =
  Number(process.env.MAX_SEAT_STREAM_CONN_PER_IP) > 0
    ? Number(process.env.MAX_SEAT_STREAM_CONN_PER_IP)
    : 5;
const MAX_SEAT_STREAM_CONN_PER_TRIP =
  Number(process.env.MAX_SEAT_STREAM_CONN_PER_TRIP) > 0
    ? Number(process.env.MAX_SEAT_STREAM_CONN_PER_TRIP)
    : 200;

// Trip IDs are generated as 16-character IDs; 128 chars also leaves room for
// imported UUID-style IDs. Seat labels match the existing 80-character import
// limit. 128 seats is well above a normal vehicle layout while bounding fan-out.
export const SEAT_UPDATE_MAX_TRIP_ID_LENGTH = 128;
export const SEAT_UPDATE_MAX_SEATS = 128;
export const SEAT_UPDATE_MAX_SEAT_NUMBER_LENGTH = 80;
export const SEAT_UPDATE_MAX_SEAT_STATUS_LENGTH = 32;
export const SEAT_UPDATE_MAX_MESSAGE_BYTES = 128 * 1024;

const ipConnections = new Map<string, number>();
const responseIp = new WeakMap<Response, string>();

export const seatStreamLimits = {
  perIp: MAX_SEAT_STREAM_CONN_PER_IP,
  perTrip: MAX_SEAT_STREAM_CONN_PER_TRIP,
};

export function isValidSeatTripId(tripId: unknown): tripId is string {
  return typeof tripId === "string"
    && tripId.trim().length > 0
    && tripId.length <= SEAT_UPDATE_MAX_TRIP_ID_LENGTH;
}

/**
 * Attempts to register an SSE client for a trip, enforcing per-IP and per-trip
 * connection caps. Returns `true` when the client was accepted and added, or
 * `false` when a limit was reached (in which case nothing is registered and the
 * caller should reject the request without holding the connection open).
 */
export function tryAddSeatClient(
  tripId: string,
  res: Response,
  ip: string | null,
): boolean {
  if (!isValidSeatTripId(tripId)) return false;

  const tripCount = clients.get(tripId)?.size ?? 0;
  if (tripCount >= MAX_SEAT_STREAM_CONN_PER_TRIP) return false;

  if (ip) {
    const ipCount = ipConnections.get(ip) ?? 0;
    if (ipCount >= MAX_SEAT_STREAM_CONN_PER_IP) return false;
  }

  if (!clients.has(tripId)) clients.set(tripId, new Set());
  clients.get(tripId)!.add(res);

  if (ip) {
    ipConnections.set(ip, (ipConnections.get(ip) ?? 0) + 1);
    responseIp.set(res, ip);
  }
  return true;
}

export function addSeatClient(tripId: string, res: Response): void {
  if (!isValidSeatTripId(tripId)) {
    throw new TypeError("Invalid trip ID for seat stream");
  }
  if (!clients.has(tripId)) clients.set(tripId, new Set());
  clients.get(tripId)!.add(res);
}

export function removeSeatClient(tripId: string, res: Response): void {
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

export interface SeatUpdatePayload {
  tripId: string;
  seats: Array<{ number: string; status: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate and project the public seat update shape so untrusted Redis extras
 * cannot be copied into every connected SSE frame.
 */
export function parseSeatUpdatePayload(value: unknown): SeatUpdatePayload | null {
  if (
    !isRecord(value)
    || !isValidSeatTripId(value.tripId)
    || !Array.isArray(value.seats)
    || value.seats.length > SEAT_UPDATE_MAX_SEATS
  ) {
    return null;
  }

  const seats: SeatUpdatePayload["seats"] = [];
  for (const item of value.seats) {
    if (
      !isRecord(item)
      || typeof item.number !== "string"
      || item.number.length === 0
      || item.number.length > SEAT_UPDATE_MAX_SEAT_NUMBER_LENGTH
      || typeof item.status !== "string"
      || item.status.length === 0
      || item.status.length > SEAT_UPDATE_MAX_SEAT_STATUS_LENGTH
    ) {
      return null;
    }
    seats.push({ number: item.number, status: item.status });
  }

  const payload = { tripId: value.tripId, seats };
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > SEAT_UPDATE_MAX_MESSAGE_BYTES) {
    return null;
  }
  return payload;
}

interface SeatRefreshPayload {
  tripId: string;
  type: "refresh";
}

function emitSeatStreamPayload(
  tripId: string,
  payload: SeatUpdatePayload | SeatRefreshPayload,
): void {
  if (!isValidSeatTripId(tripId) || payload.tripId !== tripId) return;
  const set = clients.get(tripId);
  if (!set || set.size === 0) return;
  const data = JSON.stringify(payload);
  const dead: Response[] = [];
  for (const res of set) {
    try {
      res.write(`data: ${data}\n\n`);
    } catch {
      dead.push(res);
    }
  }
  for (const res of dead) removeSeatClient(tripId, res);
}

export function emitSeatUpdate(payload: SeatUpdatePayload): void {
  const validatedPayload = parseSeatUpdatePayload(payload);
  if (!validatedPayload) {
    throw new TypeError("Invalid seat update payload");
  }
  emitSeatStreamPayload(validatedPayload.tripId, validatedPayload);
}

/** Sends a trip-only recovery hint to every currently connected seat stream. */
export function emitSeatRefresh(): void {
  for (const tripId of clients.keys()) {
    if (!isValidSeatTripId(tripId)) continue;
    emitSeatStreamPayload(tripId, { type: "refresh", tripId });
  }
}
