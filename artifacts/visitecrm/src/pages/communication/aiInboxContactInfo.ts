import type { AiConversation } from "./CommunicationInboxTabs";

export interface AiInboxClientDetails {
  name?: string | null;
  photoUrl?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  instagram?: string | null;
  tags?: string[] | null;
}

function getInstagramHandle(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const input = value.trim();
  const urlMatch = input.match(
    /(?:^|\/\/)(?:www\.)?instagram\.com\/([^/?#]+)/i,
  );
  const username = (urlMatch?.[1] ?? input).replace(/^@+/, "");
  return username ? `@${username}` : null;
}

export function formatInboxPhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const digits = value.replace(/@s\.whatsapp\.net$/i, "").replace(/\D/g, "");
  const hasBrazilCode =
    digits.startsWith("55") && [12, 13].includes(digits.length);
  const localNumber = hasBrazilCode ? digits.slice(2) : digits;

  if (localNumber.length === 11) {
    return `${hasBrazilCode ? "+55 " : ""}(${localNumber.slice(0, 2)}) ${localNumber.slice(2, 7)}-${localNumber.slice(7)}`;
  }
  if (localNumber.length === 10) {
    return `${hasBrazilCode ? "+55 " : ""}(${localNumber.slice(0, 2)}) ${localNumber.slice(2, 6)}-${localNumber.slice(6)}`;
  }
  if (digits.length >= 12 && digits.length <= 15) return `+${digits}`;
  return null;
}

export function getAiInboxDisplayName(
  conversation: AiConversation,
  client?: AiInboxClientDetails,
): string {
  return (
    client?.name?.trim() ||
    conversation.clientName?.trim() ||
    (conversation.channel === "instagram"
      ? (getInstagramHandle(conversation.metadata?.["instagramUsername"]) ??
        "Contato do Instagram")
      : "Contato WhatsApp")
  );
}

export function getAiInboxChannelIdentifier(
  conversation: AiConversation,
  client?: AiInboxClientDetails,
): string | null {
  if (conversation.channel === "instagram") {
    return (
      getInstagramHandle(conversation.metadata?.["instagramUsername"]) ??
      getInstagramHandle(client?.instagram)
    );
  }
  return formatInboxPhone(
    client?.whatsapp || client?.phone || conversation.sessionId,
  );
}

export function getAiInboxInitials(name: string): string {
  const parts = name.replace(/^@+/, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CM";
  return parts.length === 1
    ? parts[0].slice(0, 2).toLocaleUpperCase("pt-BR")
    : `${parts[0][0]}${parts[parts.length - 1][0]}`.toLocaleUpperCase("pt-BR");
}
