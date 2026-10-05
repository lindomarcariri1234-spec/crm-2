import { useCallback, useEffect, useRef, useState } from "react";
import type { AiConversationMessage } from "@/lib/communicationTimeline";

interface ConversationLink {
  id: string;
  clientId: string | null;
  channel: string;
  startedAt?: string | null;
  createdAt?: string | null;
}

interface UseConversationAiMessagesOptions {
  enabled: boolean;
  selectedClientId: string | null;
  conversations: ConversationLink[];
  refreshToken: number;
  retryConversationId?: string | null;
}

interface UseConversationAiMessagesResult {
  messages: AiConversationMessage[];
  loading: boolean;
  retryingConversationId: string | null;
  error: string | null;
  failedConversationLabels: FailedConversationLabel[];
  updateConversationMessages: (
    conversationId: string,
    conversationMessages: AiConversationMessage[],
  ) => void;
  setErrorMessage: (message: string) => void;
}

export interface FailedConversationLabel {
  conversationId: string;
  label: string;
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
const MAX_CONCURRENT_CONVERSATION_HISTORY_REQUESTS = 5;
const conversationStartFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function formatConversationStart(conversation: ConversationLink | undefined): string {
  for (const timestamp of [conversation?.startedAt, conversation?.createdAt]) {
    if (!timestamp) continue;
    const date = new Date(timestamp);
    if (!Number.isNaN(date.getTime())) {
      return `Sessão iniciada em ${conversationStartFormatter.format(date)}`;
    }
  }
  return "Sessão do WhatsApp sem data de início";
}

function formatFailedConversationLabels(
  failedConversationIds: string[],
  conversations: ConversationLink[],
): FailedConversationLabel[] {
  const entries = failedConversationIds.map((conversationId) => ({
    conversationId,
    label: formatConversationStart(
      conversations.find((conversation) => conversation.id === conversationId),
    ),
  }));
  const totals = new Map<string, number>();
  for (const { label } of entries) {
    totals.set(label, (totals.get(label) ?? 0) + 1);
  }

  const occurrences = new Map<string, number>();
  return entries.map(({ conversationId, label }) => {
    if ((totals.get(label) ?? 0) < 2) return { conversationId, label };

    const occurrence = (occurrences.get(label) ?? 0) + 1;
    occurrences.set(label, occurrence);
    return { conversationId, label: `${label} (sessão ${occurrence})` };
  });
}

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
  retryConversationId = null,
}: UseConversationAiMessagesOptions): UseConversationAiMessagesResult {
  const [messages, setMessages] = useState<AiConversationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [retryingConversationId, setRetryingConversationId] = useState<string | null>(null);
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
  const failedConversationLabels = currentPartialFailure
    ? formatFailedConversationLabels(currentPartialFailure.failedConversationIds, conversations)
    : [];
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
      setRetryingConversationId(null);
      setPartialFailure(null);
      setRefreshError(null);
      return;
    }

    const currentFailureForScope = partialFailureRef.current?.scopeKey === scopeKey
      ? partialFailureRef.current
      : null;
    if (
      isExplicitRefresh
      && retryConversationId
      && !currentFailureForScope?.failedConversationIds.includes(retryConversationId)
    ) {
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    setLoading(true);
    setRefreshError((current) => current?.scopeKey === scopeKey ? null : current);
    // A targeted retry loads one failed session; an unscoped retry loads all failures.
    const failedConversationIdsToRetry = isExplicitRefresh
      && currentFailureForScope
      ? retryConversationId
        ? [retryConversationId]
        : currentFailureForScope.failedConversationIds
      : [];
    const isTargetedRetry = isExplicitRefresh && retryConversationId !== null;
    const conversationIdsToLoad = isTargetedRetry
      ? failedConversationIdsToRetry
      : failedConversationIdsToRetry.length > 0
        ? failedConversationIdsToRetry
        : conversationIds;
    setRetryingConversationId(isTargetedRetry ? retryConversationId : null);
    const conversationIdSet = new Set(conversationIds);
    const requestedConversationIdSet = new Set(conversationIdsToLoad);
    const results = new Array<ConversationLoadResult>(conversationIdsToLoad.length);
    let nextConversationIndex = 0;
    const loadNextConversation = async (): Promise<void> => {
      while (!cancelled && nextConversationIndex < conversationIdsToLoad.length) {
        const resultIndex = nextConversationIndex++;
        const conversationId = conversationIdsToLoad[resultIndex]!;
        try {
          const response = await fetch(
            `${BASE}/api/chatbot-conversations/${encodeURIComponent(conversationId)}/messages`,
            { credentials: "include", signal: abortController.signal },
          );
          if (!response.ok) throw new Error("failed");
          results[resultIndex] = {
            conversationId,
            messages: await response.json() as AiConversationMessage[],
          };
        } catch {
          results[resultIndex] = { conversationId, failed: true };
        }
      }
    };
    const workerCount = Math.min(
      MAX_CONCURRENT_CONVERSATION_HISTORY_REQUESTS,
      conversationIdsToLoad.length,
    );
    Promise.all(Array.from({ length: workerCount }, () => loadNextConversation()))
      .then(() => {
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
        const allFailedConversationIds = isTargetedRetry && currentFailureForScope
          ? currentFailureForScope.failedConversationIds.filter(
            (conversationId) =>
              !requestedConversationIdSet.has(conversationId)
              || failedConversationIds.includes(conversationId),
          )
          : failedConversationIds;

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
        setPartialFailure(allFailedConversationIds.length > 0
          ? {
              scopeKey,
              failedConversationIds: allFailedConversationIds,
              totalConversationCount: conversationIds.length,
            }
          : null);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setRetryingConversationId(null);
        }
      });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [
    enabled,
    selectedClientId,
    linkedConversationIds,
    refreshToken,
    retryConversationId,
    scopeKey,
  ]);

  return {
    messages,
    loading,
    retryingConversationId,
    error,
    failedConversationLabels,
    updateConversationMessages,
    setErrorMessage,
  };
}