import type { AiConversation } from "./CommunicationInboxTabs";

export type AiInboxChannelFilter = "all" | "whatsapp" | "instagram";
export type AiInboxStatusFilter = "all" | "human" | "automation" | "opted_out";

export interface AiInboxStatusCounts {
  all: number;
  human: number;
  automation: number;
  opted_out: number;
}

function normalizeSearchValue(value: string): string {
  return value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function supportsInboxChannel(conversation: AiConversation): boolean {
  return (
    conversation.channel === "whatsapp" || conversation.channel === "instagram"
  );
}

function matchesStatus(
  conversation: AiConversation,
  status: AiInboxStatusFilter,
): boolean {
  if (status === "all") return true;
  if (status === "human") return conversation.status === "human_handoff";
  if (status === "opted_out") return conversation.status === "opted_out";
  return (
    conversation.status !== "human_handoff" &&
    conversation.status !== "opted_out"
  );
}

export function getAiInboxStatusCounts(
  conversations: AiConversation[],
  channel: AiInboxChannelFilter,
): AiInboxStatusCounts {
  const supported = conversations.filter(
    (conversation) =>
      supportsInboxChannel(conversation) &&
      (channel === "all" || conversation.channel === channel),
  );

  return {
    all: supported.length,
    human: supported.filter((conversation) =>
      matchesStatus(conversation, "human"),
    ).length,
    automation: supported.filter((conversation) =>
      matchesStatus(conversation, "automation"),
    ).length,
    opted_out: supported.filter((conversation) =>
      matchesStatus(conversation, "opted_out"),
    ).length,
  };
}

export function filterAiInboxConversations(
  conversations: AiConversation[],
  filters: {
    channel: AiInboxChannelFilter;
    status: AiInboxStatusFilter;
    search: string;
  },
  getIdentity: (conversation: AiConversation) => string,
): AiConversation[] {
  const query = normalizeSearchValue(filters.search.trim());

  return conversations
    .filter((conversation) => {
      if (!supportsInboxChannel(conversation)) return false;
      if (filters.channel !== "all" && conversation.channel !== filters.channel)
        return false;
      if (!matchesStatus(conversation, filters.status)) return false;

      const searchable = [
        getIdentity(conversation),
        conversation.clientName,
        conversation.sessionId,
        conversation.lastMessageContent,
        conversation.channel,
      ]
        .filter(Boolean)
        .join(" ");

      return !query || normalizeSearchValue(searchable).includes(query);
    })
    .sort((a, b) => {
      const timeA = Date.parse(a.lastMessageAt ?? a.createdAt);
      const timeB = Date.parse(b.lastMessageAt ?? b.createdAt);
      return (
        (Number.isFinite(timeB) ? timeB : 0) -
        (Number.isFinite(timeA) ? timeA : 0)
      );
    });
}
