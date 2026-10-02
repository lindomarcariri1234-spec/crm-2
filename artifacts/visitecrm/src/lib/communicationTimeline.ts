export interface AiConversationSummary {
  id: string;
  clientId: string | null;
  clientName?: string | null;
  channel: string;
  status: string;
  createdAt: string;
  lastMessageId?: string | null;
  lastMessageContent?: string | null;
  lastMessageAt?: string | null;
  lastMessageRole?: string | null;
  lastMessageIsBot?: boolean | null;
  lastMessageStatus?: string | null;
  messageCount?: number;
}

export interface AiConversationMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  isBot: boolean;
  sentAt: string;
  deliveryStatus?: string | null;
  mediaUrl?: string | null;
}

interface SentMessage {
  id: string;
  toClientId?: string | null;
  clientName?: string | null;
  channel: string;
  content: string;
  status: string;
  sentAt: string;
  mediaUrl?: string | null;
  outboundMessageId?: string | null;
}

interface OutboundMessage {
  id: string;
  recipientType: string;
  recipientId?: string | null;
  recipientName?: string | null;
  createdAt: string;
  deliveries: Array<{
    id: string;
    channel: string;
    content: string;
    status: string;
    createdAt?: string;
    acceptedAt?: string | null;
    failedAt?: string | null;
  }>;
}

export interface CommunicationTimelineEntry {
  id: string;
  clientId: string;
  clientName: string;
  channel: string;
  content: string;
  direction: "inbound" | "outbound";
  actor: "client" | "team" | "ai";
  sentAt: string;
  status: string | null;
  source: "message" | "outbound" | "chatbot";
  mediaUrl?: string | null;
}

export interface ClientConversationSummary {
  clientId: string;
  clientName: string;
  lastMessage: CommunicationTimelineEntry;
  count: number;
}

function timeValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timelineContent(channel: string, content: string): string {
  if (channel !== "email") return content;
  return content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .trim();
}

function compareChronologically(
  left: CommunicationTimelineEntry,
  right: CommunicationTimelineEntry,
): number {
  return timeValue(left.sentAt) - timeValue(right.sentAt) || left.id.localeCompare(right.id);
}

function basicTimelineEntries(
  messages: SentMessage[],
  outboundMessages: OutboundMessage[],
): CommunicationTimelineEntry[] {
  const outboundIds = new Set(outboundMessages.map((message) => message.id));
  const sentEntries: CommunicationTimelineEntry[] = messages.flatMap((message) => {
    if (!message.toClientId || (message.outboundMessageId && outboundIds.has(message.outboundMessageId))) {
      return [];
    }
    return [{
      id: `message:${message.id}`,
      clientId: message.toClientId,
      clientName: message.clientName || message.toClientId,
      channel: message.channel,
      content: timelineContent(message.channel, message.content),
      direction: "outbound",
      actor: "team",
      sentAt: message.sentAt,
      status: message.status,
      source: "message",
      mediaUrl: message.mediaUrl ?? null,
    }];
  });

  const outboundEntries: CommunicationTimelineEntry[] = outboundMessages.flatMap((message) => {
    if (message.recipientType !== "client" || !message.recipientId) return [];
    return message.deliveries.flatMap((delivery) => delivery.content.trim() ? [{
      id: `outbound:${message.id}:${delivery.id}`,
      clientId: message.recipientId!,
      clientName: message.recipientName || message.recipientId!,
      channel: delivery.channel,
      content: timelineContent(delivery.channel, delivery.content),
      direction: "outbound",
      actor: "team",
      sentAt: delivery.acceptedAt ?? delivery.failedAt ?? delivery.createdAt ?? message.createdAt,
      status: delivery.status,
      source: "outbound",
    } satisfies CommunicationTimelineEntry] : []);
  });

  return [...sentEntries, ...outboundEntries];
}

function chatbotEntry(
  conversation: AiConversationSummary,
  message: AiConversationMessage,
): CommunicationTimelineEntry | null {
  if (!conversation.clientId || conversation.channel !== "whatsapp" || message.role === "system") {
    return null;
  }
  const isInbound = message.role === "user";
  return {
    id: `chatbot:${message.id}`,
    clientId: conversation.clientId,
    clientName: conversation.clientName || conversation.clientId,
    channel: "whatsapp",
    content: message.content,
    direction: isInbound ? "inbound" : "outbound",
    actor: isInbound ? "client" : message.isBot ? "ai" : "team",
    sentAt: message.sentAt,
    status: isInbound ? "received" : message.deliveryStatus ?? null,
    source: "chatbot",
    mediaUrl: message.mediaUrl ?? null,
  };
}

