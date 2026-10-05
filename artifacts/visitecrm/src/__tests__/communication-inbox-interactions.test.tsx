import {
  createElement,
  useState,
  type ComponentProps,
  type FormEvent,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupRoots,
  flushAct,
  renderComponent,
} from "./eventSourceHarness.js";
import { ConversationsTab } from "../pages/communication/CommunicationInboxTabs";
import {
  submitInboxMessage,
  type InboxMessageToast,
} from "../pages/communication/submitInboxMessage";
import type {
  AiConversationMessage,
  ClientConversationSummary,
  CommunicationTimelineEntry,
} from "../lib/communicationTimeline";
import { useConversationAiMessages } from "../pages/communication/useConversationAiMessages";

type ConversationsTabProps = ComponentProps<typeof ConversationsTab>;

const firstMessage: CommunicationTimelineEntry = {
  id: "message-client-a-1",
  clientId: "client-a",
  clientName: "Ana Silva",
  channel: "whatsapp",
  content: "Mensagem antiga da Ana",
  direction: "inbound",
  actor: "client",
  sentAt: "2026-10-01T10:00:00.000Z",
  status: "received",
  source: "chatbot",
  mediaUrl: null,
  mediaMimeType: null,
  mediaFileName: null,
  mediaExpiredAt: null,
};

const latestFirstMessage: CommunicationTimelineEntry = {
  ...firstMessage,
  id: "message-client-a-2",
  content: "Mensagem nova da Ana",
  sentAt: "2026-10-01T10:05:00.000Z",
};

const secondMessage: CommunicationTimelineEntry = {
  ...firstMessage,
  id: "message-client-b-1",
  clientId: "client-b",
  clientName: "Bruna Costa",
  content: "Mensagem recente da Bruna",
  sentAt: "2026-10-02T10:00:00.000Z",
};

const summaries: ClientConversationSummary[] = [
  {
    clientId: "client-a",
    clientName: "Ana Silva",
    lastMessage: firstMessage,
    count: 2,
  },
  {
    clientId: "client-b",
    clientName: "Bruna Costa",
    lastMessage: secondMessage,
    count: 1,
  },
];

function makeProps(
  selectedClientId: string | null,
  onSelectClient: (clientId: string) => void,
  conversationMessages: CommunicationTimelineEntry[],
): ConversationsTabProps {
  return {
    channelColors: { whatsapp: "" },
    channelLabels: { whatsapp: "WhatsApp" },
    summaries,
    selectedClientId,
    onSelectClient,
    loadingMessages: false,
    loadingOutboundMessages: false,
    loadingAiInbox: false,
    messagesError: false,
    messagesQueryError: null,
    outboundMessagesError: false,
    aiInboxError: null,
    refetchMessages: () => undefined,
    refetchOutboundMessages: () => undefined,
    fetchAiInbox: () => undefined,
    conversationMessages,
    selectedClientName: selectedClientId === "client-b" ? "Bruna Costa" : "Ana Silva",
    loadingConversationAiMessages: false,
    conversationAiError: null,
    onRetryConversationAiMessages: () => undefined,
    selectedWhatsAppConversation: null,
    selectedClientLinkStatus: "valid",
    onRetryClientLinkCheck: () => undefined,
    onReassociateConversation: () => undefined,
    onOpenFailedConversation: () => undefined,
    inboxChannel: "whatsapp",
    setInboxChannel: () => undefined,
    inboxMessage: "",
    setInboxMessage: () => undefined,
    handleSendInbox: () => undefined,
    sendingMessage: false,
  };
}

function ConversationInteractionHarness() {
  const [selectedClientId, setSelectedClientId] = useState<string | null>("client-a");
  const [firstConversationMessages, setFirstConversationMessages] = useState([firstMessage]);
  const conversationMessages =
    selectedClientId === "client-b" ? [secondMessage] : firstConversationMessages;

  return createElement(
    "div",
    null,
    createElement(
      "button",
      {
        type: "button",
        "data-testid": "button-simulate-first-conversation-update",
        onClick: () => setFirstConversationMessages((messages) => [...messages, latestFirstMessage]),
      },
      "Simular nova mensagem",
    ),
    createElement(
      ConversationsTab,
      makeProps(selectedClientId, setSelectedClientId, conversationMessages),
    ),
  );
}

