import { and, desc, eq, exists, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  auditLogsTable,
  clientsTable,
  tenantsTable,
  usersTable,
  emailLogsTable,
  outboundDeliveriesTable,
  outboundDeliveryAttemptsTable,
  outboundMessagesTable,
  type OutboundDelivery,
  type OutboundDeliveryChannel,
  type OutboundBounceType,
  type OutboundDeliveryStatus,
  type OutboundMessage,
} from "@workspace/db";
import { normalizeBrazilPhone } from "@workspace/shared";
import { sendReminderHtmlEmail } from "@workspace/email";
import { generateId } from "../lib/id";
import { logger } from "../lib/logger";
import { getOutboundDeliveryQueue } from "../queues";
import { reconcileTenantWhatsAppMessage, sendTenantWhatsAppMessage } from "../lib/whatsapp";
import { emitOutboundDeliveryUpdate } from "../lib/outbound-sse";

export type OutboundRecipient =
  | { type: "client"; id: string }
  | { type: "user"; id: string }
  | { type: "admin" }
  | { type: "direct"; name?: string | null; email?: string | null; whatsapp?: string | null };

export interface CreateOutboundMessageInput {
  tenantId: string;
  eventType: string;
  idempotencyKey: string;
  recipient: OutboundRecipient;
  email?: { subject: string; html: string; senderName?: string | null };
  whatsapp?: { text: string };
  origin?: string;
  originChannel?: OutboundDeliveryChannel | null;
  createdById?: string | null;
  metadata?: Record<string, unknown>;
  isReplication?: boolean;
  replicatedFromId?: string | null;
}

export interface OutboundMessageWithDeliveries {
  message: OutboundMessage;
  deliveries: OutboundDelivery[];
  created: boolean;
}

export interface OutboundMessageListOptions {
  status?: OutboundMessage["status"];
  channel?: OutboundDeliveryChannel;
  deliveryStatus?: OutboundDeliveryStatus;
  provider?: string;
  clientId?: string;
  origin?: string;
  eventType?: string;
  campaignId?: string;
  automationId?: string;
  bounceType?: OutboundBounceType;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  maxLimit?: number;
  providerMissing?: boolean;
}

export interface OutboundProviderFailureSummary {
  provider: string | null;
  failureCount: number;
  totalFailures: number;
  failurePercentage: number;
}

