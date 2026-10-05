import type { Response } from "express";
import { ALL_STAFF_ROLES } from "@workspace/permissions";

const clients = new Map<string, Set<Response>>();

export type SupportTicketUpdatePayload =
  | { eventId: string; type: "ticket"; ticketId: string }
  | { eventId: string; type: "queues"; ticketId: null }
  | { eventId: string; type: "refresh"; ticketId: null };

export type SupportTicketUpdatePayloadParseResult =
  | { ok: true; payload: SupportTicketUpdatePayload }
  | { ok: false; reason: "invalid_event_id" | "invalid_payload_shape" };

export type SupportTicketBroadcastUpdate =
  | { type: "ticket"; ticketId: string }
  | { type: "queues"; ticketId: null };

type SupportTicketUpdateShape =
  | { type: "ticket"; ticketId: string }
  | { type: "queues"; ticketId: null }
  | { type: "refresh"; ticketId: null };

const SUPPORT_TICKET_EVENT_ID_CONTROL_CHARACTERS = /[\p{Cc}\p{Zl}\p{Zp}]/u;

export const SUPPORT_TICKET_STREAM_HEARTBEAT_MS = 30_000;

export type SupportTicketStreamPrincipal = {
  id: string;
  tenantId: string | null;
  role: string;
  isActive: boolean;
};

export function isSupportTicketStreamAuthorized(
  connectedUser: { id: string; tenantId: string },
  currentUser: SupportTicketStreamPrincipal | null,
): boolean {
  return currentUser !== null
    && currentUser.isActive
    && currentUser.id === connectedUser.id
    && (currentUser.tenantId ?? "") === connectedUser.tenantId
    && ALL_STAFF_ROLES.includes(currentUser.role);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseSupportTicketUpdateShape(value: unknown): SupportTicketUpdateShape | null {
  if (!isRecord(value)) return null;

  if (value.type === "ticket") {
    return typeof value.ticketId === "string" && value.ticketId.trim()
      ? { type: "ticket", ticketId: value.ticketId }
      : null;
  }

  if ((value.type === "queues" || value.type === "refresh") && value.ticketId === null) {
    return { type: value.type, ticketId: null };
  }

  return null;
}

/**
 * Parse and project a public ticket SSE payload. Unknown fields are deliberately
 * omitted so Redis messages and direct local emits share the same contract.
 */
export function parseSupportTicketUpdatePayload(
  payload: unknown,
): SupportTicketUpdatePayload | null {
  const result = parseSupportTicketUpdatePayloadDetailed(payload);
  return result.ok ? result.payload : null;
}

export function parseSupportTicketUpdatePayloadDetailed(
  payload: unknown,
): SupportTicketUpdatePayloadParseResult {
  if (!isRecord(payload)) return { ok: false, reason: "invalid_payload_shape" };

  if (
    typeof payload.eventId !== "string"
    || !payload.eventId.trim()
    || SUPPORT_TICKET_EVENT_ID_CONTROL_CHARACTERS.test(payload.eventId)
  ) {
    return { ok: false, reason: "invalid_event_id" };
  }

  const shape = parseSupportTicketUpdateShape(payload);
  return shape
    ? { ok: true, payload: { eventId: payload.eventId, ...shape } }
    : { ok: false, reason: "invalid_payload_shape" };
}

/** Parse caller updates while keeping recovery-only refreshes off Redis. */
export function parseSupportTicketBroadcastUpdate(
  update: unknown,
): SupportTicketBroadcastUpdate | null {
  const shape = parseSupportTicketUpdateShape(update);
  return shape && shape.type !== "refresh" ? shape : null;
}

export function addSupportTicketClient(tenantId: string, res: Response): void {
  if (!clients.has(tenantId)) clients.set(tenantId, new Set());
  clients.get(tenantId)!.add(res);
}

export function removeSupportTicketClient(tenantId: string, res: Response): void {
  const set = clients.get(tenantId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(tenantId);
}

/**
 * Register a staff stream, send heartbeats, and close it when current access
 * can no longer be confirmed. The caller supplies a fresh authorization check.
 */
export function monitorSupportTicketClient(
  tenantId: string,
  res: Response,
  isAuthorized: () => Promise<boolean>,
): void {
  addSupportTicketClient(tenantId, res);

  let active = true;
  let authorizationCheckInFlight = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const stop = (endResponse: boolean) => {
    if (!active) return;
    active = false;
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    res.off("close", onClose);
    removeSupportTicketClient(tenantId, res);
    if (endResponse) {
      try {
        res.end();
      } catch {
        // The stream may have been closed by the client during revalidation.
      }
    }
  };
  const onClose = () => stop(false);

  res.on("close", onClose);
  heartbeatTimer = setInterval(() => {
    if (!active) return;
    try {
      res.write(": ping\n\n");
    } catch {
      stop(false);
      return;
    }

    if (authorizationCheckInFlight) return;
    authorizationCheckInFlight = true;
    void Promise.resolve()
      .then(isAuthorized)
      .then((authorized) => {
        if (!authorized) stop(true);
      })
      .catch(() => {
        // Fail closed if the current user's access cannot be verified.
        stop(true);
      })
      .finally(() => {
        authorizationCheckInFlight = false;
      });
  }, SUPPORT_TICKET_STREAM_HEARTBEAT_MS);
}

/** Sends refresh hints only to staff streams belonging to the affected tenant. */
export function emitSupportTicketUpdate(
  tenantId: string,
  payload: SupportTicketUpdatePayload,
): void {
  const publicPayload = parseSupportTicketUpdatePayload(payload);
  if (!publicPayload) {
    throw new TypeError("Invalid support-ticket SSE payload");
  }

  const set = clients.get(tenantId);
  if (!set || set.size === 0) return;
  const data = JSON.stringify(publicPayload);
  const dead: Response[] = [];
  for (const res of set) {
    try {
      res.write(`id: ${publicPayload.eventId}\ndata: ${data}\n\n`);
    } catch {
      dead.push(res);
    }
  }
  for (const res of dead) removeSupportTicketClient(tenantId, res);
}

/** Prompts every connected tenant inbox on this instance to rehydrate after Redis recovery. */
export function emitSupportTicketRefresh(eventId: string): void {
  for (const tenantId of clients.keys()) {
    emitSupportTicketUpdate(tenantId, {
      eventId,
      type: "refresh",
      ticketId: null,
    });
  }
}
