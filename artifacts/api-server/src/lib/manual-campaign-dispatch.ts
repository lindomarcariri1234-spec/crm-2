import { and, asc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import {
  db,
  campaignSendsTable,
  campaignsTable,
  clientsTable,
  tenantsTable,
} from "@workspace/db";
import { AppError, NotFoundError, ValidationError } from "./errors.js";
import { generateId } from "./id.js";
import { logger } from "./logger.js";
import { safeErrorLogFields } from "./safe-error-log.js";
import { resolveSegment } from "./campaign-segment.js";
import { dispatchOutboundMessage, htmlToWhatsAppText } from "../services/outbound-delivery.js";
import type { SegmentCriteria } from "./campaign-segment.js";

const RECIPIENT_BATCH_SIZE = 25;
const DUE_CAMPAIGN_BATCH_SIZE = 50;
const STALE_CAMPAIGN_BATCH_SIZE = 25;
const STALE_CAMPAIGN_MS = 5 * 60 * 1000;

type CampaignRow = typeof campaignsTable.$inferSelect;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function personalize(value: string, name: string, escapeHtml: boolean): string {
  const replacement = escapeHtml
    ? name.replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;",
      })[char]!)
    : name;
  return value.replace(/\{nome\}|\{name\}/gi, replacement);
}

function campaignChannels(campaign: CampaignRow): ("email" | "whatsapp")[] {
  if (campaign.type === "email") return ["email"];
  if (campaign.type === "whatsapp") return ["whatsapp"];
  if (campaign.type === "unified") return ["email", "whatsapp"];
  throw new ValidationError("Selecione um canal válido para a campanha.", "INVALID_CAMPAIGN_CHANNEL");
}

function campaignContent(campaign: CampaignRow) {
  const triggerConfig = asRecord(campaign.triggerConfig);
  const channelConfig = asRecord(triggerConfig["channels"]);
  const emailConfig = asRecord(channelConfig["email"]);
  const whatsappConfig = asRecord(channelConfig["whatsapp"]);
  const channels = campaignChannels(campaign);
  const emailHtml = typeof emailConfig["html"] === "string" ? emailConfig["html"] : campaign.content;
  const whatsappText = typeof whatsappConfig["text"] === "string"
    ? whatsappConfig["text"]
    : htmlToWhatsAppText(campaign.content);
  const emailSubject = typeof emailConfig["subject"] === "string"
    ? emailConfig["subject"]
    : campaign.subject;

  if (channels.includes("email") && (!emailSubject?.trim() || !emailHtml.trim())) {
    throw new ValidationError("Informe o assunto e o conteúdo do e-mail antes de enviar.", "CAMPAIGN_EMAIL_CONTENT_REQUIRED");
  }
  if (channels.includes("whatsapp") && !whatsappText.trim()) {
    throw new ValidationError("Informe o conteúdo do WhatsApp antes de enviar.", "CAMPAIGN_WHATSAPP_CONTENT_REQUIRED");
  }

  return { channels, emailHtml, emailSubject, whatsappText };
}

async function getCampaign(tenantId: string, campaignId: string): Promise<CampaignRow> {
  const [campaign] = await db.select().from(campaignsTable)
    .where(and(
      eq(campaignsTable.id, campaignId),
      eq(campaignsTable.tenantId, tenantId),
    ))
    .limit(1);
  if (!campaign) throw new NotFoundError("Campanha não encontrada.", "CAMPAIGN_NOT_FOUND");
  return campaign;
}

async function createOrLoadCampaignSend(campaign: CampaignRow, clientId: string): Promise<string> {
  const sendId = generateId();
  const [inserted] = await db.insert(campaignSendsTable)
    .values({
      id: sendId,
      campaignId: campaign.id,
      clientId,
      tenantId: campaign.tenantId,
      status: "queued",
    })
    .onConflictDoNothing({
      target: [campaignSendsTable.campaignId, campaignSendsTable.clientId],
    })
    .returning({ id: campaignSendsTable.id });

  if (inserted) return inserted.id;

  const [existing] = await db.select({ id: campaignSendsTable.id })
    .from(campaignSendsTable)
    .where(and(
      eq(campaignSendsTable.campaignId, campaign.id),
      eq(campaignSendsTable.clientId, clientId),
      eq(campaignSendsTable.tenantId, campaign.tenantId),
    ))
    .limit(1);
  if (!existing) throw new Error("campaign_send_persist_failed");
  return existing.id;
}