export interface OutboundReconciliationContext {
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface OutboundReconciliationResult {
  outcome: "accepted" | "not_found" | "unsupported" | "inconclusive";
  deliveryId: string;
  messageId: string;
  provider: string | null;
  externalId: string | null;
  providerStatus?: string;
  detail?: string;
  canRetry: boolean;
}

const MAX_ATTEMPTS = 3;
const STALE_CLAIM_MS = 15 * 60 * 1000;

function clean(value: string | null | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

/** Converts email markup to a readable WhatsApp message. Callers may provide
 * a carefully written channel-specific rendering, but never send HTML raw. */
export function htmlToWhatsAppText(html: string): string {
  return html
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function resolveRecipient(tenantId: string, recipient: OutboundRecipient) {
  if (recipient.type === "direct") {
    // Most legacy producers only know the e-mail address. Resolve it against
    // the tenant client directory when possible so an e-mail-triggered event
    // can still reach the client's WhatsApp and respect both opt-out flags.
    // Staff/admin addresses that are not clients intentionally keep a skipped
    // WhatsApp delivery instead of being guessed from another tenant.
    if (recipient.email) {
      const [client] = await db
        .select({
          name: clientsTable.name,
          email: clientsTable.email,
          whatsapp: clientsTable.whatsapp,
          phone: clientsTable.phone,
          emailOptIn: clientsTable.emailOptIn,
          whatsappOptIn: clientsTable.whatsappOptIn,
        })
        .from(clientsTable)
        .where(and(
          eq(clientsTable.tenantId, tenantId),
          sql`lower(${clientsTable.email}) = lower(${recipient.email})`,
        ))
        .limit(1);
      if (client) {
        return {
          name: clean(recipient.name) ?? clean(client.name),
          email: clean(recipient.email) ?? clean(client.email),
          whatsapp: clean(recipient.whatsapp) ?? clean(client.whatsapp) ?? clean(client.phone),
          emailOptIn: client.emailOptIn,
          whatsappOptIn: client.whatsappOptIn,
        };
      }
    }
    return {
      name: clean(recipient.name),
      email: clean(recipient.email),
      whatsapp: clean(recipient.whatsapp),
      emailOptIn: true,
      whatsappOptIn: true,
    };
  }

  if (recipient.type === "client") {
    const [client] = await db
      .select({
        name: clientsTable.name,
        email: clientsTable.email,
        whatsapp: clientsTable.whatsapp,
        phone: clientsTable.phone,
        emailOptIn: clientsTable.emailOptIn,
        whatsappOptIn: clientsTable.whatsappOptIn,
      })
      .from(clientsTable)
      .where(and(eq(clientsTable.id, recipient.id), eq(clientsTable.tenantId, tenantId)))
      .limit(1);
    if (!client) throw new Error("recipient_not_found");
    return {
      name: clean(client.name),
      email: clean(client.email),
      whatsapp: clean(client.whatsapp) ?? clean(client.phone),
      emailOptIn: client.emailOptIn,
      whatsappOptIn: client.whatsappOptIn,
    };
  }

  if (recipient.type === "user") {
    const [user] = await db
      .select({ name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(and(eq(usersTable.id, recipient.id), eq(usersTable.tenantId, tenantId)))
      .limit(1);
    if (!user) throw new Error("recipient_not_found");
    return { name: clean(user.name), email: clean(user.email), whatsapp: null, emailOptIn: true, whatsappOptIn: true };
  }

  const [tenant] = await db
    .select({ name: tenantsTable.name, email: tenantsTable.email, whatsapp: tenantsTable.whatsapp, phone: tenantsTable.phone })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  if (!tenant) throw new Error("tenant_not_found");
  return {
    name: clean(tenant.name),
    email: clean(tenant.email),
    whatsapp: clean(tenant.whatsapp) ?? clean(tenant.phone),
    emailOptIn: true,
    whatsappOptIn: true,
  };
}

function skippedReason(channel: OutboundDeliveryChannel, recipient: ReturnType<typeof clean>, optedIn: boolean, content: string | null) {
  if (!content) return `${channel}_content_missing`;
  if (!recipient) return `${channel}_address_missing`;
  if (!optedIn) return `${channel}_opted_out`;
  if (channel === "whatsapp" && !normalizeBrazilPhone(recipient)) return "whatsapp_invalid_phone";
  return null;
}

function deliveryValues(
  input: CreateOutboundMessageInput,
  messageId: string,
  channel: OutboundDeliveryChannel,
  recipient: string | null,
  content: string | null,
  subject: string | null,
  reason: string | null,
) {
  return {
    id: generateId(),
    tenantId: input.tenantId,
    outboundMessageId: messageId,
    channel,
    recipient: channel === "whatsapp" && recipient ? normalizeBrazilPhone(recipient) : recipient,
    subject,
    content: content ?? "",
    status: (reason ? "skipped" : "pending") as OutboundDeliveryStatus,
    skippedReason: reason,
    maxAttempts: MAX_ATTEMPTS,
    nextAttemptAt: new Date(),
  };
}

async function refreshMessageStatus(tenantId: string, messageId: string): Promise<void> {
  const deliveries = await db
    .select({ status: outboundDeliveriesTable.status })
    .from(outboundDeliveriesTable)
    .where(and(eq(outboundDeliveriesTable.tenantId, tenantId), eq(outboundDeliveriesTable.outboundMessageId, messageId)));
  if (!deliveries.length) return;
  const statuses = deliveries.map((d) => d.status);
  const nextStatus =
    statuses.some((status) => status === "unknown") ? "unknown" :
    statuses.every((status) => status === "skipped") ? "skipped" :
    statuses.every((status) => status === "accepted" || status === "skipped") ? "accepted" :
    statuses.some((status) => status === "accepted") ? "partial" :
    statuses.some((status) => status === "processing") ? "processing" :
    statuses.some((status) => status === "pending") ? "pending" : "failed";
  await db.update(outboundMessagesTable)
    .set({ status: nextStatus })
    .where(and(eq(outboundMessagesTable.id, messageId), eq(outboundMessagesTable.tenantId, tenantId)));
}

export async function createOutboundMessage(input: CreateOutboundMessageInput): Promise<OutboundMessageWithDeliveries> {
  const idempotencyKey = input.idempotencyKey.trim();
  if (!idempotencyKey) throw new Error("idempotency_key_required");
  if (input.isReplication && input.replicatedFromId === undefined) throw new Error("replication_source_required");

  const resolved = await resolveRecipient(input.tenantId, input.recipient);
  const whatsappText = clean(input.whatsapp?.text) ?? (input.email?.html ? htmlToWhatsAppText(input.email.html) : null);
  const emailHtml = clean(input.email?.html);
  const emailSubject = clean(input.email?.subject);

  const messageId = generateId();
  const result = await db.transaction(async (tx) => {
    await tx.insert(outboundMessagesTable).values({
      id: messageId,
      tenantId: input.tenantId,
      idempotencyKey,
      eventType: input.eventType,
      origin: input.origin ?? "system",
      originChannel: input.originChannel ?? null,
      recipientType: input.recipient.type,
      recipientId: input.recipient.type === "direct" || input.recipient.type === "admin" ? null : input.recipient.id,
      recipientName: resolved.name,
      emailAddress: resolved.email,
      whatsappNumber: resolved.whatsapp,
      emailSubject,
      emailHtml,
      whatsappText,
      senderName: clean(input.email?.senderName) ?? resolved.name,
      status: "pending",
      isReplication: input.isReplication ?? false,
      replicatedFromId: input.replicatedFromId ?? null,
      createdById: input.createdById ?? null,
      metadata: input.metadata ?? null,
    }).onConflictDoNothing({ target: [outboundMessagesTable.tenantId, outboundMessagesTable.idempotencyKey] });

    const [message] = await tx.select().from(outboundMessagesTable)
      .where(and(eq(outboundMessagesTable.tenantId, input.tenantId), eq(outboundMessagesTable.idempotencyKey, idempotencyKey)))
      .limit(1);
    if (!message) throw new Error("outbound_message_create_failed");

    const existing = await tx.select().from(outboundDeliveriesTable)
      .where(and(eq(outboundDeliveriesTable.tenantId, input.tenantId), eq(outboundDeliveriesTable.outboundMessageId, message.id)));
    if (!existing.length) {
      await tx.insert(outboundDeliveriesTable).values([
        deliveryValues(input, message.id, "email", resolved.email, emailHtml, emailSubject,
          skippedReason("email", resolved.email, resolved.emailOptIn, emailHtml)),
        deliveryValues(input, message.id, "whatsapp", resolved.whatsapp, whatsappText, null,
          skippedReason("whatsapp", resolved.whatsapp, resolved.whatsappOptIn, whatsappText)),
      ]);
    }
    const deliveries = await tx.select().from(outboundDeliveriesTable)
      .where(and(eq(outboundDeliveriesTable.tenantId, input.tenantId), eq(outboundDeliveriesTable.outboundMessageId, message.id)));
    return { message, deliveries, created: message.id === messageId };
  });

  await refreshMessageStatus(input.tenantId, result.message.id);
  const [message] = await db.select().from(outboundMessagesTable)
    .where(and(eq(outboundMessagesTable.id, result.message.id), eq(outboundMessagesTable.tenantId, input.tenantId))).limit(1);
  return { message: message ?? result.message, deliveries: result.deliveries, created: result.created };
}

export async function dispatchOutboundMessage(input: CreateOutboundMessageInput): Promise<OutboundMessageWithDeliveries> {
  const created = await createOutboundMessage(input);
  for (const delivery of created.deliveries) {
    if (delivery.status !== "pending") continue;
    try {
      await enqueueOutboundDelivery(delivery.id, input.tenantId);
    } catch (error) {
      // The durable row remains pending and the recovery sweep will enqueue it
      // later. Never perform an untracked direct send after an ambiguous queue
      // write, which could duplicate a provider-accepted message.
      logger.warn({ tenantId: input.tenantId, deliveryId: delivery.id, error }, "[outbound-delivery] Queue unavailable; delivery left pending");
    }
  }
  // A missing BullMQ queue is handled synchronously by enqueueOutboundDelivery.
  // Return the post-processing snapshot so callers do not report a failed
  // provider call as merely queued (or mark an outbox sent before acceptance).
  const deliveries = await db.select().from(outboundDeliveriesTable)
    .where(and(
      eq(outboundDeliveriesTable.tenantId, input.tenantId),
      eq(outboundDeliveriesTable.outboundMessageId, created.message.id),
    ));
  const [message] = await db.select().from(outboundMessagesTable)
    .where(and(
      eq(outboundMessagesTable.tenantId, input.tenantId),
      eq(outboundMessagesTable.id, created.message.id),
    ))
    .limit(1);
  return { ...created, message: message ?? created.message, deliveries };
}

export async function enqueueOutboundDelivery(deliveryId: string, tenantId: string): Promise<void> {
  const [delivery] = await db.select({ id: outboundDeliveriesTable.id, status: outboundDeliveriesTable.status })
    .from(outboundDeliveriesTable)
    .where(and(eq(outboundDeliveriesTable.id, deliveryId), eq(outboundDeliveriesTable.tenantId, tenantId))).limit(1);
  if (!delivery || delivery.status !== "pending") return;
  const queue = getOutboundDeliveryQueue();
  if (queue) {
    await queue.add("outbound-delivery", { deliveryId, tenantId }, { jobId: `outbound-delivery:${tenantId}:${deliveryId}` });
    return;
  }
  await processOutboundDelivery(deliveryId, tenantId);
}

async function claimDelivery(deliveryId: string, tenantId: string) {
  const now = new Date();
  const [delivery] = await db.update(outboundDeliveriesTable)
    .set({ status: "processing", claimedAt: now, attempts: sql`${outboundDeliveriesTable.attempts} + 1` })
    .where(and(
      eq(outboundDeliveriesTable.id, deliveryId),
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.status, "pending"),
      lte(outboundDeliveriesTable.nextAttemptAt, now),
    ))
    .returning();
  return delivery;
}

function isPermanentSkip(channel: OutboundDeliveryChannel, error: string) {
  return error === "credentials_not_configured" ||
    error === "invalid_phone" ||
    error.includes("RESEND_API_KEY") ||
    (channel === "email" && error.toLowerCase().includes("recipient"));
}

async function updateAttempt(tenantId: string, deliveryId: string, attemptNumber: number, values: {
  status: string; provider?: string | null; externalId?: string | null; error?: string | null;
}) {
  await db.update(outboundDeliveryAttemptsTable).set({
    status: values.status,
    provider: values.provider ?? null,
    externalId: values.externalId ?? null,
    error: values.error ?? null,
    completedAt: new Date(),
  }).where(and(
    eq(outboundDeliveryAttemptsTable.tenantId, tenantId),
    eq(outboundDeliveryAttemptsTable.deliveryId, deliveryId),
    eq(outboundDeliveryAttemptsTable.attemptNumber, attemptNumber),
  ));
}

async function syncLegacyEmailLog(
  tenantId: string,
  delivery: Pick<OutboundDelivery, "channel" | "outboundMessageId" | "status" | "externalId" | "lastError" | "skippedReason">,
): Promise<void> {
  if (delivery.channel !== "email") return;
  if (delivery.status !== "accepted" && delivery.status !== "failed" && delivery.status !== "skipped") return;

  await db
    .update(emailLogsTable)
    .set({
      status: delivery.status === "accepted" ? "sent" : "failed",
      messageId: delivery.externalId ?? null,
      errorMessage: delivery.status === "accepted"
        ? null
        : delivery.lastError ?? delivery.skippedReason ?? "send_failed",
    })
    .where(and(
      eq(emailLogsTable.tenantId, tenantId),
      eq(emailLogsTable.outboundMessageId, delivery.outboundMessageId),
    ));
}

export type OutboundProviderDeliveryStatus = "accepted" | "failed";

export interface OutboundDeliveryWebhookUpdate {
  tenantId: string;
  provider: string;
  externalId: string;
  status: OutboundProviderDeliveryStatus;
  providerStatus?: string | null;
  error?: string | null;
  bounceType?: OutboundBounceType;
}

export function resolveWebhookDeliveryState(
  currentStatus: string,
  update: Pick<OutboundDeliveryWebhookUpdate, "status" | "providerStatus" | "error">,
  now: Date,
) {
  const error = update.error?.trim() || null;
  if (update.status === "accepted") {
    return {
      status: "accepted" as const,
      acceptedAt: now,
      failedAt: null,
      claimedAt: null,
      lastError: null,
      nextAttemptAt: now,
    };
  }
  const remainsAccepted = currentStatus === "accepted";
  return {
    status: remainsAccepted ? "accepted" as const : "failed" as const,
    failedAt: remainsAccepted ? null : now,
    claimedAt: null,
    lastError: remainsAccepted ? null : error ?? update.providerStatus ?? "provider_failed",
  };
}

/**
 * Applies a provider callback to the existing delivery row. The tenant and
 * external ID are always part of the lookup: provider IDs must never update
 * another agency's delivery. Replays are safe because this function only
 * updates the matched row and never inserts a message or attempt.
 */
export async function updateOutboundDeliveryFromWebhook(
  update: OutboundDeliveryWebhookUpdate,
): Promise<{ updated: boolean; deliveryId?: string; messageId?: string }> {
  const externalId = update.externalId.trim();
  if (!externalId) return { updated: false };

  const [delivery] = await db
    .select({
      id: outboundDeliveriesTable.id,
      outboundMessageId: outboundDeliveriesTable.outboundMessageId,
      channel: outboundDeliveriesTable.channel,
      status: outboundDeliveriesTable.status,
      externalId: outboundDeliveriesTable.externalId,
      lastError: outboundDeliveriesTable.lastError,
      skippedReason: outboundDeliveriesTable.skippedReason,
    })
    .from(outboundDeliveriesTable)
    .where(and(
      eq(outboundDeliveriesTable.tenantId, update.tenantId),
      eq(outboundDeliveriesTable.externalId, externalId),
      eq(outboundDeliveriesTable.provider, update.provider),
    ))
    .limit(1);
  if (!delivery) return { updated: false };

  const now = new Date();
  const error = update.error?.trim() || null;
  const [updated] = await db
    .update(outboundDeliveriesTable)
    .set({
      ...resolveWebhookDeliveryState(delivery.status, update, now),
      ...(update.bounceType ? { bounceType: update.bounceType } : {}),
    })
    .where(and(
      eq(outboundDeliveriesTable.id, delivery.id),
      eq(outboundDeliveriesTable.tenantId, update.tenantId),
      eq(outboundDeliveriesTable.externalId, externalId),
      eq(outboundDeliveriesTable.provider, update.provider),
    ))
    .returning({
      id: outboundDeliveriesTable.id,
      outboundMessageId: outboundDeliveriesTable.outboundMessageId,
      channel: outboundDeliveriesTable.channel,
      status: outboundDeliveriesTable.status,
      externalId: outboundDeliveriesTable.externalId,
      lastError: outboundDeliveriesTable.lastError,
      skippedReason: outboundDeliveriesTable.skippedReason,
    });

  if (!updated) return { updated: false };

  // Keep the provider's lifecycle detail in the attempt history without
  // changing the numeric delivery.attempts retry counter.
  await db.update(outboundDeliveryAttemptsTable)
    .set({
      status: updated.status,
      error: updated.status === "failed" ? error ?? update.providerStatus ?? "provider_failed" : null,
      completedAt: now,
    })
    .where(and(
      eq(outboundDeliveryAttemptsTable.tenantId, update.tenantId),
      eq(outboundDeliveryAttemptsTable.deliveryId, delivery.id),
      eq(outboundDeliveryAttemptsTable.externalId, externalId),
    ));

  await syncLegacyEmailLog(update.tenantId, updated);
  await refreshMessageStatus(update.tenantId, delivery.outboundMessageId);
  emitOutboundDeliveryUpdate(update.tenantId, {
    deliveryId: delivery.id,
    messageId: delivery.outboundMessageId,
    status: updated.status,
    channel: delivery.channel,
    provider: update.provider,
  });
  return {
    updated: true,
    deliveryId: delivery.id,
    messageId: delivery.outboundMessageId,
  };
}

export async function processOutboundDelivery(deliveryId: string, tenantId: string): Promise<boolean> {
  const delivery = await claimDelivery(deliveryId, tenantId);
  if (!delivery) return false;
  const attemptNumber = delivery.attempts;
  await db.insert(outboundDeliveryAttemptsTable).values({
    id: generateId(),
    tenantId,
    deliveryId,
    attemptNumber,
    status: "processing",
  });

  let success = false;
  let provider: string | null = null;
  let externalId: string | null = null;
  let error: string | null = null;
  let outcomeUnknown = false;
  try {
    if (!delivery.recipient) {
      error = delivery.skippedReason ?? "recipient_missing";
    } else if (delivery.channel === "email") {
      const result = await sendReminderHtmlEmail({
        to: delivery.recipient,
        subject: delivery.subject ?? "",
        html: delivery.content,
        fromName: "VisiteCRM",
        idempotencyKey: `outbound:${tenantId}:${delivery.id}`,
      });
      success = result.success;
      externalId = result.messageId ?? null;
      provider = "resend";
      error = result.error ?? null;
    } else {
      const result = await sendTenantWhatsAppMessage(tenantId, delivery.recipient, delivery.content);
      success = result.success;
      externalId = result.externalId ?? null;
      provider = result.provider ?? "whatsapp";
      error = result.error ?? null;
      outcomeUnknown = result.outcome === "unknown";
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    outcomeUnknown = delivery.channel === "whatsapp";
  }

  if (success) {
    const [updated] = await db.update(outboundDeliveriesTable).set({
      status: "accepted", provider, externalId, lastError: null, acceptedAt: new Date(), claimedAt: null,
    }).where(and(
      eq(outboundDeliveriesTable.id, deliveryId),
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.attempts, attemptNumber),
      or(eq(outboundDeliveriesTable.status, "processing"), eq(outboundDeliveriesTable.status, "unknown")),
    )).returning();
    await updateAttempt(tenantId, deliveryId, attemptNumber, { status: "accepted", provider, externalId });
    if (updated) await syncLegacyEmailLog(tenantId, updated);
  } else if (outcomeUnknown && delivery.channel === "whatsapp") {
    const unknownReason = "delivery_result_unknown";
    const [updated] = await db.update(outboundDeliveriesTable).set({
      status: "unknown",
      lastError: unknownReason,
      claimedAt: null,
      failedAt: null,
      nextAttemptAt: new Date(),
      provider,
      externalId,
    }).where(and(
      eq(outboundDeliveriesTable.id, deliveryId),
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.attempts, attemptNumber),
      eq(outboundDeliveriesTable.status, "processing"),
    )).returning();
    await updateAttempt(tenantId, deliveryId, attemptNumber, {
      status: "unknown",
      provider,
      externalId,
      error: unknownReason,
    });
  } else if (isPermanentSkip(delivery.channel, error ?? "send_failed")) {
    const [updated] = await db.update(outboundDeliveriesTable).set({
      status: "skipped", skippedReason: error ?? "provider_unavailable", lastError: error, claimedAt: null, failedAt: new Date(),
    }).where(and(
      eq(outboundDeliveriesTable.id, deliveryId),
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.attempts, attemptNumber),
      eq(outboundDeliveriesTable.status, "processing"),
    )).returning();
    await updateAttempt(tenantId, deliveryId, attemptNumber, {
      status: updated ? "skipped" : "unknown",
      provider,
      error: updated ? error : "delivery_result_unknown",
    });
    if (updated) await syncLegacyEmailLog(tenantId, updated);
  } else {
    const exhausted = attemptNumber >= delivery.maxAttempts;
    const nextAttemptAt = new Date(Date.now() + Math.min(60 * 60 * 1000, 10_000 * 2 ** Math.max(0, attemptNumber - 1)));
    const [updated] = await db.update(outboundDeliveriesTable).set({
      status: exhausted ? "failed" : "pending",
      lastError: error ?? "send_failed",
      failedAt: exhausted ? new Date() : null,
      claimedAt: null,
      nextAttemptAt,
      provider,
    }).where(and(
      eq(outboundDeliveriesTable.id, deliveryId),
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.attempts, attemptNumber),
      eq(outboundDeliveriesTable.status, "processing"),
    )).returning();
    await updateAttempt(tenantId, deliveryId, attemptNumber, {
      status: updated ? (exhausted ? "failed" : "retrying") : "unknown",
      provider,
      error: updated ? error : "delivery_result_unknown",
    });
    if (exhausted && updated) await syncLegacyEmailLog(tenantId, updated);
  }
  await refreshMessageStatus(tenantId, delivery.outboundMessageId);
  return success;
}

export async function listOutboundMessages(tenantId: string, opts?: OutboundMessageListOptions) {
  // Delivery filters must be part of the message query, before its LIMIT.
  // Filtering the hydrated rows afterwards would make a matching failure
  // disappear whenever newer non-matching messages fill the first page.
  const hasDeliveryFilter = Boolean(opts?.channel || opts?.deliveryStatus || opts?.provider || opts?.providerMissing || opts?.bounceType);
  const deliveryMatchConditions = [
    eq(outboundDeliveriesTable.tenantId, tenantId),
    eq(outboundDeliveriesTable.outboundMessageId, outboundMessagesTable.id),
    opts?.channel ? eq(outboundDeliveriesTable.channel, opts.channel) : undefined,
    opts?.deliveryStatus ? eq(outboundDeliveriesTable.status, opts.deliveryStatus) : undefined,
    opts?.providerMissing
      ? isNull(outboundDeliveriesTable.provider)
      : opts?.provider
        ? eq(outboundDeliveriesTable.provider, opts.provider)
        : undefined,
    opts?.bounceType ? eq(outboundDeliveriesTable.bounceType, opts.bounceType) : undefined,
  ];
  const messageConditions = [
    eq(outboundMessagesTable.tenantId, tenantId),
    opts?.status ? eq(outboundMessagesTable.status, opts.status) : undefined,
    opts?.clientId ? eq(outboundMessagesTable.recipientId, opts.clientId) : undefined,
    opts?.origin ? eq(outboundMessagesTable.origin, opts.origin) : undefined,
    opts?.eventType ? eq(outboundMessagesTable.eventType, opts.eventType) : undefined,
    opts?.dateFrom ? sql`${outboundMessagesTable.createdAt} >= ${opts.dateFrom}` : undefined,
    opts?.dateTo ? sql`${outboundMessagesTable.createdAt} <= ${opts.dateTo}` : undefined,
    opts?.campaignId ? sql`${outboundMessagesTable.metadata}->>'campaignId' = ${opts.campaignId}` : undefined,
    opts?.automationId ? sql`${outboundMessagesTable.metadata}->>'automationId' = ${opts.automationId}` : undefined,
    hasDeliveryFilter
      ? exists(db.select({ id: outboundDeliveriesTable.id }).from(outboundDeliveriesTable).where(and(...deliveryMatchConditions)))
      : undefined,
  ];
  const messages = await db.select().from(outboundMessagesTable)
    .where(and(...messageConditions))
    .orderBy(desc(outboundMessagesTable.createdAt)).limit(Math.min(opts?.limit ?? 100, opts?.maxLimit ?? 500));
  const rows = await Promise.all(messages.map(async (message) => {
    const deliveryConditions = [
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.outboundMessageId, message.id),
      opts?.channel ? eq(outboundDeliveriesTable.channel, opts.channel) : undefined,
      opts?.deliveryStatus ? eq(outboundDeliveriesTable.status, opts.deliveryStatus) : undefined,
       opts?.providerMissing
         ? isNull(outboundDeliveriesTable.provider)
         : opts?.provider
           ? eq(outboundDeliveriesTable.provider, opts.provider)
           : undefined,
      opts?.bounceType ? eq(outboundDeliveriesTable.bounceType, opts.bounceType) : undefined,
    ];
    const deliveries = await db.select().from(outboundDeliveriesTable)
      .where(and(...deliveryConditions))
      .orderBy(outboundDeliveriesTable.channel);
    const deliveriesWithAttempts = await Promise.all(deliveries.map(async (delivery) => ({
      ...delivery,
      attempts: await db.select().from(outboundDeliveryAttemptsTable)
        .where(and(
          eq(outboundDeliveryAttemptsTable.tenantId, tenantId),
          eq(outboundDeliveryAttemptsTable.deliveryId, delivery.id),
        ))
        .orderBy(desc(outboundDeliveryAttemptsTable.attemptNumber)),
    })));
    return { message, deliveries: deliveriesWithAttempts };
  }));
  return opts?.channel || opts?.deliveryStatus || opts?.provider || opts?.providerMissing || opts?.bounceType
    ? rows.filter((row) => row.deliveries.length > 0)
    : rows;
}

