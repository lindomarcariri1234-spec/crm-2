import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
}

interface UseConversationAiMessagesResult {
  messages: AiConversationMessage[];
  loading: boolean;
  retryingConversationIds: string[];
  queuedRetryConversationIds: string[];
  error: string | null;
  failedConversationLabels: FailedConversationLabel[];
  retryConversationAiMessages: (conversationId?: string) => void;
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

interface ConversationRetryJob {
  conversationId: string;
  scopeKey: string;
  generation: number;
  totalConversationCount: number;
  abortController: AbortController;
}

interface ConversationRetryStatus {
  scopeKey: string;
  activeConversationIds: string[];
  queuedConversationIds: string[];
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
}: UseConversationAiMessagesOptions): UseConversationAiMessagesResult {
  const [messages, setMessages] = useState<AiConversationMessage[]>([]);
  const [initialLoading, setInitialLoading] = useState(false);
  const [retryStatus, setRetryStatus] = useState<ConversationRetryStatus>({
    scopeKey: "",
    activeConversationIds: [],
    queuedConversationIds: [],
  });
  const [partialFailure, setPartialFailure] = useState<PartialConversationFailure | null>(null);
  const [refreshError, setRefreshError] = useState<ScopedRefreshError | null>(null);
  const partialFailureRef = useRef<PartialConversationFailure | null>(null);
  const retryQueueRef = useRef<ConversationRetryJob[]>([]);
  const activeRetryJobsRef = useRef(new Map<string, ConversationRetryJob>());
  const retryGenerationRef = useRef(0);
  const retryScopeKeyRef = useRef<string | null>(null);
  const retryPumpRef = useRef<(generation: number) => void>(() => undefined);

  const linkedConversationIds = conversations
    .filter((conversation) =>
      conversation.clientId === selectedClientId && conversation.channel === "whatsapp",
    )
    .map((conversation) => conversation.id)
    .sort()
    .join("|");
  const conversationIds = useMemo(
    () => linkedConversationIds ? linkedConversationIds.split("|") : [],
    [linkedConversationIds],
  );
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
  const retryingConversationIds = retryStatus.scopeKey === scopeKey
    ? retryStatus.activeConversationIds
    : [];
  const queuedRetryConversationIds = retryStatus.scopeKey === scopeKey
    ? retryStatus.queuedConversationIds
    : [];
  const loading = initialLoading
    || retryingConversationIds.length > 0
    || queuedRetryConversationIds.length > 0;

  const setPartialFailureSnapshot = useCallback((next: PartialConversationFailure | null) => {
    partialFailureRef.current = next;
    setPartialFailure(next);
  }, []);

  const updateConversationMessages = useCallback((
    conversationId: string,
    conversationMessages: AiConversationMessage[],
  ) => {
    setMessages((current) => [
      ...current.filter((message) => message.conversationId !== conversationId),
      ...conversationMessages,
    ]);
    const currentFailure = partialFailureRef.current;
    if (currentFailure?.scopeKey === scopeKey) {
      const failedConversationIds = currentFailure.failedConversationIds.filter(
        (failedId) => failedId !== conversationId,
      );
      setPartialFailureSnapshot(failedConversationIds.length > 0
        ? { ...currentFailure, failedConversationIds }
        : null);
    }
    setRefreshError((current) => current?.scopeKey === scopeKey ? null : current);
  }, [scopeKey, setPartialFailureSnapshot]);
  const setErrorMessage = useCallback((message: string) => {
    setRefreshError({ scopeKey, message });
  }, [scopeKey]);

  const applyRetryResult = useCallback((
    job: ConversationRetryJob,
    result: { messages: AiConversationMessage[] } | { failed: true },
  ) => {
    const currentFailure = partialFailureRef.current?.scopeKey === job.scopeKey
      ? partialFailureRef.current
      : null;
    if ("messages" in result) {
      setMessages((current) => [
        ...current.filter((message) => message.conversationId !== job.conversationId),
        ...result.messages,
      ]);
      const failedConversationIds = currentFailure?.failedConversationIds.filter(
        (failedId) => failedId !== job.conversationId,
      ) ?? [];
      setPartialFailureSnapshot(
        currentFailure && failedConversationIds.length > 0
          ? { ...currentFailure, failedConversationIds }
          : null,
      );
      return;
    }

    const failedConversationIds = currentFailure?.failedConversationIds ?? [];
    setPartialFailureSnapshot({
      scopeKey: job.scopeKey,
      failedConversationIds: failedConversationIds.includes(job.conversationId)
        ? failedConversationIds
        : [...failedConversationIds, job.conversationId],
      totalConversationCount: currentFailure?.totalConversationCount ?? job.totalConversationCount,
    });
  }, [setPartialFailureSnapshot]);

  const pumpRetries = useCallback((generation: number) => {
    if (
      generation !== retryGenerationRef.current
      || retryScopeKeyRef.current !== scopeKey
      || !enabled
      || !selectedClientId
    ) {
      return;
    }

    const activeJobs = activeRetryJobsRef.current;
    const queuedJobs = retryQueueRef.current;
    while (
      activeJobs.size < MAX_CONCURRENT_CONVERSATION_HISTORY_REQUESTS
      && queuedJobs.length > 0
    ) {
      const job = queuedJobs.shift()!;
      if (
        job.generation !== generation
        || job.scopeKey !== scopeKey
        || activeJobs.has(job.conversationId)
      ) {
        continue;
      }
      activeJobs.set(job.conversationId, job);

      void (async () => {
        let result: { messages: AiConversationMessage[] } | { failed: true };
        try {
          const response = await fetch(
            `${BASE}/api/chatbot-conversations/${encodeURIComponent(job.conversationId)}/messages`,
            { credentials: "include", signal: job.abortController.signal },
          );
          if (!response.ok) throw new Error("failed");
          result = {
            messages: await response.json() as AiConversationMessage[],
          };
        } catch {
          result = { failed: true };
        }

        if (
          retryGenerationRef.current === generation
          && retryScopeKeyRef.current === job.scopeKey
          && activeJobs.get(job.conversationId) === job
        ) {
          applyRetryResult(job, result);
        }
      })().finally(() => {
        if (
          retryGenerationRef.current !== generation
          || retryScopeKeyRef.current !== job.scopeKey
          || activeJobs.get(job.conversationId) !== job
        ) {
          return;
        }
        activeJobs.delete(job.conversationId);
        retryPumpRef.current(generation);
      });
    }

    setRetryStatus({
      scopeKey,
      activeConversationIds: Array.from(activeJobs.keys()),
      queuedConversationIds: queuedJobs.map((job) => job.conversationId),
    });
  }, [
    applyRetryResult,
    enabled,
    scopeKey,
    selectedClientId,
  ]);
  retryPumpRef.current = pumpRetries;

  const retryConversationAiMessages = useCallback((conversationId?: string) => {
    if (
      !enabled
      || !selectedClientId
      || retryScopeKeyRef.current !== scopeKey
    ) {
      return;
    }

    const currentFailure = partialFailureRef.current?.scopeKey === scopeKey
      ? partialFailureRef.current
      : null;
    const conversationIdsToRetry = conversationId
      ? currentFailure?.failedConversationIds.includes(conversationId)
        ? [conversationId]
        : []
      : currentFailure?.failedConversationIds ?? (currentRefreshError ? conversationIds : []);
    if (conversationIdsToRetry.length === 0) return;

    const pendingIds = new Set([
      ...activeRetryJobsRef.current.keys(),
      ...retryQueueRef.current.map((job) => job.conversationId),
    ]);
    const newConversationIds = conversationIdsToRetry.filter(
      (id) => conversationIds.includes(id) && !pendingIds.has(id),
    );
    if (newConversationIds.length === 0) return;

    const generation = retryGenerationRef.current;
    retryQueueRef.current.push(...newConversationIds.map((id) => ({
      conversationId: id,
      scopeKey,
      generation,
      totalConversationCount: conversationIds.length,
      abortController: new AbortController(),
    })));
    setRefreshError((current) => current?.scopeKey === scopeKey ? null : current);
    retryPumpRef.current(generation);
  }, [
    conversationIds,
    currentRefreshError,
    enabled,
    scopeKey,
    selectedClientId,
  ]);

  useEffect(() => {
    const generation = retryGenerationRef.current + 1;
    retryGenerationRef.current = generation;
    retryScopeKeyRef.current = scopeKey;
    retryQueueRef.current = [];
    for (const job of activeRetryJobsRef.current.values()) {
      job.abortController.abort();
    }
    activeRetryJobsRef.current.clear();
    setRetryStatus({
      scopeKey,
      activeConversationIds: [],
      queuedConversationIds: [],
    });

    let cancelled = false;
    const abortController = new AbortController();
    const cancelRetries = () => {
      if (retryGenerationRef.current !== generation) return;
      retryGenerationRef.current += 1;
      retryScopeKeyRef.current = null;
      retryQueueRef.current = [];
      for (const job of activeRetryJobsRef.current.values()) {
        job.abortController.abort();
      }
      activeRetryJobsRef.current.clear();
    };

    if (!enabled || !selectedClientId || conversationIds.length === 0) {
      setMessages([]);
      setInitialLoading(false);
      setPartialFailureSnapshot(null);
      setRefreshError(null);
      return () => {
        cancelled = true;
        abortController.abort();
        cancelRetries();
      };
    }

    setInitialLoading(true);
    setRefreshError((current) => current?.scopeKey === scopeKey ? null : current);
    const conversationIdSet = new Set(conversationIds);
    const results = new Array<ConversationLoadResult>(conversationIds.length);
    let nextConversationIndex = 0;
    const loadNextConversation = async (): Promise<void> => {
      while (!cancelled && nextConversationIndex < conversationIds.length) {
        const resultIndex = nextConversationIndex++;
        const id = conversationIds[resultIndex]!;
        try {
          const response = await fetch(
            `${BASE}/api/chatbot-conversations/${encodeURIComponent(id)}/messages`,
            { credentials: "include", signal: abortController.signal },
          );
          if (!response.ok) throw new Error("failed");
          results[resultIndex] = {
            conversationId: id,
            messages: await response.json() as AiConversationMessage[],
          };
        } catch {
          results[resultIndex] = { conversationId: id, failed: true };
        }
      }
    };
    const workerCount = Math.min(
      MAX_CONCURRENT_CONVERSATION_HISTORY_REQUESTS,
      conversationIds.length,
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
        setMessages((current) => [
          ...current.filter((message) =>
            conversationIdSet.has(message.conversationId)
            && failedConversationIds.includes(message.conversationId),
          ),
          ...successfulResults.flatMap((result) => result.messages),
        ]);
        setPartialFailureSnapshot(failedConversationIds.length > 0
          ? {
              scopeKey,
              failedConversationIds,
              totalConversationCount: conversationIds.length,
            }
          : null);
      })
      .finally(() => {
        if (!cancelled) setInitialLoading(false);
      });

    return () => {
      cancelled = true;
      abortController.abort();
      cancelRetries();
    };
  }, [
    enabled,
    selectedClientId,
    linkedConversationIds,
    scopeKey,
    conversationIds,
    setPartialFailureSnapshot,
  ]);

  return {
    messages,
    loading,
    retryingConversationIds,
    queuedRetryConversationIds,
    error,
    failedConversationLabels,
    retryConversationAiMessages,
    updateConversationMessages,
    setErrorMessage,
  };
}