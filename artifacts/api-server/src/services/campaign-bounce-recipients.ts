import { and, asc, desc, eq, exists, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  campaignSendsTable,
  campaignsTable,
  clientsTable,
  outboundDeliveriesTable,
  outboundMessagesTable,
} from "@workspace/db";

export const CAMPAIGN_BOUNCE_RECIPIENT_PAGE_SIZE = 50;
const campaignBounceHistoryTable = alias(campaignSendsTable, "campaign_bounce_history");

export interface CampaignPermanentBounceSuppressionRecipient {
  clientId: string;
  name: string;
  email: string | null;
}

export interface CampaignPermanentBounceSuppressionsPage {
  available: boolean;
  count: number;
  recipients: CampaignPermanentBounceSuppressionRecipient[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CampaignPermanentBounceRecipient {
  clientId: string;
  name: string;
  email: string;
  bouncedAt: string;
}

export interface CampaignPermanentBounceRecipientsPage {
  available: boolean;
  recipients: CampaignPermanentBounceRecipient[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  permanentBounceSuppressions: CampaignPermanentBounceSuppressionsPage;
}

function buildPermanentBounceSuppressionQuery(tenantId: string, campaignId?: string) {
  return db.select({
    campaignId: sql<string>`${campaignSendsTable.campaignId}`.as("campaign_id"),
    sendId: sql<string>`${campaignSendsTable.id}`.as("send_id"),
    sentAt: sql<Date>`${campaignSendsTable.sentAt}`.as("sent_at"),
    clientId: sql<string>`${clientsTable.id}`.as("client_id"),
    name: sql<string>`${clientsTable.name}`.as("client_name"),
    email: sql<string | null>`${clientsTable.email}`.as("client_email"),
  })
    .from(campaignSendsTable)
    .innerJoin(campaignsTable, and(
      eq(campaignsTable.id, campaignSendsTable.campaignId),
      eq(campaignsTable.tenantId, campaignSendsTable.tenantId),
      inArray(campaignsTable.type, ["email", "unified"]),
    ))
    .innerJoin(clientsTable, and(
      eq(clientsTable.id, campaignSendsTable.clientId),
      eq(clientsTable.tenantId, campaignSendsTable.tenantId),
    ))
    .leftJoin(outboundMessagesTable, and(
      eq(outboundMessagesTable.tenantId, campaignSendsTable.tenantId),
      eq(outboundMessagesTable.origin, "campaign"),
      eq(outboundMessagesTable.recipientType, "client"),
      sql`(${outboundMessagesTable.metadata} ->> 'campaignSendId') = ${campaignSendsTable.id}`,
    ))
    .leftJoin(outboundDeliveriesTable, and(
      eq(outboundDeliveriesTable.tenantId, campaignSendsTable.tenantId),
      eq(outboundDeliveriesTable.outboundMessageId, outboundMessagesTable.id),
      eq(outboundDeliveriesTable.channel, "email"),
      eq(outboundDeliveriesTable.status, "skipped"),
      eq(outboundDeliveriesTable.skippedReason, "permanent_email_bounce"),
    ))
    .where(and(
      eq(campaignSendsTable.tenantId, tenantId),
      ...(campaignId ? [eq(campaignSendsTable.campaignId, campaignId)] : []),
      or(
        and(
          eq(campaignSendsTable.status, "skipped"),
          eq(campaignSendsTable.error, "permanent_email_bounce"),
        ),
        isNotNull(outboundDeliveriesTable.id),
      ),
    ));
}

export async function listCampaignPermanentBounceSuppressionCounts(
  tenantId: string,
): Promise<Map<string, number>> {
  const suppressions = buildPermanentBounceSuppressionQuery(tenantId)
    .as("campaign_permanent_bounce_suppressions");
  const rows = await db.select({
    campaignId: suppressions.campaignId,
    count: sql<number>`count(distinct ${suppressions.sendId})::int`,
  })
    .from(suppressions)
    .groupBy(suppressions.campaignId);

  return new Map(rows.map((row) => [row.campaignId, row.count]));
}

export function tenantHasPermanentEmailBounceExpression(
  tenantId: string,
  clientId: typeof clientsTable.id,
) {
  return exists(db.select({ id: campaignSendsTable.id })
    .from(campaignSendsTable)
    .where(and(
      eq(campaignSendsTable.tenantId, tenantId),
      eq(campaignSendsTable.clientId, clientId),
      eq(campaignSendsTable.bounceType, "permanent"),
      isNotNull(campaignSendsTable.bouncedAt),
    )));
}

export function campaignSendHasPermanentEmailBounceExpression() {
  return exists(db.select({ id: campaignBounceHistoryTable.id })
    .from(campaignBounceHistoryTable)
    .where(and(
      eq(campaignBounceHistoryTable.tenantId, campaignSendsTable.tenantId),
      eq(campaignBounceHistoryTable.clientId, campaignSendsTable.clientId),
      eq(campaignBounceHistoryTable.bounceType, "permanent"),
      isNotNull(campaignBounceHistoryTable.bouncedAt),
    )));
}

export async function hasTenantPermanentEmailBounce(
  tenantId: string,
  clientId: string,
): Promise<boolean> {
  const [send] = await db.select({ id: campaignSendsTable.id })
    .from(campaignSendsTable)
    .where(and(
      eq(campaignSendsTable.tenantId, tenantId),
      eq(campaignSendsTable.clientId, clientId),
      eq(campaignSendsTable.bounceType, "permanent"),
      isNotNull(campaignSendsTable.bouncedAt),
    ))
    .limit(1);
  return Boolean(send);
}

export async function listCampaignPermanentBounceRecipients(
  tenantId: string,
  campaignId: string,
  page: number,
): Promise<CampaignPermanentBounceRecipientsPage | null> {
  const [campaign] = await db.select({
    type: campaignsTable.type,
    failureTrackingStartedAt: campaignsTable.failureTrackingStartedAt,
  }).from(campaignsTable)
    .where(and(
      eq(campaignsTable.id, campaignId),
      eq(campaignsTable.tenantId, tenantId),
    ))
    .limit(1);

  if (!campaign) return null;

  const pageSize = CAMPAIGN_BOUNCE_RECIPIENT_PAGE_SIZE;
  const bounceAvailable = campaign.type !== "whatsapp" && campaign.failureTrackingStartedAt !== null;
  const bounceRows = bounceAvailable
    ? await db.select({
        clientId: clientsTable.id,
        name: clientsTable.name,
        email: clientsTable.email,
        bouncedAt: campaignSendsTable.bouncedAt,
      }).from(campaignSendsTable)
        .innerJoin(clientsTable, and(
          eq(clientsTable.id, campaignSendsTable.clientId),
          eq(clientsTable.tenantId, tenantId),
        ))
        .where(and(
          eq(campaignSendsTable.campaignId, campaignId),
          eq(campaignSendsTable.tenantId, tenantId),
          eq(campaignSendsTable.bounceType, "permanent"),
          isNotNull(campaignSendsTable.bouncedAt),
        ))
        .orderBy(
          desc(campaignSendsTable.bouncedAt),
          asc(clientsTable.name),
          asc(campaignSendsTable.id),
        )
        .limit(pageSize + 1)
        .offset((page - 1) * pageSize)
    : [];

  const hasMore = bounceRows.length > pageSize;
  const recipients: CampaignPermanentBounceRecipient[] = [];
  for (const row of bounceRows.slice(0, pageSize)) {
    if (!row.bouncedAt) continue;
    recipients.push({
      clientId: row.clientId,
      name: row.name,
      email: row.email,
      bouncedAt: row.bouncedAt.toISOString(),
    });
  }

  const suppressionsAvailable = campaign.type === "email" || campaign.type === "unified";
  let permanentBounceSuppressions: CampaignPermanentBounceSuppressionsPage = {
    available: suppressionsAvailable,
    count: 0,
    recipients: [],
    page,
    pageSize,
    hasMore: false,
  };
  if (suppressionsAvailable) {
    const suppressionRows = await buildPermanentBounceSuppressionQuery(tenantId, campaignId)
      .orderBy(
        desc(campaignSendsTable.sentAt),
        asc(clientsTable.name),
        asc(campaignSendsTable.id),
      )
      .limit(pageSize + 1)
      .offset((page - 1) * pageSize);
    const suppressionRowsSubquery = buildPermanentBounceSuppressionQuery(tenantId, campaignId)
      .as("campaign_permanent_bounce_suppression_recipients");
    const [suppressionTotal] = await db.select({
      count: sql<number>`count(distinct ${suppressionRowsSubquery.sendId})::int`,
    }).from(suppressionRowsSubquery);
    permanentBounceSuppressions = {
      available: true,
      count: suppressionTotal?.count ?? 0,
      recipients: suppressionRows.slice(0, pageSize).map((row) => ({
        clientId: row.clientId,
        name: row.name,
        email: row.email,
      })),
      page,
      pageSize,
      hasMore: suppressionRows.length > pageSize,
    };
  }

  return {
    available: bounceAvailable,
    recipients,
    page,
    pageSize,
    hasMore: bounceAvailable && hasMore,
    permanentBounceSuppressions,
  };
}