export async function listOutboundProviderFailureSummary(
  tenantId: string,
  opts?: OutboundMessageListOptions,
): Promise<OutboundProviderFailureSummary[]> {
  const messageConditions = [
    eq(outboundMessagesTable.tenantId, tenantId),
    opts?.status ? eq(outboundMessagesTable.status, opts.status) : undefined,
    opts?.clientId ? eq(outboundMessagesTable.recipientId, opts.clientId) : undefined,
    opts?.origin ? eq(outboundMessagesTable.origin, opts.origin) : undefined,
    opts?.eventType ? eq(outboundMessagesTable.eventType, opts.eventType) : undefined,
    opts?.dateFrom ? sql`${outboundMessagesTable.createdAt} >= ${opts.dateFrom}` : undefined,
    opts?.dateTo ? sql`${outboundMessagesTable.createdAt} <= ${opts.dateTo}` : undefined,
    opts?.campaignId ? sql`${outboundMessagesTable.metadata}->>'campaignId' = ${opts.campaignId}` : undefined,
    opts?.automationId ? sql`${outboundMessagesTable.metadata}->>'automationId' = ${opts.automationId}` : undefined,
  ];
  const deliveryConditions = [
    eq(outboundDeliveriesTable.tenantId, tenantId),
    eq(outboundDeliveriesTable.status, "failed"),
    opts?.channel ? eq(outboundDeliveriesTable.channel, opts.channel) : undefined,
    opts?.deliveryStatus ? eq(outboundDeliveriesTable.status, opts.deliveryStatus) : undefined,
    opts?.providerMissing
      ? isNull(outboundDeliveriesTable.provider)
      : opts?.provider
        ? eq(outboundDeliveriesTable.provider, opts.provider)
        : undefined,
    opts?.bounceType ? eq(outboundDeliveriesTable.bounceType, opts.bounceType) : undefined,
  ];

  const rows = await db
    .select({
      provider: outboundDeliveriesTable.provider,
      failureCount: sql<number>`count(*)::int`,
    })
    .from(outboundDeliveriesTable)
    .innerJoin(
      outboundMessagesTable,
      eq(outboundDeliveriesTable.outboundMessageId, outboundMessagesTable.id),
    )
    .where(and(...messageConditions, ...deliveryConditions))
    .groupBy(outboundDeliveriesTable.provider)
    .orderBy(sql`count(*) desc`, sql`${outboundDeliveriesTable.provider} asc`);

  const totalFailures = rows.reduce((total, row) => total + Number(row.failureCount), 0);
  return rows.map((row) => {
    const failureCount = Number(row.failureCount);
    return {
      provider: row.provider,
      failureCount,
      totalFailures,
      failurePercentage: totalFailures === 0 ? 0 : Number(((failureCount / totalFailures) * 100).toFixed(2)),
    };
  });
}

