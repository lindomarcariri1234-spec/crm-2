/**
 * Referral bonus tests:
 *   POST /api/referrals/:id/pay-bonus  — marks bonusPaid, sends email, guards duplicates/role/status/missing
 *   GET  /api/referrals                — JOIN-enriched response: live referrerName/Email/Whatsapp from clientsTable
 *   GET  /api/referrals/stats          — filtered global aggregates
 */

import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before any vi.mock factory runs
// ---------------------------------------------------------------------------

const {
  mockSendEmail,
  mockDispatchOutboundMessage,
  mockReversePaidReferralBonus,
  mockDispatchReferralReversedEmail,
  capturedUpdates,
  updateMocks,
} = vi.hoisted(() => {
  const capturedUpdates: Array<{ set: Record<string, unknown> }> = [];
  const returning = vi.fn().mockResolvedValue([{ id: "ref-001" }]);
  const where = vi.fn().mockImplementation(() => ({ returning }));
  const set = vi.fn().mockImplementation((s: Record<string, unknown>) => {
    capturedUpdates.push({ set: s });
    return { where, returning };
  });
  const update = vi.fn().mockImplementation(() => ({ set }));
  const mockDispatchOutboundMessage = vi.fn().mockResolvedValue({
    message: { id: "outbound-1", status: "accepted" },
    created: true,
    deliveries: [
      { id: "delivery-email", channel: "email", status: "accepted", externalId: "msg-001" },
      { id: "delivery-whatsapp", channel: "whatsapp", status: "accepted", externalId: "wa-001" },
    ],
  });
  return {
    mockSendEmail: vi.fn(),
    mockDispatchOutboundMessage,
    mockReversePaidReferralBonus: vi.fn(),
    mockDispatchReferralReversedEmail: vi.fn().mockResolvedValue(undefined),
    capturedUpdates,
    updateMocks: { update, set, where, returning },
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/email", () => ({
  sendReminderHtmlEmail: mockSendEmail,
  // Mock sendReferralBonusPaidEmail to call the sendReminderHtmlEmail spy directly.
  // Both functions live in the same service.ts file, so vi.importActual cannot intercept
  // the internal call. We replicate the contract (to, fromName, html with formatted amount).
  sendReferralBonusPaidEmail: vi.fn().mockImplementation(
    async (props: { referrerEmail: string; agencyName: string; bonusAmount: number }) => {
      const formatted = Number(props.bonusAmount).toFixed(2).replace(".", ",");
      return mockSendEmail({ to: props.referrerEmail, fromName: props.agencyName, html: `R$ ${formatted}` });
    },
  ),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    update: updateMocks.update,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
  },
  referralsTable:        {
    id: "id", tenantId: "tenant_id", code: "code", status: "status", bonusAmount: "bonus_amount",
    referrerId: "referrer_id", bonusPaid: "bonus_paid", fraudFlag: "fraud_flag",
    expiresAt: "expires_at", bonusReleaseNotifiedAt: "bonus_release_notified_at",
    referrerName: "referrer_name", referredEmail: "referred_email", referredName: "referred_name",
  },
  clientsTable:          { id: "id", tenantId: "tenant_id", referralCodeStatus: "referral_code_status", name: "name", email: "email" },
  tenantsTable:          { id: "id", settings: "settings" },
  referralSettingsTable: { tenantId: "tenant_id", tiersConfig: "tiers_config" },
  referralTrackingTable: {},
  referralCampaignsTable: {},
  emailLogsTable: {
    id: "id",
    tenantId: "tenant_id",
    referralId: "referral_id",
    notificationType: "notification_type",
    status: "status",
    errorMessage: "error_message",
    createdAt: "created_at",
  },
  reservationsTable: {},
  storeOrdersTable: {},
  paymentsTable: {},
  dealsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq:              vi.fn(() => "eq"),
  and:             vi.fn((...a: unknown[]) => a),
  or:              vi.fn((...a: unknown[]) => a),
  desc:            vi.fn(() => "desc"),
  asc:             vi.fn(() => "asc"),
  ilike:           vi.fn(() => "ilike"),
  count:           vi.fn(() => "count"),
  inArray:         vi.fn(() => "inArray"),
  isNull:          vi.fn(() => "isNull"),
  isNotNull:       vi.fn(() => "isNotNull"),
  gte:             vi.fn(() => "gte"),
  lte:             vi.fn(() => "lte"),
  sql:             Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
  getTableColumns: vi.fn(() => ({})),
}));

