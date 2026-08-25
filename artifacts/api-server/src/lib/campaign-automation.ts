import { db, campaignsTable, campaignSendsTable, clientsTable, tenantsTable, reservationsTable, tripsTable } from "@workspace/db";
import { eq, ne, and, sql, isNotNull, inArray } from "drizzle-orm";
import { RESERVATION_STATUS, type ReservationStatus } from "@workspace/permissions";
import { logger } from "./logger";
import { generateId } from "./id";
import { sendReminderHtmlEmail, type SendEmailResult } from "@workspace/email";
import { getCampaignEmailQueue, type CampaignEmailJobData } from "../queues/index";

const TRIGGER_TYPES = [
  "birthday",
  "post_trip",
  "reactivation",
  "repurchase",
  "cart_abandonment",
] as const;

type TriggerType = (typeof TRIGGER_TYPES)[number];

interface ClientRow {
  id: string;
  name: string;
  email: string | null;
}

interface QueuedCampaignSendRow {
  sendId: string;
  campaignId: string;
  clientId: string;
  tenantId: string;
  subject: string;
  content: string;
  clientName: string;
  clientEmail: string;
  tenantName: string | null;
}

async function prepareCampaignJobSlot(
  queue: NonNullable<ReturnType<typeof getCampaignEmailQueue>>,
  jobId: string,
  expectedData: Pick<CampaignEmailJobData, "campaignId" | "clientId" | "tenantId">,
): Promise<boolean> {
  // Queue doubles used by direct enqueue callers may not expose getJob. A
  // production BullMQ Queue always does.
  if (typeof queue.getJob !== "function") return true;

  const existingJob = await queue.getJob(jobId);
  if (!existingJob) return true;

  // Never remove a job unless both its immutable logical identity and terminal
  // failed state are unambiguous. In particular, a completed job can mean the
  // email was delivered before a DB status update was lost.
  if (
    existingJob.name !== "campaign-email"
    || existingJob.data.campaignId !== expectedData.campaignId
    || existingJob.data.clientId !== expectedData.clientId
    || existingJob.data.tenantId !== expectedData.tenantId
    || typeof existingJob.getState !== "function"
    || typeof existingJob.remove !== "function"
  ) {
    return false;
  }

  if (await existingJob.getState() !== "failed") return false;

  await existingJob.remove();

  // Another cron may have replaced the failed job while this one was removing
  // it. BullMQ job IDs still provide the final uniqueness guard, but avoiding
  // add here also avoids treating that concurrent replacement as our enqueue.
  return !(await queue.getJob(jobId));
}

/**
 * Repairs the narrow DB-before-Redis crash window. Campaign job IDs are
 * durable and deterministic (the campaign_sends id), so BullMQ's job-id
 * uniqueness makes a concurrent sweep/add return the existing job rather
 * than create a second delivery.
 *
 * A send is deliberately left queued when recovery cannot enqueue it; the
 * next hourly sweep can retry it. Rows are selected through tenant-matched
 * campaign and client joins, and the worker independently verifies ownership.
 */
export async function reconcileStaleQueuedCampaignSends(): Promise<void> {
  const queue = getCampaignEmailQueue();
  // Queue doubles in callers/tests may only support production enqueueing.
  // A real BullMQ Queue always has getJob; without it we cannot safely decide
  // whether a queued send already has an active job.
  if (!queue || typeof queue.getJob !== "function") return;

  const staleSends = await db
    .select({
      sendId: campaignSendsTable.id,
      campaignId: campaignSendsTable.campaignId,
      clientId: campaignSendsTable.clientId,
      tenantId: campaignSendsTable.tenantId,
      subject: campaignsTable.subject,
      content: campaignsTable.content,
      clientName: clientsTable.name,
      clientEmail: clientsTable.email,
      tenantName: tenantsTable.name,
    })
    .from(campaignSendsTable)
    .innerJoin(
      campaignsTable,
      and(
        eq(campaignsTable.id, campaignSendsTable.campaignId),
        eq(campaignsTable.tenantId, campaignSendsTable.tenantId),
      ),
    )
    .innerJoin(
      clientsTable,
      and(
        eq(clientsTable.id, campaignSendsTable.clientId),
        eq(clientsTable.tenantId, campaignSendsTable.tenantId),
      ),
    )
    .leftJoin(tenantsTable, eq(tenantsTable.id, campaignSendsTable.tenantId))
    .where(
      and(
        eq(campaignSendsTable.status, "queued"),
        sql`${campaignSendsTable.sentAt} < NOW() - INTERVAL '5 minutes'`,
        eq(campaignsTable.type, "email"),
        isNotNull(campaignsTable.subject),
        isNotNull(clientsTable.email),
      ),
    ) as QueuedCampaignSendRow[];

  for (const send of staleSends) {
    // sendId is persisted before enqueue and is therefore available even for
    // rows created by the crash window.
    const jobId = send.sendId;
    try {
      const jobData: CampaignEmailJobData = {
        to: send.clientEmail,
        toName: send.clientName,
        subject: send.subject,
        htmlContent: send.content
          .replace(/\{nome\}/gi, send.clientName)
          .replace(/\{name\}/gi, send.clientName),
        fromName: send.tenantName ?? "VisiteCRM",
        campaignId: send.campaignId,
        clientId: send.clientId,
        tenantId: send.tenantId,
      };
      if (!(await prepareCampaignJobSlot(queue, jobId, jobData))) continue;

      await queue.add("campaign-email", jobData, { jobId });
    } catch (err) {
      logger.error(
        { err, campaignId: send.campaignId, clientId: send.clientId, tenantId: send.tenantId },
        "[campaign-automation] Failed to recover stale queued campaign send",
      );
    }
  }
}

