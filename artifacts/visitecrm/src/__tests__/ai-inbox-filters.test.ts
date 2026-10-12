import { describe, expect, it } from "vitest";
import type { AiConversation } from "../pages/communication/CommunicationInboxTabs";
import {
  filterAiInboxConversations,
  getAiInboxStatusCounts,
} from "../pages/communication/aiInboxFilters";

function conversation(
  id: string,
  overrides: Partial<AiConversation> = {},
): AiConversation {
  return {
    id,
    clientId: null,
    clientName: null,
    channel: "whatsapp",
    status: "active",
    assignedUserId: null,
    sessionId: id,
    metadata: null,
    startedAt: "2026-10-01T10:00:00.000Z",
    createdAt: "2026-10-01T10:00:00.000Z",
    lastMessageId: null,
    lastMessageContent: "",
    lastMessageAt: null,
    lastMessageRole: null,
    lastMessageIsBot: null,
    lastMessageStatus: null,
    messageCount: 0,
    ...overrides,
  };
}

describe("multichannel inbox filters", () => {
  const conversations = [
    conversation("handoff-wa", {
      status: "human_handoff",
      clientName: "Ana Silva",
      lastMessageContent: "Quero falar com a equipe",
      lastMessageAt: "2026-10-02T10:00:00.000Z",
    }),
    conversation("automation-ig", {
      channel: "instagram",
      clientName: "Bruna Costa",
      lastMessageContent: "Dúvida sobre a viagem",
      lastMessageAt: "2026-10-03T10:00:00.000Z",
    }),
    conversation("automation-wa", {
      clientName: "Caio Souza",
      lastMessageContent: "Duvida sobre o roteiro",
      lastMessageAt: "2026-10-02T12:00:00.000Z",
    }),
    conversation("opted-out-wa", { status: "opted_out" }),
    conversation("unsupported-email", { channel: "email" }),
  ];

  it("counts each triage state within the selected channel", () => {
    expect(getAiInboxStatusCounts(conversations, "all")).toEqual({
      all: 4,
      human: 1,
      automation: 2,
      opted_out: 1,
    });
    expect(getAiInboxStatusCounts(conversations, "whatsapp")).toEqual({
      all: 3,
      human: 1,
      automation: 1,
      opted_out: 1,
    });
  });

  it("combines channel, status, and localized search, then orders newest first", () => {
    const result = filterAiInboxConversations(
      conversations,
      { channel: "all", status: "automation", search: "duvida" },
      (item) => item.clientName ?? "Contato",
    );

    expect(result.map((item) => item.id)).toEqual([
      "automation-ig",
      "automation-wa",
    ]);
  });

  it("keeps opt-outs separate from automation and excludes unsupported channels", () => {
    const result = filterAiInboxConversations(
      conversations,
      { channel: "all", status: "opted_out", search: "" },
      (item) => item.clientName ?? "Contato",
    );

    expect(result.map((item) => item.id)).toEqual(["opted-out-wa"]);
  });
});