vi.mock("@clerk/express", () => ({
  clerkClient:      vi.fn(),
  getAuth:          vi.fn(() => ({ userId: "user-test" })),
  clerkMiddleware:  () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth:       vi.fn(),
  ADMIN_ROLES:       [ROLES.AGENCY_ADMIN, ROLES.SUPER_ADMIN],
  MANAGEMENT_ROLES:  [ROLES.AGENCY_ADMIN, ROLES.SUPER_ADMIN],
  ALL_STAFF_ROLES:   [ROLES.AGENCY_ADMIN, ROLES.SUPER_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SALES, ROLES.SUPPORT],
}));

vi.mock("../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("../lib/id.js", () => ({ generateId: vi.fn(() => "gen-id") }));

vi.mock("../queues/index.js", () => ({
  getEmailQueue: vi.fn().mockReturnValue(null),
  getCancellationEmailQueue: vi.fn().mockReturnValue(null),
  getNewBookingNotificationEmailQueue: vi.fn().mockReturnValue(null),
  getReferralEmailQueue: vi.fn().mockReturnValue(null),
}));

vi.mock("../queues/email-helpers.js", () => ({
  enqueueReferralBonusPaidEmail: vi.fn(async (
    props: { referrerName: string; referrerEmail: string; bonusAmount: number; agencyName: string },
    tenantId: string,
    clientId: string,
    referralId: string,
  ) => mockDispatchOutboundMessage({
    tenantId,
    eventType: "bonus_paid",
    idempotencyKey: `referral:${clientId}:bonus_paid`,
    recipient: { type: "client", id: clientId },
    email: { subject: `Seu bônus de indicação foi pago! — ${props.agencyName}`, html: `<p>${props.referrerName}: ${props.bonusAmount}</p>` },
    whatsapp: { text: `Bônus pago: ${props.bonusAmount}` },
    origin: "referral-bonus_paid",
    metadata: { referralId },
  })),
  dispatchReferralReversedEmail: mockDispatchReferralReversedEmail,
  dispatchReferralExpiringSoonEmail: vi.fn(),
  dispatchReferralBonusReleasedEmail: vi.fn(),
}));

vi.mock("../lib/redis.js", () => ({
  areWorkersEnabled: vi.fn().mockReturnValue(false),
  getRedis: vi.fn().mockReturnValue(null),
}));

vi.mock("../lib/client-notifications.js", () => ({
  insertClientNotification: vi.fn().mockResolvedValue(undefined),
  getRecentNotifications: vi.fn().mockResolvedValue([]),
  getUnreadCount: vi.fn().mockResolvedValue(0),
  markAllRead: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/whatsapp-helpers.js", () => ({
  dispatchWhatsAppReferralBonusPaid: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/outbound-delivery.js", () => ({
  dispatchOutboundMessage: mockDispatchOutboundMessage,
}));

vi.mock("../lib/whatsapp.js", () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true }),
  sendTenantWhatsAppMessage: vi.fn().mockResolvedValue({ success: true }),
  interpolateWhatsAppMessage: vi.fn((template: string) => template),
}));

vi.mock("../lib/referral-tiers.js", () => ({
  DEFAULT_TIERS: [],
  computeReferralTier: vi.fn().mockReturnValue(null),
}));

vi.mock("../services/reservation-referral-conversion.js", () => ({
  reversePaidReferralBonus: mockReversePaidReferralBonus,
}));

// ---------------------------------------------------------------------------
// Import router AFTER mocks
// ---------------------------------------------------------------------------

import { requireAuth } from "../lib/tenant.js";
import { db } from "@workspace/db";
import referralsRouter from "../routes/referrals.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Chain builder — thenable stub for drizzle select chains
// ---------------------------------------------------------------------------

interface DbChain extends PromiseLike<unknown[]> {
  from(table: unknown): DbChain;
  where(...args: unknown[]): DbChain;
  leftJoin(table: unknown, cond: unknown): DbChain;
  orderBy(...cols: unknown[]): DbChain;
  groupBy(...cols: unknown[]): DbChain;
  limit(n: number): DbChain;
  offset(n: number): DbChain;
  returning(...fields: unknown[]): DbChain;
}