export async function retryOutboundDelivery(tenantId: string, deliveryId: string): Promise<void> {
  const [existing] = await db.select({
    id: outboundDeliveriesTable.id,
    outboundMessageId: outboundDeliveriesTable.outboundMessageId,
    status: outboundDeliveriesTable.status,
    skippedReason: outboundDeliveriesTable.skippedReason,
  }).from(outboundDeliveriesTable).where(and(
    eq(outboundDeliveriesTable.id, deliveryId),
    eq(outboundDeliveriesTable.tenantId, tenantId),
  )).limit(1);
  if (!existing) throw new Error("delivery_not_found");
  if (existing.status === "skipped" && existing.skippedReason !== "provider_unavailable") {
    throw new Error("delivery_not_authorized");
  }
  const [delivery] = await db.update(outboundDeliveriesTable).set({
    status: "pending", nextAttemptAt: new Date(), lastError: null, skippedReason: null, failedAt: null, claimedAt: null,
  }).where(and(eq(outboundDeliveriesTable.id, deliveryId), eq(outboundDeliveriesTable.tenantId, tenantId), inArray(outboundDeliveriesTable.status, ["failed", "skipped"]))).returning();
  if (!delivery) throw new Error("delivery_not_retryable");
  await refreshMessageStatus(tenantId, delivery.outboundMessageId);
  await enqueueOutboundDelivery(delivery.id, tenantId);
}

