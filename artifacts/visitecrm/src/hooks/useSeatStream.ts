import { useEffect, useRef, useState } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface SeatStreamEntry {
  number: string;
  status: string;
}

interface UseSeatStreamOptions {
  tripId: string | null | undefined;
  slug?: string;
  isPublic?: boolean;
  enabled?: boolean;
}

interface UseSeatStreamResult {
  occupiedSeats: Record<string, string>;
  connected: boolean;
  eventCount: number;
}

export function useSeatStream({ tripId, slug, isPublic = true, enabled = true }: UseSeatStreamOptions): UseSeatStreamResult {
  const [occupiedSeats, setOccupiedSeats] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState(false);
  const [eventCount, setEventCount] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!tripId || !enabled) {
      setOccupiedSeats({});
      setConnected(false);
      return;
    }

    const url = isPublic && slug
      ? `${BASE}/api/public/store/${encodeURIComponent(slug)}/trips/${encodeURIComponent(tripId)}/seats/stream`
      : `${BASE}/api/trips/${encodeURIComponent(tripId)}/seats/stream`;

    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as { tripId: string; seats: SeatStreamEntry[] };
        if (payload.tripId !== tripId) return;
        const map: Record<string, string> = {};
        for (const seat of payload.seats) map[seat.number] = seat.status;
        setOccupiedSeats(map);
        setEventCount(c => c + 1);
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      setConnected(false);
      // Do NOT call es.close() here — allow EventSource native auto-reconnect.
      // The browser will automatically retry the connection with exponential backoff.
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [tripId, slug, isPublic, enabled]);

  return { occupiedSeats, connected, eventCount };
}