function makeChain(data: unknown[]): DbChain {
  const chain: DbChain = {
    then: (resolve, reject) => Promise.resolve(data).then(resolve, reject),
    from:     vi.fn().mockImplementation(() => makeChain(data)),
    where:    vi.fn().mockImplementation(() => makeChain(data)),
    leftJoin: vi.fn().mockImplementation(() => makeChain(data)),
    orderBy:  vi.fn().mockImplementation(() => makeChain(data)),
    groupBy:  vi.fn().mockImplementation(() => makeChain(data)),
    limit:    vi.fn().mockImplementation(() => makeChain(data)),
    offset:   vi.fn().mockImplementation(() => makeChain(data)),
    returning: vi.fn().mockImplementation(() => makeChain(data)),
  } as DbChain;
  return chain;
}

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { log?: unknown }, _res: express.Response, next: express.NextFunction) => {
    const noop = () => {};
    req.log = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop } as never;
    next();
  });
  app.use("/api", referralsRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_ADMIN  = { id: "user-001", tenantId: "tenant-001", role: ROLES.AGENCY_ADMIN, name: "Admin", email: "admin@ag.com" };
const FAKE_MANAGER = { id: "user-manager", tenantId: "tenant-001", role: ROLES.AGENCY_MANAGER, name: "Manager", email: "manager@ag.com" };
const FAKE_VIEWER = { id: "user-002", tenantId: "tenant-001", role: "viewer",            name: "Viewer", email: "viewer@ag.com" };

function makeReferral(overrides: Record<string, unknown> = {}) {
  return {
    id: "ref-001", tenantId: "tenant-001",
    referrerId: "client-001", referredId: "client-002",
    referredEmail: "indicado@example.com", referredName: "José Indicado",
    referrerName: "Maria Stored",  referrerEmail: "maria@stored.com", referrerPhone: "11999990000",
    code: "MARIA2026", status: "completed",
    bonusPaid: false, bonusPaidAt: null, bonusAmount: "50.00",
    discountValue: "5", discountAmount: "25.00", discountApplied: true, discountType: "percentage",
    visitsCount: 3, lastVisit: null,
    convertedAt: new Date("2026-01-15"), expiresAt: new Date("2026-12-31"), isActive: true,
    notes: null, utmSource: null, utmMedium: null, utmCampaign: null,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-15"),
    ...overrides,
  };
}

function makeJoinedRow(overrides: Record<string, unknown> = {}) {
  return {
    ...makeReferral(),
    referrerClientName: "Maria Live", referrerClientEmail: "maria@live.com",
    referrerClientWhatsapp: "11988887777", referrerClientPhone: "11999990001",
    tenantName: "Agência Teste",
    ...overrides,
  };
}

function makeRefetchRow(overrides: Record<string, unknown> = {}) {
  return {
    ...makeReferral(),
    referrerClientName: "Maria Live", referrerClientEmail: "maria@live.com",
    referrerClientWhatsapp: "11988887777", referrerClientPhone: "11999990001",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  capturedUpdates.length = 0;
  updateMocks.where.mockImplementation(() => ({ returning: updateMocks.returning }));
  updateMocks.returning.mockResolvedValue([{ id: "ref-001" }]);
  updateMocks.set.mockImplementation((s: Record<string, unknown>) => {
    capturedUpdates.push({ set: s });
    return { where: updateMocks.where, returning: updateMocks.returning };
  });
  updateMocks.update.mockImplementation(() => ({ set: updateMocks.set }));
  mockSendEmail.mockResolvedValue({ success: true, messageId: "msg-001" });
  mockReversePaidReferralBonus.mockReset();
});

// ---------------------------------------------------------------------------
// POST /api/referrals/:id/pay-bonus
// ---------------------------------------------------------------------------

describe("POST /api/referrals/:id/pay-bonus", () => {
  it("marks bonusPaid=true and records bonusPaidAt for a completed, unpaid referral", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeJoinedRow()]))
      .mockImplementationOnce(() => makeChain([]))                                                      // referralSettings (grace period)
      .mockImplementationOnce(() => makeChain([makeRefetchRow({ bonusPaid: true, bonusPaidAt: new Date() })]));

    const res = await request(buildApp()).post("/api/referrals/ref-001/pay-bonus").send();

    expect(res.status).toBe(200);
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0].set).toMatchObject({ bonusPaid: true });
    expect(capturedUpdates[0].set.bonusPaidAt).toBeInstanceOf(Date);
    expect(capturedUpdates[0].set.updatedAt).toBeInstanceOf(Date);
  });

  it("returns 422 when bonus has already been paid", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeJoinedRow({ bonusPaid: true, bonusPaidAt: new Date() })]));

    const res = await request(buildApp()).post("/api/referrals/ref-001/pay-bonus").send();

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/já foi pago/i);
    expect(capturedUpdates).toHaveLength(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns 422 when referral status is not 'completed'", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeJoinedRow({ status: "pending", bonusPaid: false })]));

    const res = await request(buildApp()).post("/api/referrals/ref-001/pay-bonus").send();

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/convertidas/i);
    expect(capturedUpdates).toHaveLength(0);
  });

  it("returns 422 when a completed referral has no confirmed conversion date", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeJoinedRow({ convertedAt: null, bonusPaid: false })]));

    const res = await request(buildApp()).post("/api/referrals/ref-001/pay-bonus").send();

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("REFERRAL_CONVERSION_STATE");
    expect(capturedUpdates).toHaveLength(0);
  });

  it("creates accepted email and WhatsApp deliveries for the live referrer", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeJoinedRow()]))
      .mockImplementationOnce(() => makeChain([]))                          // referralSettings (grace period)
      .mockImplementationOnce(() => makeChain([makeRefetchRow({ bonusPaid: true })]));

    const res = await request(buildApp()).post("/api/referrals/ref-001/pay-bonus").send();

    expect(res.status).toBe(200);
    expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-001",
      recipient: { type: "client", id: "client-001" },
    }));
    const outbound = await mockDispatchOutboundMessage.mock.results[0].value;
    expect(outbound.deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "email", status: "accepted" }),
      expect.objectContaining({ channel: "whatsapp", status: "accepted" }),
    ]));
  });

  it("skips email and still updates when both live and stored referrerEmail are null", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeJoinedRow({ referrerEmail: null, referrerClientEmail: null })]))
      .mockImplementationOnce(() => makeChain([]))                          // referralSettings (grace period)
      .mockImplementationOnce(() => makeChain([makeRefetchRow({ bonusPaid: true, referrerEmail: null, referrerClientEmail: null })]));

    const res = await request(buildApp()).post("/api/referrals/ref-001/pay-bonus").send();

    expect(res.status).toBe(200);
    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0].set.bonusPaid).toBe(true);
  });

  it("still marks bonus as paid even when email dispatch throws", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    mockDispatchOutboundMessage.mockRejectedValueOnce(new Error("dispatch error"));
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeJoinedRow()]))
      .mockImplementationOnce(() => makeChain([]))                          // referralSettings (grace period)
      .mockImplementationOnce(() => makeChain([makeRefetchRow({ bonusPaid: true })]));

    const res = await request(buildApp()).post("/api/referrals/ref-001/pay-bonus").send();

    expect(res.status).toBe(200);
    expect(capturedUpdates[0].set.bonusPaid).toBe(true);
  });

  it("returns 404 when the referral does not exist", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>).mockImplementationOnce(() => makeChain([]));

    const res = await request(buildApp()).post("/api/referrals/nonexistent/pay-bonus").send();

    expect(res.status).toBe(404);
    expect(capturedUpdates).toHaveLength(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns 403 when caller is not an admin", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_VIEWER);

    const res = await request(buildApp()).post("/api/referrals/ref-001/pay-bonus").send();

    expect(res.status).toBe(403);
    expect(capturedUpdates).toHaveLength(0);
  });

  it("response merges live JOIN data and strips internal JOIN columns", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeJoinedRow()]))
      .mockImplementationOnce(() => makeChain([]))                          // referralSettings (grace period)
      .mockImplementationOnce(() => makeChain([makeRefetchRow({ bonusPaid: true })]));

    const res = await request(buildApp()).post("/api/referrals/ref-001/pay-bonus").send();

    expect(res.status).toBe(200);
    expect(res.body.referrerName).toBe("Maria Live");
    expect(res.body.referrerEmail).toBe("maria@live.com");
    expect(res.body.referrerWhatsapp).toBe("11988887777");
    expect(res.body).not.toHaveProperty("referrerClientName");
    expect(res.body).not.toHaveProperty("referrerClientEmail");
    expect(res.body).not.toHaveProperty("referrerClientWhatsapp");
    expect(res.body).not.toHaveProperty("referrerClientPhone");
    expect(res.body).not.toHaveProperty("tenantName");
  });
});

