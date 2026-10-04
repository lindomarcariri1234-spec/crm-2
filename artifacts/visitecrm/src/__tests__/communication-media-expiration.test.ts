import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AiInboxTab,
  ConversationsTab,
  MessageMediaAttachment,
  type AiConversation,
  type AiMessage,
} from "../pages/communication/CommunicationInboxTabs";
import type {
  ClientConversationSummary,
  CommunicationTimelineEntry,
} from "../lib/communicationTimeline";

const expiredAt = "2026-10-01T10:00:00.000Z";

const expiredTimelineMessage: CommunicationTimelineEntry = {
  id: "chatbot:expired-media",
  clientId: "client-expired-media",
  clientName: "Ana Silva",
  channel: "whatsapp",
  content: "Áudio recebido",
  direction: "inbound",
  actor: "client",
  sentAt: expiredAt,
  status: "received",
  source: "chatbot",
  mediaUrl: null,
  mediaMimeType: "audio/ogg",
  mediaFileName: "voice.ogg",
  mediaExpiredAt: expiredAt,
};

const expiredAiConversation: AiConversation = {
  id: "conversation-expired-media",
  clientId: "client-expired-media",
  clientName: "Ana Silva",
  channel: "whatsapp",
  status: "human_handoff",
  assignedUserId: null,
  sessionId: "5511999999999",
  startedAt: expiredAt,
  createdAt: expiredAt,
  lastMessageId: "expired-media",
  lastMessageContent: "Áudio recebido",
  lastMessageAt: expiredAt,
  lastMessageRole: "user",
  lastMessageIsBot: false,
  lastMessageStatus: null,
  messageCount: 1,
};

const expiredAiMessage: AiMessage = {
  id: "expired-media",
  conversationId: expiredAiConversation.id,
  role: "user",
  content: "Áudio recebido",
  isBot: false,
  sentAt: expiredAt,
  mediaUrl: null,
  mediaMimeType: "audio/ogg",
  mediaFileName: "voice.ogg",
  mediaExpiredAt: expiredAt,
};

function expectExpiredMediaStatus(html: string) {
  expect(html).toContain("Anexo expirado após 90 dias");
  expect(html).toContain('role="status"');
  expect(html).not.toContain("<audio");
  expect(html).not.toContain("https://ufs.example/stale-media");
}

describe("WhatsApp message media expiration", () => {
  it("shows the expiry notice when the expired media URL has been cleared", () => {
    const html = renderToStaticMarkup(
      createElement(MessageMediaAttachment, {
        url: null,
        mimeType: "audio/ogg",
        fileName: "voice.ogg",
        expiredAt: "2026-10-01T10:00:00.000Z",
      }),
    );

    expect(html).toContain("Anexo expirado após 90 dias");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Anexo indisponível");
  });

  it("keeps the unavailable status for a missing URL without an expiry marker", () => {
    const html = renderToStaticMarkup(
      createElement(MessageMediaAttachment, {
        url: null,
        mimeType: "audio/ogg",
        fileName: "voice.ogg",
        expiredAt: null,
      }),
    );

    expect(html).toContain("Anexo indisponível");
    expect(html).not.toContain("Anexo expirado após 90 dias");
  });

  it("shows the expired status in the client conversation view", () => {
    const summary: ClientConversationSummary = {
      clientId: expiredTimelineMessage.clientId,
      clientName: expiredTimelineMessage.clientName,
      lastMessage: expiredTimelineMessage,
      count: 1,
    };
    const html = renderToStaticMarkup(
      createElement(ConversationsTab, {
        channelColors: { whatsapp: "" },
        channelLabels: { whatsapp: "WhatsApp" },
        summaries: [summary],
        selectedClientId: summary.clientId,
        onSelectClient: () => {},
        loadingMessages: false,
        loadingOutboundMessages: false,
        loadingAiInbox: false,
        messagesError: false,
        messagesQueryError: null,
        outboundMessagesError: false,
        aiInboxError: null,
        refetchMessages: () => {},
        refetchOutboundMessages: () => {},
        fetchAiInbox: () => {},
        conversationMessages: [expiredTimelineMessage],
        selectedClientName: summary.clientName,
        loadingConversationAiMessages: false,
        conversationAiError: null,
        selectedWhatsAppConversation: null,
        selectedClientLinkStatus: "valid",
        onRetryClientLinkCheck: () => {},
        onReassociateConversation: () => {},
        inboxChannel: "whatsapp",
        setInboxChannel: () => {},
        inboxMessage: "",
        setInboxMessage: () => {},
        handleSendInbox: () => {},
        sendingMessage: false,
      }),
    );

    expectExpiredMediaStatus(html);
  });

  it("blocks sending and offers WhatsApp reassociation for an invalid client link", () => {
    const summary: ClientConversationSummary = {
      clientId: expiredTimelineMessage.clientId,
      clientName: expiredTimelineMessage.clientName,
      lastMessage: expiredTimelineMessage,
      count: 1,
    };
    const html = renderToStaticMarkup(
      createElement(ConversationsTab, {
        channelColors: { whatsapp: "" },
        channelLabels: { whatsapp: "WhatsApp" },
        summaries: [summary],
        selectedClientId: summary.clientId,
        onSelectClient: () => {},
        loadingMessages: false,
        loadingOutboundMessages: false,
        loadingAiInbox: false,
        messagesError: false,
        messagesQueryError: null,
        outboundMessagesError: false,
        aiInboxError: null,
        refetchMessages: () => {},
        refetchOutboundMessages: () => {},
        fetchAiInbox: () => {},
        conversationMessages: [expiredTimelineMessage],
        selectedClientName: summary.clientName,
        loadingConversationAiMessages: false,
        conversationAiError: null,
        selectedWhatsAppConversation: expiredAiConversation,
        selectedClientLinkStatus: "missing",
        onRetryClientLinkCheck: () => {},
        onReassociateConversation: () => {},
        inboxChannel: "whatsapp",
        setInboxChannel: () => {},
        inboxMessage: "Oi",
        setInboxMessage: () => {},
        handleSendInbox: () => {},
        sendingMessage: false,
      }),
    );

    expect(html).toContain("client-link-missing-warning");
    expect(html).toContain("Abrir atendimento para reassociar");
    expect(html).toMatch(/data-testid="input-conversation-message"[^>]*disabled/);
    expect(html).toMatch(/data-testid="button-send-conversation-message"[^>]*disabled/);
  });

  it("shows the expired status in the WhatsApp AI inbox conversation view", () => {
    const html = renderToStaticMarkup(
      createElement(AiInboxTab, {
        conversations: [expiredAiConversation],
        selectedConversationId: expiredAiConversation.id,
        selectedMessages: [expiredAiMessage],
        loading: false,
        error: null,
        reply: "",
        sendingReply: false,
        onSelectConversation: () => {},
        onRefresh: () => {},
        onReplyChange: () => {},
        onReply: () => {},
      }),
    );

    expectExpiredMediaStatus(html);
  });
});
