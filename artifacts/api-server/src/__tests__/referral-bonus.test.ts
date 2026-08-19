/**
 * Referral bonus tests:
 *   POST /api/referrals/:id/pay-bonus  — marks bonusPaid, sends email, guards duplicates/role/status/missing
 *   GET  /api/referrals                — JOIN-enriched response: live referrerName/Email/Whatsapp from clientsTable
 */

import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before any vi.mock factory runs
// ---------------------------------------------------------------------------

const { mockSendEmail, capturedUpdates, updateMocks } = vi.hoisted(() => {
  const capturedUpdates: Array<{ set: Record<string, unknown> }> = [];
  const where = vi.fn().mockResolvedValue([]);
  const set = vi.fn().mockImplementation((s: Record<string, unknown>) => {
    capturedUpdates.push({ set: s });
    return { where };
  });
  const update = vi.fn().mockImplementation(() => ({ set }));
  return { mockSendEmail: vi.fn(), capturedUpdates, updateMocks: { update, set, where } };
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
  referralsTable:        { id: "id", tenantId: "tenant_id", bonusPaid: "bonus_paid" },
  clientsTable:          { id: "id", tenantId: "tenant_id" },
  tenantsTable:          { id: "id" },
  referralSettingsTable: {},
  referralTrackingTable: {},
  referralCampaignsTable: {},
  emailLogsTable: {},
  reservationsTable: {},
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

vi.mock("../lib/whatsapp.js", () => ({
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ success: true }),
  sendTenantWhatsAppMessage: vi.fn().mockResolvedValue({ success: true }),
  interpolateWhatsAppMessage: vi.fn((template: string) => template),
}));

vi.mock("../lib/referral-tiers.js", () => ({
  DEFAULT_TIERS: [],
  computeReferralTier: vi.fn().mockReturnValue(null),
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
  updateMocks.where.mockResolvedValue([]);
  updateMocks.set.mockImplementation((s: Record<string, unknown>) => {
    capturedUpdates.push({ set: s });
    return { where: updateMocks.where };
  });
  updateMocks.update.mockImplementation(() => ({ set: updateMocks.set }));
  mockSendEmail.mockResolvedValue({ success: true, messageId: "msg-001" });
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

  it("sends email to the live JOIN email (clientsTable), not the stored snapshot", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeJoinedRow()]))
      .mockImplementationOnce(() => makeChain([]))                          // referralSettings (grace period)
      .mockImplementationOnce(() => makeChain([makeRefetchRow({ bonusPaid: true })]));

    await request(buildApp()).post("/api/referrals/ref-001/pay-bonus").send();

    expect(mockSendEmail).toHaveBeenCalledOnce();
    const args = mockSendEmail.mock.calls[0][0] as Record<string, string>;
    expect(args.to).toBe("maria@live.com");
    expect(args.fromName).toBe("Agência Teste");
    expect(args.html).toContain("50,00");
  });

  it("skips email and still updates when both live and stored referrerEmail are null", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeJoinedRow({ referrerEmail: null, referrerClientEmail: null })]))
      .mockImplementationOnce(() => makeChain([]))                          // referralSettings (grace period)
      .mockImplementationOnce(() => makeChain([makeRefetchRow({ bonusPaid: true, referrerEmail: null, referrerClientEmail: null })]));

    const res = await request(buildApp()).post("/api/referrals/ref-001/pay-bonus").send();

    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0].set.bonusPaid).toBe(true);
  });

  it("still marks bonus as paid even when email dispatch throws", async () => {
    (requireAuth as ReturnType<typeof vi.fn>).mockResolvedValue(FAKE_ADMIN);
    mockSendEmail.mockRejectedValueOnce(new Error("SMTP error"));
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
      .mockImplementationOnce(() => makeChain([]));    // referralSettings (gracePeriodDays)

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
      .mockImplementationOnce(() => makeChain([]));    // referralSettings (gracePeriodDays)

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
      .mockImplementationOnce(() => makeChain([]));    // referralSettings (gracePeriodDays)

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