// ---------------------------------------------------------------------------
// GET /api/referrals/validate/:code — authorization and tenant isolation
// ---------------------------------------------------------------------------

describe("GET /api/referrals/validate/:code", () => {
  it("returns 403 before reading referral data when caller lacks commission view permission", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_VIEWER);

    const res = await request(buildApp()).get("/api/referrals/validate/MARIA2026");

    expect(res.status).toBe(403);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("validates a referral for a staff member with commission view permission", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_MANAGER);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([{ settings: {} }]))
      .mockImplementationOnce(() => makeChain([{
        id: "ref-001",
        bonusAmount: "50.00",
        referrerId: "client-001",
        referrerCodeStatus: "active",
      }]));

    const res = await request(buildApp()).get("/api/referrals/validate/MARIA2026");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      valid: true,
      referralId: "ref-001",
      bonusAmount: 50,
    });
  });

  it("does not expose referral data when the tenant has disabled the program", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_MANAGER);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([{ settings: { referralsEnabled: false } }]));

    const res = await request(buildApp()).get("/api/referrals/validate/MARIA2026");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      valid: false,
      bonusAmount: 0,
      message: "Programa de indicação inativo",
    });
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("returns invalid when the tenant-scoped referral lookup finds no matching row", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_MANAGER);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([{ settings: {} }]))
      // A referral belonging to another tenant is filtered out by the route query.
      .mockImplementationOnce(() => makeChain([]));

    const res = await request(buildApp()).get("/api/referrals/validate/MARIA2026");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      valid: false,
      bonusAmount: 0,
    });
  });
});

