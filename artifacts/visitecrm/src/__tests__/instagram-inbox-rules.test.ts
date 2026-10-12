import { describe, expect, it } from "vitest";
import type { AiConversation, AiMessage } from "../pages/communication/CommunicationInboxTabs";
import {
  getInstagramIdentity,
  getInstagramProfileUrl,
  getInstagramReplyByteCount,
  getWhatsAppDirectUrl,
  INSTAGRAM_REPLY_MAX_BYTES,
  isInstagramReplyWindowExpired,
} from "../pages/communication/instagramInboxRules";

const conversation = (overrides: Partial<AiConversation> = {}): AiConversation => ({
  id: "ig-1",
  clientId: null,
  clientName: null,
  channel: "instagram",
  status: "human_handoff",
  assignedUserId: null,
  sessionId: null,
  startedAt: "2026-11-01T10:00:00.000Z",
  createdAt: "2026-11-01T10:00:00.000Z",
  lastMessageId: null,
  lastMessageContent: null,
  lastMessageAt: null,
  lastMessageRole: null,
  lastMessageIsBot: null,
  lastMessageStatus: null,
  messageCount: 0,
  metadata: null,
  ...overrides,
});

const message = (role: string, sentAt: string): AiMessage => ({
  id: `${role}-${sentAt}`,
  conversationId: "ig-1",
  role,
  content: "",
  isBot: false,
  sentAt,
});

describe("Instagram inbox policy", () => {
  it("uses customer name, then session ID, then a safe identity fallback", () => {
    expect(getInstagramIdentity(conversation({ clientName: "  Ana Silva  " }))).toBe("Ana Silva");
    expect(getInstagramIdentity(conversation({ sessionId: "ig:ana_88" }))).toBe("ig:ana_88");
    expect(getInstagramIdentity(conversation())).toBe("Contato sem identificação");
  });

  it("prefers the provider-confirmed Instagram username when available", () => {
    expect(getInstagramIdentity(conversation({
      clientName: "Ana Silva",
      metadata: { instagramUsername: "ana.silva" },
    }))).toBe("@ana.silva");
  });

  it("builds safe direct contact links from a handle or a WhatsApp number", () => {
    expect(getInstagramProfileUrl("@lindomar.cariri")).toBe("https://www.instagram.com/lindomar.cariri/");
    expect(getInstagramProfileUrl("https://instagram.com/lindomar.cariri/")).toBe("https://www.instagram.com/lindomar.cariri/");
    expect(getInstagramProfileUrl("javascript:alert(1)")).toBeNull();
    expect(getWhatsAppDirectUrl("(88) 99999-1234")).toBe("https://wa.me/5588999991234");
    expect(getWhatsAppDirectUrl("123")).toBeNull();
  });

  it("keeps replies available only within 24 hours of the latest inbound message", () => {
    const now = Date.parse("2026-11-02T10:00:00.000Z");
    expect(isInstagramReplyWindowExpired([message("user", "2026-11-01T10:00:01.000Z")], now)).toBe(false);
    expect(isInstagramReplyWindowExpired([message("user", "2026-11-01T10:00:00.000Z")], now)).toBe(true);
    expect(isInstagramReplyWindowExpired([
      message("user", "2026-11-01T08:00:00.000Z"),
      message("assistant", "2026-11-02T09:59:00.000Z"),
    ], now)).toBe(true);
  });

  it("counts UTF-8 bytes after trimming and enforces the 1,000-byte boundary", () => {
    expect(getInstagramReplyByteCount("  olá  ")).toBe(4);
    expect(getInstagramReplyByteCount("á".repeat(500))).toBe(INSTAGRAM_REPLY_MAX_BYTES);
    expect(getInstagramReplyByteCount("á".repeat(501))).toBeGreaterThan(INSTAGRAM_REPLY_MAX_BYTES);
  });
});
