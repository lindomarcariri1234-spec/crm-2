import { createElement, type ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRoots, flushAct, renderComponent, renderHook } from "./eventSourceHarness.js";
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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await cleanupRoots();
  vi.unstubAllGlobals();
});

describe("WhatsApp conversation history", () => {
  it("keeps successful linked history, reports a partial failure, and clears it after retry", async () => {
    const { requests } = installDeferredFetch();
    let options = {
      enabled: true,
      selectedClientId: "client-a",
      conversations: [
        { id: "conversation-success", clientId: "client-a", channel: "whatsapp" },
        { id: "conversation-failed", clientId: "client-a", channel: "whatsapp" },
      ],
      refreshToken: 0,
    };
    const hook = await renderHook(() => useConversationAiMessages(options));
    const successRequest = getMessageRequest(requests, "conversation-success");
    const failedRequest = getMessageRequest(requests, "conversation-failed");
    const successfulMessage = makeAiMessage("conversation-success", "Histórico disponível");

    await flushAct(async () => {
      successRequest.resolve(makeJsonResponse([successfulMessage]));
      failedRequest.reject(new Error("Falha de rede"));
      await Promise.all([
        successRequest.promise,
        failedRequest.promise.catch(() => undefined),
      ]);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hook.result.current.messages).toEqual([successfulMessage]);
    expect(hook.result.current.error).toBe(
      "Não foi possível carregar 1 de 2 conversas vinculadas. Os demais históricos continuam disponíveis.",
    );
    expect(hook.result.current.loading).toBe(false);

    options = { ...options, refreshToken: 1 };
    await hook.rerender();
    const retriedSuccessRequest = getMessageRequest(requests, "conversation-success", 1);
    const retriedFailedRequest = getMessageRequest(requests, "conversation-failed", 1);
    const recoveredSuccess = makeAiMessage("conversation-success", "Histórico atualizado");
    const recoveredFailure = makeAiMessage("conversation-failed", "Histórico recuperado");

    await flushAct(async () => {
      await Promise.all([
        settleRequest(retriedSuccessRequest, [recoveredSuccess]),
        settleRequest(retriedFailedRequest, [recoveredFailure]),
      ]);
    });

    expect(hook.result.current.messages).toEqual([recoveredFailure, recoveredSuccess]);
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.loading).toBe(false);
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