function latestChatbotSummary(
  conversation: AiConversationSummary,
): CommunicationTimelineEntry | null {
  if (
    !conversation.clientId ||
    conversation.channel !== "whatsapp" ||
    !conversation.lastMessageAt ||
    !conversation.lastMessageId ||
    !conversation.lastMessageContent?.trim() ||
    conversation.lastMessageRole === "system"
  ) {
    return null;
  }
  const isInbound = conversation.lastMessageRole === "user";
  return {
    id: `chatbot:${conversation.lastMessageId}`,
    clientId: conversation.clientId,
    clientName: conversation.clientName || conversation.clientId,
    channel: "whatsapp",
    content: conversation.lastMessageContent,
    direction: isInbound ? "inbound" : "outbound",
    actor: isInbound ? "client" : conversation.lastMessageIsBot ? "ai" : "team",
    sentAt: conversation.lastMessageAt,
    status: isInbound ? "received" : conversation.lastMessageStatus ?? null,
    source: "chatbot",
  };
}

export function buildClientTimeline(input: {
  clientId: string | null;
  messages: SentMessage[];
  outboundMessages: OutboundMessage[];
  chatbotConversations: AiConversationSummary[];
  chatbotMessages: AiConversationMessage[];
}): CommunicationTimelineEntry[] {
  if (!input.clientId) return [];
  const conversationsById = new Map(
    input.chatbotConversations
      .filter((conversation) => conversation.clientId === input.clientId && conversation.channel === "whatsapp")
      .map((conversation) => [conversation.id, conversation]),
  );
  const chatbotEntries = input.chatbotMessages.flatMap((message) => {
    const conversation = conversationsById.get(message.conversationId);
    if (!conversation) return [];
    const entry = chatbotEntry(conversation, message);
    return entry ? [entry] : [];
  });
  return [
    ...basicTimelineEntries(input.messages, input.outboundMessages)
      .filter((entry) => entry.clientId === input.clientId),
    ...chatbotEntries,
  ].sort(compareChronologically);
}

export function buildClientConversationSummaries(input: {
  messages: SentMessage[];
  outboundMessages: OutboundMessage[];
  chatbotConversations: AiConversationSummary[];
}): ClientConversationSummary[] {
  const summaries = new Map<string, ClientConversationSummary>();
  const addMessage = (message: CommunicationTimelineEntry, count = 1) => {
    const existing = summaries.get(message.clientId);
    if (!existing) {
      summaries.set(message.clientId, {
        clientId: message.clientId,
        clientName: message.clientName || message.clientId,
        lastMessage: message,
        count,
      });
      return;
    }
    existing.count += count;
    if (timeValue(message.sentAt) > timeValue(existing.lastMessage.sentAt)) {
      existing.lastMessage = message;
    }
    if (message.clientName && message.clientName !== message.clientId) {
      existing.clientName = message.clientName;
    }
  };

  for (const message of basicTimelineEntries(input.messages, input.outboundMessages)) {
    addMessage(message);
  }
  for (const conversation of input.chatbotConversations) {
    const latest = latestChatbotSummary(conversation);
    if (latest) addMessage(latest, Math.max(1, conversation.messageCount ?? 1));
  }

  return [...summaries.values()].sort(
    (left, right) => timeValue(right.lastMessage.sentAt) - timeValue(left.lastMessage.sentAt),
  );
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function filterClientConversationSummaries(
  summaries: ClientConversationSummary[],
  query: string,
): ClientConversationSummary[] {
  const terms = normalizeSearchText(query).trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return summaries;

  return summaries.filter((summary) => {
    const actorLabels = {
      client: "cliente",
      team: "equipe",
      ai: "atendimento ia",
    } as const;
    const directionLabel = summary.lastMessage.direction === "inbound" ? "recebida" : "enviada";
    const searchableText = normalizeSearchText([
      summary.clientName,
      summary.clientId,
      summary.lastMessage.content,
      summary.lastMessage.channel,
      summary.lastMessage.status ?? "",
      actorLabels[summary.lastMessage.actor],
      directionLabel,
    ].join(" "));

    return terms.every((term) => searchableText.includes(term));
  });
}