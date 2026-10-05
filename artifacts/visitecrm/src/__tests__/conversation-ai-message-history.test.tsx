import { createElement, useState, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";
import {
  ConversationsTab,
  type AiConversation,
} from "../pages/communication/CommunicationInboxTabs";
import type {
  AiConversationMessage,
  ClientConversationSummary,
} from "../lib/communicationTimeline";
import { useConversationAiMessages } from "../pages/communication/useConversationAiMessages";

type ConversationsTabProps = ComponentProps<typeof ConversationsTab>;

const selectedConversation: AiConversation = {
  id: "whatsapp-conversation-1",
  clientId: "client-1",
  clientName: "Ana Silva",
  channel: "whatsapp",
  status: "human_handoff",
  assignedUserId: null,
  sessionId: "session-1",
  startedAt: "2026-10-01T10:00:00.000Z",
  createdAt: "2026-10-01T10:00:00.000Z",
  lastMessageId: "inbound-1",
  lastMessageContent: "Olá",
  lastMessageAt: "2026-10-01T10:00:00.000Z",
  lastMessageRole: "user",
  lastMessageIsBot: false,
  lastMessageStatus: null,
  messageCount: 1,
};

const summary: ClientConversationSummary = {
  clientId: "client-1",
  clientName: "Ana Silva",
  lastMessage: {
    id: "inbound-1",
    clientId: "client-1",
    clientName: "Ana Silva",
    channel: "whatsapp",
    content: "Olá",
    direction: "inbound",
    actor: "client",
    sentAt: "2026-10-01T10:00:00.000Z",
    status: "received",
    source: "chatbot",
    mediaUrl: null,
    mediaMimeType: null,
    mediaFileName: null,
    mediaExpiredAt: null,
  },
  count: 1,
};

const fetchAiInbox = vi.fn();
const onRetryConversationAiMessages = vi.fn();
const onSelectClient = vi.fn();

function makeProps(overrides: Partial<ConversationsTabProps> = {}): ConversationsTabProps {
  return {
    channelColors: { whatsapp: "" },
    channelLabels: { whatsapp: "WhatsApp" },
    summaries: [summary],
    selectedClientId: "client-1",
    onSelectClient,
    loadingMessages: false,
    loadingOutboundMessages: false,
    loadingAiInbox: false,
    messagesError: false,
    messagesQueryError: null,
    outboundMessagesError: false,
    aiInboxError: null,
    refetchMessages: vi.fn(),
    refetchOutboundMessages: vi.fn(),
    fetchAiInbox,
    conversationMessages: [summary.lastMessage],
    selectedClientName: "Ana Silva",
    loadingConversationAiMessages: false,
    conversationAiError: null,
    onRetryConversationAiMessages,
    selectedWhatsAppConversation: selectedConversation,
    selectedClientLinkStatus: "valid",
    onRetryClientLinkCheck: vi.fn(),
    onReassociateConversation: vi.fn(),
    inboxChannel: "whatsapp",
    setInboxChannel: vi.fn(),
    inboxMessage: "Resposta de teste",
    setInboxMessage: vi.fn(),
    handleSendInbox: vi.fn(),
    sendingMessage: false,
    ...overrides,
  };
}

function ConversationHistoryRetryHarness() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [retryConversationId, setRetryConversationId] = useState<string | null>(null);
  const history = useConversationAiMessages({
    enabled: true,
    selectedClientId: "client-1",
    conversations: [
      { id: "conversation-success", clientId: "client-1", channel: "whatsapp" },
      { id: "conversation-failed-a", clientId: "client-1", channel: "whatsapp" },
      { id: "conversation-failed-b", clientId: "client-1", channel: "whatsapp" },
    ],
    refreshToken,
    retryConversationId,
  });

  return createElement(
    "div",
    null,
    createElement(
      ConversationsTab,
      makeProps({
        conversationAiError: history.error,
        failedConversationLabels: history.failedConversationLabels,
        loadingConversationAiMessages: history.loading,
        onRetryConversationAiMessages: (conversationId) => {
          setRetryConversationId(conversationId ?? null);
          setRefreshToken((current) => current + 1);
        },
      }),
    ),
    createElement(
      "div",
      { "data-testid": "loaded-conversation-history" },
      history.messages.map((message) =>
        createElement("p", { key: message.id, "data-message-id": message.id }, message.content),
      ),
    ),
  );
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installDeferredFetch() {
  const requests = new Map<string, Deferred<Response>[]>();
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    const request = createDeferred<Response>();
    requests.set(url, [...(requests.get(url) ?? []), request]);
    return request.promise;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { requests, fetchMock };
}

function getMessageRequest(
  requests: Map<string, Deferred<Response>[]>,
  conversationId: string,
  attempt = 0,
): Deferred<Response> {
  const entry = [...requests.entries()].find(([url]) =>
    url.includes(`/chatbot-conversations/${conversationId}/messages`),
  );
  const request = entry?.[1][attempt];
  if (!request) throw new Error(`No pending request ${attempt + 1} for ${conversationId}`);
  return request;
}

function makeJsonResponse(messages: AiConversationMessage[]): Response {
  return {
    ok: true,
    json: async () => messages,
  } as unknown as Response;
}

function makeAiMessage(conversationId: string, content: string): AiConversationMessage {
  return {
    id: `message-${conversationId}`,
    conversationId,
    role: "user",
    content,
    isBot: false,
    sentAt: "2026-10-01T10:00:00.000Z",
  };
}

async function settleRequest(request: Deferred<Response>, messages: AiConversationMessage[]): Promise<void> {
  request.resolve(makeJsonResponse(messages));
  await request.promise;
  await Promise.resolve();
  await Promise.resolve();
}

async function settleHttpFailure(request: Deferred<Response>): Promise<void> {
  request.resolve({ ok: false, json: async () => [] } as unknown as Response);
  await request.promise;
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await cleanupRoots();
  vi.unstubAllGlobals();
});