type UnknownDeliveryForReconciliation = Pick<
  OutboundDelivery,
  "id" | "tenantId" | "outboundMessageId" | "channel" | "status" | "provider" | "externalId" | "recipient" | "attempts" | "lastError"
>;

async function getUnknownDeliveryForReconciliation(
  tenantId: string,
  deliveryId: string,
): Promise<UnknownDeliveryForReconciliation> {
  const [delivery] = await db.select({
    id: outboundDeliveriesTable.id,
    tenantId: outboundDeliveriesTable.tenantId,
    outboundMessageId: outboundDeliveriesTable.outboundMessageId,
    channel: outboundDeliveriesTable.channel,
    status: outboundDeliveriesTable.status,
    provider: outboundDeliveriesTable.provider,
    externalId: outboundDeliveriesTable.externalId,
    recipient: outboundDeliveriesTable.recipient,
    attempts: outboundDeliveriesTable.attempts,
    lastError: outboundDeliveriesTable.lastError,
  }).from(outboundDeliveriesTable).where(and(
    eq(outboundDeliveriesTable.id, deliveryId),
    eq(outboundDeliveriesTable.tenantId, tenantId),
  )).limit(1);
  if (!delivery) throw new Error("delivery_not_found");
  if (delivery.status !== "unknown") throw new Error("delivery_not_unknown");
  if (delivery.channel !== "whatsapp") throw new Error("delivery_reconciliation_unsupported");
  return delivery;
}

