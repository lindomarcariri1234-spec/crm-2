import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// stripeSync.initStripeSync — duplicate webhook endpoint audit.
//
// We recently removed a second Stripe webhook endpoint that was silently
// delivering every billing event twice (double plan activations). Nothing
// prevents this from recurring if someone adds another endpoint in the Stripe
// Dashboard or a stale one is left by a prior deploy. After registering the
// managed webhook, initStripeSync() now lists all Stripe webhook endpoints and
// logs a clear WARN when more than one *enabled* endpoint targets
// /api/stripe/webhook. This pins that behaviour: WARN on duplicates, INFO when
// clean, and never throwing (non-fatal, never blocks startup).
//
// The audit also sends a rate-limited alert email (at most once per 24 hours)
// with a two-layer debounce:
//   1. In-process: timestamp set synchronously before any async work — prevents
//      concurrent calls racing through the guard.
//   2. Cross-restart: timestamp persisted to platform_settings DB so a server
//      restart within the 24-hour window doesn't re-send the alert.
// ---------------------------------------------------------------------------

type Endpoint = { id: string; url: string; status: string };

// ─── Hoisted mutable state ────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  // Endpoints returned by the mocked stripe.webhookEndpoints.list() iterator.
  endpoints: [] as Endpoint[],
  // When true, getUncachableStripeClient rejects (simulates a Stripe outage).
  listThrows: false,
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  // Alert email function spy — resolves to success by default.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sendAlertEmail: vi.fn(async (_opts: unknown) => ({ success: true, messageId: "msg_1" })),
  // DB rows to return for each query key — keyed by the platform_settings key.
  // "stripe_duplicate_webhook_alert_sent_at" → controls cross-restart debounce.
  // "redis_alert_email"                      → controls recipient lookup.
  dbRows: {} as Record<string, Array<{ value: string }>>,
  // DB insert spy.
  dbInsertCalled: false,
  dbInsertValues: null as null | Record<string, unknown>,
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("stripe-replit-sync", () => {
  const query = vi.fn(async () => ({ rows: [] }));
  const findOrCreateManagedWebhook = vi.fn(async () => ({
    id: "we_managed",
    secret: "whsec_managed",
  }));
  const syncBackfill = vi.fn(async () => ({ synced: 0 }));
  class StripeSyncMock {
    postgresClient = { query };
    findOrCreateManagedWebhook = findOrCreateManagedWebhook;
    syncBackfill = syncBackfill;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_opts: any) {}
  }
  return { StripeSync: StripeSyncMock, runMigrations: vi.fn(async () => {}) };
});

vi.mock("../lib/stripeClient", () => ({
  getStripeSecretKey: vi.fn(async () => "sk_test_audit"),
  getUncachableStripeClient: vi.fn(async () => {
    if (h.listThrows) throw new Error("stripe down");
    return {
      webhookEndpoints: {
        list: () => ({
          async *[Symbol.asyncIterator]() {
            for (const ep of h.endpoints) yield ep;
          },
        }),
      },
    };
  }),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: h.info,
    warn: h.warn,
    error: h.error,
    debug: vi.fn(),
  },
}));

vi.mock("@workspace/email", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendStripeWebhookDuplicateAlertEmail: (arg: any) => h.sendAlertEmail(arg),
}));

// Mock @workspace/db.
// The code executes these chains:
//   db.select({…}).from(tbl).where(eq(key, "some-key")).limit(1)  → select rows
//   db.insert(tbl).values({…}).onConflictDoUpdate({…})            → upsert
//
// `mockWhere` inspects which platform_settings key is being queried (via the
// mocked eq result's `.b` field) and returns the appropriate rows from h.dbRows.
const mockOnConflictDoUpdate = vi.fn(async () => []);
const mockInsertValues = vi.fn(
  (vals: Record<string, unknown>) => {
    h.dbInsertCalled = true;
    h.dbInsertValues = vals;
    return { onConflictDoUpdate: mockOnConflictDoUpdate };
  },
);

const mockLimit = vi.fn();
const mockWhere = vi.fn((condition: { b?: string } | unknown) => ({
  limit: (n: number) => {
    const key = (condition as { b?: string })?.b ?? "";
    const rows = h.dbRows[key] ?? [];
    return Promise.resolve(rows);
  },
}));
const mockFrom = vi.fn(() => ({ where: mockWhere }));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
    insert: vi.fn(() => ({ values: mockInsertValues })),
  },
  platformSettingsTable: { key: "key", value: "value" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ a: col, b: val })),
}));

