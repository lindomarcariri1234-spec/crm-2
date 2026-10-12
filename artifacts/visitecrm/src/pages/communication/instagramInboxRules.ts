import type { AiConversation, AiMessage } from "./CommunicationInboxTabs";

export const INSTAGRAM_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const INSTAGRAM_REPLY_MAX_BYTES = 1000;

export function getInstagramIdentity(conversation: Pick<AiConversation, "clientName" | "sessionId">): string {
  return conversation.clientName?.trim() || conversation.sessionId?.trim() || "Contato sem identificação";
}

export function getInstagramReplyByteCount(content: string): number {
  return new TextEncoder().encode(content.trim()).length;
}

export function isInstagramReplyWindowExpired(messages: AiMessage[], now = Date.now()): boolean {
  const latestInbound = messages.reduce((latest, message) => {
    if (message.role !== "user") return latest;
    const timestamp = Date.parse(message.sentAt);
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, Number.NEGATIVE_INFINITY);
  return !Number.isFinite(latestInbound) || now - latestInbound >= INSTAGRAM_REPLY_WINDOW_MS;
}