async function resolveClientsByTrigger(
  tenantId: string,
  triggerType: TriggerType,
  config: Record<string, unknown>
): Promise<ClientRow[]> {
  switch (triggerType) {
    case "birthday": {
      const daysAhead = Number(config["daysAhead"] ?? 3);
      const target = new Date();
      target.setDate(target.getDate() + daysAhead);
      const targetMonth = target.getMonth() + 1;
      const targetDay = target.getDate();

      return db
        .select({ id: clientsTable.id, name: clientsTable.name, email: clientsTable.email })
        .from(clientsTable)
        .where(
          and(
            eq(clientsTable.tenantId, tenantId),
            isNotNull(clientsTable.birthDate),
            sql`EXTRACT(MONTH FROM ${clientsTable.birthDate}) = ${targetMonth}`,
            sql`EXTRACT(DAY FROM ${clientsTable.birthDate}) = ${targetDay}`
          )
        );
    }

    case "post_trip": {
      const daysAfter = Number(config["daysAfter"] ?? 7);
      const rows = await db
        .selectDistinct({ clientId: reservationsTable.clientId })
        .from(reservationsTable)
        .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
        .where(
          and(
            eq(reservationsTable.tenantId, tenantId),
            eq(reservationsTable.status, "confirmed"),
            isNotNull(tripsTable.returnDate),
            sql`DATE(${tripsTable.returnDate} AT TIME ZONE 'America/Sao_Paulo') = (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo') - (${daysAfter} * INTERVAL '1 day')`
          )
        );
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.clientId).filter((id): id is string => id !== null);
      return db
        .select({ id: clientsTable.id, name: clientsTable.name, email: clientsTable.email })
        .from(clientsTable)
        .where(and(eq(clientsTable.tenantId, tenantId), inArray(clientsTable.id, ids)));
    }

    case "repurchase": {
      const days = Number(config["days"] ?? 30);
      const rows = await db
        .selectDistinct({ clientId: reservationsTable.clientId })
        .from(reservationsTable)
        .innerJoin(tripsTable, eq(reservationsTable.tripId, tripsTable.id))
        .where(
          and(
            eq(reservationsTable.tenantId, tenantId),
            eq(reservationsTable.status, "confirmed"),
            isNotNull(tripsTable.returnDate),
            sql`DATE(${tripsTable.returnDate} AT TIME ZONE 'America/Sao_Paulo') = (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo') - (${days} * INTERVAL '1 day')`
          )
        );
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.clientId).filter((id): id is string => id !== null);
      return db
        .select({ id: clientsTable.id, name: clientsTable.name, email: clientsTable.email })
        .from(clientsTable)
        .where(and(eq(clientsTable.tenantId, tenantId), inArray(clientsTable.id, ids)));
    }

    case "reactivation": {
      const inactiveDays = Number(config["inactiveDays"] ?? 120);
      return db
        .select({ id: clientsTable.id, name: clientsTable.name, email: clientsTable.email })
        .from(clientsTable)
        .where(
          and(
            eq(clientsTable.tenantId, tenantId),
            sql`NOT EXISTS (
              SELECT 1 FROM reservations r2
              WHERE r2.client_id = ${clientsTable.id}
                AND r2.tenant_id = ${clientsTable.tenantId}
                AND r2.status = 'confirmed'
                AND r2.created_at > NOW() - (${inactiveDays} * INTERVAL '1 day')
            )`
          )
        );
    }

    case "cart_abandonment": {
      const hours = Number(config["hours"] ?? 24);
      const rows = await db
        .selectDistinct({ clientId: reservationsTable.clientId })
        .from(reservationsTable)
        .where(
          and(
            eq(reservationsTable.tenantId, tenantId),
            inArray(reservationsTable.status, [RESERVATION_STATUS.PENDING, "pending_payment" as ReservationStatus]),
            sql`${reservationsTable.createdAt} < NOW() - (${hours} * INTERVAL '1 hour')`,
            sql`${reservationsTable.createdAt} > NOW() - INTERVAL '30 days'`
          )
        );
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.clientId).filter((id): id is string => id !== null);
      return db
        .select({ id: clientsTable.id, name: clientsTable.name, email: clientsTable.email })
        .from(clientsTable)
        .where(and(eq(clientsTable.tenantId, tenantId), inArray(clientsTable.id, ids)));
    }

    default:
      return [];
  }
}

