/**
 * Unit tests for processReferralBonusReleaseNotifications (reminder.worker.ts)
 *
 * Scenarios:
 *   (a) sends email and stamps bonusReleaseNotifiedAt when lock period has expired
 *   (b) skips referrals already notified — idempotency (DB filter means they never appear)
 *   (c) skips referrals where bonusPaid = true (DB filter means they never appear)
 *   (d) handles concurrent runs without double-sending via atomic stamp-before-dispatch:
 *       two parallel invocations race; only the one whose UPDATE wins the IS NULL guard
 *       proceeds to dispatch — the other sees an empty RETURNING and skips.
 *
 * Additional edge cases:
 *   - early return when no tenants have referrals enabled
 *   - early return when no released referrals are found
 *   - skips referral when per-tenant bonusReleaseEmailEnabled = false
 *   - continues processing remaining referrals when one throws
 *   - multi-tenant: processes referrals from different tenants in one run
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — defined before any vi.mock factory executes
// ---------------------------------------------------------------------------

const {
  mockDispatchBonusReleased,
  capturedUpdates,
  updateMocks,
} = vi.hoisted(() => {
  const capturedUpdates: Array<{ set: Record<string, unknown> }> = [];
  const returning = vi.fn().mockResolvedValue([{ id: "ref-001" }]);
  const where = vi.fn().mockImplementation(() => ({ returning }));
  const set = vi.fn().mockImplementation((s: Record<string, unknown>) => {
    capturedUpdates.push({ set: s });
    return { where };
  });
  const update = vi.fn().mockImplementation(() => ({ set }));
  return {
    mockDispatchBonusReleased: vi.fn(),
    capturedUpdates,
    updateMocks: { update, set, where, returning },
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    update: updateMocks.update,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
  },
  referralsTable: {
    id: "id",
    tenantId: "tenant_id",
    status: "status",
    bonusPaid: "bonus_paid",
    bonusReleaseNotifiedAt: "bonus_release_notified_at",
    convertedAt: "converted_at",
  },
  referralSettingsTable: {
    tenantId: "tenant_id",
    isEnabled: "is_enabled",
    bonusReleaseEmailEnabled: "bonus_release_email_enabled",
  },
  reservationsTable: {},
  tripsTable: {},
  clientsTable: {},
  tenantsTable: {},
  paymentsTable: {},
  emailLogsTable: {},
  storesTable: {},
  usersTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn((...a: unknown[]) => a),
  or: vi.fn((...a: unknown[]) => a),
  gt: vi.fn(() => "gt"),
  gte: vi.fn(() => "gte"),
  lt: vi.fn(() => "lt"),
  lte: vi.fn(() => "lte"),
  isNull: vi.fn(() => "isNull"),
  isNotNull: vi.fn(() => "isNotNull"),
  not: vi.fn(() => "not"),
  notLike: vi.fn(() => "notLike"),
  like: vi.fn(() => "like"),
  inArray: vi.fn(() => "inArray"),
  exists: vi.fn(() => "exists"),
  desc: vi.fn(() => "desc"),
  asc: vi.fn(() => "asc"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn(() => "sql-raw") }),
}));

vi.mock("@workspace/email", () => ({
  sendReminderHtmlEmail: vi.fn(),
  sendReservationConfirmationEmail: vi.fn(),
  sendReferralExpiringSoonEmail: vi.fn(),
}));

vi.mock("../queues/email-helpers.js", () => ({
  dispatchReferralBonusReleasedEmail: mockDispatchBonusReleased,
  dispatchReferralExpiredEmail: vi.fn(),
  dispatchReferralExpiringSoonEmail: vi.fn(),
  buildEmailPropsFromReservation: vi.fn(),
}));

vi.mock("../lib/redis.js", () => ({
  getRedisConnection: vi.fn(() => null),
  isTransientRedisError: vi.fn(() => false),
  recordTransientRedisError: vi.fn(),
  resetTransientRedisErrors: vi.fn(),
}));

vi.mock("../lib/expired-reservations.js", () => ({
  runExpiredReservationsCron: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../lib/id.js", () => ({ generateId: vi.fn(() => "gen-id") }));

vi.mock("../lib/email-retry-constants.js", () => ({
  MAX_AUTO_RETRY_ATTEMPTS: 3,
}));

vi.mock("@workspace/permissions", () => ({
  RESERVATION_STATUS: { CONFIRMED: "confirmed", EXPIRED: "expired", CANCELLED: "cancelled" },
  PAYMENT_STATUS: { PENDING: "pending", PAID: "paid" },
  ROLES: { AGENCY_ADMIN: "agency_admin", AGENCY_MANAGER: "agency_manager", SUPER_ADMIN: "super_admin" },
}));

// ---------------------------------------------------------------------------
// Import the function under test AFTER all mocks are registered
// ---------------------------------------------------------------------------

import { processReferralBonusReleaseNotifications } from "../workers/reminder.worker.js";
import { db } from "@workspace/db";

// ---------------------------------------------------------------------------
// Chain builder — thenable stub for drizzle select chains
// ---------------------------------------------------------------------------

interface DbChain extends PromiseLike<unknown[]> {
  from(table: unknown): DbChain;
  where(...args: unknown[]): DbChain;
  innerJoin(table: unknown, cond: unknown): DbChain;
  leftJoin(table: unknown, cond: unknown): DbChain;
  orderBy(...cols: unknown[]): DbChain;
  limit(n: number): DbChain;
  offset(n: number): DbChain;
}

function makeChain(data: unknown[]): DbChain {
  const chain: DbChain = {
    then: (resolve, reject) => Promise.resolve(data).then(resolve, reject),
    from: vi.fn().mockImplementation(() => makeChain(data)),
    where: vi.fn().mockImplementation(() => makeChain(data)),
    innerJoin: vi.fn().mockImplementation(() => makeChain(data)),
    leftJoin: vi.fn().mockImplementation(() => makeChain(data)),
    orderBy: vi.fn().mockImplementation(() => makeChain(data)),
    limit: vi.fn().mockImplementation(() => makeChain(data)),
    offset: vi.fn().mockImplementation(() => makeChain(data)),
  } as DbChain;
  return chain;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTenantSetting(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-001",
    bonusReleaseEmailEnabled: true,
    ...overrides,
  };
}

function makeReferral(overrides: Record<string, unknown> = {}) {
  return {
    id: "ref-001",
    referrerId: "client-001",
    tenantId: "tenant-001",
    bonusAmount: "50.00",
    convertedAt: new Date("2026-01-01"),
    bonusReleaseNotifiedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  capturedUpdates.length = 0;

  // Default: stamp succeeds (IS NULL guard passes — we won the race)
  updateMocks.returning.mockResolvedValue([{ id: "ref-001" }]);
  updateMocks.where.mockImplementation(() => ({ returning: updateMocks.returning }));
  updateMocks.set.mockImplementation((s: Record<string, unknown>) => {
    capturedUpdates.push({ set: s });
    return { where: updateMocks.where };
  });
  updateMocks.update.mockImplementation(() => ({ set: updateMocks.set }));

  mockDispatchBonusReleased.mockResolvedValue(true);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processReferralBonusReleaseNotifications", () => {

  // (a) Happy path: stamp first, then dispatch email
  it("(a) atomically stamps bonusReleaseNotifiedAt and then dispatches email when lock period has expired", async () => {
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeTenantSetting()]))
      .mockImplementationOnce(() => makeChain([makeReferral()]));

    await processReferralBonusReleaseNotifications();

    // Step 1: auto-release (bonusPaid=true) always runs first
    expect(capturedUpdates).toHaveLength(2);
    expect(capturedUpdates[0].set.bonusPaid).toBe(true);
    expect(capturedUpdates[0].set.bonusPaidAt).toBeInstanceOf(Date);
    // Step 2: email stamp written before dispatch
    expect(capturedUpdates[1].set.bonusReleaseNotifiedAt).toBeInstanceOf(Date);
    expect(capturedUpdates[1].set.updatedAt).toBeInstanceOf(Date);

    // Email dispatched after winning the race
    expect(mockDispatchBonusReleased).toHaveBeenCalledOnce();
    expect(mockDispatchBonusReleased).toHaveBeenCalledWith(
      "client-001",
      "tenant-001",
      50,
      expect.any(String),
      "ref-001",
    );
  });

  // (a) Verify the atomic update WHERE clause includes the IS NULL guard
  it("(a) update WHERE clause includes the IS NULL guard on bonusReleaseNotifiedAt", async () => {
    const { isNull } = await import("drizzle-orm");

    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeTenantSetting()]))
      .mockImplementationOnce(() => makeChain([makeReferral()]));

    await processReferralBonusReleaseNotifications();

    expect(isNull).toHaveBeenCalledWith(
      expect.anything(), // referralsTable.bonusReleaseNotifiedAt column
    );
  });

  // (b) Idempotency — referrals already notified are filtered out at DB level
  it("(b) skips already-notified referrals — DB returns empty set when bonusReleaseNotifiedAt IS NOT NULL", async () => {
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeTenantSetting()]))
      .mockImplementationOnce(() => makeChain([]));

    await processReferralBonusReleaseNotifications();

    expect(capturedUpdates).toHaveLength(0);
    expect(mockDispatchBonusReleased).not.toHaveBeenCalled();
  });

  // (c) bonusPaid = true — filtered out at DB level, nothing to process
  it("(c) skips referrals where bonusPaid = true — DB returns empty set", async () => {
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeTenantSetting()]))
      .mockImplementationOnce(() => makeChain([]));

    await processReferralBonusReleaseNotifications();

    expect(capturedUpdates).toHaveLength(0);
    expect(mockDispatchBonusReleased).not.toHaveBeenCalled();
  });

  // (d) Concurrency — two parallel invocations race on the same referral.
  //     The atomic IS NULL guard ensures only the first writer's UPDATE returns
  //     a row; the second gets an empty RETURNING and skips dispatch entirely.
  it("(d) concurrent runs: only the run that wins the IS NULL stamp race dispatches the email", async () => {
    // With Promise.all([A(), B()]), both functions run synchronously until their
    // first `await`. Since db.select() calls happen before any await resolves, the
    // actual select call order is deterministic:
    //   call 1: Run A's first select (settings) — happens during A()'s sync start
    //   call 2: Run B's first select (settings) — happens during B()'s sync start
    //   call 3: Run A's second select (referrals) — first microtask resolves for A
    //   call 4: Run B's second select (referrals) — next microtask resolves for B
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeTenantSetting()]))  // Run A call 1
      .mockImplementationOnce(() => makeChain([makeTenantSetting()]))  // Run B call 2
      .mockImplementationOnce(() => makeChain([makeReferral()]))       // Run A call 3
      .mockImplementationOnce(() => makeChain([makeReferral()]));      // Run B call 4

    // returning() call order mirrors the select order with one more level of awaits:
    //   call 1: Run A step 1 auto-release  → non-empty
    //   call 2: Run B step 1 auto-release  → non-empty
    //   call 3: Run A step 2 email stamp   → non-empty (WINNER → dispatches)
    //   call 4: Run B step 2 email stamp   → empty     (LOSER  → skips)
    updateMocks.returning
      .mockResolvedValueOnce([{ id: "ref-001" }])  // Run A step 1
      .mockResolvedValueOnce([{ id: "ref-001" }])  // Run B step 1
      .mockResolvedValueOnce([{ id: "ref-001" }])  // Run A step 2 (winner)
      .mockResolvedValueOnce([]);                  // Run B step 2 (loser)

    // Run two concurrent instances in parallel
    await Promise.all([
      processReferralBonusReleaseNotifications(),
      processReferralBonusReleaseNotifications(),
    ]);

    // Exactly one dispatch — the loser must have skipped
    expect(mockDispatchBonusReleased).toHaveBeenCalledTimes(1);

    // Four returning calls total: 2 step-1 auto-releases + 2 step-2 email stamps
    expect(updateMocks.returning).toHaveBeenCalledTimes(4);
  });

  // Early exit — no tenants with referrals enabled
  it("returns early when no tenants have referrals enabled", async () => {
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([]));

    await processReferralBonusReleaseNotifications();

    expect(capturedUpdates).toHaveLength(0);
    expect(mockDispatchBonusReleased).not.toHaveBeenCalled();
  });

  // Early exit — no referrals have crossed the 30-day lock window
  it("returns early when no referrals are past the lock period", async () => {
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeTenantSetting()]))
      .mockImplementationOnce(() => makeChain([]));

    await processReferralBonusReleaseNotifications();

    expect(capturedUpdates).toHaveLength(0);
    expect(mockDispatchBonusReleased).not.toHaveBeenCalled();
  });

  // Per-tenant toggle — bonusReleaseEmailEnabled = false skips without stamping
  it("skips referral and does NOT stamp when per-tenant bonusReleaseEmailEnabled is false", async () => {
    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeTenantSetting({ bonusReleaseEmailEnabled: false })]))
      .mockImplementationOnce(() => makeChain([makeReferral()]));

    await processReferralBonusReleaseNotifications();

    // Step 1 (auto-release) always runs regardless of email toggle
    expect(capturedUpdates).toHaveLength(1);
    expect(capturedUpdates[0].set.bonusPaid).toBe(true);
    // Step 2 (email stamp) is skipped because bonusReleaseEmailEnabled = false
    expect(mockDispatchBonusReleased).not.toHaveBeenCalled();
  });

  // Resilience — error for one referral does not block others
  it("continues processing remaining referrals when one throws an error", async () => {
    const ref1 = makeReferral({ id: "ref-001" });
    const ref2 = makeReferral({ id: "ref-002", referrerId: "client-002" });

    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => makeChain([makeTenantSetting()]))
      .mockImplementationOnce(() => makeChain([ref1, ref2]));

    // First stamp throws; second succeeds
    updateMocks.returning
      .mockRejectedValueOnce(new Error("DB connection lost"))
      .mockResolvedValueOnce([{ id: "ref-002" }]);

    await processReferralBonusReleaseNotifications();

    // ref1 threw on stamp — no dispatch for it; ref2 succeeded — one dispatch
    expect(mockDispatchBonusReleased).toHaveBeenCalledTimes(1);
    expect(mockDispatchBonusReleased).toHaveBeenCalledWith(
      "client-002",
      expect.any(String),
      expect.any(Number),
      expect.any(String),
      "ref-002",
    );
  });

  // Multiple referrals from different tenants in a single run
  it("processes referrals from multiple tenants in one run", async () => {
    updateMocks.returning
      .mockResolvedValueOnce([{ id: "ref-001" }])
      .mockResolvedValueOnce([{ id: "ref-002" }]);

    (db.select as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() =>
        makeChain([
          makeTenantSetting({ tenantId: "tenant-001" }),
          makeTenantSetting({ tenantId: "tenant-002" }),
        ]),
      )
      .mockImplementationOnce(() =>
        makeChain([
          makeReferral({ id: "ref-001", tenantId: "tenant-001" }),
          makeReferral({ id: "ref-002", tenantId: "tenant-002", referrerId: "client-002" }),
        ]),
      );

    await processReferralBonusReleaseNotifications();

    expect(mockDispatchBonusReleased).toHaveBeenCalledTimes(2);
    // 2 referrals × 2 updates each (step 1 auto-release + step 2 email stamp)
    expect(capturedUpdates).toHaveLength(4);
  });
});
