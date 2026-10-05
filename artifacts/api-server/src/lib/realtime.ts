import type { Redis } from "ioredis";
import { db } from "@workspace/db";
import { reservationsTable, tripsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { emitSeatRefresh, emitSeatUpdate, type SeatUpdatePayload } from "./seat-sse";
import {
  emitSupportTicketRefresh,
  emitSupportTicketUpdate,
  type SupportTicketBroadcastUpdate,
  type SupportTicketUpdatePayload,
} from "./support-ticket-sse";
import { RESERVATION_STATUS, ACTIVE_RESERVATION_STATUSES } from "@workspace/permissions";
import { getRedisConnection } from "./redis";
import { logger } from "./logger";
import { generateId } from "./id";

const SEAT_UPDATE_CHANNEL = "seat-updates";
const SUPPORT_TICKET_UPDATE_CHANNEL = "support-ticket-updates";

function toPublicSupportTicketPayload(
  payload: SupportTicketUpdatePayload,
): SupportTicketUpdatePayload {
  return {
    eventId: payload.eventId,
    type: payload.type,
    ticketId: payload.type === "ticket" ? payload.ticketId : null,
  };
}

function isSupportTicketBroadcastUpdate(update: unknown): update is SupportTicketBroadcastUpdate {
  if (!update || typeof update !== "object") return false;
  const payload = update as { type?: unknown; ticketId?: unknown };
  if (payload.type === "ticket") {
    return typeof payload.ticketId === "string" && payload.ticketId.trim().length > 0;
  }
  return payload.type === "queues" && payload.ticketId === null;
}

let _subscriber: Redis | null = null;
let _cancelRecoveryRetry: (() => void) | null = null;

/**
 * Initialises a dedicated Redis subscriber connection for realtime fan-out.
 *
 * Every instance subscribes to the seat and support-ticket channels. Publishers
 * send events through Redis so all instances emit to their local SSE clients.
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
  const subscriber = _subscriber;
  let subscriptionsActive = false;
  let recoveryPending = false;
  let recoveryGeneration = 0;
  let recoveryInFlight = false;
  let subscriberReady = false;
  let recoveryRetryCount = 0;
  let recoveryRetryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRecoveryRetry = () => {
    if (recoveryRetryTimer !== null) {
      clearTimeout(recoveryRetryTimer);
      recoveryRetryTimer = null;
    }
  };
  _cancelRecoveryRetry = clearRecoveryRetry;

  function scheduleRecoveryRetry(generation: number): void {
    if (
      _subscriber !== subscriber
      || !recoveryPending
      || !subscriberReady
      || generation !== recoveryGeneration
    ) {
      return;
    }

    clearRecoveryRetry();
    const delayMs = Math.min(250 * 2 ** recoveryRetryCount, 5_000);
    recoveryRetryCount += 1;
    recoveryRetryTimer = setTimeout(() => {
      recoveryRetryTimer = null;
      attemptRecoverySubscribe();
    }, delayMs);
  }

  function attemptRecoverySubscribe(): void {
    if (
      _subscriber !== subscriber
      || !recoveryPending
      || !subscriberReady
      || recoveryInFlight
    ) {
      return;
    }

    clearRecoveryRetry();
    recoveryInFlight = true;
    const generation = recoveryGeneration;
    void subscriber
      .subscribe(SEAT_UPDATE_CHANNEL, SUPPORT_TICKET_UPDATE_CHANNEL)
      .then(() => {
        recoveryInFlight = false;
        if (_subscriber !== subscriber || !recoveryPending) return;
        if (generation !== recoveryGeneration) {
          // A later disconnect happened while this acknowledgement was pending.
          // If Redis is already ready again, subscribe once more for that cycle.
          if (subscriberReady) attemptRecoverySubscribe();
          return;
        }

        const wasActive = subscriptionsActive;
        subscriptionsActive = true;
        recoveryPending = false;
        recoveryRetryCount = 0;
        clearRecoveryRetry();
        emitSeatRefresh();
        emitSupportTicketRefresh(generateId());
        logger.info(
          { phase: wasActive ? "recovery" : "startup-recovery" },
          "[realtime] Redis SSE subscriptions restored; refreshing connected seat maps and ticket inboxes",
        );
      })
      .catch((err: unknown) => {
        recoveryInFlight = false;
        if (_subscriber !== subscriber) return;
        logger.error({ err }, "[realtime] Failed to restore Redis SSE subscriptions");
        if (!recoveryPending) return;
        if (generation !== recoveryGeneration) {
          if (subscriberReady) attemptRecoverySubscribe();
          return;
        }
        scheduleRecoveryRetry(generation);
      });
  }

  subscriber.on("error", (err: Error) => {
    logger.warn({ err }, "[seat-sse] Subscriber connection error");
  });

  subscriber.on("reconnecting", () => {
    subscriberReady = false;
    clearRecoveryRetry();
    recoveryPending = true;
    recoveryGeneration += 1;
    recoveryRetryCount = 0;
  });

  // Pub/Sub does not replay messages lost while this connection is offline.
  // ioredis emits "ready" before its automatic resubscribe is acknowledged,
  // so refresh open seat and ticket streams only after explicit subscribe succeeds.
  subscriber.on("ready", () => {
    subscriberReady = true;
    attemptRecoverySubscribe();
  });

  recoveryInFlight = true;
  const initialGeneration = recoveryGeneration;
  void subscriber
    .subscribe(SEAT_UPDATE_CHANNEL, SUPPORT_TICKET_UPDATE_CHANNEL)
    .then(() => {
      recoveryInFlight = false;
      if (_subscriber !== subscriber) return;

      if (initialGeneration !== recoveryGeneration) {
        recoveryPending = true;
        if (subscriberReady) attemptRecoverySubscribe();
        return;
      }

      subscriptionsActive = true;
      recoveryPending = false;
      recoveryRetryCount = 0;
      clearRecoveryRetry();
      emitSeatRefresh();
      emitSupportTicketRefresh(generateId());
      logger.info("[realtime] Subscribed to Redis SSE channels — multi-instance fan-out active");
    })
    .catch((err: unknown) => {
      recoveryInFlight = false;
      if (_subscriber !== subscriber) return;
      logger.error({ err }, "[realtime] Failed to subscribe to Redis SSE channels");
      recoveryPending = true;
      if (initialGeneration !== recoveryGeneration) {
        if (subscriberReady) attemptRecoverySubscribe();
        return;
      }
      scheduleRecoveryRetry(initialGeneration);
    });

  subscriber.on("message", (channel: string, message: string) => {
    if (!subscriptionsActive || recoveryPending) return;
    if (channel === SUPPORT_TICKET_UPDATE_CHANNEL) {
      try {
        const envelope = JSON.parse(message) as {
          tenantId?: unknown;
          payload?: unknown;
        };
        const payload = envelope.payload as SupportTicketUpdatePayload | undefined;
        if (
          typeof envelope.tenantId !== "string"
          || !envelope.tenantId.trim()
          || !payload
          || typeof payload.eventId !== "string"
          || !payload.eventId.trim()
          || (payload.type !== "ticket" && payload.type !== "queues")
          || (
            payload.type === "ticket"
            && (typeof payload.ticketId !== "string" || !payload.ticketId.trim())
          )
          || (payload.type === "queues" && payload.ticketId !== null)
        ) {
          return;
        }
        // Redis payloads can carry fields outside the public SSE contract; never relay them.
        emitSupportTicketUpdate(envelope.tenantId, toPublicSupportTicketPayload(payload));
      } catch (err) {
        logger.warn({ err }, "[support-ticket-sse] Ignoring malformed Redis update");
      }
      return;
    }
    if (channel !== SEAT_UPDATE_CHANNEL) return;
    try {
      const payload = JSON.parse(message) as SeatUpdatePayload;
      emitSeatUpdate(payload);
    } catch (err) {
      logger.warn({ err }, "[seat-sse] Ignoring malformed seat-update message from Redis");
    }
  });
}

export async function broadcastSupportTicketUpdate(
  tenantId: string,
  update: SupportTicketBroadcastUpdate,
): Promise<void> {
  if (!isSupportTicketBroadcastUpdate(update)) {
    throw new TypeError("Only valid ticket and queue updates can be broadcast");
  }

  const payload: SupportTicketUpdatePayload = {
    ...update,
    eventId: generateId(),
  };

  if (_subscriber !== null) {
    const pub = getRedisConnection();
    if (pub?.status === "ready") {
      try {
        await pub.publish(SUPPORT_TICKET_UPDATE_CHANNEL, JSON.stringify({ tenantId, payload }));
        return;
      } catch (err) {
        logger.warn({ err, tenantId }, "[support-ticket-sse] Redis publish failed — falling back to local emit");
      }
    }
  }

  emitSupportTicketUpdate(tenantId, toPublicSupportTicketPayload(payload));
}

/**
 * Closes the dedicated subscriber connection. Call during graceful shutdown.
 */
export async function closeSeatUpdateSubscriber(): Promise<void> {
  _cancelRecoveryRetry?.();
  _cancelRecoveryRetry = null;
  if (_subscriber) {
    const subscriber = _subscriber;
    _subscriber = null;
    await subscriber.quit().catch(() => {});
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
