/**
 * Boot-time stripe.* table assertion in initStripeSync().
 *
 * After runMigrations() runs, initStripeSync() queries information_schema.tables
 * to verify that stripe.accounts exists. This pins the three observable outcomes:
 *
 *   1. Tables missing (exists=false) → logger.error with a CRITICAL message.
 *   2. Tables present (exists=true)  → logger.info confirming the table; no error.
 *   3. Query throws                  → logger.warn with the error; no crash.
 *
 * Regression guard: if the SQL migration files are dropped from the esbuild bundle
 * (see build.mjs + stripe-sync-migrations-bundling memory note), runMigrations()
 * silently skips and leaves the stripe.* schema empty. Without this assertion the
 * failure only surfaces as a billing error in production; with it the startup log
 * immediately shows a CRITICAL message pointing at the root cause.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted shared state ─────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  // Controls what postgresClient.query() returns for the assertion SELECT.
  // Each call to initStripeSync() consumes one entry (FIFO).
  queryResults: [] as Array<{ rows: Array<{ exists: boolean }> } | Error>,
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("stripe-replit-sync", () => {
  const queryFn = vi.fn(async () => {
    const next = h.queryResults.shift();
    if (!next) return { rows: [{ exists: true }] }; // safe default
    if (next instanceof Error) throw next;
    return next;
  });

  class StripeSyncMock {
    postgresClient = { query: queryFn };
    findOrCreateManagedWebhook = vi.fn(async () => ({ id: "we_test", secret: "whsec_test" }));
    syncBackfill = vi.fn(async () => ({ synced: 0 }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_opts: any) {}
  }

  return { StripeSync: StripeSyncMock, runMigrations: vi.fn(async () => {}) };
});

vi.mock("../lib/stripeClient.js", () => ({
  getStripeSecretKey: vi.fn(async () => "sk_test_assert"),
  getUncachableStripeClient: vi.fn(async () => ({
    webhookEndpoints: {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          // no endpoints — keeps the duplicate-audit path quiet
        },
      }),
    },
  })),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: h.info,
    warn: h.warn,
    error: h.error,
    debug: vi.fn(),
  },
}));

vi.mock("@workspace/email", () => ({
  sendStripeWebhookDuplicateAlertEmail: vi.fn(async () => ({ success: true })),
}));

vi.mock("@workspace/db", () => ({
  buildDatabaseConnectionConfig: vi.fn((connectionString: string) => ({
    connectionString,
    ssl: undefined,
  })),
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({ limit: vi.fn(async () => []) })) })) })),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ onConflictDoUpdate: vi.fn(async () => []) })) })),
  },
  platformSettingsTable: { key: "key", value: "value" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((_col: unknown, val: unknown) => ({ b: val })),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-id"),
}));

// ─── Import AFTER mocks ───────────────────────────────────────────────────────

import {
  getStripeSyncTablesStatus,
  initStripeSync,
  _resetDuplicateWebhookAlertStateForTesting,
} from "../lib/stripeSync.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function errorMessages(): string[] {
  return h.error.mock.calls.map((c) => String(c[1] ?? c[0]));
}
function infoMessages(): string[] {
  return h.info.mock.calls.map((c) => String(c[1] ?? c[0]));
}
function warnMessages(): string[] {
  return h.warn.mock.calls.map((c) => {
    const arg = c[1] ?? c[0];
    return typeof arg === "string" ? arg : String(JSON.stringify(arg));
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  h.queryResults = [];
  _resetDuplicateWebhookAlertStateForTesting();
});

describe("initStripeSync — boot-time stripe.* table assertion", () => {
  it("logs logger.error with CRITICAL when stripe.accounts is absent after runMigrations", async () => {
    // Simulate: runMigrations() silently skipped (missing bundle folder),
    // so stripe.accounts does not exist.
    h.queryResults.push({ rows: [{ exists: false }] });

    await initStripeSync();

    const errors = errorMessages();
    expect(errors.some((m) => m.includes("CRITICAL") && m.includes("stripe.accounts"))).toBe(true);
    expect(errors.some((m) => m.includes("build.mjs"))).toBe(true);
    // Must NOT log the success info line
    expect(infoMessages().some((m) => m.includes("stripe.accounts table verified"))).toBe(false);
    expect(getStripeSyncTablesStatus()).toEqual({
      ok: false,
      checkedAt: expect.any(String),
    });
  });

  it("logs logger.info confirming the table and does NOT log an error when stripe.accounts exists", async () => {
    h.queryResults.push({ rows: [{ exists: true }] });

    await initStripeSync();

    expect(infoMessages().some((m) => m.includes("stripe.accounts table verified"))).toBe(true);
    expect(errorMessages().some((m) => m.includes("CRITICAL"))).toBe(false);
    expect(getStripeSyncTablesStatus()).toEqual({
      ok: true,
      checkedAt: expect.any(String),
    });
  });

  it("logs logger.warn (not error) and does not crash when the assertion query itself throws", async () => {
    h.queryResults.push(new Error("connection refused"));

    await initStripeSync();

    expect(warnMessages().some((m) => m.includes("Could not verify stripe.* table existence"))).toBe(true);
    expect(errorMessages().some((m) => m.includes("CRITICAL"))).toBe(false);
    expect(getStripeSyncTablesStatus()).toEqual({
      ok: null,
      checkedAt: expect.any(String),
    });
  });

  it("still asserts stripe.accounts when no app URL is configured", async () => {
    const originalFrontendUrl = process.env["FRONTEND_URL"];
    const originalReplitDevDomain = process.env["REPLIT_DEV_DOMAIN"];

    // The table assertion must not be gated by managed webhook registration.
    delete process.env["FRONTEND_URL"];
    delete process.env["REPLIT_DEV_DOMAIN"];
    h.queryResults.push({ rows: [{ exists: true }] });

    try {
      await initStripeSync();
    } finally {
      if (originalFrontendUrl === undefined) {
        delete process.env["FRONTEND_URL"];
      } else {
        process.env["FRONTEND_URL"] = originalFrontendUrl;
      }
      if (originalReplitDevDomain === undefined) {
        delete process.env["REPLIT_DEV_DOMAIN"];
      } else {
        process.env["REPLIT_DEV_DOMAIN"] = originalReplitDevDomain;
      }
    }

    expect(infoMessages().some((m) => m.includes("stripe.accounts table verified"))).toBe(true);
    expect(warnMessages().some((m) => m.includes("No app URL available"))).toBe(true);
    expect(getStripeSyncTablesStatus()).toEqual({
      ok: true,
      checkedAt: expect.any(String),
    });
  });
});
