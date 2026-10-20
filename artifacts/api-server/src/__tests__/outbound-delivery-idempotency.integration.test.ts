import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { mockWhatsAppSend, mockReconcileWhatsAppMessage } = vi.hoisted(() => ({
  mockWhatsAppSend: vi.fn(async () => ({
    provider: "integration-test",
    externalId: "provider-accepted-once",
    success: true,
    error: null as string | null,
    outcomeUnknown: false,
  })),
  mockReconcileWhatsAppMessage: vi.fn<() => Promise<{
    outcome: "accepted" | "inconclusive";
    provider: "evolution";
    externalId: string;
    providerStatus?: string;
    detail: string;
  }>>(async () => ({
    outcome: "accepted" as const,
    provider: "evolution" as const,
    externalId: "provider-accepted-after-timeout",
    providerStatus: "SERVER_ACK",
    detail: "provider_message_found",
  })),
}));

vi.mock("../services/messaging-provider-adapters.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/messaging-provider-adapters.js")>();
  return {
    ...actual,
    whatsappProviderAdapter: {
      ...actual.whatsappProviderAdapter,
      send: mockWhatsAppSend,
    },
  };
});

vi.mock("../lib/whatsapp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/whatsapp")>();
  return {
    ...actual,
    reconcileTenantWhatsAppMessage: mockReconcileWhatsAppMessage,
  };
});

import {
  db,
  campaignSendsTable,
  campaignsTable,
  clientsTable,
  outboundDeliveriesTable,
  outboundDeliveryAttemptsTable,
  outboundMessagesTable,
  pool,
  tenantsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  createOutboundMessage,
  processOutboundDelivery,
  reconcileOutboundDelivery,
  recoverOutboundDeliveries,
  updateOutboundDeliveryFromWebhook,
} from "../services/outbound-delivery.js";
import { listCampaignPermanentBounceRecipients } from "../services/campaign-bounce-recipients.js";

const runId = randomUUID().replaceAll("-", "");
const tenantId = `outbound-idem-${runId}`;
const tenantSlug = `outbound-idem-${runId}`;
const secondTenantId = `outbound-idem-other-${runId}`;
const secondTenantSlug = `outbound-idem-other-${runId}`;
const callbackTenantId = `campaign-callback-${runId}`;
const callbackTenantSlug = `campaign-callback-${runId}`;
const callbackOtherTenantId = `campaign-callback-other-${runId}`;
const callbackOtherTenantSlug = `campaign-callback-other-${runId}`;
const phone = "5511999912345";
const campaignId = randomUUID();
const newCampaignId = randomUUID();
const testDatabase = "visitecrm_test";
const ciTestDatabase = "visitecrm_ci";
let isolatedDatabaseVerified = false;

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1"].includes(
    hostname.replace(/^\[|\]$/g, "").toLowerCase(),
  );
}

async function assertIsolatedDatabase(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must point to an isolated outbound delivery test database");
  }

  let configuredUrl: URL;
  try {
    configuredUrl = new URL(databaseUrl);
  } catch {
    throw new Error("Refusing to run outbound delivery integration test with an invalid database URL");
  }

  const databaseName = decodeURIComponent(configuredUrl.pathname.replace(/^\/+/, ""));
  const host = configuredUrl.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const local = databaseName === testDatabase && isLoopback(host);
  const ci = process.env["CI"] === "true" && databaseName === ciTestDatabase && isLoopback(host);
  if (!local && !ci) {
    throw new Error("Refusing to run outbound delivery integration test outside an isolated database");
  }

  const { rows } = await pool.query<{
    database_name: string;
    server_address: string | null;
  }>(`
    SELECT current_database() AS database_name,
           host(inet_server_addr()) AS server_address
  `);
  const connected = rows[0];
  const localMatches = local
    && connected?.database_name === testDatabase
    && isLoopback(connected.server_address ?? "");
  const ciMatches = ci && connected?.database_name === ciTestDatabase;
  if (!localMatches && !ciMatches) {
    throw new Error("Refusing to run outbound delivery integration test outside an isolated database");
  }
}

async function waitForBlockedSessions(blockingPid: number, expectedCount: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ blocked_count: number }>(`
      WITH RECURSIVE waiters AS (
        SELECT activity.pid, pg_blocking_pids(activity.pid) AS blockers
        FROM pg_stat_activity activity
        WHERE activity.datname = current_database()
          AND activity.pid <> pg_backend_pid()
          AND activity.wait_event_type = 'Lock'
      ),
      reaches_fixture_blocker(pid, chain) AS (
        SELECT waiter.pid, ARRAY[waiter.pid]::integer[]
        FROM waiters waiter
        WHERE $1 = ANY(waiter.blockers)
        UNION ALL
        SELECT waiter.pid, parent.chain || waiter.pid
        FROM waiters waiter
        JOIN reaches_fixture_blocker parent
          ON parent.pid = ANY(waiter.blockers)
        WHERE NOT waiter.pid = ANY(parent.chain)
      )
      SELECT COUNT(DISTINCT pid)::integer AS blocked_count
      FROM reaches_fixture_blocker
    `, [blockingPid]);
    if ((rows[0]?.blocked_count ?? 0) >= expectedCount) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const { rows } = await pool.query(`
    SELECT pid, state, wait_event_type, wait_event,
           pg_blocking_pids(pid) AS blockers, left(query, 240) AS query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND state <> 'idle'
  `);
  throw new Error(
    `Timed out waiting for ${expectedCount} campaign callbacks behind lock ${blockingPid}: ${JSON.stringify(rows)}`,
  );
}

beforeAll(async () => {
  await assertIsolatedDatabase();
  isolatedDatabaseVerified = true;
  await db.insert(tenantsTable).values({
    id: tenantId,
    name: "Outbound delivery idempotency test",
    slug: tenantSlug,
    email: `${tenantSlug}@example.test`,
  });
  await db.insert(tenantsTable).values({
    id: secondTenantId,
    name: "Outbound delivery idempotency test (second tenant)",
    slug: secondTenantSlug,
    email: `${secondTenantSlug}@example.test`,
  });
  await db.insert(tenantsTable).values({
    id: callbackTenantId,
    name: "Campaign callback concurrency test",
    slug: callbackTenantSlug,
    email: `${callbackTenantSlug}@example.test`,
  });
  await db.insert(tenantsTable).values({
    id: callbackOtherTenantId,
    name: "Campaign callback concurrency test (second tenant)",
    slug: callbackOtherTenantSlug,
    email: `${callbackOtherTenantSlug}@example.test`,
  });
});

afterAll(async () => {
  if (!isolatedDatabaseVerified) return;
  await db.delete(outboundMessagesTable).where(eq(outboundMessagesTable.tenantId, tenantId));
  await db.delete(outboundMessagesTable).where(eq(outboundMessagesTable.tenantId, secondTenantId));
  await db.delete(outboundMessagesTable).where(eq(outboundMessagesTable.tenantId, callbackTenantId));
  await db.delete(outboundMessagesTable).where(eq(outboundMessagesTable.tenantId, callbackOtherTenantId));
  await db.delete(campaignSendsTable).where(eq(campaignSendsTable.tenantId, tenantId));
  await db.delete(campaignSendsTable).where(eq(campaignSendsTable.tenantId, secondTenantId));
  await db.delete(campaignSendsTable).where(eq(campaignSendsTable.tenantId, callbackTenantId));
  await db.delete(campaignSendsTable).where(eq(campaignSendsTable.tenantId, callbackOtherTenantId));
  await db.delete(campaignsTable).where(eq(campaignsTable.tenantId, tenantId));
  await db.delete(campaignsTable).where(eq(campaignsTable.tenantId, secondTenantId));
  await db.delete(campaignsTable).where(eq(campaignsTable.tenantId, callbackTenantId));
  await db.delete(campaignsTable).where(eq(campaignsTable.tenantId, callbackOtherTenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, secondTenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, callbackTenantId));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, callbackOtherTenantId));
  await pool.end();
});

