import type { Redis } from "ioredis";
import { db } from "@workspace/db";
import { reservationsTable, tripsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { emitSeatUpdate, type SeatUpdatePayload } from "./seat-sse";
import { RESERVATION_STATUS, ACTIVE_RESERVATION_STATUSES } from "@workspace/permissions";
import { getRedisConnection } from "./redis";
import { logger } from "./logger";

const SEAT_UPDATE_CHANNEL = "seat-updates";

let _subscriber: Redis | null = null;

/**
 * Initialises a dedicated Redis subscriber connection for seat-map fan-out.
 *
 * When called, every instance subscribes to the `seat-updates` Redis channel.
 * `broadcastSeatUpdate` then publishes the computed payload to that channel so
 * ALL instances—not just the one that handled the triggering HTTP request—emit
 * the update to their locally-connected SSE clients.
 *
 * Safe to call even when Redis is not configured: it logs and returns immediately.
 * Call once at server startup (after getRedisConnection has been initialised).
 */
export function initSeatUpdateSubscriber(): void {
  const conn = getRedisConnection();
  if (!conn) {
    logger.info("[seat-sse] Redis not configured — in-memory fan-out only (single-instance mode)");
    return;
  }

  _subscriber = conn.duplicate();

  _subscriber.on("error", (err: Error) => {
    logger.warn({ err }, "[seat-sse] Subscriber connection error");
  });

  void _subscriber
    .subscribe(SEAT_UPDATE_CHANNEL)
    .then(() => {
      logger.info("[seat-sse] Subscribed to Redis seat-updates channel — multi-instance fan-out active");
    })
    .catch((err: unknown) => {
      logger.error({ err }, "[seat-sse] Failed to subscribe to seat-updates channel");
    });

  _subscriber.on("message", (_channel: string, message: string) => {
    try {
      const payload = JSON.parse(message) as SeatUpdatePayload;
      emitSeatUpdate(payload);
    } catch (err) {
      logger.warn({ err }, "[seat-sse] Ignoring malformed seat-update message from Redis");
    }
  });
}

/**
 * Closes the dedicated subscriber connection. Call during graceful shutdown.
 */
export async function closeSeatUpdateSubscriber(): Promise<void> {
  if (_subscriber) {
    await _subscriber.quit().catch(() => {});
    _subscriber = null;
  }
}

/**
 * Queries the current seat occupancy for a trip and broadcasts it to all
 * connected SSE clients.
 *
 * Multi-instance behaviour (when Redis is configured and the subscriber is
 * active): publishes the computed payload to the `seat-updates` Redis channel.
 * Every instance—including this one—receives the message via its subscriber
 * and calls emitSeatUpdate locally.  Only publishes when the connection is
 * in `ready` state to avoid indefinite command-queuing during Redis outages.
 *
 * Single-instance / fallback behaviour: calls emitSeatUpdate directly when
 * Redis is not configured, the subscriber is not initialised, or the publish
 * fails.
 */
export async function broadcastSeatUpdate(tripId: string, tenantId: string): Promise<void> {
  const reservations = await db
    .select({ seats: reservationsTable.seats, status: reservationsTable.status })
    .from(reservationsTable)
    .where(
      and(
        eq(reservationsTable.tripId, tripId),
        eq(reservationsTable.tenantId, tenantId),
        inArray(reservationsTable.status, ACTIVE_RESERVATION_STATUSES),
      ),
    );
  const occupiedMap: Record<string, string> = {};
  for (const r of reservations) {
    const s = r.status === RESERVATION_STATUS.CONFIRMED ? "confirmed" : "reserved";
    for (const seat of r.seats) occupiedMap[seat] = s;
  }

  // Include free-passenger (gratuidade) seats so they appear occupied on the
  // vitrine seat map and SSE updates.
  const [trip] = await db
    .select({ freePassengers: tripsTable.freePassengers })
    .from(tripsTable)
    .where(and(eq(tripsTable.id, tripId), eq(tripsTable.tenantId, tenantId)))
    .limit(1);
  const freePassengers = Array.isArray(trip?.freePassengers)
    ? (trip.freePassengers as Array<{ seatNumber?: string | null }>)
    : [];
  for (const fp of freePassengers) {
    if (fp.seatNumber) occupiedMap[fp.seatNumber] = "free";
  }

  const payload: SeatUpdatePayload = {
    tripId,
    seats: Object.entries(occupiedMap).map(([number, status]) => ({ number, status })),
  };

  // When a subscriber is active and the connection is ready, publish to Redis
  // so ALL instances (including this one) emit via their subscriber callback.
  // Skip publishing if the connection is not ready to avoid blocking the caller
  // on indefinite offline-queue drain during a Redis outage — fall through to
  // direct local emit instead.
  if (_subscriber !== null) {
    const pub = getRedisConnection();
    if (pub?.status === "ready") {
      try {
        await pub.publish(SEAT_UPDATE_CHANNEL, JSON.stringify(payload));
        return; // subscriber handles emitSeatUpdate on every connected instance
      } catch (err) {
        logger.warn({ err }, "[seat-sse] Redis publish failed — falling back to local emit");
      }
    }
  }

  // Fallback: Redis not configured, subscriber not initialised, connection not
  // ready, or publish threw.  Emit directly to this instance's SSE client map.
  emitSeatUpdate(payload);
}
