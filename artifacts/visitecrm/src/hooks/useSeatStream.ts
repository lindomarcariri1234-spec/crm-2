import { useEffect, useRef, useState } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface SeatStreamEntry {
  number: string;
  status: string;
}

const OCCUPIED_SEAT_STATUSES = new Set(["confirmed", "reserved", "free"]);

function parseOccupiedSeatMap(payload: unknown, tripId: string): Record<string, string> | null {
  if (typeof payload !== "object" || payload === null) return null;
  const snapshot = payload as { tripId?: unknown; seats?: unknown };
  if (snapshot.tripId !== tripId || !Array.isArray(snapshot.seats)) return null;

  const occupiedSeats: Record<string, string> = {};
  for (const seat of snapshot.seats) {
    if (typeof seat !== "object" || seat === null) continue;
    const entry = seat as { number?: unknown; status?: unknown };
    if (
      typeof entry.number === "string"
      && typeof entry.status === "string"
      && OCCUPIED_SEAT_STATUSES.has(entry.status)
    ) {
      occupiedSeats[entry.number] = entry.status;
    }
  }
  return occupiedSeats;
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
    const seatMapUrl = isPublic && slug
      ? `${BASE}/api/public/store/${encodeURIComponent(slug)}/trips/${encodeURIComponent(tripId)}/seat-map`
      : `${BASE}/api/trips/${encodeURIComponent(tripId)}/seat-map`;

    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;
    let active = true;
    let seatEventVersion = 0;
    let refreshRequestVersion = 0;
    let refreshRetryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearRefreshRetry = () => {
      if (refreshRetryTimer !== null) {
        clearTimeout(refreshRetryTimer);
        refreshRetryTimer = null;
      }
    };

    es.onopen = () => setConnected(true);

    const refreshCurrentSeatMap = async (attempt = 0) => {
      clearRefreshRetry();
      const requestVersion = ++refreshRequestVersion;
      const currentSeatEventVersion = seatEventVersion;
      try {
        const response = await fetch(seatMapUrl, { credentials: "include" });
        if (!response.ok) throw new Error(`Seat map refresh failed (${response.status})`);
        const snapshot = parseOccupiedSeatMap(await response.json(), tripId);
        if (!snapshot) throw new Error("Seat map refresh returned an invalid snapshot");
        if (
          !active
          || requestVersion !== refreshRequestVersion
          || currentSeatEventVersion !== seatEventVersion
        ) {
          return;
        }
        setOccupiedSeats(snapshot);
        setEventCount(count => count + 1);
      } catch {
        // Existing staff views also refetch their tenant-scoped seat queries on
        // eventCount; preserve that fallback if the snapshot request is unavailable.
        if (
          active
          && requestVersion === refreshRequestVersion
          && currentSeatEventVersion === seatEventVersion
        ) {
          if (attempt === 0) {
            refreshRetryTimer = setTimeout(() => {
              refreshRetryTimer = null;
              void refreshCurrentSeatMap(1);
            }, 250);
            return;
          }
          setEventCount(count => count + 1);
        }
      }
    };

    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as {
          tripId?: unknown;
          type?: unknown;
          seats?: unknown;
        };
        if (payload.tripId !== tripId) return;
        if (payload.type === "refresh") {
          void refreshCurrentSeatMap();
          return;
        }
        if (!Array.isArray(payload.seats)) return;

        const map: Record<string, string> = {};
        for (const value of payload.seats) {
          if (typeof value !== "object" || value === null) continue;
          const seat = value as Partial<SeatStreamEntry>;
          if (typeof seat.number !== "string" || typeof seat.status !== "string") continue;
          map[seat.number] = seat.status;
        }
        clearRefreshRetry();
        seatEventVersion += 1;
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
      active = false;
      refreshRequestVersion += 1;
      clearRefreshRetry();
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [tripId, slug, isPublic, enabled]);

  return { occupiedSeats, connected, eventCount };
}