describe("GET /api/referrals/stats — filtered global aggregates", () => {
  it("returns operational counts from the full filtered result, not the current page", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([
        { status: "pending", cnt: "2" },
        { status: "completed", cnt: "1" },
      ]))
      .mockImplementationOnce(() => makeChain([{ total: "10.00" }]))
      .mockImplementationOnce(() => makeChain([{ total: "25.00" }]))
      .mockImplementationOnce(() => makeChain([{
        suspicious: "3",
        expiringSoon: "2",
        pendingBonus: "1",
        bonusNotified: "4",
        bonusNotNotified: "1",
      }]))
      .mockImplementationOnce(() => makeChain([]))
      .mockImplementationOnce(() => makeChain([]));

    const res = await request(buildApp()).get(
      "/api/referrals/stats?search=ana&bonusPaid=false&fraudFlag=true&expiringSoon=false&bonusNotified=false",
    );

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 3,
      pending: 2,
      completed: 1,
      suspicious: 3,
      expiringSoon: 2,
      pendingBonus: 1,
      bonusNotified: 4,
      bonusNotNotified: 1,
      totalBonusPaid: 10,
      totalDiscountGiven: 25,
    });
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/referrals/:id — financial state protection
// ---------------------------------------------------------------------------

describe("PATCH /api/referrals/:id — financial state protection", () => {
  it("rejects direct bonus payment edits", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeReferral()]));

    const res = await request(buildApp())
      .patch("/api/referrals/ref-001")
      .send({ bonusPaid: true });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("REFERRAL_PAYMENT_STATE");
    expect(capturedUpdates).toHaveLength(0);
  });

  it("rejects direct conversion and reversal status edits", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeReferral()]));

    const conversionRes = await request(buildApp())
      .patch("/api/referrals/ref-001")
      .send({ convertedAt: "2026-02-01T00:00:00.000Z" });

    expect(conversionRes.status).toBe(422);
    expect(conversionRes.body.code).toBe("REFERRAL_CONVERSION_STATE");

    vi.clearAllMocks();
    capturedUpdates.length = 0;
    updateMocks.returning.mockResolvedValue([{ id: "ref-001" }]);
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeReferral()]));

    const reversalRes = await request(buildApp())
      .patch("/api/referrals/ref-001")
      .send({ status: "reversed" });

    expect(reversalRes.status).toBe(422);
    expect(reversalRes.body.code).toBe("REFERRAL_INVALID_TRANSITION");
    expect(capturedUpdates).toHaveLength(0);
  });

  it("allows only the non-financial pending-to-expired transition", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeReferral({ status: "pending" })]))
      .mockImplementationOnce(() => makeChain([makeReferral({ status: "expired", isActive: false })]));

    const res = await request(buildApp())
      .patch("/api/referrals/ref-001")
      .send({ status: "expired", isActive: false });

    expect(res.status).toBe(200);
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0].set).toMatchObject({ status: "expired", isActive: false });
  });

  it("never leaves an expired referral active", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeReferral({ status: "pending" })]));

    const res = await request(buildApp())
      .patch("/api/referrals/ref-001")
      .send({ status: "expired", isActive: true });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("REFERRAL_INVALID_TRANSITION");
    expect(capturedUpdates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Concurrent payment claim
// ---------------------------------------------------------------------------

describe("POST /api/referrals/:id/pay-bonus — concurrent claim", () => {
  it("sends one delivery when two requests race for the same unpaid bonus", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementation(() => makeChain([makeJoinedRow()]));
    updateMocks.returning
      .mockResolvedValueOnce([{ id: "ref-001" }])
      .mockResolvedValueOnce([]);

    const responses = await Promise.all([
      request(buildApp()).post("/api/referrals/ref-001/pay-bonus").send(),
      request(buildApp()).post("/api/referrals/ref-001/pay-bonus").send(),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(capturedUpdates).toHaveLength(2);
    expect(mockDispatchOutboundMessage).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/referrals/:id/reverse-paid-bonus
// ---------------------------------------------------------------------------

describe("POST /api/referrals/:id/reverse-paid-bonus", () => {
  it("requires financial edit permission before inspecting the confirmation body", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_MANAGER);

    const res = await request(buildApp())
      .post("/api/referrals/ref-001/reverse-paid-bonus")
      .send({ reason: "Correção", confirmed: true });

    expect(res.status).toBe(403);
    expect(mockReversePaidReferralBonus).not.toHaveBeenCalled();
  });

  it("requires an explicit positive confirmation", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);

    const res = await request(buildApp())
      .post("/api/referrals/ref-001/reverse-paid-bonus")
      .send({ reason: "Correção" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("REFERRAL_REVERSAL_CONFIRMATION");
    expect(mockReversePaidReferralBonus).not.toHaveBeenCalled();
  });

  it("passes the trimmed reason and authenticated operator to the financial service", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    mockReversePaidReferralBonus.mockResolvedValue({
      reversalId: "audit-001",
      referralId: "ref-001",
      reservationId: "reservation-001",
      referrerId: "client-001",
      referredId: "client-002",
      bonusAmount: "50.00",
      reason: "Correção financeira",
      alreadyReversed: false,
    });
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeRefetchRow({ status: "reversed", bonusPaid: true })]));

    const res = await request(buildApp())
      .post("/api/referrals/ref-001/reverse-paid-bonus")
      .send({ reason: "  Correção financeira  ", confirmed: true });

    expect(res.status).toBe(200);
    expect(mockReversePaidReferralBonus).toHaveBeenCalledWith(
      "ref-001",
      FAKE_ADMIN.tenantId,
      "Correção financeira",
      FAKE_ADMIN.id,
    );
    expect(mockDispatchReferralReversedEmail).toHaveBeenCalledWith(expect.objectContaining({
      referralId: "ref-001",
      reason: "Correção financeira",
      bonusAmount: "50.00",
    }));
    expect(res.body.reversal).toEqual({
      id: "audit-001",
      amount: "50.00",
      reason: "Correção financeira",
      alreadyApplied: false,
    });
  });

  it("does not notify again when the service reports an idempotent replay", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    mockReversePaidReferralBonus.mockResolvedValue({
      reversalId: "audit-001",
      referralId: "ref-001",
      reservationId: null,
      referrerId: "client-001",
      referredId: null,
      bonusAmount: "50.00",
      reason: "Correção original",
      alreadyReversed: true,
    });
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeRefetchRow({ status: "reversed", bonusPaid: true })]));

    const res = await request(buildApp())
      .post("/api/referrals/ref-001/reverse-paid-bonus")
      .send({ reason: "Tentativa repetida", confirmed: true });

    expect(res.status).toBe(200);
    expect(mockDispatchReferralReversedEmail).not.toHaveBeenCalled();
    expect(res.body.reversal.alreadyApplied).toBe(true);
  });
});

