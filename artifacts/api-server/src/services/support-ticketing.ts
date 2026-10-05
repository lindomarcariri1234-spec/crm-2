import {
  db,
  chatbotConversationsTable,
  chatbotMessagesTable,
  clientsTable,
  supportQueuesTable,
  supportTicketEventsTable,
  supportTicketsTable,
  type SupportTicket,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { generateId } from "../lib/id.js";

type SupportTicketExecutor = Pick<typeof db, "execute" | "select" | "insert" | "update">;

const REOPEN_GRACE_PERIOD_MS = 2 * 60 * 60 * 1000;

export function isWithinTicketReopenWindow(resolvedAt: Date | null, receivedAt: Date): boolean {
  if (!resolvedAt) return false;
  const elapsedMs = receivedAt.getTime() - resolvedAt.getTime();
  return elapsedMs >= 0 && elapsedMs <= REOPEN_GRACE_PERIOD_MS;
}

async function ensureDefaultQueue(executor: SupportTicketExecutor, tenantId: string) {
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${`support-default-queue:${tenantId}`}, 0))
  `);
  const [existing] = await executor.select().from(supportQueuesTable)
    .where(and(
      eq(supportQueuesTable.tenantId, tenantId),
      eq(supportQueuesTable.isDefault, true),
    ))
    .limit(1);
  if (existing) return existing;

  await executor.insert(supportQueuesTable).values({
    id: generateId(),
    tenantId,
    name: "Geral",
    slug: "__default__",
    isDefault: true,
    isActive: true,
  }).onConflictDoNothing();

  const [created] = await executor.select().from(supportQueuesTable)
    .where(and(
      eq(supportQueuesTable.tenantId, tenantId),
      eq(supportQueuesTable.isDefault, true),
    ))
    .limit(1);
  if (!created) throw new Error("Could not create the default support queue");
  return created;
}

async function recordTicketEvent(
  executor: SupportTicketExecutor,
  input: {
    tenantId: string;
    ticketId: string;
    actorUserId?: string | null;
    eventType: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await executor.insert(supportTicketEventsTable).values({
    id: generateId(),
    tenantId: input.tenantId,
    ticketId: input.ticketId,
    actorUserId: input.actorUserId ?? null,
    eventType: input.eventType,
    details: input.details ?? {},
  });
}

/**
 * Creates or reuses the human-support ticket for a WhatsApp conversation.
 * Call only from an existing transaction: inbound message persistence and its
 * ticket association must commit together.
 */
export async function ensureSupportTicketForConversation(
  executor: SupportTicketExecutor,
  input: {
    tenantId: string;
    conversationId: string;
    actorUserId?: string | null;
    inboundMessageId?: string | null;
    occurredAt?: Date;
    subject?: string | null;
  },
): Promise<SupportTicket | null> {
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`support-ticket:${input.tenantId}:${input.conversationId}`}, 0)
    )
  `);

  const [conversation] = await executor.select({
    id: chatbotConversationsTable.id,
    clientId: chatbotConversationsTable.clientId,
    channel: chatbotConversationsTable.channel,
    status: chatbotConversationsTable.status,
    whatsappIntegrationId: chatbotConversationsTable.whatsappIntegrationId,
    whatsappOptIn: clientsTable.whatsappOptIn,
  }).from(chatbotConversationsTable)
    .leftJoin(clientsTable, and(
      eq(clientsTable.id, chatbotConversationsTable.clientId),
      eq(clientsTable.tenantId, input.tenantId),
    ))
    .where(and(
      eq(chatbotConversationsTable.id, input.conversationId),
      eq(chatbotConversationsTable.tenantId, input.tenantId),
    ))
    .limit(1);

  if (
    !conversation
    || conversation.channel !== "whatsapp"
    || conversation.status === "opted_out"
    || conversation.whatsappOptIn === false
  ) {
    return null;
  }

  const [lastMessage] = await executor.select({
    id: chatbotMessagesTable.id,
    role: chatbotMessagesTable.role,
    content: chatbotMessagesTable.content,
    sentAt: chatbotMessagesTable.sentAt,
  }).from(chatbotMessagesTable)
    .where(and(
      eq(chatbotMessagesTable.tenantId, input.tenantId),
      eq(chatbotMessagesTable.conversationId, input.conversationId),
    ))
    .orderBy(desc(chatbotMessagesTable.sentAt), desc(chatbotMessagesTable.id))
    .limit(1);

  const occurredAt = input.occurredAt ?? lastMessage?.sentAt ?? new Date();
  const subject = input.subject
    ?? (lastMessage?.role === "user" ? lastMessage.content.slice(0, 160) : null);

  const [active] = await executor.select().from(supportTicketsTable)
    .where(and(
      eq(supportTicketsTable.tenantId, input.tenantId),
      eq(supportTicketsTable.conversationId, input.conversationId),
      sql`${supportTicketsTable.status} <> 'resolved'`,
    ))
    .for("update")
    .limit(1);

  let ticket: SupportTicket;
  if (active) {
    const [updated] = await executor.update(supportTicketsTable)
      .set({
        clientId: conversation.clientId,
        whatsappIntegrationId: conversation.whatsappIntegrationId,
        lastMessageAt: occurredAt,
        subject: active.subject ?? subject,
        updatedAt: new Date(),
      })
      .where(and(
        eq(supportTicketsTable.id, active.id),
        eq(supportTicketsTable.tenantId, input.tenantId),
      ))
      .returning();
    if (!updated) throw new Error("Could not refresh active support ticket");
    ticket = updated;
  } else {
    const [resolved] = await executor.select().from(supportTicketsTable)
      .where(and(
        eq(supportTicketsTable.tenantId, input.tenantId),
        eq(supportTicketsTable.conversationId, input.conversationId),
        eq(supportTicketsTable.status, "resolved"),
      ))
      .orderBy(desc(supportTicketsTable.resolvedAt), desc(supportTicketsTable.updatedAt))
      .for("update")
      .limit(1);

    if (resolved && isWithinTicketReopenWindow(resolved.resolvedAt, occurredAt)) {
      const [reopened] = await executor.update(supportTicketsTable)
        .set({
          clientId: conversation.clientId,
          whatsappIntegrationId: conversation.whatsappIntegrationId,
          status: "pending",
          assignedUserId: null,
          resolvedAt: null,
          lastMessageAt: occurredAt,
          subject: resolved.subject ?? subject,
          updatedAt: new Date(),
        })
        .where(and(
          eq(supportTicketsTable.id, resolved.id),
          eq(supportTicketsTable.tenantId, input.tenantId),
          eq(supportTicketsTable.status, "resolved"),
        ))
        .returning();
      if (!reopened) throw new Error("Could not reopen support ticket");
      ticket = reopened;
      await recordTicketEvent(executor, {
        tenantId: input.tenantId,
        ticketId: ticket.id,
        actorUserId: input.actorUserId,
        eventType: "ticket_reopened",
        details: { reason: "customer_message_within_grace_period" },
      });
    } else {
      const queue = await ensureDefaultQueue(executor, input.tenantId);
      const [created] = await executor.insert(supportTicketsTable).values({
        id: generateId(),
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        clientId: conversation.clientId,
        whatsappIntegrationId: conversation.whatsappIntegrationId,
        queueId: queue.id,
        createdByUserId: input.actorUserId ?? null,
        status: "pending",
        priority: "normal",
        subject,
        lastMessageAt: occurredAt,
      }).returning();
      if (!created) throw new Error("Could not create support ticket");
      ticket = created;
      await recordTicketEvent(executor, {
        tenantId: input.tenantId,
        ticketId: ticket.id,
        actorUserId: input.actorUserId,
        eventType: "ticket_created",
        details: { reason: input.actorUserId ? "staff_handoff" : "whatsapp_handoff" },
      });
    }
  }

  if (input.inboundMessageId) {
    await executor.update(chatbotMessagesTable)
      .set({ ticketId: ticket.id })
      .where(and(
        eq(chatbotMessagesTable.id, input.inboundMessageId),
        eq(chatbotMessagesTable.tenantId, input.tenantId),
        eq(chatbotMessagesTable.conversationId, input.conversationId),
      ));
  }
  return ticket;
}

export async function recordSupportTicketEvent(
  executor: SupportTicketExecutor,
  input: Parameters<typeof recordTicketEvent>[1],
): Promise<void> {
  await recordTicketEvent(executor, input);
}