async function updateCampaignSend(
  campaign: CampaignRow,
  sendId: string,
  status: "sent" | "skipped" | "error",
  error: string | null,
): Promise<void> {
  await db.update(campaignSendsTable)
    .set({ status, error })
    .where(and(
      eq(campaignSendsTable.id, sendId),
      eq(campaignSendsTable.campaignId, campaign.id),
      eq(campaignSendsTable.tenantId, campaign.tenantId),
    ));
}

async function dispatchToClient(
  campaign: CampaignRow,
  client: { id: string; name: string | null },
  tenantName: string,
  content: ReturnType<typeof campaignContent>,
): Promise<void> {
  const sendId = await createOrLoadCampaignSend(campaign, client.id);
  const { channels, emailHtml, emailSubject, whatsappText } = content;
  const name = client.name ?? "";

  try {
    const result = await dispatchOutboundMessage({
      tenantId: campaign.tenantId,
      eventType: "campaign_message",
      idempotencyKey: `campaign:${campaign.id}:${client.id}`,
      recipient: { type: "client", id: client.id },
      channels,
      ...(channels.includes("email") && emailSubject
        ? {
            email: {
              subject: personalize(emailSubject, name, false),
              html: personalize(emailHtml, name, true),
              senderName: tenantName,
            },
          }
        : {}),
      ...(channels.includes("whatsapp")
        ? { whatsapp: { text: personalize(whatsappText, name, false) } }
        : {}),
      origin: "campaign",
      originChannel: channels.length === 1 ? channels[0] : null,
      createdById: campaign.createdById,
      metadata: {
        campaignId: campaign.id,
        campaignSendId: sendId,
        clientId: client.id,
      },
    });

    const activeStatuses = new Set(["pending", "processing", "accepted", "delivered", "read", "unknown"]);
    const hasActiveDelivery = result.deliveries.some((delivery) => activeStatuses.has(delivery.status));
    const allSkipped = result.deliveries.length > 0
      && result.deliveries.every((delivery) => delivery.status === "skipped");
    const failedDelivery = result.deliveries.find((delivery) => delivery.status === "failed");

    await updateCampaignSend(
      campaign,
      sendId,
      hasActiveDelivery ? "sent" : allSkipped ? "skipped" : "error",
      failedDelivery?.lastError ?? null,
    );
  } catch (error) {
    await updateCampaignSend(campaign, sendId, "error", "campaign_dispatch_failed");
    logger.error(
      {
        error: safeErrorLogFields(error),
        campaignId: campaign.id,
        clientId: client.id,
        tenantId: campaign.tenantId,
      },
      "[campaign-dispatch] Recipient dispatch failed",
    );
  }
}

async function processClaimedCampaign(campaign: CampaignRow): Promise<CampaignRow> {
  if (campaign.triggerType !== "manual" && campaign.triggerType != null) {
    throw new AppError("Somente campanhas manuais podem ser enviadas por esta ação.", 400, "NOT_A_MANUAL_CAMPAIGN");
  }
  const content = campaignContent(campaign);
  const segment = asRecord(campaign.targetSegment);
  const { clientIds } = await resolveSegment(campaign.tenantId, segment as SegmentCriteria);
  const [tenant] = await db.select({ name: tenantsTable.name })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, campaign.tenantId))
    .limit(1);
  const tenantName = tenant?.name ?? "VisiteCRM";

  for (let offset = 0; offset < clientIds.length; offset += RECIPIENT_BATCH_SIZE) {
    const ids = clientIds.slice(offset, offset + RECIPIENT_BATCH_SIZE);
    const clients = await db.select({ id: clientsTable.id, name: clientsTable.name })
      .from(clientsTable)
      .where(and(
        eq(clientsTable.tenantId, campaign.tenantId),
        inArray(clientsTable.id, ids),
      ));
    const byId = new Map(clients.map((client) => [client.id, client]));

    for (const clientId of ids) {
      const client = byId.get(clientId);
      if (client) await dispatchToClient(campaign, client, tenantName, content);
    }

    await db.update(campaignsTable)
      .set({ updatedAt: new Date() })
      .where(and(
        eq(campaignsTable.id, campaign.id),
        eq(campaignsTable.tenantId, campaign.tenantId),
        eq(campaignsTable.status, "sending"),
      ));
  }

  // Re-read the durable send rows so a retry/recovery never increments totals twice.
  const sends = await db.select({ status: campaignSendsTable.status })
    .from(campaignSendsTable)
    .where(and(
      eq(campaignSendsTable.campaignId, campaign.id),
      eq(campaignSendsTable.tenantId, campaign.tenantId),
    ));
  const sentCount = sends.filter((send) => send.status === "sent").length;

  const [finished] = await db.update(campaignsTable)
    .set({
      status: "sent",
      sentAt: new Date(),
      recipientsCount: clientIds.length,
      sentCount,
      updatedAt: new Date(),
    })
    .where(and(
      eq(campaignsTable.id, campaign.id),
      eq(campaignsTable.tenantId, campaign.tenantId),
      eq(campaignsTable.status, "sending"),
    ))
    .returning();

  return finished ?? await getCampaign(campaign.tenantId, campaign.id);
}

