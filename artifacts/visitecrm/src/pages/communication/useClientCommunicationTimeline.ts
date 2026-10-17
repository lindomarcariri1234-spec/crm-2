import { useCallback, useEffect, useRef, useState } from "react";
import {
  normalizeTimelineContent,
  type CommunicationTimelineEntry,
} from "@/lib/communicationTimeline";

interface ClientTimelinePage {
  items: CommunicationTimelineEntry[];
  hasMore: boolean;
  nextCursor: string | null;
}

interface UseClientCommunicationTimelineOptions {
  enabled: boolean;
  selectedClientId: string | null;
  onOlderLoadError?: () => void;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export function useClientCommunicationTimeline({
  enabled,
  selectedClientId,
  onOlderLoadError,
}: UseClientCommunicationTimelineOptions) {
  const [messages, setMessages] = useState<CommunicationTimelineEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const fetchTimeline = useCallback(async (
    clientId: string,
    pageCursor: string | null = null,
    append = false,
  ) => {
    const requestId = append ? requestIdRef.current : ++requestIdRef.current;
    if (append) setLoadingOlder(true);
    else {
      setLoading(true);
      setError(null);
    }
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (pageCursor) params.set("cursor", pageCursor);
      const response = await fetch(
        `${BASE}/api/clients/${encodeURIComponent(clientId)}/communication-timeline?${params.toString()}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error("failed");
      const page = await response.json() as ClientTimelinePage;
      if (!Array.isArray(page.items) || typeof page.hasMore !== "boolean") {
        throw new Error("invalid timeline response");
      }
      if (requestId !== requestIdRef.current || clientId !== selectedClientId) return;

      const pageItems = page.items.map((item) => ({
        ...item,
        content: normalizeTimelineContent(item.channel, item.content),
      }));
      if (append) {
        setMessages((current) => {
          const knownIds = new Set(current.map((item) => item.id));
          return [...pageItems.filter((item) => !knownIds.has(item.id)), ...current];
        });
      } else {
        setMessages(pageItems);
      }
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setError(null);
    } catch {
      if (requestId === requestIdRef.current) {
        setError("Não foi possível carregar o histórico deste cliente.");
        if (append) onOlderLoadError?.();
      }
    } finally {
      if (requestId === requestIdRef.current) {
        if (append) setLoadingOlder(false);
        else setLoading(false);
      }
    }
  }, [onOlderLoadError, selectedClientId]);

  useEffect(() => {
    requestIdRef.current += 1;
    setMessages([]);
    setCursor(null);
    setHasMore(false);
    setError(null);
    setLoadingOlder(false);
    if (!enabled || !selectedClientId) {
      setLoading(false);
      return;
    }
    void fetchTimeline(selectedClientId);
    return () => {
      requestIdRef.current += 1;
    };
  }, [enabled, selectedClientId, fetchTimeline]);

  const retry = useCallback(() => {
    if (!enabled || !selectedClientId) return;
    return fetchTimeline(selectedClientId);
  }, [enabled, selectedClientId, fetchTimeline]);

  const loadOlder = useCallback(() => {
    if (!enabled || !selectedClientId || !cursor || !hasMore || loadingOlder) return;
    return fetchTimeline(selectedClientId, cursor, true);
  }, [enabled, selectedClientId, cursor, hasMore, loadingOlder, fetchTimeline]);

  return { messages, cursor, hasMore, loading, loadingOlder, error, retry, loadOlder };
}
