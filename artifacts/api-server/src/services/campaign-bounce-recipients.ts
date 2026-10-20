import { and, asc, desc, eq, exists, isNotNull } from "drizzle-orm";
import { db, campaignSendsTable, campaignsTable, clientsTable } from "@workspace/db";

export const CAMPAIGN_BOUNCE_RECIPIENT_PAGE_SIZE = 50;

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
  if (campaign.type === "whatsapp" || campaign.failureTrackingStartedAt === null) {
    return { available: false, recipients: [], page, pageSize, hasMore: false };
  }

  const rows = await db.select({
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
    .offset((page - 1) * pageSize);

  const hasMore = rows.length > pageSize;
  const recipients: CampaignPermanentBounceRecipient[] = [];
  for (const row of rows.slice(0, pageSize)) {
    if (!row.bouncedAt) continue;
    recipients.push({
      clientId: row.clientId,
      name: row.name,
      email: row.email,
      bouncedAt: row.bouncedAt.toISOString(),
    });
  }

  return { available: true, recipients, page, pageSize, hasMore };
}