vi.mock("../lib/id", () => ({
  generateId: vi.fn(() => "generated-id"),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TS_KEY = "stripe_duplicate_webhook_alert_sent_at";
const EMAIL_KEY = "redis_alert_email";

/** Configure DB to return no persisted alert timestamp (first send ever). */
function dbNoTimestamp() {
  h.dbRows[TS_KEY] = [];
}

/** Configure DB to return a recent timestamp (within 24h, cross-restart debounce active). */
function dbRecentTimestamp(msSinceNow = 60_000) {
  h.dbRows[TS_KEY] = [{ value: String(Date.now() - msSinceNow) }];
}

/** Configure DB to return an old timestamp (beyond 24h, debounce expired). */
function dbOldTimestamp() {
  h.dbRows[TS_KEY] = [{ value: String(Date.now() - 25 * 60 * 60 * 1000) }];
}

/**
 * Flush pending microtasks + a short macrotask tick so the fire-and-forget
 * IIFE inside auditDuplicateWebhookEndpoints() has a chance to complete.
 */
async function flushAsync() {
  await new Promise<void>((r) => setTimeout(r, 30));
}

const warn = h.warn;
const info = h.info;

import {
  initStripeSync,
  getWebhookAuditStatus,
  _resetDuplicateWebhookAlertStateForTesting,
} from "../lib/stripeSync";

const AUDIT_WARN = /DUPLICATE WEBHOOK ENDPOINTS DETECTED/;
const AUDIT_INFO = /Webhook endpoint audit passed/;

function warnMessages(): string[] {
  return warn.mock.calls.map((c) => String(c[1] ?? c[0]));
}
function infoMessages(): string[] {
  return info.mock.calls.map((c) => String(c[1] ?? c[0]));
}

// ─── Shared beforeEach ────────────────────────────────────────────────────────

function resetAll() {
  warn.mockClear();
  info.mockClear();
  h.error.mockClear();
  h.endpoints = [];
  h.listThrows = false;
  h.sendAlertEmail.mockClear();
  h.sendAlertEmail.mockResolvedValue({ success: true, messageId: "msg_1" });
  h.dbInsertCalled = false;
  h.dbInsertValues = null;
  h.dbRows = {};
  mockWhere.mockClear();
  mockFrom.mockClear();
  mockLimit.mockClear();
  mockInsertValues.mockClear();
  mockOnConflictDoUpdate.mockClear();
  mockOnConflictDoUpdate.mockResolvedValue([]);
  process.env["DATABASE_URL"] = "postgres://localhost/test";
  process.env["FRONTEND_URL"] = "https://app.test.example";
  process.env["SUPERADMIN_EMAIL"] = "admin@example.com";
  // Reset module-level rate-limit and init state so each test starts clean.
  _resetDuplicateWebhookAlertStateForTesting();
  dbNoTimestamp();
}

// ─── Test suites ──────────────────────────────────────────────────────────────

describe("initStripeSync — duplicate webhook endpoint audit", () => {
  beforeEach(resetAll);

  it("warns when more than one enabled endpoint targets /api/stripe/webhook", async () => {
    h.endpoints = [
      { id: "we_1", url: "https://app.test.example/api/stripe/webhook", status: "enabled" },
      { id: "we_2", url: "https://old.deploy.example/api/stripe/webhook", status: "enabled" },
    ];

    await initStripeSync();

    expect(warnMessages().some((m) => AUDIT_WARN.test(m))).toBe(true);
    expect(infoMessages().some((m) => AUDIT_INFO.test(m))).toBe(false);
  });

  it("does not warn when only one enabled endpoint targets the path", async () => {
    h.endpoints = [
      { id: "we_1", url: "https://app.test.example/api/stripe/webhook", status: "enabled" },
      { id: "we_2", url: "https://app.test.example/api/other/webhook", status: "enabled" },
    ];

    await initStripeSync();

    expect(warnMessages().some((m) => AUDIT_WARN.test(m))).toBe(false);
    expect(infoMessages().some((m) => AUDIT_INFO.test(m))).toBe(true);
  });

  it("ignores disabled duplicate endpoints", async () => {
    h.endpoints = [
      { id: "we_1", url: "https://app.test.example/api/stripe/webhook", status: "enabled" },
      { id: "we_2", url: "https://old.deploy.example/api/stripe/webhook", status: "disabled" },
    ];

    await initStripeSync();

    expect(warnMessages().some((m) => AUDIT_WARN.test(m))).toBe(false);
    expect(infoMessages().some((m) => AUDIT_INFO.test(m))).toBe(true);
  });

  it("is non-fatal when listing endpoints throws — no throw, warns softly", async () => {
    h.listThrows = true;

    await expect(initStripeSync()).resolves.toBeUndefined();

    expect(warnMessages().some((m) => AUDIT_WARN.test(m))).toBe(false);
    expect(warnMessages().some((m) => /Could not audit webhook endpoints/.test(m))).toBe(true);
  });

  it("getWebhookAuditStatus() reflects 'duplicate' with the matching endpoints after a duplicate audit", async () => {
    h.endpoints = [
      { id: "we_1", url: "https://app.test.example/api/stripe/webhook", status: "enabled" },
      { id: "we_2", url: "https://old.deploy.example/api/stripe/webhook", status: "enabled" },
    ];

    await initStripeSync();
    const status = getWebhookAuditStatus();

    expect(status.status).toBe("duplicate");
    expect(status.duplicateCount).toBe(2);
    expect(status.endpoints).toEqual([
      { id: "we_1", url: "https://app.test.example/api/stripe/webhook" },
      { id: "we_2", url: "https://old.deploy.example/api/stripe/webhook" },
    ]);
    expect(status.checkedAt).not.toBeNull();
  });

  it("getWebhookAuditStatus() reflects 'ok' with zero duplicates after a clean audit", async () => {
    h.endpoints = [
      { id: "we_1", url: "https://app.test.example/api/stripe/webhook", status: "enabled" },
    ];

    await initStripeSync();
    const status = getWebhookAuditStatus();

    expect(status.status).toBe("ok");
    expect(status.duplicateCount).toBe(1);
    expect(status.endpoints).toEqual([
      { id: "we_1", url: "https://app.test.example/api/stripe/webhook" },
    ]);
    expect(status.checkedAt).not.toBeNull();
  });

  it("getWebhookAuditStatus() reflects 'unknown' with no endpoints after a failed audit", async () => {
    h.listThrows = true;

    await initStripeSync();
    const status = getWebhookAuditStatus();

    expect(status.status).toBe("unknown");
    expect(status.duplicateCount).toBe(0);
    expect(status.endpoints).toEqual([]);
    expect(status.checkedAt).not.toBeNull();
  });
});

describe("initStripeSync — duplicate webhook alert email", () => {
  beforeEach(() => {
    resetAll();
    // All tests in this suite use two duplicate endpoints.
    h.endpoints = [
      { id: "we_1", url: "https://app.test.example/api/stripe/webhook", status: "enabled" },
      { id: "we_2", url: "https://old.deploy.example/api/stripe/webhook", status: "enabled" },
    ];
  });

  it("sends alert email to SUPERADMIN_EMAIL when duplicates are detected for the first time", async () => {
    await initStripeSync();
    await flushAsync();

    expect(h.sendAlertEmail).toHaveBeenCalledOnce();
    expect(h.sendAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@example.com",
        count: 2,
        endpoints: expect.arrayContaining([
          expect.objectContaining({ id: "we_1" }),
          expect.objectContaining({ id: "we_2" }),
        ]),
        stripeDashboardUrl: "https://dashboard.stripe.com/webhooks",
      }),
    );
  });

  it("persists the alert timestamp to the DB after a successful send", async () => {
    await initStripeSync();
    await flushAsync();

    expect(h.dbInsertCalled).toBe(true);
    expect(h.dbInsertValues).toMatchObject({
      key: TS_KEY,
      value: expect.stringMatching(/^\d+$/),
    });
    expect(mockOnConflictDoUpdate).toHaveBeenCalled();
  });

  it("does not send alert email when a recent DB timestamp exists (cross-restart debounce)", async () => {
    dbRecentTimestamp(5 * 60 * 1000); // 5 minutes ago — within 24h window

    await initStripeSync();
    await flushAsync();

    expect(h.sendAlertEmail).not.toHaveBeenCalled();
    expect(
      infoMessages().some((m) => /rate-limited.*cross-restart/i.test(m) || /cross-restart.*rate-limited/i.test(m)),
    ).toBe(true);
  });

  it("sends again when the DB timestamp is older than 24 hours", async () => {
    dbOldTimestamp(); // 25 hours ago — outside the 24h window

    await initStripeSync();
    await flushAsync();

    expect(h.sendAlertEmail).toHaveBeenCalledOnce();
  });

  it("clears the rate-limit when send fails so the next startup can retry", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    h.sendAlertEmail.mockResolvedValue({ success: false, error: "Resend API error" } as any);

    await initStripeSync();
    await flushAsync();

    // Error should have been logged.
    const allErrors = h.error.mock.calls.map((c) => String(c[1] ?? c[0]));
    expect(allErrors.some((m) => /Failed to send duplicate webhook alert email/.test(m))).toBe(true);

    // The in-process rate-limit is cleared on failure, so a second call
    // (simulating next startup) should also try to send.
    _resetDuplicateWebhookAlertStateForTesting();
    h.sendAlertEmail.mockResolvedValue({ success: true, messageId: "msg_retry" });
    h.error.mockClear();

    await initStripeSync();
    await flushAsync();

    expect(h.sendAlertEmail).toHaveBeenCalledTimes(2);
  });

  it("does not send alert email when no recipient is configured", async () => {
    delete process.env["SUPERADMIN_EMAIL"];
    // DB returns no custom email either.
    h.dbRows[EMAIL_KEY] = [];

    await initStripeSync();
    await flushAsync();

    expect(h.sendAlertEmail).not.toHaveBeenCalled();
    expect(
      warnMessages().some((m) => /No alert email configured/.test(m)),
    ).toBe(true);
  });

  it("does not send alert email when only one endpoint targets the path", async () => {
    h.endpoints = [
      { id: "we_1", url: "https://app.test.example/api/stripe/webhook", status: "enabled" },
    ];

    await initStripeSync();
    await flushAsync();

    expect(h.sendAlertEmail).not.toHaveBeenCalled();
  });

  it("does not send alert email when the audit itself fails (Stripe unreachable)", async () => {
    h.listThrows = true;

    await initStripeSync();
    await flushAsync();

    expect(h.sendAlertEmail).not.toHaveBeenCalled();
  });
});