interface InboxSendInteractionHarnessProps {
  attempts: string[];
  notifications: InboxMessageToast[];
  submission: { current: Promise<void> | null };
}

function InboxSendInteractionHarness({
  attempts,
  notifications,
  submission,
}: InboxSendInteractionHarnessProps) {
  const [draft, setDraft] = useState("");
  const handleSendInbox = (event: FormEvent<HTMLFormElement>) => {
    const pending = submitInboxMessage({
      event,
      selectedClientId: "client-a",
      message: draft,
      channel: "whatsapp",
      clientLinkStatus: "valid",
      whatsappOptedOut: false,
      sendMessage: async ({ data }) => {
        attempts.push(data.content);
        if (attempts.length === 1) throw new Error("Falha temporária da API");
      },
      setInboxMessage: setDraft,
      refetchMessages: async () => undefined,
      refetchOutboundMessages: async () => undefined,
      toast: (notification) => notifications.push(notification),
    });
    submission.current = pending;
    return pending;
  };

  return createElement(ConversationsTab, {
    ...makeProps("client-a", () => undefined, [firstMessage]),
    inboxMessage: draft,
    setInboxMessage: setDraft,
    handleSendInbox,
  });
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

function installDeferredHistoryFetch() {
  const requests = new Map<string, Deferred<Response>[]>();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      const request = createDeferred<Response>();
      requests.set(url, [...(requests.get(url) ?? []), request]);
      return request.promise;
    }),
  );
  return requests;
}

function getHistoryRequest(
  requests: Map<string, Deferred<Response>[]>,
  conversationId: string,
  attempt = 0,
): Deferred<Response> {
  const entry = [...requests.entries()].find(([url]) =>
    url.includes(`/chatbot-conversations/${conversationId}/messages`),
  );
  const request = entry?.[1][attempt];
  if (!request) throw new Error(`No pending history request ${attempt + 1} for ${conversationId}`);
  return request;
}

function makeHistoryResponse(messages: AiConversationMessage[]): Response {
  return {
    ok: true,
    json: async () => messages,
  } as unknown as Response;
}

function makeHistoryMessage(
  conversationId: string,
  content: string,
): AiConversationMessage {
  return {
    id: `message-${conversationId}`,
    conversationId,
    role: "user",
    content,
    isBot: false,
    sentAt: "2026-10-01T10:00:00.000Z",
  };
}