async function recordReconciliationAudit(
  tenantId: string,
  delivery: Pick<UnknownDeliveryForReconciliation, "id" | "outboundMessageId" | "status" | "attempts" | "provider" | "externalId">,
  result: Pick<OutboundReconciliationResult, "outcome" | "providerStatus" | "detail">,
  context: OutboundReconciliationContext,
  nextStatus: string,
): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      id: generateId(),
      tenantId,
      userId: context.userId,
      action: "reconcile_outbound_delivery",
      entityType: "outbound_delivery",
      entityId: delivery.id,
      before: {
        status: delivery.status,
        attempts: delivery.attempts,
        provider: delivery.provider,
        externalId: delivery.externalId,
      },
      after: {
        status: nextStatus,
        outcome: result.outcome,
        providerStatus: result.providerStatus ?? null,
        detail: result.detail ?? null,
      },
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });
  } catch (error) {
    logger.error({ tenantId, deliveryId: delivery.id, error }, "[outbound-delivery] Failed to write reconciliation audit");
    throw new Error("delivery_reconciliation_audit_failed");
  }
}

/**
 * Reconciles one ambiguous WhatsApp attempt without sending anything. A
 * provider-confirmed absence is returned as retryable, but remains `unknown`
 * until the operator explicitly confirms the second action. This two-step
 * flow prevents a stale or inconclusive provider lookup from causing a
 * duplicate message.
 */
