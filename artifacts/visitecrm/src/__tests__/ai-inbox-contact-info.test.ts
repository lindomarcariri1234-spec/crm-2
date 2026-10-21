import { describe, expect, it } from "vitest";
import type { AiConversation } from "../pages/communication/CommunicationInboxTabs";
import {
  formatInboxPhone,
  getAiInboxChannelIdentifier,
  getAiInboxDisplayName,
  getAiInboxInitials,
} from "../pages/communication/aiInboxContactInfo";

const baseConversation: AiConversation = {
  id: "conversation-1",
  clientId: "client-1",
  clientName: "Mariana Costa",
  channel: "whatsapp",
  status: "active",
  assignedUserId: null,
  sessionId: "5511999990001",
  metadata: null,
  startedAt: "2026-10-01T10:00:00.000Z",
  createdAt: "2026-10-01T10:00:00.000Z",
  lastMessageId: null,
  lastMessageContent: null,
  lastMessageAt: null,
  lastMessageRole: null,
  lastMessageIsBot: null,
  lastMessageStatus: null,
  messageCount: 0,
};

describe("inbox contact details", () => {
  it("shows the linked client name and a readable WhatsApp number", () => {
    expect(
      getAiInboxDisplayName(baseConversation, { name: "Mariana Costa" }),
    ).toBe("Mariana Costa");
    expect(getAiInboxChannelIdentifier(baseConversation)).toBe(
      "+55 (11) 99999-0001",
    );
  });

  it("uses the Instagram handle as channel identity and keeps the client name primary", () => {
    const instagramConversation = {
      ...baseConversation,
      channel: "instagram",
      metadata: { instagramUsername: "@mariana.costa" },
    };

    expect(getAiInboxDisplayName(instagramConversation)).toBe("Mariana Costa");
    expect(getAiInboxChannelIdentifier(instagramConversation)).toBe(
      "@mariana.costa",
    );
  });

  it("normalizes Brazilian numbers, WhatsApp JIDs, and avatar initials", () => {
    expect(formatInboxPhone("11999990001@s.whatsapp.net")).toBe(
      "(11) 99999-0001",
    );
    expect(getAiInboxInitials("Mariana Costa")).toBe("MC");
    expect(getAiInboxInitials("@mariana.costa")).toBe("MA");
  });
});
