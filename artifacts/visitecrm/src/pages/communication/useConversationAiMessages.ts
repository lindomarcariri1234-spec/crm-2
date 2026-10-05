import { useCallback, useEffect, useRef, useState } from "react";
import type { AiConversationMessage } from "@/lib/communicationTimeline";

interface ConversationLink {
  id: string;
  clientId: string | null;
  channel: string;
}

interface UseConversationAiMessagesOptions {
  enabled: boolean;
  selectedClientId: string | null;
  conversations: ConversationLink[];
  refreshToken: number;
}

interface UseConversationAiMessagesResult {
  messages: AiConversationMessage[];
  loading: boolean;
  error: string | null;
  updateConversationMessages: (
    conversationId: string,
    conversationMessages: AiConversationMessage[],
  ) => void;
  setErrorMessage: (message: string) => void;
}

interface PartialConversationFailure {
  scopeKey: string;
  failedConversationIds: string[];
  totalConversationCount: number;
}

interface ScopedRefreshError {
  scopeKey: string;
  message: string;
}

type ConversationLoadResult =
  | { conversationId: string; messages: AiConversationMessage[] }
  | { conversationId: string; failed: true };

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function formatPartialFailure(failure: PartialConversationFailure): string {
  const failedCount = failure.failedConversationIds.length;
  if (failedCount === failure.totalConversationCount) {
    if (failedCount === 1) {
      return "Não foi possível carregar as mensagens recebidas desta conversa.";
    }
    return `Não foi possível carregar nenhuma das ${failedCount} conversas vinculadas.`;
  }
  return `Não foi possível carregar ${failedCount} de ${failure.totalConversationCount} conversas vinculadas. Os demais históricos continuam disponíveis.`;
}

export function useConversationAiMessages({
  enabled,
  selectedClientId,
  conversations,
  refreshToken,
}: UseConversationAiMessagesOptions): UseConversationAiMessagesResult {
  const [messages, setMessages] = useState<AiConversationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [partialFailure, setPartialFailure] = useState<PartialConversationFailure | null>(null);
  const [refreshError, setRefreshError] = useState<ScopedRefreshError | null>(null);
  const partialFailureRef = useRef(partialFailure);
  const lastRefreshTokenRef = useRef(refreshToken);

  useEffect(() => {
    partialFailureRef.current = partialFailure;
  }, [partialFailure]);

  const linkedConversationIds = conversations
    .filter((conversation) =>
      conversation.clientId === selectedClientId && conversation.channel === "whatsapp",
    )
    .map((conversation) => conversation.id)
    .sort()
    .join("|");
  const scopeKey = JSON.stringify([selectedClientId, linkedConversationIds]);
  const currentPartialFailure = partialFailure?.scopeKey === scopeKey ? partialFailure : null;
  const currentRefreshError = refreshError?.scopeKey === scopeKey ? refreshError.message : null;
  const error = [
    currentPartialFailure ? formatPartialFailure(currentPartialFailure) : null,
    currentRefreshError,
  ].filter((message): message is string => Boolean(message)).join(" ") || null;

  const updateConversationMessages = useCallback((
    conversationId: string,
    conversationMessages: AiConversationMessage[],
  ) => {
    setMessages((current) => [
      ...current.filter((message) => message.conversationId !== conversationId),
      ...conversationMessages,
    ]);
    setPartialFailure((current) => {
      if (current?.scopeKey !== scopeKey) return current;
      const failedConversationIds = current.failedConversationIds.filter(
        (failedId) => failedId !== conversationId,
      );
      return failedConversationIds.length > 0
        ? { ...current, failedConversationIds }
        : null;
    });
    setRefreshError((current) => current?.scopeKey === scopeKey ? null : current);
  }, [scopeKey]);
  const setErrorMessage = useCallback((message: string) => {
    setRefreshError({ scopeKey, message });
  }, [scopeKey]);

  useEffect(() => {
    const isExplicitRefresh = refreshToken !== lastRefreshTokenRef.current;
    lastRefreshTokenRef.current = refreshToken;
    const conversationIds = linkedConversationIds ? linkedConversationIds.split("|") : [];
    if (!enabled || !selectedClientId || conversationIds.length === 0) {
      setMessages([]);
      setLoading(false);
      setPartialFailure(null);
      setRefreshError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setRefreshError((current) => current?.scopeKey === scopeKey ? null : current);
    // A retry token narrows the request to the current failures; a scope change reloads every link.
    const failedConversationIdsToRetry = isExplicitRefresh
      && partialFailureRef.current?.scopeKey === scopeKey
      ? partialFailureRef.current.failedConversationIds
      : [];
    const conversationIdsToLoad = failedConversationIdsToRetry.length > 0
      ? failedConversationIdsToRetry
      : conversationIds;
    const conversationIdSet = new Set(conversationIds);
    const requestedConversationIdSet = new Set(conversationIdsToLoad);
    Promise.all(conversationIdsToLoad.map(async (conversationId): Promise<ConversationLoadResult> => {
      try {
        const response = await fetch(
          `${BASE}/api/chatbot-conversations/${encodeURIComponent(conversationId)}/messages`,
          { credentials: "include" },
        );
        if (!response.ok) throw new Error("failed");
        return {
          conversationId,
          messages: await response.json() as AiConversationMessage[],
        };
      } catch {
        return { conversationId, failed: true };
      }
    }))
      .then((results) => {
        if (cancelled) return;
        const successfulResults = results.filter(
          (result): result is Extract<ConversationLoadResult, { messages: AiConversationMessage[] }> =>
            "messages" in result,
        );
        const failedConversationIds = results
          .filter((result): result is Extract<ConversationLoadResult, { failed: true }> =>
            "failed" in result,
          )
          .map((result) => result.conversationId);

        setMessages((current) => [
          ...current.filter((message) =>
            conversationIdSet.has(message.conversationId)
            && (
              !requestedConversationIdSet.has(message.conversationId)
              || failedConversationIds.includes(message.conversationId)
            ),
          ),
          ...successfulResults.flatMap((result) => result.messages),
        ]);
        setPartialFailure(failedConversationIds.length > 0
          ? {
              scopeKey,
              failedConversationIds,
              totalConversationCount: conversationIds.length,
            }
          : null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, selectedClientId, linkedConversationIds, refreshToken, scopeKey]);

  return { messages, loading, error, updateConversationMessages, setErrorMessage };
}