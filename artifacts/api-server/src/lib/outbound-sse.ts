import type { Response } from "express";

const clients = new Map<string, Set<Response>>();

export interface OutboundDeliveryUpdatePayload {
  deliveryId: string;
  messageId: string;
  status: string;
  channel: "email" | "whatsapp";
  provider: string;
}

export function addOutboundClient(tenantId: string, res: Response): void {
  if (!clients.has(tenantId)) clients.set(tenantId, new Set());
  clients.get(tenantId)!.add(res);
}

export function removeOutboundClient(tenantId: string, res: Response): void {
  const set = clients.get(tenantId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(tenantId);
}

/** Sends only to clients in the affected tenant. Provider callbacks may arrive
 * on any API instance, so the DB remains the source of truth for the refresh. */
export function emitOutboundDeliveryUpdate(
  tenantId: string,
  payload: OutboundDeliveryUpdatePayload,
): void {
  const set = clients.get(tenantId);
  if (!set || set.size === 0) return;
  const data = JSON.stringify(payload);
  const dead: Response[] = [];
  for (const res of set) {
    try {
      res.write(`event: outbound-delivery-updated\ndata: ${data}\n\n`);
    } catch {
      dead.push(res);
    }
  }
  for (const res of dead) removeOutboundClient(tenantId, res);
}