async function settleHistorySuccess(
  request: Deferred<Response>,
  messages: AiConversationMessage[],
): Promise<void> {
  request.resolve(makeHistoryResponse(messages));
  await request.promise;
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function settleHistoryFailure(request: Deferred<Response>): Promise<void> {
  request.reject(new Error("Falha de rede"));
  await request.promise.catch(() => undefined);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function DelayedHistoryRefreshHarness() {
  const [selectedClientId, setSelectedClientId] = useState<string | null>("client-a");
  const [activeTab, setActiveTab] = useState("conversations");
  const [selectedAiConversationId, setSelectedAiConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState([
    {
      id: "conversation-a",
      clientId: "client-a",
      channel: "whatsapp",
      startedAt: "2026-10-01T12:00:00.000Z",
    },
    {
      id: "conversation-b-main",
      clientId: "client-b",
      channel: "whatsapp",
      startedAt: "2026-10-01T12:00:00.000Z",
    },
    {
      id: "conversation-b-failed-1",
      clientId: "client-b",
      channel: "whatsapp",
      startedAt: "2026-10-02T12:00:00.000Z",
      sessionId: "+5511999990001",
    },
    {
      id: "conversation-b-failed-2",
      clientId: "client-b",
      channel: "whatsapp",
      startedAt: "2026-10-02T12:00:00.000Z",
      sessionId: "+5511999990002",
    },
  ]);
  const { messages, loading, error, failedConversationLabels } = useConversationAiMessages({
    enabled: true,
    selectedClientId,
    conversations,
    refreshToken: 0,
  });

  return createElement(
    "section",
    null,
    createElement(
      "button",
      {
        type: "button",
        "data-testid": "button-simulate-periodic-client-a-update",
        onClick: () => setConversations((current) => [
          ...current,
          {
            id: "conversation-a-new",
            clientId: "client-a",
            channel: "whatsapp",
            startedAt: "2026-10-04T12:00:00.000Z",
          },
        ]),
      },
      "Atualizar conversas vinculadas",
    ),
    createElement(
      "button",
      {
        type: "button",
        "data-testid": "button-select-client-b",
        onClick: () => setSelectedClientId("client-b"),
      },
      "Selecionar cliente B",
    ),
    createElement("p", { "data-testid": "selected-history-client" }, selectedClientId),
    createElement("p", { "data-testid": "active-communication-tab" }, activeTab),
    createElement(
      "p",
      { "data-testid": "selected-ai-conversation" },
      selectedAiConversationId,
    ),
    createElement(ConversationsTab, {
      ...makeProps(selectedClientId, setSelectedClientId, []),
      loadingConversationAiMessages: loading,
      conversationAiError: error,
      failedConversationLabels,
      onOpenFailedConversation: (conversationId) => {
        setActiveTab("ai-inbox");
        setSelectedAiConversationId(conversationId);
      },
    }),
    createElement(
      "div",
      { "data-testid": "selected-client-history" },
      messages.map((message) => createElement("p", { key: message.id }, message.content)),
    ),
    createElement("p", { "data-testid": "selected-client-history-error", role: "alert" }, error ?? ""),
  );
}

function LargeConversationHistoryHarness({ conversationCount }: { conversationCount: number }) {
  const conversations = Array.from({ length: conversationCount }, (_, index) => ({
    id: `large-conversation-${String(index).padStart(2, "0")}`,
    clientId: "client-many",
    channel: "whatsapp",
    startedAt: "2026-10-02T12:00:00.000Z",
  }));
  const { messages, loading, error } = useConversationAiMessages({
    enabled: true,
    selectedClientId: "client-many",
    conversations,
    refreshToken: 0,
  });

  return createElement(
    "section",
    null,
    createElement("p", { "data-testid": "large-history-loading" }, String(loading)),
    createElement("p", { "data-testid": "large-history-error" }, error ?? ""),
    createElement(
      "div",
      { "data-testid": "large-history-messages" },
      messages.map((message) => createElement("p", { key: message.id }, message.content)),
    ),
  );
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("HTMLInputElement.value setter is unavailable");
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(async () => {
  await cleanupRoots();
  vi.unstubAllGlobals();
});

describe("conversation list search interactions", () => {
  it("finds clients by name and preserves the selected conversation when search is cleared", async () => {
    const { container } = await renderComponent(createElement(ConversationInteractionHarness));
    const searchInput = container.querySelector<HTMLInputElement>(
      '[data-testid="input-client-conversation-search"]',
    );
    expect(searchInput).not.toBeNull();

    await flushAct(() => setInputValue(searchInput!, "bruna"));

    expect(container.querySelector('[data-testid="button-conversation-client-a"]')).toBeNull();
    const brunaButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-conversation-client-b"]',
    );
    expect(brunaButton).not.toBeNull();

    await flushAct(() => brunaButton!.click());
    expect(brunaButton!.getAttribute("aria-pressed")).toBe("true");

    await flushAct(() => setInputValue(searchInput!, ""));

    expect(container.querySelector('[data-testid="button-conversation-client-a"]')).not.toBeNull();
    const restoredBrunaButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-conversation-client-b"]',
    );
    expect(restoredBrunaButton?.getAttribute("aria-pressed")).toBe("true");
    expect(
      container.querySelector('[data-testid="client-conversation-timeline"]')?.textContent,
    ).toContain(secondMessage.content);
  });

  it("finds a conversation by the text of its latest message", async () => {
    const { container } = await renderComponent(createElement(ConversationInteractionHarness));
    const searchInput = container.querySelector<HTMLInputElement>(
      '[data-testid="input-client-conversation-search"]',
    );
    expect(searchInput).not.toBeNull();

    await flushAct(() =>
      setInputValue(searchInput!, "mensagem recente da bruna"),
    );

    expect(container.querySelector('[data-testid="button-conversation-client-a"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="button-conversation-client-b"]'),
    ).not.toBeNull();
  });
});

describe("conversation timeline interactions", () => {
  it("opens a newly selected conversation at its latest message after history was read", async () => {
    const { container } = await renderComponent(createElement(ConversationInteractionHarness));
    const timeline = container.querySelector<HTMLDivElement>(
      '[data-testid="client-conversation-timeline"]',
    );
    expect(timeline).not.toBeNull();

    Object.defineProperty(timeline!, "scrollHeight", {
      configurable: true,
      get: () => {
        const content = timeline!.textContent ?? "";
        if (content.includes(secondMessage.content)) return 2_400;
        if (content.includes(latestFirstMessage.content)) return 1_600;
        return 1_200;
      },
    });
    Object.defineProperty(timeline!, "clientHeight", {
      configurable: true,
      value: 400,
    });

    timeline!.scrollTop = 100;
    await flushAct(() => {
      timeline!.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    const simulateMessage = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-simulate-first-conversation-update"]',
    );
    expect(simulateMessage).not.toBeNull();
    await flushAct(() => simulateMessage!.click());

    expect(timeline!.scrollTop).toBe(100);

    const secondConversation = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-conversation-client-b"]',
    );
    expect(secondConversation).not.toBeNull();
    await flushAct(() => secondConversation!.click());

    expect(timeline!.textContent).toContain(secondMessage.content);
    expect(timeline!.scrollTop).toBe(timeline!.scrollHeight);
    expect(timeline!.scrollTop).not.toBe(100);
  });
});

describe("client conversation message sending", () => {
  it("keeps the draft after a failed send and retries with the same content", async () => {
    const attempts: string[] = [];
    const notifications: InboxMessageToast[] = [];
    const submission: { current: Promise<void> | null } = { current: null };
    const { container } = await renderComponent(
      createElement(InboxSendInteractionHarness, {
        attempts,
        notifications,
        submission,
      }),
    );
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="input-conversation-message"]',
    );
    const sendButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-send-conversation-message"]',
    );
    expect(input).not.toBeNull();
    expect(sendButton).not.toBeNull();

    const message = "Olá, preciso confirmar o horário da viagem.";
    await flushAct(() => setInputValue(input!, message));
    expect(input!.value).toBe(message);

    await flushAct(() => sendButton!.click());
    expect(submission.current).not.toBeNull();
    await flushAct(async () => {
      await submission.current;
    });

    expect(input!.value).toBe(message);
    expect(attempts).toEqual([message]);
    expect(notifications).toEqual([
      {
        title: "Não foi possível enviar a mensagem.",
        description: "Falha temporária da API",
        variant: "destructive",
      },
    ]);

    await flushAct(() => sendButton!.click());
    expect(submission.current).not.toBeNull();
    await flushAct(async () => {
      await submission.current;
    });

    expect(attempts).toEqual([message, message]);
    expect(input!.value).toBe("");
    expect(notifications).toHaveLength(1);
  });
});

