import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  chatbotMessagesTable: { id: "chatbot_messages.id" },
}));

import type { NormalizedInboundEvent } from "./messaging-provider-adapters.js";
import { persistNormalizedInboundMessage } from "./inbound-message-persistence.js";

describe("persistNormalizedInboundMessage", () => {
  it("persists normalized identity, content, timestamp, and media consistently across providers", async () => {
    const sentAt = new Date("2026-10-16T15:30:00.000Z");
    const normalizedEvents: NormalizedInboundEvent[] = [
      {
        provider: "evolution",
        channel: "whatsapp",
        accountId: "evolution-instance",
        conversationId: "5511999900000",
        senderId: "5511999900000",
        externalId: "evolution-123",
        content: "Imagem recebida",
        occurredAt: sentAt,
        media: { kind: "image", mimeType: "image/jpeg", fileName: "image.jpg", url: null },
        providerData: {},
      },
      {
        provider: "meta",
        channel: "instagram",
        accountId: "meta-account",
        conversationId: "instagram-sender",
        senderId: "instagram-sender",
        externalId: "meta-123",
        content: "Oi",
        occurredAt: sentAt,
        media: null,
        providerData: {},
      },
      {
        provider: "zernio",
        channel: "instagram",
        accountId: "zernio-account",
        conversationId: "zernio-conversation",
        senderId: "zernio-sender",
        externalId: "zernio-123",
        content: "Mídia recebida pelo Instagram",
        occurredAt: sentAt,
        media: {
          kind: "attachment",
          mimeType: "image/jpeg",
          fileName: "image.jpg",
          url: "https://media.example.test/image.jpg",
        },
        providerData: {},
      },
    ];

    for (const event of normalizedEvents) {
      const insertedId = `inserted-${event.provider}`;
      const returning = vi.fn(async () => [{ id: insertedId }]);
      const onConflictDoNothing = vi.fn(() => ({ returning }));
      const values = vi.fn(() => ({ onConflictDoNothing }));
      const insert = vi.fn(() => ({ values }));
      const executor = { insert } as never;
      const sourceMessageId = event.externalId
        ? `${event.provider}:${event.externalId}`
        : null;

      await expect(persistNormalizedInboundMessage(executor, event, {
        tenantId: "tenant-shared",
        conversationId: `conversation-${event.provider}`,
        sourceMessageId,
      })).resolves.toEqual({ id: insertedId });

      expect(values).toHaveBeenCalledWith(expect.objectContaining({
        tenantId: "tenant-shared",
        conversationId: `conversation-${event.provider}`,
        sourceMessageId,
        role: "user",
        content: event.content,
        sentAt,
        isBot: false,
        mediaUrl: event.media?.url ?? null,
        mediaMimeType: event.media?.mimeType ?? null,
        mediaFileName: event.media?.fileName ?? null,
      }));
      expect(onConflictDoNothing).toHaveBeenCalledOnce();
    }
  });

  it("can suppress media metadata for events that must not retain attachments", async () => {
    const event: NormalizedInboundEvent = {
      provider: "evolution",
      channel: "whatsapp",
      accountId: "evolution-instance",
      conversationId: "5511999900000",
      senderId: "5511999900000",
      externalId: "opt-out-123",
      content: "STOP",
      occurredAt: null,
      media: { kind: "image", mimeType: "image/jpeg", fileName: "image.jpg", url: null },
      providerData: {},
    };
    const values = vi.fn(() => ({
      onConflictDoNothing: () => ({ returning: async () => [] }),
    }));
    const executor = { insert: () => ({ values }) } as never;

    await persistNormalizedInboundMessage(executor, event, {
      tenantId: "tenant-shared",
      conversationId: "conversation-opt-out",
      sourceMessageId: "opt-out-123",
      media: null,
    });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      mediaUrl: null,
      mediaMimeType: null,
      mediaFileName: null,
    }));
  });
});
