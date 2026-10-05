import type { Response } from "express";

const clients = new Map<string, Set<Response>>();

export type SupportTicketUpdatePayload =
  | { eventId: string; type: "ticket"; ticketId: string }
  | { eventId: string; type: "queues"; ticketId: null }
  | { eventId: string; type: "refresh"; ticketId: null };

export type SupportTicketBroadcastUpdate =
  | { type: "ticket"; ticketId: string }
  | { type: "queues"; ticketId: null };

function isValidSupportTicketUpdatePayload(
  payload: unknown,
): payload is SupportTicketUpdatePayload {
  if (!payload || typeof payload !== "object") return false;
  const candidate = payload as { eventId?: unknown; type?: unknown; ticketId?: unknown };
  if (typeof candidate.eventId !== "string" || !candidate.eventId.trim()) return false;

  if (candidate.type === "ticket") {
    return typeof candidate.ticketId === "string" && candidate.ticketId.trim().length > 0;
  }
  return (
    (candidate.type === "queues" || candidate.type === "refresh")
    && candidate.ticketId === null
  );
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
  if (!isValidSupportTicketUpdatePayload(payload)) {
    throw new TypeError("Invalid support-ticket SSE payload");
  }

  const set = clients.get(tenantId);
  if (!set || set.size === 0) return;
  const data = JSON.stringify(payload);
  const dead: Response[] = [];
  for (const res of set) {
    try {
      res.write(`id: ${payload.eventId}\ndata: ${data}\n\n`);
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