describe("PATCH /api/referrals/:id/reverse", () => {
  it("blocks AGENCY_MANAGER because referral reversal is a financial mutation", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_MANAGER);

    const res = await request(buildApp())
      .patch("/api/referrals/ref-001/reverse")
      .send({ reason: "Correção" });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/referrals — clientsTable JOIN enrichment
// ---------------------------------------------------------------------------

describe("GET /api/referrals — clientsTable JOIN enrichment", () => {
  it("referrerWhatsapp comes from clientsTable via JOIN, stripped from internal columns", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    const row = { ...makeReferral(), referrerClientName: "Maria Live", referrerClientEmail: "maria@live.com", referrerClientWhatsapp: "11977776666", referrerClientPhone: "11988880000" };
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([{ total: "1" }]))
      .mockImplementationOnce(() => makeChain([row]))
      .mockImplementationOnce(() => makeChain([]))     // tracking backfill query
      .mockImplementationOnce(() => makeChain([]))     // referralSettings (gracePeriodDays)
      .mockImplementationOnce(() => makeChain([]));    // pending store-order lookup

    const res = await request(buildApp()).get("/api/referrals").send();

    expect(res.status).toBe(200);
    const item = ((res.body.data ?? res.body) as Record<string, unknown>[])[0];
    expect(item.referrerWhatsapp).toBe("11977776666");
    expect(item).not.toHaveProperty("referrerClientWhatsapp");
    expect(item).not.toHaveProperty("referrerClientName");
    expect(item).not.toHaveProperty("referrerClientEmail");
    expect(item).not.toHaveProperty("referrerClientPhone");
  });

  it("referrerEmail and referrerName are overridden by live clientsTable values when JOIN matches", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    const row = { ...makeReferral({ referrerEmail: "stale@old.com", referrerName: "Nome Antigo" }), referrerClientName: "Nome Novo", referrerClientEmail: "novo@live.com", referrerClientWhatsapp: null, referrerClientPhone: null };
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([{ total: "1" }]))
      .mockImplementationOnce(() => makeChain([row]))
      .mockImplementationOnce(() => makeChain([]))     // tracking backfill query
      .mockImplementationOnce(() => makeChain([]))     // referralSettings (gracePeriodDays)
      .mockImplementationOnce(() => makeChain([]));    // pending store-order lookup

    const res = await request(buildApp()).get("/api/referrals").send();

    expect(res.status).toBe(200);
    const item = ((res.body.data ?? res.body) as Record<string, unknown>[])[0];
    expect(item.referrerEmail).toBe("novo@live.com");
    expect(item.referrerName).toBe("Nome Novo");
  });

  it("falls back to stored snapshot when LEFT JOIN misses (null client columns)", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    const row = { ...makeReferral({ referrerName: "Fallback", referrerEmail: "stored@fallback.com", referrerPhone: "11911112222" }), referrerClientName: null, referrerClientEmail: null, referrerClientWhatsapp: null, referrerClientPhone: null };
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([{ total: "1" }]))
      .mockImplementationOnce(() => makeChain([row]))
      .mockImplementationOnce(() => makeChain([]))     // tracking backfill query
      .mockImplementationOnce(() => makeChain([]))     // referralSettings (gracePeriodDays)
      .mockImplementationOnce(() => makeChain([]));    // pending store-order lookup

    const res = await request(buildApp()).get("/api/referrals").send();

    expect(res.status).toBe(200);
    const item = ((res.body.data ?? res.body) as Record<string, unknown>[])[0];
    expect(item.referrerName).toBe("Fallback");
    expect(item.referrerEmail).toBe("stored@fallback.com");
    expect(item.referrerPhone).toBe("11911112222");
    expect(item.referrerWhatsapp).toBeNull();
  });

  it("returns pagination metadata from the count query", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([{ total: "42" }]))
      .mockImplementationOnce(() => makeChain([]))   // rows (empty → no tracking)
      .mockImplementationOnce(() => makeChain([]));  // referralSettings (gracePeriodDays)

    const res = await request(buildApp()).get("/api/referrals?page=2&limit=10").send();

    expect(res.status).toBe(200);
    expect(res.body.pagination).toMatchObject({ page: 2, limit: 10, total: 42, totalPages: 5 });
  });
});

