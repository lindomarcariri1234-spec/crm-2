import type { AiConversation, AiMessage } from "./CommunicationInboxTabs";

export const INSTAGRAM_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const INSTAGRAM_REPLY_MAX_BYTES = 1000;

export function getInstagramIdentity(conversation: Pick<AiConversation, "clientName" | "sessionId" | "metadata">): string {
  const username = conversation.metadata?.["instagramUsername"];
  if (typeof username === "string" && username.trim()) {
    return `@${username.trim().replace(/^@+/, "")}`;
  }
  return conversation.clientName?.trim() || conversation.sessionId?.trim() || "Contato sem identificação";
}

export function getInstagramProfileUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  const urlMatch = input.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)\/?$/i);
  const username = (urlMatch?.[1] ?? input).replace(/^@+/, "");
  if (!/^[a-z0-9._]{1,30}$/i.test(username)) return null;
  return `https://www.instagram.com/${username}/`;
}

export function getWhatsAppDirectUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let number = value.replace(/\D/g, "");
  if (number.length === 10 || number.length === 11) number = `55${number}`;
  if (number.length < 12 || number.length > 15) return null;
  return `https://wa.me/${number}`;
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
