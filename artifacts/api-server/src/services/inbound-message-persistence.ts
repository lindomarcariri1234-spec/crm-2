import { chatbotMessagesTable, db } from "@workspace/db";
import { generateId } from "../lib/id.js";
import type { NormalizedInboundEvent, NormalizedInboundMedia } from "./messaging-provider-adapters.js";

type InboundMessageExecutor = Pick<typeof db, "insert">;

export async function persistNormalizedInboundMessage(
  executor: InboundMessageExecutor,
  event: NormalizedInboundEvent,
  input: {
    tenantId: string;
    conversationId: string;
    sourceMessageId: string | null;
    media?: NormalizedInboundMedia | null;
  },
): Promise<{ id: string } | undefined> {
  const media = input.media === undefined ? event.media : input.media;
  const [inserted] = await executor.insert(chatbotMessagesTable).values({
    id: generateId(),
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    sourceMessageId: input.sourceMessageId,
    role: "user",
    content: event.content,
    mediaUrl: media?.url ?? null,
    mediaMimeType: media?.mimeType ?? null,
    mediaFileName: media?.fileName ?? null,
    ...(event.occurredAt ? { sentAt: event.occurredAt } : {}),
    isBot: false,
  }).onConflictDoNothing().returning({ id: chatbotMessagesTable.id });
  return inserted;
}
