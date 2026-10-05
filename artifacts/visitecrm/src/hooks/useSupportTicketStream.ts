import { useEffect, useRef } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface SupportTicketStreamUpdate {
  eventId: string;
  type: "ticket" | "queues" | "refresh";
  ticketId: string | null;
}

interface UseSupportTicketStreamOptions {
  tenantId: string | null | undefined;
  enabled?: boolean;
  onOpen: () => void;
  onTicketUpdate: (ticketId: string) => void;
  onQueuesUpdate: () => void;
}

function parseUpdate(data: string): SupportTicketStreamUpdate | null {
  try {
    const value = JSON.parse(data) as Partial<SupportTicketStreamUpdate>;
    if (typeof value.eventId !== "string" || !value.eventId) return null;
    if (value.type === "ticket" && typeof value.ticketId === "string") {
      return { eventId: value.eventId, type: "ticket", ticketId: value.ticketId };
    }
    if (value.type === "queues" && value.ticketId === null) {
      return { eventId: value.eventId, type: "queues", ticketId: null };
    }
    if (value.type === "refresh" && value.ticketId === null) {
      return { eventId: value.eventId, type: "refresh", ticketId: null };
    }
    return null;
  } catch {
    return null;
  }
}

export function useSupportTicketStream({
  tenantId,
  enabled = true,
  onOpen,
  onTicketUpdate,
  onQueuesUpdate,
}: UseSupportTicketStreamOptions): void {
  const seenEventIds = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled || !tenantId) return;

    const stream = new EventSource(`${BASE}/api/support/tickets/stream`, {
      withCredentials: true,
    });

    stream.onopen = () => {
      // The stream does not replay events missed during a disconnect. Rehydrate
      // from the tenant-scoped API whenever the connection opens or reconnects.
      onOpen();
    };
    stream.onmessage = (event) => {
      const update = parseUpdate(event.data);
      if (!update) return;
      const eventKey = `${tenantId}:${update.eventId}`;
      if (seenEventIds.current.has(eventKey)) return;

      seenEventIds.current.add(eventKey);
      if (seenEventIds.current.size > 256) {
        const oldest = seenEventIds.current.values().next().value;
        if (oldest) seenEventIds.current.delete(oldest);
      }

      if (update.type === "ticket") onTicketUpdate(update.ticketId!);
      else if (update.type === "queues") onQueuesUpdate();
      else onOpen();
    };
    stream.onerror = () => {
      // Leave the connection open so EventSource can reconnect automatically.
    };

    return () => stream.close();
  }, [enabled, onOpen, onQueuesUpdate, onTicketUpdate, tenantId]);
}