describe("delayed conversation history refreshes", () => {
  it("keeps client B's messages and error when client A's periodic refresh finishes late", async () => {
    const requests = installDeferredHistoryFetch();
    const { container } = await renderComponent(
      createElement(DelayedHistoryRefreshHarness),
    );
    const history = container.querySelector<HTMLElement>(
      '[data-testid="selected-client-history"]',
    );
    const historyError = container.querySelector<HTMLElement>(
      '[data-testid="selected-client-history-error"]',
    );
    expect(history).not.toBeNull();
    expect(historyError).not.toBeNull();

    const initialAMessage = makeHistoryMessage("conversation-a", "Histórico inicial da Ana");
    await flushAct(async () => {
      await settleHistorySuccess(
        getHistoryRequest(requests, "conversation-a"),
        [initialAMessage],
      );
    });
    expect(history!.textContent).toContain(initialAMessage.content);

    const periodicUpdate = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-simulate-periodic-client-a-update"]',
    );
    expect(periodicUpdate).not.toBeNull();
    await flushAct(() => periodicUpdate!.click());

    const delayedARefresh = getHistoryRequest(requests, "conversation-a", 1);
    const delayedANewConversation = getHistoryRequest(requests, "conversation-a-new");
    const selectClientB = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-select-client-b"]',
    );
    expect(selectClientB).not.toBeNull();
    await flushAct(() => selectClientB!.click());

    const currentBMessage = makeHistoryMessage(
      "conversation-b-main",
      "Histórico atual da Bruna",
    );
    await flushAct(async () => {
      await Promise.all([
        settleHistorySuccess(
          getHistoryRequest(requests, "conversation-b-main"),
          [currentBMessage],
        ),
        settleHistoryFailure(
          getHistoryRequest(requests, "conversation-b-failed-1"),
        ),
        settleHistoryFailure(
          getHistoryRequest(requests, "conversation-b-failed-2"),
        ),
      ]);
    });

    const clientBError =
      "Não foi possível carregar 2 de 3 conversas vinculadas. Os demais históricos continuam disponíveis.";
    expect(container.querySelector('[data-testid="selected-history-client"]')?.textContent)
      .toBe("client-b");
    expect(history!.textContent).toContain(currentBMessage.content);
    expect(history!.textContent).not.toContain(initialAMessage.content);
    expect(historyError!.textContent).toBe(clientBError);
    const failedSessions = container.querySelector<HTMLElement>(
      '[data-testid="failed-conversation-history-labels"]',
    );
    const failureWarning = container.querySelector<HTMLElement>(
      '[data-testid="conversation-ai-history-error"]',
    );
    expect(failedSessions).not.toBeNull();
    expect(failureWarning?.textContent).toContain("Sessões com histórico incompleto:");
    expect(failedSessions!.querySelectorAll("li")).toHaveLength(2);
    const failedSessionLabels = Array.from(
      failedSessions!.querySelectorAll("button"),
      (button) => button.textContent,
    );
    expect(failedSessionLabels).toEqual([
      "Sessão iniciada em 02/10/2026, 09:00 (sessão 1)",
      "Sessão iniciada em 02/10/2026, 09:00 (sessão 2)",
    ]);
    expect(new Set(failedSessionLabels).size).toBe(2);
    const failedSessionAriaLabels = Array.from(
      failedSessions!.querySelectorAll("button"),
      (button) => button.getAttribute("aria-label"),
    );
    expect(failedSessionAriaLabels).toEqual([
      "Abrir Sessão iniciada em 02/10/2026, 09:00 (sessão 1) no Atendimento IA",
      "Abrir Sessão iniciada em 02/10/2026, 09:00 (sessão 2) no Atendimento IA",
    ]);
    expect(failedSessions!.textContent).not.toContain("conversation-b-failed");
    expect(failedSessions!.textContent).not.toContain("+5511999990001");
    expect(failedSessions!.textContent).not.toContain("+5511999990002");
    expect(failureWarning?.textContent).not.toContain("conversation-b-failed");
    expect(failureWarning?.textContent).not.toContain("+5511999990001");
    expect(failureWarning?.textContent).not.toContain("+5511999990002");

    const failedSessionLink = container.querySelector<HTMLButtonElement>(
      '[data-testid="button-open-failed-whatsapp-session-0"]',
    );
    expect(failedSessionLink?.textContent)
      .toBe("Sessão iniciada em 02/10/2026, 09:00 (sessão 1)");
    expect(failedSessionAriaLabels.join(" "))
      .not.toContain("conversation-b-failed");
    expect(failedSessionAriaLabels.join(" "))
      .not.toContain("+5511999990001");
    expect(failedSessionAriaLabels.join(" "))
      .not.toContain("+5511999990002");
    await flushAct(() => failedSessionLink?.click());
    expect(container.querySelector('[data-testid="active-communication-tab"]')?.textContent)
      .toBe("ai-inbox");
    expect(container.querySelector('[data-testid="selected-ai-conversation"]')?.textContent)
      .toBe("conversation-b-failed-1");
    expect(container.querySelector('[data-testid="selected-history-client"]')?.textContent)
      .toBe("client-b");

    await flushAct(async () => {
      await Promise.all([
        settleHistorySuccess(
          delayedARefresh,
          [makeHistoryMessage("conversation-a", "Atualização atrasada da Ana")],
        ),
        settleHistoryFailure(delayedANewConversation),
      ]);
    });

    expect(history!.textContent).toContain(currentBMessage.content);
    expect(history!.textContent).not.toContain("Atualização atrasada da Ana");
    expect(historyError!.textContent).toBe(clientBError);
    expect(failedSessions!.textContent)
      .toContain("Sessão iniciada em 02/10/2026, 09:00 (sessão 1)");
    expect(failedSessions!.textContent)
      .toContain("Sessão iniciada em 02/10/2026, 09:00 (sessão 2)");
  });

  it("bounds concurrent history loads and keeps successful results when one of many fails", async () => {
    const conversationCount = 13;
    const conversationIds = Array.from(
      { length: conversationCount },
      (_, index) => `large-conversation-${String(index).padStart(2, "0")}`,
    );
    const requests = new Map<string, Deferred<Response>>();
    let activeRequests = 0;
    let peakActiveRequests = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const conversationId = decodeURIComponent(
        String(input).match(/\/chatbot-conversations\/([^/]+)\/messages/)?.[1] ?? "",
      );
      if (!conversationId) throw new Error("History URL did not contain a conversation ID");

      const request = createDeferred<Response>();
      requests.set(conversationId, request);
      activeRequests++;
      peakActiveRequests = Math.max(peakActiveRequests, activeRequests);
      return request.promise.finally(() => {
        activeRequests--;
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = await renderComponent(
      createElement(LargeConversationHistoryHarness, { conversationCount }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(activeRequests).toBe(5);

    for (const [index, conversationId] of conversationIds.entries()) {
      const request = requests.get(conversationId);
      expect(request).toBeDefined();
      await flushAct(async () => {
        if (index === 7) {
          await settleHistoryFailure(request!);
        } else {
          await settleHistorySuccess(
            request!,
            [makeHistoryMessage(conversationId, `Histórico carregado ${index}`)],
          );
        }
      });
      expect(peakActiveRequests).toBeLessThanOrEqual(5);
    }

    const historyError = container.querySelector<HTMLElement>(
      '[data-testid="large-history-error"]',
    );
    const history = container.querySelector<HTMLElement>(
      '[data-testid="large-history-messages"]',
    );
    expect(fetchMock).toHaveBeenCalledTimes(conversationCount);
    expect(activeRequests).toBe(0);
    expect(peakActiveRequests).toBe(5);
    expect(container.querySelector('[data-testid="large-history-loading"]')?.textContent)
      .toBe("false");
    expect(historyError?.textContent)
      .toBe("Não foi possível carregar 1 de 13 conversas vinculadas. Os demais históricos continuam disponíveis.");
    expect(history?.textContent).toContain("Histórico carregado 0");
    expect(history?.textContent).toContain("Histórico carregado 12");
    expect(history?.textContent).not.toContain("Histórico carregado 7");
  });
});
