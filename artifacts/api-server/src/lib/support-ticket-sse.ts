import type { Response } from "express";

const clients = new Map<string, Set<Response>>();

export interface SupportTicketUpdatePayload {
  eventId: string;
  type: "ticket" | "queues" | "refresh";
  ticketId: string | null;
}

export type SupportTicketBroadcastUpdate =
  | { type: "ticket"; ticketId: string }
  | { type: "queues"; ticketId: null };

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
