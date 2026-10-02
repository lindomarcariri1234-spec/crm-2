import { describe, expect, it } from "vitest";
import {
  buildClientConversationSummaries,
  buildClientTimeline,
  filterClientConversationSummaries,
  type AiConversationMessage,
  type ClientConversationSummary,
  type AiConversationSummary,
} from "../lib/communicationTimeline";

const conversation: AiConversationSummary = {
  id: "chat-1",
  clientId: "client-1",
  clientName: "Ana Silva",
  channel: "whatsapp",
  status: "human_handoff",
  createdAt: "2026-10-01T10:00:00.000Z",
  lastMessageId: "human-1",
  lastMessageContent: "Já estou verificando.",
  lastMessageAt: "2026-10-01T10:03:00.000Z",
  lastMessageRole: "assistant",
  lastMessageIsBot: false,
  lastMessageStatus: "sent",
  messageCount: 3,
};

const chatbotMessages: AiConversationMessage[] = [
  {
    id: "inbound-1",
    conversationId: "chat-1",
    role: "user",
    content: "Minha reserva foi confirmada?",
    isBot: false,
    sentAt: "2026-10-01T10:00:00.000Z",
    deliveryStatus: "sent",
  },
  {
    id: "bot-1",
    conversationId: "chat-1",
    role: "assistant",
    content: "Vou conferir para você.",
    isBot: true,
    sentAt: "2026-10-01T10:01:00.000Z",
    deliveryStatus: "sent",
  },
  {
    id: "human-1",
    conversationId: "chat-1",
    role: "assistant",
    content: "Já estou verificando.",
    isBot: false,
    sentAt: "2026-10-01T10:03:00.000Z",
    deliveryStatus: "sent",
  },
];

describe("communication timeline", () => {
  it("merges inbound, automated, human, and outbound-ledger messages chronologically", () => {
    const timeline = buildClientTimeline({
      clientId: "client-1",
      messages: [
        {
          id: "legacy-1",
          toClientId: "client-1",
          clientName: "Ana Silva",
          channel: "sms",
          content: "Mensagem antiga",
          status: "sent",
          sentAt: "2026-10-01T09:00:00.000Z",
        },
        {
          id: "projected-1",
          toClientId: "client-1",
          clientName: "Ana Silva",
          channel: "whatsapp",
          content: "Já estou verificando.",
          status: "accepted",
          sentAt: "2026-10-01T10:03:00.000Z",
          outboundMessageId: "outbound-1",
        },
      ],
      outboundMessages: [{
        id: "outbound-1",
        recipientType: "client",
        recipientId: "client-1",
        recipientName: "Ana Silva",
        createdAt: "2026-10-01T10:02:00.000Z",
        deliveries: [{
          id: "delivery-1",
          channel: "email",
          content: "<p>Segue a confirmação.</p>",
          status: "accepted",
          createdAt: "2026-10-01T10:01:45.000Z",
          acceptedAt: "2026-10-01T10:02:00.000Z",
        }],
      }],
      chatbotConversations: [conversation],
      chatbotMessages,
    });

    expect(timeline.map((message) => [message.source, message.actor, message.channel])).toEqual([
      ["message", "team", "sms"],
      ["chatbot", "client", "whatsapp"],
      ["chatbot", "ai", "whatsapp"],
      ["outbound", "team", "email"],
      ["chatbot", "team", "whatsapp"],
    ]);
    expect(timeline.map((message) => message.sentAt)).toEqual([
      "2026-10-01T09:00:00.000Z",
      "2026-10-01T10:00:00.000Z",
      "2026-10-01T10:01:00.000Z",
      "2026-10-01T10:02:00.000Z",
      "2026-10-01T10:03:00.000Z",
    ]);
    expect(timeline.find((message) => message.source === "outbound")?.content).toBe("Segue a confirmação.");
    expect(timeline.filter((message) => message.content === "Já estou verificando.")).toHaveLength(1);
  });

  it("lists clients with inbound-only conversations and skips unlinked or other-client messages", () => {
    const inboundOnly: AiConversationSummary = {
      ...conversation,
      id: "chat-inbound",
      clientId: "client-2",
      clientName: "Bruno Lima",
      lastMessageId: "inbound-2",
      lastMessageContent: "Preciso de ajuda.",
      lastMessageAt: "2026-10-02T10:00:00.000Z",
      lastMessageRole: "user",
      lastMessageIsBot: false,
      messageCount: 1,
    };
    const unlinked = { ...inboundOnly, id: "chat-unlinked", clientId: null };

    const summaries = buildClientConversationSummaries({
      messages: [],
      outboundMessages: [],
      chatbotConversations: [conversation, inboundOnly, unlinked],
    });
    expect(summaries.map(({ clientId, clientName, lastMessage }) => [
      clientId,
      clientName,
      lastMessage.direction,
      lastMessage.actor,
    ])).toEqual([
      ["client-2", "Bruno Lima", "inbound", "client"],
      ["client-1", "Ana Silva", "outbound", "team"],
    ]);

    const timeline = buildClientTimeline({
      clientId: "client-2",
      messages: [],
      outboundMessages: [],
      chatbotConversations: [inboundOnly, unlinked],
      chatbotMessages: [
        { ...chatbotMessages[0], id: "for-client-1" },
        {
          ...chatbotMessages[0],
          id: "for-client-2",
          conversationId: "chat-inbound",
          content: "Preciso de ajuda.",
          sentAt: "2026-10-02T10:00:00.000Z",
        },
        {
          ...chatbotMessages[0],
          id: "system-message",
          conversationId: "chat-inbound",
          role: "system",
          content: "Contexto interno",
        },
      ],
    });
    expect(timeline.map(({ id, direction, actor }) => [id, direction, actor])).toEqual([
      ["chatbot:for-client-2", "inbound", "client"],
    ]);
  });
});

describe("client conversation search", () => {
  const summaries: ClientConversationSummary[] = [
    {
      clientId: "client-ana",
      clientName: "Ana Paula",
      count: 2,
      lastMessage: {
        id: "message-ana",
        clientId: "client-ana",
        clientName: "Ana Paula",
        channel: "whatsapp",
        content: "Confirmação da excursão",
        direction: "inbound",
        actor: "client",
        sentAt: "2026-10-02T12:00:00.000Z",
        status: "received",
        source: "chatbot",
      },
    },
    {
      clientId: "client-bruno",
      clientName: "Bruno Lima",
      count: 1,
      lastMessage: {
        id: "message-bruno",
        clientId: "client-bruno",
        clientName: "Bruno Lima",
        channel: "email",
        content: "Proposta enviada para análise",
        direction: "outbound",
        actor: "team",
        sentAt: "2026-10-02T11:00:00.000Z",
        status: "accepted",
        source: "outbound",
      },
    },
  ];

  it("matches client names and message text without requiring accents or word order", () => {
    expect(filterClientConversationSummaries(summaries, "confirmacao ana")).toEqual([summaries[0]]);
  });

  it("matches channel, actor, and direction, and returns all rows for a blank query", () => {
    expect(filterClientConversationSummaries(summaries, "equipe email enviada")).toEqual([summaries[1]]);
    expect(filterClientConversationSummaries(summaries, "  ")).toBe(summaries);
  });
});