export async function reconcileOutboundDelivery(
  tenantId: string,
  deliveryId: string,
  context: OutboundReconciliationContext,
): Promise<OutboundReconciliationResult> {
  const delivery = await getUnknownDeliveryForReconciliation(tenantId, deliveryId);
  const result = delivery.provider && delivery.externalId
    ? await reconcileTenantWhatsAppMessage(tenantId, delivery.provider, delivery.externalId, delivery.recipient)
    : {
      outcome: "inconclusive" as const,
      provider: delivery.provider === "evolution" || delivery.provider === "z-api" ? delivery.provider : "whatsapp" as const,
      externalId: delivery.externalId ?? "",
      detail: "provider_reference_missing",
    };

  if (result.outcome === "accepted") {
    const now = new Date();
    const [updated] = await db.update(outboundDeliveriesTable).set({
      status: "accepted",
      provider: result.provider,
      externalId: result.externalId,
      lastError: null,
      failedAt: null,
      claimedAt: null,
      acceptedAt: now,
      nextAttemptAt: now,
    }).where(and(
      eq(outboundDeliveriesTable.id, delivery.id),
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.status, "unknown"),
    )).returning();
    if (!updated) throw new Error("delivery_reconciliation_race");
    await updateAttempt(tenantId, delivery.id, delivery.attempts, {
      status: "accepted",
      provider: result.provider,
      externalId: result.externalId,
      error: null,
    });
    await recordReconciliationAudit(tenantId, delivery, result, context, "accepted");
    await refreshMessageStatus(tenantId, delivery.outboundMessageId);
    emitOutboundDeliveryUpdate(tenantId, {
      deliveryId: delivery.id,
      messageId: delivery.outboundMessageId,
      status: "accepted",
      channel: "whatsapp",
      provider: result.provider,
    });
    return {
      ...result,
      deliveryId: delivery.id,
      messageId: delivery.outboundMessageId,
      provider: result.provider,
      externalId: result.externalId,
      canRetry: false,
    };
  }

  const persistedError = result.outcome === "not_found"
    ? "provider_message_not_found"
    : result.detail ?? "provider_reconciliation_inconclusive";
  const [stillUnknown] = await db.update(outboundDeliveriesTable).set({
    lastError: persistedError,
    provider: result.provider,
    externalId: result.externalId || delivery.externalId,
    claimedAt: null,
    nextAttemptAt: new Date(),
  }).where(and(
    eq(outboundDeliveriesTable.id, delivery.id),
    eq(outboundDeliveriesTable.tenantId, tenantId),
    eq(outboundDeliveriesTable.status, "unknown"),
  )).returning({
    id: outboundDeliveriesTable.id,
    outboundMessageId: outboundDeliveriesTable.outboundMessageId,
  });
  if (!stillUnknown) throw new Error("delivery_reconciliation_race");
  await db.update(outboundDeliveryAttemptsTable).set({
    provider: result.provider,
    externalId: result.externalId || delivery.externalId,
    error: persistedError,
  }).where(and(
    eq(outboundDeliveryAttemptsTable.tenantId, tenantId),
    eq(outboundDeliveryAttemptsTable.deliveryId, delivery.id),
    eq(outboundDeliveryAttemptsTable.attemptNumber, delivery.attempts),
  ));
  await recordReconciliationAudit(tenantId, delivery, result, context, "unknown");
  return {
    ...result,
    deliveryId: delivery.id,
    messageId: delivery.outboundMessageId,
    provider: result.provider,
    externalId: result.externalId || delivery.externalId,
    canRetry: result.outcome === "not_found",
  };
}