describe("POST /api/referral-settings/test-whatsapp — canonical test endpoint", () => {
  it("uses the explicit test destination while keeping the canonical request contract", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([{ whatsappPhoneNumber: "5511888888888", bonusValue: "25" }]))
      .mockImplementationOnce(() => makeChain([{ name: "Agência Teste" }]));

    const res = await request(buildApp())
      .post("/api/referral-settings/test-whatsapp")
      .set("Idempotency-Key", "attempt-explicit-001")
      .send({
        type: "converted",
        message: "Olá {nome}, seu código é {codigo}.",
        phone: " 5511999999999 ",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      recipient: { type: "direct", whatsapp: "5511999999999" },
    }));
  });

  it("falls back to the configured agency number when no explicit destination is sent", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([{ whatsappPhoneNumber: "5511888888888", bonusValue: "25" }]))
      .mockImplementationOnce(() => makeChain([{ name: "Agência Teste" }]));

    const res = await request(buildApp())
      .post("/api/referral-settings/test-whatsapp")
      .set("Idempotency-Key", "attempt-configured-001")
      .send({ type: "share", message: "Use o código {codigo}." });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      recipient: { type: "direct", whatsapp: "5511888888888" },
    }));
  });

  it("does not keep the legacy duplicate endpoint registered", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);

    const res = await request(buildApp())
      .post("/api/referral-settings/whatsapp-test")
      .set("Idempotency-Key", "legacy-route-001")
      .send({ phone: "5511999999999", messageType: "share" });

    expect(res.status).toBe(404);
    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
  });

  it("resolves D-7 and D-1 status by notification type, not translated subject", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([{ id: "ref-001" }]))
      .mockImplementationOnce(() => makeChain([
        { id: "log-d1", notificationType: "expiry_warning_1", status: "failed", errorMessage: "provider unavailable", createdAt: new Date("2026-09-02") },
        { id: "log-d7", notificationType: "expiry_warning_7", status: "sent", errorMessage: null, createdAt: new Date("2026-09-01") },
        { id: "legacy", notificationType: null, status: "sent", errorMessage: null, createdAt: new Date("2026-09-03") },
      ]));

    const res = await request(buildApp())
      .get("/api/referrals/ref-001/expiry-email-status");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      d7: { status: "sent", errorMessage: null, sentAt: "2026-09-01T00:00:00.000Z" },
      d1: { status: "failed", errorMessage: "Não foi possível enviar a notificação.", sentAt: "2026-09-02T00:00:00.000Z" },
    });
  });

  it("resolves bonus-release status by the persisted notification type", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([{ code: "JOAO123", referrerClientEmail: "joao@example.com" }]))
      .mockImplementationOnce(() => makeChain([
        { id: "log-bonus", notificationType: "bonus_released", status: "sent", errorMessage: null, createdAt: new Date("2026-09-04") },
      ]));

    const res = await request(buildApp())
      .get("/api/referrals/ref-001/bonus-release-email-status");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      bonusRelease: { status: "sent", errorMessage: null, sentAt: "2026-09-04T00:00:00.000Z" },
    });
  });

  it("reuses the request key for repeated clicks while allowing a later attempt to get a new key", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementation(() => makeChain([{ whatsappPhoneNumber: "5511888888888", bonusValue: "25" }, { name: "Agência Teste" }]));

    const first = await request(buildApp())
      .post("/api/referral-settings/test-whatsapp")
      .set("Idempotency-Key", "attempt-share-001")
      .send({ type: "share", message: "Use o código {codigo}." });
    const repeated = await request(buildApp())
      .post("/api/referral-settings/test-whatsapp")
      .set("Idempotency-Key", "attempt-share-001")
      .send({ type: "share", message: "Use o código {codigo}." });
    const later = await request(buildApp())
      .post("/api/referral-settings/test-whatsapp")
      .set("Idempotency-Key", "attempt-share-002")
      .send({ type: "share", message: "Use o código {codigo}." });

    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(later.status).toBe(200);
    expect(mockDispatchOutboundMessage).toHaveBeenCalledTimes(3);
    expect(mockDispatchOutboundMessage.mock.calls.map(([input]) => (input as { idempotencyKey: string }).idempotencyKey))
      .toEqual([
        "referral-test-whatsapp:attempt-share-001",
        "referral-test-whatsapp:attempt-share-001",
        "referral-test-whatsapp:attempt-share-002",
      ]);
  });

  it("requires an idempotency key before contacting the provider", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);

    const res = await request(buildApp())
      .post("/api/referral-settings/test-whatsapp")
      .send({ type: "share", message: "Use o código {codigo}." });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "idempotency_key_required" });
    expect(mockDispatchOutboundMessage).not.toHaveBeenCalled();
  });
});