describe("WhatsApp conversation history", () => {
  it("retries one failed session and clears only its warning after success", async () => {
    const { requests, fetchMock } = installDeferredFetch();
    const { container } = await renderComponent(
      createElement(ConversationHistoryRetryHarness),
    );
    const history = container.querySelector<HTMLElement>(
      '[data-testid="loaded-conversation-history"]',
    );
    expect(history).not.toBeNull();
    const successRequest = getMessageRequest(requests, "conversation-success");
    const failedRequestA = getMessageRequest(requests, "conversation-failed-a");
    const failedRequestB = getMessageRequest(requests, "conversation-failed-b");
    const successfulMessage = makeAiMessage("conversation-success", "Histórico disponível");

    await flushAct(async () => {
      successRequest.resolve(makeJsonResponse([successfulMessage]));
      failedRequestA.reject(new Error("Falha de rede"));
      failedRequestB.resolve({ ok: false, json: async () => [] } as unknown as Response);
      await Promise.all([
        successRequest.promise,
        failedRequestA.promise.catch(() => undefined),
        failedRequestB.promise,
      ]);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const retryAButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-retry-failed-whatsapp-session-0"]',
    );
    expect(retryAButton).not.toBeNull();
    await flushAct(() => retryAButton!.click());
    const retriedFailedRequestA = getMessageRequest(
      requests,
      "conversation-failed-a",
      1,
    );

    const callsFor = (conversationId: string) => fetchMock.mock.calls.filter(([input]) =>
      String(input).includes(`/chatbot-conversations/${conversationId}/messages`),
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(callsFor("conversation-success")).toHaveLength(1);
    expect(callsFor("conversation-failed-a")).toHaveLength(2);
    expect(callsFor("conversation-failed-b")).toHaveLength(1);

    await flushAct(async () => {
      await settleHttpFailure(retriedFailedRequestA);
    });
    expect(history!.textContent).toContain(successfulMessage.content);
    expect(container.querySelectorAll(
      '[data-testid^="button-retry-failed-whatsapp-session-"]',
    )).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("Não foi possível carregar 2 de 3 conversas vinculadas.");

    const retryAAgainButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-retry-failed-whatsapp-session-0"]',
    );
    expect(retryAAgainButton).not.toBeNull();
    await flushAct(() => retryAAgainButton!.click());
    const secondRetriedFailedRequestA = getMessageRequest(
      requests,
      "conversation-failed-a",
      2,
    );
    const recoveredMessageA = makeAiMessage(
      "conversation-failed-a",
      "Histórico da primeira conversa recuperado",
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(callsFor("conversation-success")).toHaveLength(1);
    expect(callsFor("conversation-failed-a")).toHaveLength(3);
    expect(callsFor("conversation-failed-b")).toHaveLength(1);
    await flushAct(async () => {
      await settleRequest(secondRetriedFailedRequestA, [recoveredMessageA]);
    });

    expect(history!.textContent).toContain(successfulMessage.content);
    expect(history!.textContent).toContain(recoveredMessageA.content);
    expect(history!.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelectorAll(
      '[data-testid^="button-retry-failed-whatsapp-session-"]',
    )).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("Não foi possível carregar 1 de 3 conversas vinculadas.");
    expect(callsFor("conversation-failed-b")).toHaveLength(1);

    const remainingRetryButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-retry-failed-whatsapp-session-0"]',
    );
    expect(remainingRetryButton).not.toBeNull();
    await flushAct(() => remainingRetryButton!.click());
    const retriedFailedRequestB = getMessageRequest(
      requests,
      "conversation-failed-b",
      1,
    );
    const recoveredMessageB = makeAiMessage(
      "conversation-failed-b",
      "Histórico da segunda conversa recuperado",
    );

    expect(callsFor("conversation-success")).toHaveLength(1);
    expect(callsFor("conversation-failed-a")).toHaveLength(3);
    expect(callsFor("conversation-failed-b")).toHaveLength(2);
    await flushAct(async () => {
      await settleRequest(retriedFailedRequestB, [recoveredMessageB]);
    });

    expect(history!.textContent).toContain(successfulMessage.content);
    expect(history!.textContent).toContain(recoveredMessageA.content);
    expect(history!.textContent).toContain(recoveredMessageB.content);
    expect(history!.querySelectorAll("p")).toHaveLength(3);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("retries only failed linked histories and preserves recovered messages without duplicates", async () => {
    const { requests, fetchMock } = installDeferredFetch();
    const { container } = await renderComponent(
      createElement(ConversationHistoryRetryHarness),
    );
    const history = container.querySelector<HTMLElement>(
      '[data-testid="loaded-conversation-history"]',
    );
    expect(history).not.toBeNull();
    const successRequest = getMessageRequest(requests, "conversation-success");
    const failedRequestA = getMessageRequest(requests, "conversation-failed-a");
    const failedRequestB = getMessageRequest(requests, "conversation-failed-b");
    const successfulMessage = makeAiMessage("conversation-success", "Histórico disponível");

    await flushAct(async () => {
      successRequest.resolve(makeJsonResponse([successfulMessage]));
      failedRequestA.reject(new Error("Falha de rede"));
      failedRequestB.resolve({ ok: false, json: async () => [] } as unknown as Response);
      await Promise.all([
        successRequest.promise,
        failedRequestA.promise.catch(() => undefined),
        failedRequestB.promise,
      ]);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const initialPartialFailure =
      "Não foi possível carregar 2 de 3 conversas vinculadas. Os demais históricos continuam disponíveis.";
    expect(history!.textContent).toContain(successfulMessage.content);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(initialPartialFailure);

    const retryButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-retry-conversation-ai-messages"]',
    );
    expect(retryButton).not.toBeNull();
    await flushAct(() => retryButton!.click());
    const retriedFailedRequestA = getMessageRequest(requests, "conversation-failed-a", 1);
    const retriedFailedRequestB = getMessageRequest(requests, "conversation-failed-b", 1);

    expect(fetchMock).toHaveBeenCalledTimes(5);
    const callsFor = (conversationId: string) => fetchMock.mock.calls.filter(([input]) =>
      String(input).includes(`/chatbot-conversations/${conversationId}/messages`),
    );
    expect(callsFor("conversation-success")).toHaveLength(1);
    expect(callsFor("conversation-failed-a")).toHaveLength(2);
    expect(callsFor("conversation-failed-b")).toHaveLength(2);

    const recoveredFailureA = makeAiMessage(
      "conversation-failed-a",
      "Histórico da primeira conversa recuperado",
    );
    expect(history!.textContent).toContain(successfulMessage.content);

    await flushAct(async () => {
      await Promise.all([
        settleRequest(retriedFailedRequestA, [recoveredFailureA]),
        settleHttpFailure(retriedFailedRequestB),
      ]);
    });

    const remainingPartialFailure =
      "Não foi possível carregar 1 de 3 conversas vinculadas. Os demais históricos continuam disponíveis.";
    expect(history!.textContent).toContain(successfulMessage.content);
    expect(history!.textContent).toContain(recoveredFailureA.content);
    expect(history!.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(remainingPartialFailure);

    const secondRetryButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-retry-conversation-ai-messages"]',
    );
    expect(secondRetryButton).not.toBeNull();
    await flushAct(() => secondRetryButton!.click());
    const retriedRemainingFailure = getMessageRequest(requests, "conversation-failed-b", 2);

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(callsFor("conversation-success")).toHaveLength(1);
    expect(callsFor("conversation-failed-a")).toHaveLength(2);
    expect(callsFor("conversation-failed-b")).toHaveLength(3);
    expect(history!.textContent).toContain(successfulMessage.content);
    expect(history!.textContent).toContain(recoveredFailureA.content);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(remainingPartialFailure);

    const recoveredFailureB = makeAiMessage(
      "conversation-failed-b",
      "Histórico da segunda conversa recuperado",
    );
    await flushAct(async () => {
      await settleRequest(retriedRemainingFailure, [recoveredFailureB]);
    });

    const messageIds = Array.from(
      history!.querySelectorAll<HTMLElement>("[data-message-id]"),
      (message) => message.dataset.messageId,
    );
    expect(history!.textContent).toContain(successfulMessage.content);
    expect(history!.textContent).toContain(recoveredFailureA.content);
    expect(history!.textContent).toContain(recoveredFailureB.content);
    expect(messageIds).toHaveLength(3);
    expect(new Set(messageIds).size).toBe(3);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows available history and retries the history request without refreshing the inbox", async () => {
    const errorMessage = "Não foi possível carregar 1 de 2 conversas vinculadas. Os demais históricos continuam disponíveis.";
    const { container } = await renderComponent(
      createElement(ConversationsTab, makeProps({
        conversationAiError: errorMessage,
      })),
    );
    const retryButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-retry-conversation-ai-messages"]',
    );

    expect(container.textContent).toContain("Olá");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(errorMessage);
    expect(retryButton).not.toBeNull();
    await flushAct(() => retryButton!.click());

    expect(onRetryConversationAiMessages).toHaveBeenCalledTimes(1);
    expect(fetchAiInbox).not.toHaveBeenCalled();
  });
});