async function claimAndDispatch(
  campaign: CampaignRow,
  options: { dueOnly?: boolean } = {},
): Promise<CampaignRow | null> {
  // Validate before changing status so invalid content does not leave a campaign stuck in "sending".
  campaignContent(campaign);

  const [claimed] = await db.update(campaignsTable)
    .set({ status: "sending", updatedAt: new Date() })
    .where(and(
      eq(campaignsTable.id, campaign.id),
      eq(campaignsTable.tenantId, campaign.tenantId),
      inArray(campaignsTable.status, ["draft", "scheduled"]),
      ...(options.dueOnly
        ? [isNotNull(campaignsTable.scheduledAt), lte(campaignsTable.scheduledAt, new Date())]
        : []),
    ))
    .returning();
  if (!claimed) return null;
  return processClaimedCampaign(claimed);
}

export async function sendManualCampaignNow(tenantId: string, campaignId: string): Promise<CampaignRow> {
  const campaign = await getCampaign(tenantId, campaignId);
  if (campaign.triggerType !== "manual" && campaign.triggerType != null) {
    throw new AppError("Somente campanhas manuais podem ser enviadas por esta ação.", 400, "NOT_A_MANUAL_CAMPAIGN");
  }

  if (campaign.status === "sent" || campaign.status === "sending") return campaign;
  if (campaign.status !== "draft" && campaign.status !== "scheduled") {
    throw new AppError("Esta campanha não pode ser enviada no estado atual.", 409, "CAMPAIGN_NOT_SENDABLE");
  }

  const result = await claimAndDispatch(campaign);
  return result ?? await getCampaign(tenantId, campaignId);
}

export async function runScheduledManualCampaignsCron(): Promise<void> {
  const now = new Date();
  const dueCampaigns = await db.select().from(campaignsTable)
    .where(and(
      eq(campaignsTable.triggerType, "manual"),
      inArray(campaignsTable.status, ["draft", "scheduled"]),
      isNotNull(campaignsTable.scheduledAt),
      lte(campaignsTable.scheduledAt, now),
    ))
    .orderBy(asc(campaignsTable.scheduledAt), asc(campaignsTable.id))
    .limit(DUE_CAMPAIGN_BATCH_SIZE);

  for (const campaign of dueCampaigns) {
    try {
      await claimAndDispatch(campaign, { dueOnly: true });
    } catch (error) {
      logger.error(
        {
          error: safeErrorLogFields(error),
          campaignId: campaign.id,
          tenantId: campaign.tenantId,
        },
        "[campaign-dispatch] Scheduled campaign failed",
      );
    }
  }

  // Recover a process interrupted after its campaign was atomically claimed.
  const staleBefore = new Date(Date.now() - STALE_CAMPAIGN_MS);
  const staleCampaigns = await db.select().from(campaignsTable)
    .where(and(
      eq(campaignsTable.triggerType, "manual"),
      eq(campaignsTable.status, "sending"),
      lte(campaignsTable.updatedAt, staleBefore),
    ))
    .orderBy(asc(campaignsTable.updatedAt), asc(campaignsTable.id))
    .limit(STALE_CAMPAIGN_BATCH_SIZE);

  for (const campaign of staleCampaigns) {
    try {
      const [claimed] = await db.update(campaignsTable)
        .set({ updatedAt: new Date() })
        .where(and(
          eq(campaignsTable.id, campaign.id),
          eq(campaignsTable.tenantId, campaign.tenantId),
          eq(campaignsTable.status, "sending"),
          lte(campaignsTable.updatedAt, staleBefore),
        ))
        .returning();
      if (claimed) await processClaimedCampaign(claimed);
    } catch (error) {
      logger.error(
        {
          error: safeErrorLogFields(error),
          campaignId: campaign.id,
          tenantId: campaign.tenantId,
        },
        "[campaign-dispatch] Stale campaign recovery failed",
      );
    }
  }
}