async function getAlreadySentClientIds(
  campaignId: string,
  sinceDate?: Date
): Promise<Set<string>> {
  const conditions = [
    eq(campaignSendsTable.campaignId, campaignId),
    ne(campaignSendsTable.status, "error"),
  ];
  if (sinceDate) {
    conditions.push(sql`${campaignSendsTable.sentAt} >= ${sinceDate.toISOString()}`);
  }
  const rows = await db
    .select({ clientId: campaignSendsTable.clientId })
    .from(campaignSendsTable)
    .where(and(...conditions));
  return new Set(rows.map((r) => r.clientId));
}

function getSinceDate(triggerType: TriggerType): Date | undefined {
  if (triggerType === "birthday") {
    const startOfYear = new Date();
    startOfYear.setMonth(0, 1);
    startOfYear.setHours(0, 0, 0, 0);
    return startOfYear;
  }
  return undefined;
}

async function processTenantCampaign(
  campaign: typeof campaignsTable.$inferSelect,
  tenantName: string
) {
  const triggerType = campaign.triggerType as TriggerType;
  if (!TRIGGER_TYPES.includes(triggerType)) return;

  const config = (campaign.triggerConfig as Record<string, unknown>) ?? {};

  const clients = await resolveClientsByTrigger(campaign.tenantId, triggerType, config);
  if (clients.length === 0) return;

  const sinceDate = getSinceDate(triggerType);
  const alreadySent = await getAlreadySentClientIds(campaign.id, sinceDate);
  const eligible = clients.filter((c) => !alreadySent.has(c.id) && c.email);

  if (eligible.length === 0) return;

  const queue = getCampaignEmailQueue();
  let successCount = 0;
  let errorCount = 0;

  for (const client of eligible) {
    if (!client.email) continue;
    if (campaign.type !== "email" || !campaign.subject) continue;

    const sendId = generateId();
    const personalised = campaign.content
      .replace(/\{nome\}/gi, client.name)
      .replace(/\{name\}/gi, client.name);

    if (queue) {
      let durableSendId: string;
      try {
        const [persistedSend] = await db
          .insert(campaignSendsTable)
          .values({
            id: sendId,
            campaignId: campaign.id,
            clientId: client.id,
            tenantId: campaign.tenantId,
            status: "queued",
          })
          .onConflictDoUpdate({
            target: [campaignSendsTable.campaignId, campaignSendsTable.clientId],
            // The campaign_sends ID is also BullMQ's durable job ID. Never
            // replace it when retrying an errored logical send.
            set: { status: "queued", sentAt: new Date(), error: null },
            setWhere: eq(campaignSendsTable.status, "error"),
          })
          .returning({ id: campaignSendsTable.id });

        // A concurrent run may have won the unique campaign/client conflict
        // with a non-error row, in which case setWhere makes RETURNING empty.
        if (!persistedSend) continue;
        durableSendId = persistedSend.id;
      } catch (err) {
        errorCount++;
        logger.error(
          { err, campaignId: campaign.id, clientId: client.id },
          "[campaign-automation] Failed to persist campaign send before enqueue",
        );
        continue;
      }

      try {
        const jobData: CampaignEmailJobData = {
          to: client.email,
          toName: client.name,
          subject: campaign.subject,
          htmlContent: personalised,
          fromName: tenantName,
          campaignId: campaign.id,
          clientId: client.id,
          tenantId: campaign.tenantId,
        };
        // This check is essential on retries: queue.add may have durably
        // created the job and then thrown while returning its response. A
        // retained terminal failed job is the sole safe replacement case.
        if (!(await prepareCampaignJobSlot(queue, durableSendId, jobData))) continue;

        await queue.add("campaign-email", jobData, { jobId: durableSendId });
        successCount++;
      } catch (err) {
        errorCount++;
        // queue.add can commit in Redis and still throw while returning its
        // response. Keep the row queued and its ID immutable; stale recovery
        // will inspect this exact job ID and add only when it is absent.
        logger.error({ err, campaignId: campaign.id, clientId: client.id }, "[campaign-automation] Failed to enqueue");
      }
    } else {
      let sendResult: SendEmailResult;
      try {
        sendResult = await sendReminderHtmlEmail({
          to: client.email,
          subject: campaign.subject,
          html: personalised,
          fromName: tenantName,
        });
      } catch (err) {
        sendResult = { success: false, error: String(err) };
      }
      if (sendResult.success) {
        try {
          await db
            .insert(campaignSendsTable)
            .values({
              id: sendId,
              campaignId: campaign.id,
              clientId: client.id,
              tenantId: campaign.tenantId,
              status: "sent",
            })
            .onConflictDoUpdate({
              target: [campaignSendsTable.campaignId, campaignSendsTable.clientId],
              set: { status: "sent", sentAt: new Date(), error: null },
              setWhere: eq(campaignSendsTable.status, "error"),
            });
        } catch (dbErr) {
          logger.warn({ err: dbErr, campaignId: campaign.id, clientId: client.id }, "[campaign-automation] Failed to record sent status in DB (message was already delivered)");
        }
        successCount++;
      } else {
        errorCount++;
        logger.error({ err: sendResult.error, campaignId: campaign.id, clientId: client.id }, "[campaign-automation] Direct send failed");
        try {
          await db
            .insert(campaignSendsTable)
            .values({
              id: sendId,
              campaignId: campaign.id,
              clientId: client.id,
              tenantId: campaign.tenantId,
              status: "error",
              error: sendResult.error ?? "Send failed",
            })
            .onConflictDoUpdate({
              target: [campaignSendsTable.campaignId, campaignSendsTable.clientId],
              set: { status: "error", error: sendResult.error ?? "Send failed" },
            });
        } catch (dbErr) {
          logger.warn({ err: dbErr, campaignId: campaign.id, clientId: client.id }, "[campaign-automation] Failed to record error status in DB");
        }
      }
    }
  }

  if (successCount > 0) {
    await db
      .update(campaignsTable)
      .set({
        sentCount: campaign.sentCount + successCount,
        recipientsCount: campaign.recipientsCount + successCount + errorCount,
      })
      .where(eq(campaignsTable.id, campaign.id));
  }

  logger.info(
    { campaignId: campaign.id, trigger: triggerType, successCount, errorCount },
    "[campaign-automation] Processed campaign"
  );
}

