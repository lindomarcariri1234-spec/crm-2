/**
 * Real PostgreSQL concurrency coverage for referral bonus payments.
 *
 * The requests use separate connections from the pool. Both may read the
 * completed referral before either payment claim runs, but PostgreSQL must
 * serialize the conditional UPDATE so only one request can claim it.
 *
 * The referral email helper owns the multichannel ledger. A successful claim
 * therefore creates exactly one outbound message with one email and one
 * WhatsApp delivery; the losing request must not create any delivery.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  emailLogsTable,
  outboundDeliveriesTable,
  outboundDeliveryAttemptsTable,
  outboundMessagesTable,
  referralsTable,
  referralSettingsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { REFERRAL_STATUS, ROLES } from "@workspace/permissions";

const { mockRequireAuth } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  getTenantUser: vi.fn(),
  ADMIN_ROLES: [ROLES.AGENCY_ADMIN, ROLES.SUPER_ADMIN],
  MANAGEMENT_ROLES: [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SUPER_ADMIN],
  ALL_STAFF_ROLES: [
    ROLES.AGENCY_ADMIN,
    ROLES.AGENCY_MANAGER,
    ROLES.SUPPORT,
    ROLES.SALES,
    ROLES.SUPER_ADMIN,
  ],
}));

vi.mock("../queues/index.js", async () => {
  const actual = await vi.importActual<typeof import("../queues/index.js")>("../queues/index.js");
  return {
    ...actual,
    getReferralEmailQueue: vi.fn().mockReturnValue(null),
    getOutboundDeliveryQueue: vi.fn().mockReturnValue(null),
  };
});

vi.mock("../lib/redis.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/redis.js")>("../lib/redis.js");
  return {
    ...actual,
    areWorkersEnabled: vi.fn().mockReturnValue(false),
    getRedis: vi.fn().mockReturnValue(null),
  };
});

vi.mock("@workspace/email", async () => {
  const actual = await vi.importActual<typeof import("@workspace/email")>("@workspace/email");
  return {
    ...actual,
    sendReminderHtmlEmail: vi.fn().mockResolvedValue({
      success: true,
      messageId: "integration-email-message",
    }),
  };
});

vi.mock("../lib/whatsapp.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/whatsapp.js")>("../lib/whatsapp.js");
  return {
    ...actual,
    sendTenantWhatsAppMessage: vi.fn().mockResolvedValue({
      success: true,
      externalId: "integration-whatsapp-message",
      provider: "integration-test",
    }),
  };
});

vi.mock("../services/reservation-referral-conversion.js", () => ({
  reversePaidReferralBonus: vi.fn(),
}));

import referralsRouter from "../routes/referrals.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const RUN = randomUUID().replaceAll("-", "").slice(0, 10);
const TENANT_ID = `rpc-tenant-${RUN}`;
const USER_ID = `rpc-user-${RUN}`;
const REFERRER_ID = `rpc-referrer-${RUN}`;
const REFERRED_ID = `rpc-referred-${RUN}`;
const REFERRAL_ID = `rpc-referral-${RUN}`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, () => void> }).log = {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
    };
    next();
  });
  app.use("/api", referralsRouter);
  app.use(errorHandler);
  return app;
}

async function clearPaymentsAndDeliveries() {
  await db.delete(emailLogsTable).where(eq(emailLogsTable.tenantId, TENANT_ID));
  await db.delete(outboundDeliveryAttemptsTable).where(eq(outboundDeliveryAttemptsTable.tenantId, TENANT_ID));
  await db.delete(outboundDeliveriesTable).where(eq(outboundDeliveriesTable.tenantId, TENANT_ID));
  await db.delete(outboundMessagesTable).where(eq(outboundMessagesTable.tenantId, TENANT_ID));
  await db.delete(referralsTable).where(eq(referralsTable.tenantId, TENANT_ID));
}

async function resetReferral() {
  await clearPaymentsAndDeliveries();
  await db.update(clientsTable)
    .set({
      successfulReferrals: 0,
      referralEarnings: "0.00",
    })
    .where(and(eq(clientsTable.id, REFERRER_ID), eq(clientsTable.tenantId, TENANT_ID)));
  await db.insert(referralsTable).values({
    id: REFERRAL_ID,
    tenantId: TENANT_ID,
    referrerId: REFERRER_ID,
    referredId: REFERRED_ID,
    referrerName: "Stored Referrer",
    referrerEmail: `rpc-referrer-${RUN}@example.com`,
    code: `RPC-CODE-${RUN}`,
    status: REFERRAL_STATUS.COMPLETED,
    bonusAmount: "25.00",
    convertedAt: new Date("2026-01-01T12:00:00.000Z"),
  });
}

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL must be set to run the referral payment concurrency integration test");
  }

  mockRequireAuth.mockResolvedValue({
    id: USER_ID,
    tenantId: TENANT_ID,
    role: ROLES.AGENCY_ADMIN,
    name: "Referral payment integration tester",
    email: `rpc-user-${RUN}@example.com`,
  });

  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "Referral payment integration agency",
    slug: `rpc-${RUN}`,
    email: `rpc-agency-${RUN}@example.com`,
  });
  await db.insert(usersTable).values({
    id: USER_ID,
    clerkId: `rpc-clerk-${RUN}`,
    tenantId: TENANT_ID,
    name: "Referral payment integration tester",
    email: `rpc-user-${RUN}@example.com`,
    role: ROLES.AGENCY_ADMIN,
    referralCode: `RPC-USER-${RUN}`,
  });
  await db.insert(clientsTable).values([
    {
      id: REFERRER_ID,
      tenantId: TENANT_ID,
      name: "Live Referrer",
      email: `rpc-referrer-${RUN}@example.com`,
      whatsapp: "85999990001",
      createdById: USER_ID,
    },
    {
      id: REFERRED_ID,
      tenantId: TENANT_ID,
      name: "Referred Customer",
      email: `rpc-referred-${RUN}@example.com`,
      whatsapp: "85999990002",
      createdById: USER_ID,
    },
  ]);
  await db.insert(referralSettingsTable).values({
    id: `rpc-settings-${RUN}`,
    tenantId: TENANT_ID,
    gracePeriodDays: 30,
    whatsappEnabled: true,
  });
});

beforeEach(async () => {
  await resetReferral();
});

afterAll(async () => {
  await clearPaymentsAndDeliveries();
  await db.delete(referralSettingsTable).where(eq(referralSettingsTable.tenantId, TENANT_ID));
  await db.delete(clientsTable).where(eq(clientsTable.tenantId, TENANT_ID));
  await db.delete(usersTable).where(eq(usersTable.tenantId, TENANT_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

describe("referral bonus payment under concurrent requests — real PostgreSQL", () => {
  it("claims once and creates only one email and WhatsApp delivery", async () => {
    const app = buildApp();

    const responses = await Promise.all([
      request(app).post(`/api/referrals/${REFERRAL_ID}/pay-bonus`).send(),
      request(app).post(`/api/referrals/${REFERRAL_ID}/pay-bonus`).send(),
    ]);

    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    const loser = responses.find((response) => response.status !== 200);
    expect(loser).toBeDefined();
    // Depending on which request observes the committed row first, the loser
    // either fails the early paid-state guard (422) or reaches the guarded
    // UPDATE after the winner (409). Both outcomes are safe no-ops.
    expect([409, 422]).toContain(loser!.status);

    const [referral] = await db.select({
      bonusPaid: referralsTable.bonusPaid,
      bonusPaidAt: referralsTable.bonusPaidAt,
    }).from(referralsTable).where(eq(referralsTable.id, REFERRAL_ID));
    expect(referral?.bonusPaid).toBe(true);
    expect(referral?.bonusPaidAt).toBeTruthy();

    const messages = await db.select({
      id: outboundMessagesTable.id,
      eventType: outboundMessagesTable.eventType,
      idempotencyKey: outboundMessagesTable.idempotencyKey,
    }).from(outboundMessagesTable).where(and(
      eq(outboundMessagesTable.tenantId, TENANT_ID),
      eq(outboundMessagesTable.eventType, "bonus_paid"),
    ));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.idempotencyKey).toBe(`referral:${REFERRER_ID}:bonus_paid`);

    const deliveries = await db.select({
      channel: outboundDeliveriesTable.channel,
      outboundMessageId: outboundDeliveriesTable.outboundMessageId,
      status: outboundDeliveriesTable.status,
    }).from(outboundDeliveriesTable).where(eq(outboundDeliveriesTable.tenantId, TENANT_ID));
    expect(deliveries).toHaveLength(2);
    expect(deliveries.map((delivery) => delivery.channel).sort()).toEqual(["email", "whatsapp"]);
    expect(new Set(deliveries.map((delivery) => delivery.outboundMessageId))).toEqual(new Set([messages[0]!.id]));
    expect(deliveries.every((delivery) => delivery.status === "accepted")).toBe(true);

    const emailLogs = await db.select({
      outboundMessageId: emailLogsTable.outboundMessageId,
      referralId: emailLogsTable.referralId,
    }).from(emailLogsTable).where(and(
      eq(emailLogsTable.tenantId, TENANT_ID),
      eq(emailLogsTable.referralId, REFERRAL_ID),
    ));
    expect(emailLogs).toEqual([{
      outboundMessageId: messages[0]!.id,
      referralId: REFERRAL_ID,
    }]);
  });
});