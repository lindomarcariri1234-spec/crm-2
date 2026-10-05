import { createElement, useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanupRoots,
  flushAct,
  renderComponent,
} from "./eventSourceHarness.js";
import { ConversationsTab } from "../pages/communication/CommunicationInboxTabs";
import type {
  ClientConversationSummary,
  CommunicationTimelineEntry,
} from "../lib/communicationTimeline";

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

afterEach(async () => {
  await cleanupRoots();
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