/**
 * Re-checks the provider immediately before moving an unknown delivery back
 * to the queue. The conditional update is the concurrency gate: only one
 * administrator can authorize a new send for a given ambiguous attempt.
 */
export async function retryUnknownOutboundDelivery(
  tenantId: string,
  deliveryId: string,
  context: OutboundReconciliationContext,
): Promise<{ deliveryId: string; messageId: string; outcome: "queued" }> {
  const reconciliation = await reconcileOutboundDelivery(tenantId, deliveryId, context);
  if (reconciliation.outcome !== "not_found") {
    throw new Error(
      reconciliation.outcome === "accepted"
        ? "delivery_already_accepted"
        : reconciliation.outcome === "unsupported"
          ? "delivery_reconciliation_unsupported"
          : "delivery_reconciliation_inconclusive",
    );
  }

  const [delivery] = await db.update(outboundDeliveriesTable).set({
    status: "pending",
    nextAttemptAt: new Date(),
    lastError: null,
    skippedReason: null,
    failedAt: null,
    claimedAt: null,
  }).where(and(
    eq(outboundDeliveriesTable.id, deliveryId),
    eq(outboundDeliveriesTable.tenantId, tenantId),
    eq(outboundDeliveriesTable.status, "unknown"),
  )).returning({
    id: outboundDeliveriesTable.id,
    outboundMessageId: outboundDeliveriesTable.outboundMessageId,
  });
  if (!delivery) throw new Error("delivery_reconciliation_race");

  await db.insert(auditLogsTable).values({
    id: generateId(),
    tenantId,
    userId: context.userId,
    action: "retry_reconciled_outbound_delivery",
    entityType: "outbound_delivery",
    entityId: delivery.id,
    before: { status: "unknown", outcome: "not_found" },
    after: { status: "pending", nextAttempt: true },
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });
  await refreshMessageStatus(tenantId, delivery.outboundMessageId);
  await enqueueOutboundDelivery(delivery.id, tenantId);
  return { deliveryId: delivery.id, messageId: delivery.outboundMessageId, outcome: "queued" };
}

export async function recoverOutboundDeliveries(): Promise<{ recovered: number; enqueued: number }> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS);
  const unknownAt = new Date();
  const unknownReason = "delivery_result_unknown";
  const stale = await db.update(outboundDeliveriesTable).set({
    status: "unknown", claimedAt: null, nextAttemptAt: unknownAt, lastError: unknownReason,
  }).where(and(eq(outboundDeliveriesTable.status, "processing"), lte(outboundDeliveriesTable.claimedAt, staleBefore)))
    .returning({
      id: outboundDeliveriesTable.id,
      tenantId: outboundDeliveriesTable.tenantId,
      outboundMessageId: outboundDeliveriesTable.outboundMessageId,
      attempts: outboundDeliveriesTable.attempts,
    });
  for (const delivery of stale) {
    await db.update(outboundDeliveryAttemptsTable).set({
      status: "unknown",
      error: unknownReason,
      completedAt: unknownAt,
    }).where(and(
      eq(outboundDeliveryAttemptsTable.tenantId, delivery.tenantId),
      eq(outboundDeliveryAttemptsTable.deliveryId, delivery.id),
      eq(outboundDeliveryAttemptsTable.attemptNumber, delivery.attempts),
      or(
        eq(outboundDeliveryAttemptsTable.status, "processing"),
        eq(outboundDeliveryAttemptsTable.status, "unknown"),
      ),
    ));
    await refreshMessageStatus(delivery.tenantId, delivery.outboundMessageId);
  }
  let enqueued = 0;
  const pending = await db.select({ id: outboundDeliveriesTable.id, tenantId: outboundDeliveriesTable.tenantId })
    .from(outboundDeliveriesTable).where(and(eq(outboundDeliveriesTable.status, "pending"), lte(outboundDeliveriesTable.nextAttemptAt, new Date()))).limit(500);
  for (const delivery of pending) {
    await enqueueOutboundDelivery(delivery.id, delivery.tenantId);
    enqueued++;
  }
  return { recovered: stale.length, enqueued };
}