export async function runCampaignAutomationCron() {
  const nowSP = new Date().toLocaleString("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "numeric",
    hour12: false,
  });
  const currentHour = Number(nowSP);

  logger.info({ currentHour }, "[campaign-automation] Hourly automation check");

  try {
    await reconcileStaleQueuedCampaignSends();
  } catch (err) {
    logger.error({ err }, "[campaign-automation] Failed stale queued campaign send reconciliation");
  }

  const autoCampaigns = await db
    .select()
    .from(campaignsTable)
    .where(eq(campaignsTable.autoEnabled, true));

  if (autoCampaigns.length === 0) return;

  const tenants = await db.select().from(tenantsTable);
  const tenantMap = new Map(tenants.map((t) => [t.id, t]));

  for (const campaign of autoCampaigns) {
    try {
      const config = (campaign.triggerConfig as Record<string, unknown>) ?? {};
      const sendHour = Number(config["sendHour"] ?? 8);
      if (currentHour !== sendHour) continue;

      const tenant = tenantMap.get(campaign.tenantId);
      const fromName = tenant?.name ?? "VisiteCRM";
      await processTenantCampaign(campaign, fromName);
    } catch (err) {
      logger.error({ err, campaignId: campaign.id }, "[campaign-automation] Campaign failed");
    }
  }

  logger.info("[campaign-automation] Hourly automation check complete");
}
