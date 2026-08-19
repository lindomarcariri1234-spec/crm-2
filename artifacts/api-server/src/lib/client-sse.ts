import type { Response } from "express";

const clients = new Map<string, Set<Response>>();

export function addClientSseConnection(clientId: string, res: Response): void {
  if (!clients.has(clientId)) clients.set(clientId, new Set());
  clients.get(clientId)!.add(res);
}

export function removeClientSseConnection(clientId: string, res: Response): void {
  const set = clients.get(clientId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(clientId);
}

export interface ClientSsePayload {
  type: string;
  data: unknown;
}

export function emitToClient(clientId: string, payload: ClientSsePayload): void {
  const set = clients.get(clientId);
  if (!set || set.size === 0) return;
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  const dead: Response[] = [];
  for (const res of set) {
    try {
      res.write(line);
    } catch {
      dead.push(res);
    }
  }
  for (const res of dead) removeClientSseConnection(clientId, res);
}

export function hasClientSseConnection(clientId: string): boolean {
  return (clients.get(clientId)?.size ?? 0) > 0;
}
