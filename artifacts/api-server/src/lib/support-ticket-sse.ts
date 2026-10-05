import type { Response } from "express";

const clients = new Map<string, Set<Response>>();

export type SupportTicketUpdatePayload =
  | { eventId: string; type: "ticket"; ticketId: string }
  | { eventId: string; type: "queues"; ticketId: null }
  | { eventId: string; type: "refresh"; ticketId: null };

export type SupportTicketBroadcastUpdate =
  | { type: "ticket"; ticketId: string }
  | { type: "queues"; ticketId: null };

type SupportTicketUpdateShape =
  | { type: "ticket"; ticketId: string }
  | { type: "queues"; ticketId: null }
  | { type: "refresh"; ticketId: null };

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
  if (!isRecord(payload) || typeof payload.eventId !== "string" || !payload.eventId.trim()) {
    return null;
  }

  const shape = parseSupportTicketUpdateShape(payload);
  return shape ? { eventId: payload.eventId, ...shape } : null;
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