describe("outbound delivery database idempotency", () => {
  it("backfills matching tracked sends and keeps bounce totals stable when the migration is retried", async () => {
    const client = await pool.connect();
    const schemaName = `bounce_backfill_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET search_path TO "${schemaName}"`);
      await client.query(`
        CREATE TABLE campaigns (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          failure_tracking_started_at timestamptz
        );
        CREATE TABLE campaign_sends (
          id text PRIMARY KEY,
          campaign_id text NOT NULL,
          tenant_id text NOT NULL,
          bounced_at timestamptz
        );
        CREATE TABLE outbound_messages (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          metadata jsonb NOT NULL,
          origin text NOT NULL
        );
        CREATE TABLE outbound_deliveries (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          outbound_message_id text NOT NULL,
          provider text NOT NULL,
          channel text NOT NULL,
          bounce_type text
        );
      `);

      const trackingStartedAt = new Date("2026-10-20T00:00:00.000Z");
      await client.query(`
        INSERT INTO campaigns (id, tenant_id, failure_tracking_started_at)
        VALUES
          ('campaign-a', 'tenant-a', $1),
          ('campaign-b', 'tenant-b', $1),
          ('campaign-legacy', 'tenant-a', NULL)
      `, [trackingStartedAt]);
      await client.query(`
        INSERT INTO campaign_sends (id, campaign_id, tenant_id, bounced_at)
        VALUES
          ('send-a-permanent', 'campaign-a', 'tenant-a', $1),
          ('send-a-temporary', 'campaign-a', 'tenant-a', $1),
          ('send-a-ambiguous', 'campaign-a', 'tenant-a', $1),
          ('send-a-missing-campaign-id', 'campaign-a', 'tenant-a', $1),
          ('send-a-non-campaign-origin', 'campaign-a', 'tenant-a', $1),
          ('send-a-non-resend-provider', 'campaign-a', 'tenant-a', $1),
          ('send-a-non-email-channel', 'campaign-a', 'tenant-a', $1),
          ('send-a-no-bounced-at', 'campaign-a', 'tenant-a', NULL),
          ('send-b-permanent', 'campaign-b', 'tenant-b', $1),
          ('send-b-temporary', 'campaign-b', 'tenant-b', $1),
          ('send-legacy', 'campaign-legacy', 'tenant-a', $1)
      `, [trackingStartedAt]);

      const deliveryFixtures: Array<{
        tenantId: string;
        campaignId?: string;
        sendId?: string;
        origin?: string;
        provider?: string;
        channel?: string;
        bounceType: string;
      }> = [
        { tenantId: "tenant-a", campaignId: "campaign-a", sendId: "send-a-permanent", bounceType: "permanent" },
        { tenantId: "tenant-a", campaignId: "campaign-a", sendId: "send-a-permanent", bounceType: "permanent" },
        { tenantId: "tenant-a", campaignId: "campaign-a", sendId: "send-a-temporary", bounceType: "temporary" },
        { tenantId: "tenant-a", campaignId: "campaign-a", sendId: "send-a-ambiguous", bounceType: "permanent" },
        { tenantId: "tenant-a", campaignId: "campaign-a", sendId: "send-a-ambiguous", bounceType: "temporary" },
        { tenantId: "tenant-b", campaignId: "campaign-b", sendId: "send-b-permanent", bounceType: "permanent" },
        { tenantId: "tenant-b", campaignId: "campaign-b", sendId: "send-b-temporary", bounceType: "temporary" },
        { tenantId: "tenant-a", campaignId: "campaign-legacy", sendId: "send-legacy", bounceType: "permanent" },
        { tenantId: "tenant-a", campaignId: "campaign-b", sendId: "send-b-permanent", bounceType: "permanent" },
        { tenantId: "tenant-b", campaignId: "campaign-a", sendId: "send-b-permanent", bounceType: "temporary" },
        { tenantId: "tenant-a", sendId: "send-a-missing-campaign-id", bounceType: "permanent" },
        { tenantId: "tenant-a", campaignId: "campaign-a", bounceType: "permanent" },
        {
          tenantId: "tenant-a",
          campaignId: "campaign-a",
          sendId: "send-a-non-campaign-origin",
          origin: "manual",
          bounceType: "permanent",
        },
        {
          tenantId: "tenant-a",
          campaignId: "campaign-a",
          sendId: "send-a-non-resend-provider",
          provider: "other-provider",
          bounceType: "permanent",
        },
        {
          tenantId: "tenant-a",
          campaignId: "campaign-a",
          sendId: "send-a-non-email-channel",
          channel: "whatsapp",
          bounceType: "permanent",
        },
        {
          tenantId: "tenant-a",
          campaignId: "campaign-a",
          sendId: "send-a-no-bounced-at",
          bounceType: "permanent",
        },
      ] as const;
      for (const [index, fixture] of deliveryFixtures.entries()) {
        const messageId = `bounce-backfill-message-${index}`;
        await client.query(`
          INSERT INTO outbound_messages (id, tenant_id, metadata, origin)
          VALUES ($1, $2, $3::jsonb, $4)
        `, [
          messageId,
          fixture.tenantId,
          JSON.stringify({
            ...(fixture.campaignId ? { campaignId: fixture.campaignId } : {}),
            ...(fixture.sendId ? { campaignSendId: fixture.sendId } : {}),
          }),
          fixture.origin ?? "campaign",
        ]);
        await client.query(`
          INSERT INTO outbound_deliveries (
            id, tenant_id, outbound_message_id, provider, channel, bounce_type
          )
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          `bounce-backfill-delivery-${index}`,
          fixture.tenantId,
          messageId,
          fixture.provider ?? "resend",
          fixture.channel ?? "email",
          fixture.bounceType,
        ]);
      }

      const migrationSql = await readFile(
        new URL("../../../../lib/db/drizzle/0129_campaign_bounce_classification.sql", import.meta.url),
        "utf8",
      );
      const applyMigration = async () => {
        for (const statement of migrationSql.split("--> statement-breakpoint")) {
          const sql = statement.trim();
          if (sql) await client.query(sql);
        }
      };
      await applyMigration();

      const readCampaigns = () => client.query<{
        id: string;
        tenant_id: string;
        tracking_available: boolean;
        permanent_bounced_count: number;
        temporary_bounced_count: number;
      }>(`
        SELECT
          id,
          tenant_id,
          failure_tracking_started_at IS NOT NULL AS tracking_available,
          permanent_bounced_count,
          temporary_bounced_count
        FROM campaigns
        ORDER BY tenant_id, id
      `);
      const campaigns = await readCampaigns();
      expect(campaigns.rows).toEqual([
        {
          id: "campaign-a",
          tenant_id: "tenant-a",
          tracking_available: true,
          permanent_bounced_count: 1,
          temporary_bounced_count: 1,
        },
        {
          id: "campaign-legacy",
          tenant_id: "tenant-a",
          tracking_available: false,
          permanent_bounced_count: 0,
          temporary_bounced_count: 0,
        },
        {
          id: "campaign-b",
          tenant_id: "tenant-b",
          tracking_available: true,
          permanent_bounced_count: 1,
          temporary_bounced_count: 1,
        },
      ]);

      const readSends = () => client.query<{ id: string; bounce_type: string | null }>(
        "SELECT id, bounce_type FROM campaign_sends ORDER BY id",
      );
      const sends = await readSends();
      expect(Object.fromEntries(sends.rows.map((row) => [row.id, row.bounce_type]))).toEqual({
        "send-a-ambiguous": null,
        "send-a-missing-campaign-id": null,
        "send-a-no-bounced-at": null,
        "send-a-non-campaign-origin": null,
        "send-a-non-email-channel": null,
        "send-a-non-resend-provider": null,
        "send-a-permanent": "permanent",
        "send-a-temporary": "temporary",
        "send-b-permanent": "permanent",
        "send-b-temporary": "temporary",
        "send-legacy": null,
      });

      await applyMigration();
      const campaignsAfterRetry = await readCampaigns();
      const sendsAfterRetry = await readSends();
      expect(campaignsAfterRetry.rows).toEqual(campaigns.rows);
      expect(sendsAfterRetry.rows).toEqual(sends.rows);
    } finally {
      try {
        await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } finally {
        try {
          await client.query("RESET search_path");
        } finally {
          client.release();
        }
      }
    }
  });

  it("preserves an existing bounce classification when a retry sees conflicting ledger evidence", async () => {
    const client = await pool.connect();
    const schemaName = `bounce_retry_conflict_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET search_path TO "${schemaName}"`);
      await client.query(`
        CREATE TABLE campaigns (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          failure_tracking_started_at timestamptz
        );
        CREATE TABLE campaign_sends (
          id text PRIMARY KEY,
          campaign_id text NOT NULL,
          tenant_id text NOT NULL,
          bounced_at timestamptz,
          bounce_type text
        );
        CREATE TABLE outbound_messages (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          metadata jsonb NOT NULL,
          origin text NOT NULL
        );
        CREATE TABLE outbound_deliveries (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          outbound_message_id text NOT NULL,
          provider text NOT NULL,
          channel text NOT NULL,
          bounce_type text
        );
      `);

      const trackingStartedAt = new Date("2026-10-20T00:00:00.000Z");
      await client.query(`
        INSERT INTO campaigns (id, tenant_id, failure_tracking_started_at)
        VALUES ('campaign-retry', 'tenant-retry', $1)
      `, [trackingStartedAt]);
      await client.query(`
        INSERT INTO campaign_sends (id, campaign_id, tenant_id, bounced_at, bounce_type)
        VALUES ('send-preclassified', 'campaign-retry', 'tenant-retry', $1, 'permanent')
      `, [trackingStartedAt]);

      const migrationSql = await readFile(
        new URL("../../../../lib/db/drizzle/0129_campaign_bounce_classification.sql", import.meta.url),
        "utf8",
      );
      const applyMigration = async () => {
        for (const statement of migrationSql.split("--> statement-breakpoint")) {
          const sql = statement.trim();
          if (sql) await client.query(sql);
        }
      };
      const readCampaign = () => client.query<{
        permanent_bounced_count: number;
        temporary_bounced_count: number;
      }>(`
        SELECT permanent_bounced_count, temporary_bounced_count
        FROM campaigns
        WHERE id = 'campaign-retry' AND tenant_id = 'tenant-retry'
      `);
      const readSend = () => client.query<{ bounce_type: string | null }>(`
        SELECT bounce_type
        FROM campaign_sends
        WHERE id = 'send-preclassified'
          AND campaign_id = 'campaign-retry'
          AND tenant_id = 'tenant-retry'
      `);

      await applyMigration();
      const campaignBeforeRetry = await readCampaign();
      const sendBeforeRetry = await readSend();
      expect(campaignBeforeRetry.rows).toEqual([{
        permanent_bounced_count: 1,
        temporary_bounced_count: 0,
      }]);
      expect(sendBeforeRetry.rows).toEqual([{ bounce_type: "permanent" }]);

      await client.query(`
        INSERT INTO outbound_messages (id, tenant_id, metadata, origin)
        VALUES (
          'message-late-conflicting-bounce',
          'tenant-retry',
          '{"campaignId":"campaign-retry","campaignSendId":"send-preclassified"}'::jsonb,
          'campaign'
        )
      `);
      await client.query(`
        INSERT INTO outbound_deliveries (
          id, tenant_id, outbound_message_id, provider, channel, bounce_type
        )
        VALUES (
          'delivery-late-conflicting-bounce',
          'tenant-retry',
          'message-late-conflicting-bounce',
          'resend',
          'email',
          'temporary'
        )
      `);

      await applyMigration();
      const campaignAfterRetry = await readCampaign();
      const sendAfterRetry = await readSend();
      expect(campaignAfterRetry.rows).toEqual(campaignBeforeRetry.rows);
      expect(sendAfterRetry.rows).toEqual(sendBeforeRetry.rows);
    } finally {
      try {
        await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } finally {
        try {
          await client.query("RESET search_path");
        } finally {
          client.release();
        }
      }
    }
  });

  it("recalculates bounce totals when a new bounced send appears before a migration retry", async () => {
    const client = await pool.connect();
    const schemaName = `bounce_retry_new_send_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET search_path TO "${schemaName}"`);
      await client.query(`
        CREATE TABLE campaigns (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          failure_tracking_started_at timestamptz
        );
        CREATE TABLE campaign_sends (
          id text PRIMARY KEY,
          campaign_id text NOT NULL,
          tenant_id text NOT NULL,
          bounced_at timestamptz
        );
        CREATE TABLE outbound_messages (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          metadata jsonb NOT NULL,
          origin text NOT NULL
        );
        CREATE TABLE outbound_deliveries (
          id text PRIMARY KEY,
          tenant_id text NOT NULL,
          outbound_message_id text NOT NULL,
          provider text NOT NULL,
          channel text NOT NULL,
          bounce_type text
        );
      `);

      const trackingStartedAt = new Date("2026-10-20T00:00:00.000Z");
      await client.query(`
        INSERT INTO campaigns (id, tenant_id, failure_tracking_started_at)
        VALUES ('campaign-retry-new-send', 'tenant-retry-new-send', $1)
      `, [trackingStartedAt]);
      await client.query(`
        INSERT INTO campaign_sends (id, campaign_id, tenant_id, bounced_at)
        VALUES ('send-original-permanent', 'campaign-retry-new-send', 'tenant-retry-new-send', $1)
      `, [trackingStartedAt]);
      await client.query(`
        INSERT INTO outbound_messages (id, tenant_id, metadata, origin)
        VALUES (
          'message-original-permanent',
          'tenant-retry-new-send',
          '{"campaignId":"campaign-retry-new-send","campaignSendId":"send-original-permanent"}'::jsonb,
          'campaign'
        )
      `);
      await client.query(`
        INSERT INTO outbound_deliveries (
          id, tenant_id, outbound_message_id, provider, channel, bounce_type
        )
        VALUES (
          'delivery-original-permanent',
          'tenant-retry-new-send',
          'message-original-permanent',
          'resend',
          'email',
          'permanent'
        )
      `);

      const migrationSql = await readFile(
        new URL("../../../../lib/db/drizzle/0129_campaign_bounce_classification.sql", import.meta.url),
        "utf8",
      );
      const applyMigration = async () => {
        for (const statement of migrationSql.split("--> statement-breakpoint")) {
          const sql = statement.trim();
          if (sql) await client.query(sql);
        }
      };
      await applyMigration();

      const campaignsBeforeRetry = await client.query<{
        permanent_bounced_count: number;
        temporary_bounced_count: number;
      }>(`
        SELECT permanent_bounced_count, temporary_bounced_count
        FROM campaigns
        WHERE id = 'campaign-retry-new-send'
          AND tenant_id = 'tenant-retry-new-send'
      `);
      const originalSendBeforeRetry = await client.query<{ bounce_type: string | null }>(`
        SELECT bounce_type
        FROM campaign_sends
        WHERE id = 'send-original-permanent'
          AND campaign_id = 'campaign-retry-new-send'
          AND tenant_id = 'tenant-retry-new-send'
      `);
      expect(campaignsBeforeRetry.rows).toEqual([{
        permanent_bounced_count: 1,
        temporary_bounced_count: 0,
      }]);
      expect(originalSendBeforeRetry.rows).toEqual([{ bounce_type: "permanent" }]);

      await client.query(`
        INSERT INTO campaign_sends (id, campaign_id, tenant_id, bounced_at)
        VALUES ('send-new-temporary', 'campaign-retry-new-send', 'tenant-retry-new-send', $1)
      `, [trackingStartedAt]);
      await client.query(`
        INSERT INTO outbound_messages (id, tenant_id, metadata, origin)
        VALUES (
          'message-new-temporary',
          'tenant-retry-new-send',
          '{"campaignId":"campaign-retry-new-send","campaignSendId":"send-new-temporary"}'::jsonb,
          'campaign'
        )
      `);
      await client.query(`
        INSERT INTO outbound_deliveries (
          id, tenant_id, outbound_message_id, provider, channel, bounce_type
        )
        VALUES (
          'delivery-new-temporary',
          'tenant-retry-new-send',
          'message-new-temporary',
          'resend',
          'email',
          'temporary'
        )
      `);

      await applyMigration();
      const campaignsAfterRetry = await client.query<{
        permanent_bounced_count: number;
        temporary_bounced_count: number;
      }>(`
        SELECT permanent_bounced_count, temporary_bounced_count
        FROM campaigns
        WHERE id = 'campaign-retry-new-send'
          AND tenant_id = 'tenant-retry-new-send'
      `);
      const sendsAfterRetry = await client.query<{ id: string; bounce_type: string | null }>(`
        SELECT id, bounce_type
        FROM campaign_sends
        WHERE campaign_id = 'campaign-retry-new-send'
          AND tenant_id = 'tenant-retry-new-send'
        ORDER BY id
      `);
      expect(campaignsAfterRetry.rows).toEqual([{
        permanent_bounced_count: 1,
        temporary_bounced_count: 1,
      }]);
      expect(sendsAfterRetry.rows).toEqual([
        { id: "send-new-temporary", bounce_type: "temporary" },
        { id: "send-original-permanent", bounce_type: "permanent" },
      ]);
    } finally {
      try {
        await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } finally {
        try {
          await client.query("RESET search_path");
        } finally {
          client.release();
        }
      }
    }
  });

  it("counts concurrent email and WhatsApp callbacks once for a unified campaign recipient", async () => {
    mockWhatsAppSend.mockClear();
    const sharedClientId = `campaign-client-${runId}`;
    const emailExternalId = `campaign-email-${runId}`;
    const whatsappExternalId = `campaign-whatsapp-${runId}`;
    const fixtures = [
      { tenantId: callbackTenantId, campaignId: randomUUID(), campaignSendId: randomUUID() },
      { tenantId: callbackOtherTenantId, campaignId: randomUUID(), campaignSendId: randomUUID() },
    ];

    for (const fixture of fixtures) {
      await db.insert(campaignsTable).values({
        id: fixture.campaignId,
        tenantId: fixture.tenantId,
        name: "Concurrent callback test",
        type: "unified",
        status: "sent",
        content: "Integration test campaign",
        createdById: "integration-test",
      });
      await db.insert(campaignSendsTable).values({
        id: fixture.campaignSendId,
        campaignId: fixture.campaignId,
        clientId: sharedClientId,
        tenantId: fixture.tenantId,
        status: "sent",
      });

      for (const channel of [
        { channel: "email" as const, provider: "resend", externalId: emailExternalId },
        { channel: "whatsapp" as const, provider: "evolution", externalId: whatsappExternalId },
      ]) {
        const messageId = randomUUID();
        await db.insert(outboundMessagesTable).values({
          id: messageId,
          tenantId: fixture.tenantId,
          idempotencyKey: `campaign-callback:${fixture.tenantId}:${channel.channel}:${randomUUID()}`,
          eventType: "campaign_message",
          origin: "campaign",
          recipientType: "client",
          recipientId: sharedClientId,
          status: "processing",
          metadata: {
            campaignId: fixture.campaignId,
            campaignSendId: fixture.campaignSendId,
            clientId: sharedClientId,
          },
        });
        await db.insert(outboundDeliveriesTable).values({
          id: randomUUID(),
          tenantId: fixture.tenantId,
          outboundMessageId: messageId,
          channel: channel.channel,
          content: "Integration test delivery",
          status: "processing",
          provider: channel.provider,
          externalId: channel.externalId,
        });
      }
    }

    const tenantCampaign = fixtures[0]!;
    const otherTenantCampaign = fixtures[1]!;
    const emailCallback = {
      tenantId: callbackTenantId,
      provider: "resend",
      externalId: emailExternalId,
      status: "accepted" as const,
      providerStatus: "email.delivered",
      error: null,
    };
    const whatsappCallback = {
      tenantId: callbackTenantId,
      provider: "evolution",
      externalId: whatsappExternalId,
      status: "accepted" as const,
      providerStatus: "3",
      error: null,
    };

    const blocker = await pool.connect();
    let blockerTransactionOpen = false;
    let pendingCallbacks: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      blockerTransactionOpen = true;
      const blockerSession = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      const blockerPid = blockerSession.rows[0]!.pid;
      await blocker.query(
        "SELECT id FROM campaign_sends WHERE id = $1 FOR UPDATE",
        [tenantCampaign.campaignSendId],
      );

      pendingCallbacks = Promise.all([
        updateOutboundDeliveryFromWebhook(emailCallback),
        updateOutboundDeliveryFromWebhook(whatsappCallback),
      ]);
      await waitForBlockedSessions(blockerPid, 2);
      await blocker.query("COMMIT");
      blockerTransactionOpen = false;

      const concurrentResults = await pendingCallbacks;
      expect(concurrentResults).toEqual([
        expect.objectContaining({ updated: true }),
        expect.objectContaining({ updated: true }),
      ]);

      const [campaignAfterConcurrentCallbacks] = await db.select().from(campaignsTable)
        .where(and(
          eq(campaignsTable.id, tenantCampaign.campaignId),
          eq(campaignsTable.tenantId, callbackTenantId),
        ));
      expect(campaignAfterConcurrentCallbacks).toMatchObject({
        deliveredCount: 1,
        emailDeliveredCount: 1,
      });

      const replayResults = await Promise.all([
        updateOutboundDeliveryFromWebhook(emailCallback),
        updateOutboundDeliveryFromWebhook(whatsappCallback),
      ]);
      expect(replayResults).toEqual([
        expect.objectContaining({ updated: true }),
        expect.objectContaining({ updated: true }),
      ]);

      const [campaignAfterReplays] = await db.select().from(campaignsTable)
        .where(and(
          eq(campaignsTable.id, tenantCampaign.campaignId),
          eq(campaignsTable.tenantId, callbackTenantId),
        ));
      const [otherTenantCampaignAfterCallbacks] = await db.select().from(campaignsTable)
        .where(and(
          eq(campaignsTable.id, otherTenantCampaign.campaignId),
          eq(campaignsTable.tenantId, callbackOtherTenantId),
        ));
      const [tenantSend] = await db.select().from(campaignSendsTable)
        .where(and(
          eq(campaignSendsTable.id, tenantCampaign.campaignSendId),
          eq(campaignSendsTable.tenantId, callbackTenantId),
        ));
      const [otherTenantSend] = await db.select().from(campaignSendsTable)
        .where(and(
          eq(campaignSendsTable.id, otherTenantCampaign.campaignSendId),
          eq(campaignSendsTable.tenantId, callbackOtherTenantId),
        ));

      expect(campaignAfterReplays).toMatchObject({
        deliveredCount: 1,
        emailDeliveredCount: 1,
      });
      expect(otherTenantCampaignAfterCallbacks).toMatchObject({
        deliveredCount: 0,
        emailDeliveredCount: 0,
      });
      expect(tenantSend?.deliveredAt).toBeInstanceOf(Date);
      expect(tenantSend?.emailDeliveredAt).toBeInstanceOf(Date);
      expect(otherTenantSend?.deliveredAt).toBeNull();
      expect(otherTenantSend?.emailDeliveredAt).toBeNull();
      expect(mockWhatsAppSend).not.toHaveBeenCalled();
    } finally {
      if (blockerTransactionOpen) await blocker.query("ROLLBACK");
      if (pendingCallbacks) await pendingCallbacks.catch(() => undefined);
      blocker.release();
    }
  });

  it("counts both Resend bounce classifications once and keeps legacy and other-tenant metrics isolated", async () => {
    const failureEvents = [
      { key: "permanent-bounce", type: "email.bounced", timestamp: "bouncedAt", bounceType: "permanent" },
      { key: "temporary-bounce", type: "email.bounced", timestamp: "bouncedAt", bounceType: "temporary" },
      { key: "failed", type: "email.failed", timestamp: "failedAt", bounceType: null },
      { key: "complaint", type: "email.complained", timestamp: "complainedAt", bounceType: null },
    ] as const;
    const trackingStartedAt = new Date();
    const fixtureByTenant = new Map<string, {
      campaignId: string;
      sendIds: Record<string, string>;
      deliveryIds: Record<string, string>;
    }>();

    // Seed the other tenant first so an unscoped provider-ID lookup cannot pass by
    // consistently finding this tenant's rows first.
    for (const currentTenantId of [callbackOtherTenantId, callbackTenantId]) {
      const campaignId = randomUUID();
      const fixture = {
        campaignId,
        sendIds: {} as Record<string, string>,
        deliveryIds: {} as Record<string, string>,
      };
      fixtureByTenant.set(currentTenantId, fixture);
      await db.insert(campaignsTable).values({
        id: campaignId,
        tenantId: currentTenantId,
        name: "Campaign failure metrics test",
        type: "email",
        status: "sent",
        content: "Integration test campaign",
        createdById: "integration-test",
        engagementTrackingStartedAt: trackingStartedAt,
        failureTrackingStartedAt: trackingStartedAt,
      });

      for (const failureEvent of failureEvents) {
        const campaignSendId = randomUUID();
        const messageId = randomUUID();
        const deliveryId = randomUUID();
        const clientId = `failure-client-${failureEvent.key}-${runId}`;
        const externalId = `resend-${failureEvent.key}-${runId}`;
        fixture.sendIds[failureEvent.key] = campaignSendId;
        fixture.deliveryIds[failureEvent.key] = deliveryId;

        await db.insert(campaignSendsTable).values({
          id: campaignSendId,
          campaignId,
          clientId,
          tenantId: currentTenantId,
          status: "sent",
        });
        await db.insert(outboundMessagesTable).values({
          id: messageId,
          tenantId: currentTenantId,
          idempotencyKey: `campaign-failure:${currentTenantId}:${failureEvent.key}:${randomUUID()}`,
          eventType: "campaign_message",
          origin: "campaign",
          recipientType: "client",
          recipientId: clientId,
          status: "processing",
          metadata: { campaignId, campaignSendId, clientId },
        });
        await db.insert(outboundDeliveriesTable).values({
          id: deliveryId,
          tenantId: currentTenantId,
          outboundMessageId: messageId,
          channel: "email",
          content: "Integration test delivery",
          status: "processing",
          provider: "resend",
          externalId,
        });
      }
    }

    const trackedCampaign = fixtureByTenant.get(callbackTenantId)!;
    const otherTenantCampaign = fixtureByTenant.get(callbackOtherTenantId)!;
    const nonComplaintEvents = failureEvents.filter((failureEvent) => failureEvent.type !== "email.complained");
    const callbacks = nonComplaintEvents.map((failureEvent) => ({
      tenantId: callbackTenantId,
      provider: "resend",
      externalId: `resend-${failureEvent.key}-${runId}`,
      status: "failed" as const,
      providerStatus: failureEvent.type,
      error: failureEvent.type,
      bounceType: failureEvent.bounceType ?? undefined,
    }));
    const initialResults = await Promise.all(callbacks.map((callback) =>
      updateOutboundDeliveryFromWebhook(callback),
    ));
    expect(initialResults).toEqual(nonComplaintEvents.map((failureEvent) =>
      expect.objectContaining({
        updated: true,
        deliveryId: trackedCampaign.deliveryIds[failureEvent.key],
      }),
    ));

    const complaintCallback = {
      tenantId: callbackTenantId,
      provider: "resend",
      externalId: `resend-complaint-${runId}`,
      status: "accepted" as const,
      providerStatus: "email.complained",
      error: null,
    };
    const complaintResult = await updateOutboundDeliveryFromWebhook(complaintCallback);
    expect(complaintResult).toMatchObject({
      updated: true,
      deliveryId: trackedCampaign.deliveryIds["complaint"],
    });

    const [campaignAfterComplaint] = await db.select().from(campaignsTable)
      .where(and(
        eq(campaignsTable.id, trackedCampaign.campaignId),
        eq(campaignsTable.tenantId, callbackTenantId),
      ));
    expect(campaignAfterComplaint).toMatchObject({
      complainedCount: 1,
      deliveredCount: 1,
      emailDeliveredCount: 1,
    });

    const deliveredCallback = {
      ...complaintCallback,
      providerStatus: "email.delivered",
    };
    const deliveredResult = await updateOutboundDeliveryFromWebhook(deliveredCallback);
    expect(deliveredResult).toEqual(complaintResult);

    const replayResults = await Promise.all(callbacks.map((callback) =>
      updateOutboundDeliveryFromWebhook(callback),
    ));
    expect(replayResults).toEqual(initialResults);
    const [complaintReplayResult, deliveredReplayResult] = await Promise.all([
      updateOutboundDeliveryFromWebhook(complaintCallback),
      updateOutboundDeliveryFromWebhook(deliveredCallback),
    ]);
    expect(complaintReplayResult).toEqual(complaintResult);
    expect(deliveredReplayResult).toEqual(deliveredResult);

    const [trackedCampaignAfterCallbacks] = await db.select().from(campaignsTable)
      .where(and(
        eq(campaignsTable.id, trackedCampaign.campaignId),
        eq(campaignsTable.tenantId, callbackTenantId),
      ));
    const [otherTenantCampaignAfterCallbacks] = await db.select().from(campaignsTable)
      .where(and(
        eq(campaignsTable.id, otherTenantCampaign.campaignId),
        eq(campaignsTable.tenantId, callbackOtherTenantId),
      ));
    expect(trackedCampaignAfterCallbacks).toMatchObject({
      bouncedCount: 2,
      permanentBouncedCount: 1,
      temporaryBouncedCount: 1,
      failedCount: 1,
      complainedCount: 1,
      deliveredCount: 1,
      emailDeliveredCount: 1,
    });
    expect(otherTenantCampaignAfterCallbacks).toMatchObject({
      bouncedCount: 0,
      permanentBouncedCount: 0,
      temporaryBouncedCount: 0,
      failedCount: 0,
      complainedCount: 0,
      deliveredCount: 0,
      emailDeliveredCount: 0,
    });

    for (const failureEvent of failureEvents) {
      const trackedSendId = trackedCampaign.sendIds[failureEvent.key]!;
      const otherTenantSendId = otherTenantCampaign.sendIds[failureEvent.key]!;
      const [trackedSend] = await db.select().from(campaignSendsTable)
        .where(and(
          eq(campaignSendsTable.id, trackedSendId),
          eq(campaignSendsTable.tenantId, callbackTenantId),
        ));
      const [otherTenantSend] = await db.select().from(campaignSendsTable)
        .where(and(
          eq(campaignSendsTable.id, otherTenantSendId),
          eq(campaignSendsTable.tenantId, callbackOtherTenantId),
        ));
      expect(trackedSend?.[failureEvent.timestamp]).toBeInstanceOf(Date);
      expect(otherTenantSend?.[failureEvent.timestamp]).toBeNull();
      expect(trackedSend?.bounceType ?? null).toBe(failureEvent.bounceType);
      expect(otherTenantSend?.bounceType ?? null).toBeNull();
      if (failureEvent.type === "email.complained") {
        expect(trackedSend?.deliveredAt).toBeInstanceOf(Date);
        expect(trackedSend?.emailDeliveredAt).toBeInstanceOf(Date);
        expect(otherTenantSend?.deliveredAt).toBeNull();
        expect(otherTenantSend?.emailDeliveredAt).toBeNull();
      }
    }

    const legacyCampaignId = randomUUID();
    const legacyCampaignSendId = randomUUID();
    const legacyMessageId = randomUUID();
    const legacyDeliveryId = randomUUID();
    const legacyClientId = `legacy-failure-client-${runId}`;
    await db.insert(campaignsTable).values({
      id: legacyCampaignId,
      tenantId: callbackTenantId,
      name: "Legacy campaign without failure metrics",
      type: "email",
      status: "sent",
      content: "Older campaign",
      createdById: "integration-test",
      engagementTrackingStartedAt: trackingStartedAt,
    });
    await db.insert(campaignSendsTable).values({
      id: legacyCampaignSendId,
      campaignId: legacyCampaignId,
      clientId: legacyClientId,
      tenantId: callbackTenantId,
      status: "sent",
    });
    await db.insert(outboundMessagesTable).values({
      id: legacyMessageId,
      tenantId: callbackTenantId,
      idempotencyKey: `legacy-campaign-failure:${randomUUID()}`,
      eventType: "campaign_message",
      origin: "campaign",
      recipientType: "client",
      recipientId: legacyClientId,
      status: "processing",
      metadata: {
        campaignId: legacyCampaignId,
        campaignSendId: legacyCampaignSendId,
        clientId: legacyClientId,
      },
    });
    await db.insert(outboundDeliveriesTable).values({
      id: legacyDeliveryId,
      tenantId: callbackTenantId,
      outboundMessageId: legacyMessageId,
      channel: "email",
      content: "Integration test legacy delivery",
      status: "processing",
      provider: "resend",
      externalId: `legacy-resend-complained-${runId}`,
    });
    await expect(updateOutboundDeliveryFromWebhook({
      tenantId: callbackTenantId,
      provider: "resend",
      externalId: `legacy-resend-complained-${runId}`,
      status: "accepted",
      providerStatus: "email.complained",
      error: null,
    })).resolves.toMatchObject({ updated: true, deliveryId: legacyDeliveryId });

    const [legacyCampaignAfterCallback] = await db.select().from(campaignsTable)
      .where(and(
        eq(campaignsTable.id, legacyCampaignId),
        eq(campaignsTable.tenantId, callbackTenantId),
      ));
    const [legacySendAfterCallback] = await db.select().from(campaignSendsTable)
      .where(and(
        eq(campaignSendsTable.id, legacyCampaignSendId),
        eq(campaignSendsTable.tenantId, callbackTenantId),
      ));
    expect(legacyCampaignAfterCallback).toMatchObject({
      complainedCount: 0,
      permanentBouncedCount: 0,
      temporaryBouncedCount: 0,
      deliveredCount: 1,
      emailDeliveredCount: 1,
      failureTrackingStartedAt: null,
    });
    expect(legacySendAfterCallback?.complainedAt).toBeNull();
    expect(legacySendAfterCallback?.deliveredAt).toBeInstanceOf(Date);
    expect(legacySendAfterCallback?.emailDeliveredAt).toBeInstanceOf(Date);
  });

  it("lists only tenant-scoped permanent-bounce clients and keeps untracked campaigns unavailable", async () => {
    const trackedCampaignId = randomUUID();
    const sameTenantOtherCampaignId = randomUUID();
    const otherTenantCampaignId = randomUUID();
    const legacyCampaignId = randomUUID();
    const trackingStartedAt = new Date();
    const campaignDetails = {
      name: "Permanent bounce recipient test",
      type: "email",
      status: "sent",
      content: "Integration test campaign",
      createdById: "integration-test",
    } as const;

    await db.insert(campaignsTable).values({
      id: trackedCampaignId,
      tenantId: callbackTenantId,
      ...campaignDetails,
      failureTrackingStartedAt: trackingStartedAt,
    });
    await db.insert(campaignsTable).values({
      id: sameTenantOtherCampaignId,
      tenantId: callbackTenantId,
      ...campaignDetails,
      failureTrackingStartedAt: trackingStartedAt,
    });
    await db.insert(campaignsTable).values({
      id: otherTenantCampaignId,
      tenantId: callbackOtherTenantId,
      ...campaignDetails,
      failureTrackingStartedAt: trackingStartedAt,
    });
    await db.insert(campaignsTable).values({
      id: legacyCampaignId,
      tenantId: callbackTenantId,
      ...campaignDetails,
    });

    const recipientFixtures = [
      { key: "permanent", tenantId: callbackTenantId, name: "Permanent bounce client", email: "permanent@example.test" },
      { key: "temporary", tenantId: callbackTenantId, name: "Temporary bounce client", email: "temporary@example.test" },
      { key: "other-campaign", tenantId: callbackTenantId, name: "Other campaign client", email: "other-campaign@example.test" },
      { key: "other-tenant", tenantId: callbackOtherTenantId, name: "Other tenant client", email: "other-tenant@example.test" },
      { key: "legacy", tenantId: callbackTenantId, name: "Legacy campaign client", email: "legacy@example.test" },
    ] as const;
    const clientIds = new Map<string, string>();
    await db.insert(clientsTable).values(recipientFixtures.map((fixture, index) => {
      const id = `bounce-recipient-${fixture.key}-${runId}`;
      clientIds.set(fixture.key, id);
      return {
        id,
        tenantId: fixture.tenantId,
        name: fixture.name,
        email: fixture.email,
        whatsapp: `551199000${String(index).padStart(4, "0")}`,
      };
    }));

    const sendRows = [
      {
        campaignId: trackedCampaignId,
        clientId: clientIds.get("permanent")!,
        tenantId: callbackTenantId,
        bounceType: "permanent" as const,
      },
      {
        campaignId: trackedCampaignId,
        clientId: clientIds.get("temporary")!,
        tenantId: callbackTenantId,
        bounceType: "temporary" as const,
      },
      {
        campaignId: sameTenantOtherCampaignId,
        clientId: clientIds.get("other-campaign")!,
        tenantId: callbackTenantId,
        bounceType: "permanent" as const,
      },
      {
        campaignId: otherTenantCampaignId,
        clientId: clientIds.get("other-tenant")!,
        tenantId: callbackOtherTenantId,
        bounceType: "permanent" as const,
      },
      {
        campaignId: legacyCampaignId,
        clientId: clientIds.get("legacy")!,
        tenantId: callbackTenantId,
        bounceType: "permanent" as const,
      },
    ];
    await db.insert(campaignSendsTable).values(sendRows.map((send) => ({
      id: randomUUID(),
      ...send,
      bouncedAt: trackingStartedAt,
      status: "sent",
    })));

    const trackedPage = await listCampaignPermanentBounceRecipients(
      callbackTenantId,
      trackedCampaignId,
      1,
    );
    expect(trackedPage).toMatchObject({
      available: true,
      page: 1,
      hasMore: false,
      recipients: [{
        clientId: clientIds.get("permanent"),
        name: "Permanent bounce client",
        email: "permanent@example.test",
        bouncedAt: trackingStartedAt.toISOString(),
      }],
    });
    expect(trackedPage?.recipients).toHaveLength(1);

    expect(await listCampaignPermanentBounceRecipients(
      callbackOtherTenantId,
      trackedCampaignId,
      1,
    )).toBeNull();

    const otherTenantPage = await listCampaignPermanentBounceRecipients(
      callbackOtherTenantId,
      otherTenantCampaignId,
      1,
    );
    expect(otherTenantPage?.recipients.map((recipient) => recipient.clientId))
      .toEqual([clientIds.get("other-tenant")]);

    const legacyPage = await listCampaignPermanentBounceRecipients(
      callbackTenantId,
      legacyCampaignId,
      1,
    );
    expect(legacyPage).toMatchObject({
      available: false,
      recipients: [],
      hasMore: false,
    });
  });

  it("persists one WhatsApp delivery for concurrent campaign requests and accepts it once", async () => {
    mockWhatsAppSend.mockClear();
    const logicalCampaignKey = `trip:trip-test:${campaignId}:passenger:${phone}`;
    const input = {
      tenantId,
      eventType: "trip_whatsapp_broadcast",
      idempotencyKey: logicalCampaignKey,
      recipient: { type: "direct" as const, whatsapp: phone },
      whatsapp: { text: "Integration test broadcast" },
      channels: ["whatsapp" as const],
      origin: "legacy_whatsapp",
      originChannel: "whatsapp" as const,
    };

    const concurrentCreations = await Promise.all([
      createOutboundMessage(input),
      createOutboundMessage(input),
    ]);
    const messageIds = new Set(concurrentCreations.map(({ message }) => message.id));
    expect(messageIds.size).toBe(1);
    expect(concurrentCreations.filter(({ created }) => created).length).toBe(1);

    const [message] = await db.select().from(outboundMessagesTable).where(and(
      eq(outboundMessagesTable.tenantId, tenantId),
      eq(outboundMessagesTable.idempotencyKey, logicalCampaignKey),
    ));
    expect(message).toBeDefined();
    const deliveries = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.outboundMessageId, message!.id),
    ));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.channel).toBe("whatsapp");

    const deliveryId = deliveries[0]!.id;
    const workerResults = await Promise.all([
      processOutboundDelivery(deliveryId, tenantId),
      processOutboundDelivery(deliveryId, tenantId),
    ]);
    expect(workerResults.filter(Boolean)).toHaveLength(1);
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(1);

    const [acceptedDelivery] = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.id, deliveryId),
    ));
    expect(acceptedDelivery?.status).toBe("accepted");
    const [acceptedMessage] = await db.select().from(outboundMessagesTable).where(and(
      eq(outboundMessagesTable.tenantId, tenantId),
      eq(outboundMessagesTable.id, message!.id),
    ));
    expect(acceptedMessage?.status).toBe("accepted");

    const distinctCampaign = await createOutboundMessage({
      ...input,
      idempotencyKey: `trip:trip-test:${newCampaignId}:passenger:${phone}`,
    });
    expect(distinctCampaign.created).toBe(true);
    expect(distinctCampaign.message.id).not.toBe(message!.id);
    expect(distinctCampaign.deliveries).toHaveLength(1);
    expect(await processOutboundDelivery(distinctCampaign.deliveries[0]!.id, tenantId)).toBe(true);
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(2);

    const persistedMessages = await db.select().from(outboundMessagesTable)
      .where(eq(outboundMessagesTable.tenantId, tenantId));
    const persistedDeliveries = await db.select().from(outboundDeliveriesTable)
      .where(eq(outboundDeliveriesTable.tenantId, tenantId));
    expect(persistedMessages).toHaveLength(2);
    expect(persistedDeliveries).toHaveLength(2);
  });

  it("keeps concurrent identical keys and delivery processing isolated between tenants", async () => {
    mockWhatsAppSend.mockClear();
    const logicalCampaignKey = `trip:trip-test:shared-campaign:${phone}`;
    const inputForTenant = (tenantId: string) => ({
      tenantId,
      eventType: "trip_whatsapp_broadcast",
      idempotencyKey: logicalCampaignKey,
      recipient: { type: "direct" as const, whatsapp: phone },
      whatsapp: { text: "Same logical key sent by two agencies" },
      channels: ["whatsapp" as const],
      origin: "legacy_whatsapp",
      originChannel: "whatsapp" as const,
    });

    const [aFirst, bFirst, aSecond, bSecond] = await Promise.all([
      createOutboundMessage(inputForTenant(tenantId)),
      createOutboundMessage(inputForTenant(secondTenantId)),
      createOutboundMessage(inputForTenant(tenantId)),
      createOutboundMessage(inputForTenant(secondTenantId)),
    ]);
    const tenantAMessages = [aFirst, aSecond];
    const tenantBMessages = [bFirst, bSecond];

    for (const tenantMessages of [tenantAMessages, tenantBMessages]) {
      expect(new Set(tenantMessages.map(({ message }) => message.id)).size).toBe(1);
      expect(tenantMessages.filter(({ created }) => created)).toHaveLength(1);
    }
    const [messagesA, messagesB] = await Promise.all([
      db.select().from(outboundMessagesTable).where(and(
        eq(outboundMessagesTable.tenantId, tenantId),
        eq(outboundMessagesTable.idempotencyKey, logicalCampaignKey),
      )),
      db.select().from(outboundMessagesTable).where(and(
        eq(outboundMessagesTable.tenantId, secondTenantId),
        eq(outboundMessagesTable.idempotencyKey, logicalCampaignKey),
      )),
    ]);
    expect(messagesA).toHaveLength(1);
    expect(messagesB).toHaveLength(1);
    const messageA = messagesA[0]!;
    const messageB = messagesB[0]!;
    expect(messageA.id).not.toBe(messageB.id);
    expect(messageA.id).toBe(aFirst.message.id);
    expect(messageB.id).toBe(bFirst.message.id);
    expect(messageA.tenantId).toBe(tenantId);
    expect(messageB.tenantId).toBe(secondTenantId);
    expect(messageA.idempotencyKey).toBe(logicalCampaignKey);
    expect(messageB.idempotencyKey).toBe(logicalCampaignKey);

    const [deliveriesA, deliveriesB] = await Promise.all([
      db.select().from(outboundDeliveriesTable).where(and(
        eq(outboundDeliveriesTable.tenantId, tenantId),
        eq(outboundDeliveriesTable.outboundMessageId, messageA.id),
      )),
      db.select().from(outboundDeliveriesTable).where(and(
        eq(outboundDeliveriesTable.tenantId, secondTenantId),
        eq(outboundDeliveriesTable.outboundMessageId, messageB.id),
      )),
    ]);
    expect(deliveriesA).toHaveLength(1);
    expect(deliveriesB).toHaveLength(1);
    const deliveryA = deliveriesA[0]!;
    const deliveryB = deliveriesB[0]!;
    expect(deliveryA.id).not.toBe(deliveryB.id);
    expect(deliveryA.tenantId).toBe(tenantId);
    expect(deliveryB.tenantId).toBe(secondTenantId);
    expect(deliveryA.channel).toBe("whatsapp");
    expect(deliveryB.channel).toBe("whatsapp");

    await expect(processOutboundDelivery(deliveryA.id, tenantId)).resolves.toBe(true);
    const [acceptedDeliveryA] = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.id, deliveryA.id),
    ));
    const [untouchedDeliveryB] = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, secondTenantId),
      eq(outboundDeliveriesTable.id, deliveryB.id),
    ));
    const [untouchedMessageB] = await db.select().from(outboundMessagesTable).where(and(
      eq(outboundMessagesTable.tenantId, secondTenantId),
      eq(outboundMessagesTable.id, messageB.id),
    ));
    const [attemptsA, attemptsB] = await Promise.all([
      db.select().from(outboundDeliveryAttemptsTable).where(and(
        eq(outboundDeliveryAttemptsTable.tenantId, tenantId),
        eq(outboundDeliveryAttemptsTable.deliveryId, deliveryA.id),
      )),
      db.select().from(outboundDeliveryAttemptsTable).where(and(
        eq(outboundDeliveryAttemptsTable.tenantId, secondTenantId),
        eq(outboundDeliveryAttemptsTable.deliveryId, deliveryB.id),
      )),
    ]);
    expect(acceptedDeliveryA?.status).toBe("accepted");
    expect(untouchedDeliveryB?.status).toBe("pending");
    expect(untouchedMessageB?.status).toBe("pending");
    expect(attemptsA).toHaveLength(1);
    expect(attemptsA[0]?.status).toBe("accepted");
    expect(attemptsB).toHaveLength(0);
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(1);

    await expect(processOutboundDelivery(deliveryB.id, secondTenantId)).resolves.toBe(true);
    const [acceptedDeliveryB] = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, secondTenantId),
      eq(outboundDeliveriesTable.id, deliveryB.id),
    ));
    expect(acceptedDeliveryB?.status).toBe("accepted");
    const [attemptsBAfterProcessing] = await db.select().from(outboundDeliveryAttemptsTable).where(and(
      eq(outboundDeliveryAttemptsTable.tenantId, secondTenantId),
      eq(outboundDeliveryAttemptsTable.deliveryId, deliveryB.id),
    ));
    expect(attemptsBAfterProcessing?.status).toBe("accepted");
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(2);
  });

  it("keeps an ambiguous provider result in reconciliation until the same delivery is confirmed accepted", async () => {
    mockWhatsAppSend.mockClear();
    mockReconcileWhatsAppMessage.mockClear();
    const externalId = "provider-accepted-after-timeout";
    const logicalCampaignKey = `trip:trip-test:ambiguous:${randomUUID()}:${phone}`;
    mockWhatsAppSend.mockResolvedValueOnce({
      provider: "evolution",
      externalId,
      success: false,
      error: "response_lost_after_send_started",
      outcomeUnknown: true,
    });
    mockReconcileWhatsAppMessage.mockResolvedValueOnce({
      outcome: "accepted",
      provider: "evolution",
      externalId,
      providerStatus: "SERVER_ACK",
      detail: "provider_message_found",
    });

    const created = await createOutboundMessage({
      tenantId,
      eventType: "trip_whatsapp_broadcast",
      idempotencyKey: logicalCampaignKey,
      recipient: { type: "direct", whatsapp: phone },
      whatsapp: { text: "A response was lost after the provider call started" },
      channels: ["whatsapp"],
      origin: "legacy_whatsapp",
      originChannel: "whatsapp",
    });
    expect(created.deliveries).toHaveLength(1);
    const deliveryId = created.deliveries[0]!.id;

    await expect(processOutboundDelivery(deliveryId, tenantId)).resolves.toBe(false);
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(1);
    const [unknownDelivery] = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.id, deliveryId),
    ));
    expect(unknownDelivery).toMatchObject({
      status: "unknown",
      provider: "evolution",
      externalId,
      lastError: "delivery_result_unknown",
      attempts: 1,
    });
    const [unknownAttempt] = await db.select().from(outboundDeliveryAttemptsTable).where(and(
      eq(outboundDeliveryAttemptsTable.tenantId, tenantId),
      eq(outboundDeliveryAttemptsTable.deliveryId, deliveryId),
    ));
    expect(unknownAttempt).toMatchObject({
      status: "unknown",
      provider: "evolution",
      externalId,
      attemptNumber: 1,
    });

    await expect(recoverOutboundDeliveries({ databaseFallback: true })).resolves.toEqual({
      recovered: 0,
      enqueued: 0,
      inlineAttempted: 0,
    });
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(1);
    const stillUnknown = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.id, deliveryId),
      eq(outboundDeliveriesTable.status, "unknown"),
    ));
    expect(stillUnknown).toHaveLength(1);

    await expect(reconcileOutboundDelivery(tenantId, deliveryId, {
      userId: "integration-test-reviewer",
    })).resolves.toMatchObject({
      outcome: "accepted",
      canRetry: false,
      deliveryId,
      messageId: created.message.id,
      provider: "evolution",
      externalId,
      providerStatus: "SERVER_ACK",
    });
    expect(mockReconcileWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(1);

    const persistedDeliveries = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.outboundMessageId, created.message.id),
    ));
    expect(persistedDeliveries).toHaveLength(1);
    expect(persistedDeliveries[0]).toMatchObject({
      id: deliveryId,
      status: "accepted",
      provider: "evolution",
      externalId,
      lastError: null,
      acceptedAt: expect.any(Date),
    });
    const [acceptedAttempt] = await db.select().from(outboundDeliveryAttemptsTable).where(and(
      eq(outboundDeliveryAttemptsTable.tenantId, tenantId),
      eq(outboundDeliveryAttemptsTable.deliveryId, deliveryId),
    ));
    expect(acceptedAttempt).toMatchObject({
      status: "accepted",
      provider: "evolution",
      externalId,
      attemptNumber: 1,
    });
    const [acceptedMessage] = await db.select().from(outboundMessagesTable).where(and(
      eq(outboundMessagesTable.tenantId, tenantId),
      eq(outboundMessagesTable.id, created.message.id),
    ));
    expect(acceptedMessage?.status).toBe("accepted");
  });

  it("keeps delivery and attempt unknown when provider reconciliation is inconclusive", async () => {
    mockWhatsAppSend.mockClear();
    mockReconcileWhatsAppMessage.mockClear();
    const externalId = "provider-inconclusive-after-timeout";
    const detail = "provider_lookup_temporarily_unavailable";
    mockWhatsAppSend.mockResolvedValueOnce({
      provider: "evolution",
      externalId,
      success: false,
      error: "response_lost_after_send_started",
      outcomeUnknown: true,
    });
    mockReconcileWhatsAppMessage.mockResolvedValueOnce({
      outcome: "inconclusive",
      provider: "evolution",
      externalId,
      detail,
    });

    const created = await createOutboundMessage({
      tenantId,
      eventType: "trip_whatsapp_broadcast",
      idempotencyKey: `trip:trip-test:inconclusive:${randomUUID()}:${phone}`,
      recipient: { type: "direct", whatsapp: phone },
      whatsapp: { text: "The provider lookup is temporarily unavailable" },
      channels: ["whatsapp"],
      origin: "legacy_whatsapp",
      originChannel: "whatsapp",
    });
    expect(created.deliveries).toHaveLength(1);
    const deliveryId = created.deliveries[0]!.id;

    await expect(processOutboundDelivery(deliveryId, tenantId)).resolves.toBe(false);
    await expect(reconcileOutboundDelivery(tenantId, deliveryId, {
      userId: "integration-test-reviewer",
    })).resolves.toMatchObject({
      outcome: "inconclusive",
      canRetry: false,
      deliveryId,
      messageId: created.message.id,
      provider: "evolution",
      externalId,
      detail,
    });

    expect(mockReconcileWhatsAppMessage).toHaveBeenCalledTimes(1);
    expect(mockWhatsAppSend).toHaveBeenCalledTimes(1);
    const persistedDeliveries = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.outboundMessageId, created.message.id),
    ));
    expect(persistedDeliveries).toHaveLength(1);
    expect(persistedDeliveries[0]).toMatchObject({
      id: deliveryId,
      status: "unknown",
      provider: "evolution",
      externalId,
      lastError: detail,
      attempts: 1,
    });
    const attempts = await db.select().from(outboundDeliveryAttemptsTable).where(and(
      eq(outboundDeliveryAttemptsTable.tenantId, tenantId),
      eq(outboundDeliveryAttemptsTable.deliveryId, deliveryId),
    ));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      status: "unknown",
      provider: "evolution",
      externalId,
      error: detail,
      attemptNumber: 1,
    });
  });

  it("recovers an expired processing lease only once across concurrent sweeps", async () => {
    mockWhatsAppSend.mockClear();
    mockReconcileWhatsAppMessage.mockClear();
    const created = await createOutboundMessage({
      tenantId,
      eventType: "trip_whatsapp_broadcast",
      idempotencyKey: `trip:trip-test:worker-crash:${randomUUID()}:${phone}`,
      recipient: { type: "direct", whatsapp: phone },
      whatsapp: { text: "The worker stopped after starting the provider request" },
      channels: ["whatsapp"],
      origin: "legacy_whatsapp",
      originChannel: "whatsapp",
    });
    expect(created.deliveries).toHaveLength(1);
    const deliveryId = created.deliveries[0]!.id;
    const expiredClaimAt = new Date(Date.now() - 16 * 60 * 1000);

    // Simulate the durable state left behind when the worker dies after
    // claiming the delivery and starting the provider attempt.
    await db.update(outboundDeliveriesTable).set({
      status: "processing",
      provider: "evolution",
      attempts: 1,
      claimedAt: expiredClaimAt,
      nextAttemptAt: expiredClaimAt,
    }).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.id, deliveryId),
    ));
    await db.insert(outboundDeliveryAttemptsTable).values({
      id: randomUUID(),
      tenantId,
      deliveryId,
      attemptNumber: 1,
      provider: "evolution",
      status: "processing",
      startedAt: expiredClaimAt,
    });

    const recoveries = await Promise.all([
      recoverOutboundDeliveries({ databaseFallback: true }),
      recoverOutboundDeliveries({ databaseFallback: true }),
    ]);
    expect(recoveries.map((result) => result.recovered).sort()).toEqual([0, 1]);
    expect(recoveries.reduce(
      (total, result) => ({
        recovered: total.recovered + result.recovered,
        enqueued: total.enqueued + result.enqueued,
        inlineAttempted: total.inlineAttempted + result.inlineAttempted,
      }),
      { recovered: 0, enqueued: 0, inlineAttempted: 0 },
    )).toEqual({
      recovered: 1,
      enqueued: 0,
      inlineAttempted: 0,
    });
    expect(mockWhatsAppSend).not.toHaveBeenCalled();
    expect(mockReconcileWhatsAppMessage).not.toHaveBeenCalled();

    const deliveries = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.outboundMessageId, created.message.id),
    ));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      id: deliveryId,
      status: "unknown",
      provider: "evolution",
      attempts: 1,
      claimedAt: null,
      lastError: "delivery_result_unknown",
    });
    const attempts = await db.select().from(outboundDeliveryAttemptsTable).where(and(
      eq(outboundDeliveryAttemptsTable.tenantId, tenantId),
      eq(outboundDeliveryAttemptsTable.deliveryId, deliveryId),
    ));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      attemptNumber: 1,
      provider: "evolution",
      status: "unknown",
      error: "delivery_result_unknown",
      completedAt: expect.any(Date),
    });
  });

  it("rolls back both recovery writes when closing the attempt fails, then recovers without sending", async () => {
    mockWhatsAppSend.mockClear();
    mockReconcileWhatsAppMessage.mockClear();
    const created = await createOutboundMessage({
      tenantId,
      eventType: "trip_whatsapp_broadcast",
      idempotencyKey: `trip:trip-test:recovery-rollback:${randomUUID()}:${phone}`,
      recipient: { type: "direct", whatsapp: phone },
      whatsapp: { text: "The worker stopped after starting the provider request" },
      channels: ["whatsapp"],
      origin: "legacy_whatsapp",
      originChannel: "whatsapp",
    });
    expect(created.deliveries).toHaveLength(1);
    const deliveryId = created.deliveries[0]!.id;
    const expiredClaimAt = new Date(Date.now() - 16 * 60 * 1000);

    await db.update(outboundDeliveriesTable).set({
      status: "processing",
      provider: "evolution",
      attempts: 1,
      claimedAt: expiredClaimAt,
      nextAttemptAt: expiredClaimAt,
    }).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.id, deliveryId),
    ));
    await db.insert(outboundDeliveryAttemptsTable).values({
      id: randomUUID(),
      tenantId,
      deliveryId,
      attemptNumber: 1,
      provider: "evolution",
      status: "processing",
      startedAt: expiredClaimAt,
    });

    const triggerSuffix = runId.slice(0, 12);
    const triggerName = `fail_recovery_attempt_${triggerSuffix}`;
    const functionName = `raise_recovery_attempt_error_${triggerSuffix}`;
    try {
      await pool.query(`
        CREATE FUNCTION ${functionName}() RETURNS trigger
        LANGUAGE plpgsql AS $trigger$
        BEGIN
          IF OLD.status = 'processing' AND NEW.status = 'unknown' THEN
            RAISE EXCEPTION 'injected attempt update failure';
          END IF;
          RETURN NEW;
        END;
        $trigger$
      `);
      await pool.query(`
        CREATE TRIGGER ${triggerName}
        BEFORE UPDATE ON outbound_delivery_attempts
        FOR EACH ROW EXECUTE FUNCTION ${functionName}()
      `);

      await expect(recoverOutboundDeliveries({ databaseFallback: true })).resolves.toEqual({
        recovered: 0,
        enqueued: 0,
        inlineAttempted: 0,
      });

      const [deliveryAfterFailure] = await db.select().from(outboundDeliveriesTable).where(and(
        eq(outboundDeliveriesTable.tenantId, tenantId),
        eq(outboundDeliveriesTable.id, deliveryId),
      ));
      const attemptsAfterFailure = await db.select().from(outboundDeliveryAttemptsTable).where(and(
        eq(outboundDeliveryAttemptsTable.tenantId, tenantId),
        eq(outboundDeliveryAttemptsTable.deliveryId, deliveryId),
      ));
      expect(deliveryAfterFailure).toMatchObject({
        status: "processing",
        attempts: 1,
        claimedAt: expiredClaimAt,
      });
      expect(attemptsAfterFailure).toHaveLength(1);
      expect(attemptsAfterFailure[0]).toMatchObject({
        attemptNumber: 1,
        status: "processing",
        completedAt: null,
      });
      expect(mockWhatsAppSend).not.toHaveBeenCalled();
      expect(mockReconcileWhatsAppMessage).not.toHaveBeenCalled();
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON outbound_delivery_attempts`);
      await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }

    await expect(recoverOutboundDeliveries({ databaseFallback: true })).resolves.toEqual({
      recovered: 1,
      enqueued: 0,
      inlineAttempted: 0,
    });
    expect(mockWhatsAppSend).not.toHaveBeenCalled();
    expect(mockReconcileWhatsAppMessage).not.toHaveBeenCalled();

    const deliveries = await db.select().from(outboundDeliveriesTable).where(and(
      eq(outboundDeliveriesTable.tenantId, tenantId),
      eq(outboundDeliveriesTable.outboundMessageId, created.message.id),
    ));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({
      id: deliveryId,
      status: "unknown",
      attempts: 1,
      claimedAt: null,
      lastError: "delivery_result_unknown",
    });
    const attempts = await db.select().from(outboundDeliveryAttemptsTable).where(and(
      eq(outboundDeliveryAttemptsTable.tenantId, tenantId),
      eq(outboundDeliveryAttemptsTable.deliveryId, deliveryId),
    ));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      attemptNumber: 1,
      status: "unknown",
      error: "delivery_result_unknown",
      completedAt: expect.any(Date),
    });
  });
});
