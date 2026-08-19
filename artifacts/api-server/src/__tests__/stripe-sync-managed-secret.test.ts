import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// stripeSync.getManagedWebhookSigningSecret — backoff-window resolution.
//
// Events delivered during the server's startup window can call
// getManagedWebhookSigningSecret() before initStripeSync() has cached the
// managed webhook signing secret. Rather than returning null immediately, it
// waits with a short backoff WHILE init is still in progress, and resolves with
// the secret as soon as init caches it. This pins that contract: a call started
// before init completes still returns the secret once initStripeSync() caches it.
//
// NOTE: these tests exercise the REAL stripeSync module (its private module
// state), so they live in a separate file from the handler tests that mock
// ../lib/stripeSync wholesale. The backoff test MUST run first, while the
// module's _cachedManagedWebhookSecret/_stripeSyncInstance/_initCompleted are
// still in their pristine startup state.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const query = vi.fn(async () => ({ rows: [] }));
  const findOrCreateManagedWebhook = vi.fn(async () => ({
    id: "we_boot",
    secret: "whsec_managed_boot",
  }));
  const syncBackfill = vi.fn(async () => ({ synced: 0 }));
  class StripeSyncMock {
    postgresClient = { query };
    findOrCreateManagedWebhook = findOrCreateManagedWebhook;
    syncBackfill = syncBackfill;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(_opts: any) {}
  }
  return { query, findOrCreateManagedWebhook, syncBackfill, StripeSyncMock };
});

vi.mock("stripe-replit-sync", () => ({
  StripeSync: h.StripeSyncMock,
  runMigrations: vi.fn(async () => {}),
}));

vi.mock("../lib/stripeClient", () => ({
  getStripeSecretKey: vi.fn(async () => "sk_test_boot"),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getManagedWebhookSigningSecret, initStripeSync } from "../lib/stripeSync";

describe("getManagedWebhookSigningSecret — boot-window backoff", () => {
  it("returns the secret once it becomes cached during the backoff window", async () => {
    process.env["DATABASE_URL"] = "postgres://localhost/test";
    process.env["FRONTEND_URL"] = "https://app.test.example";

    // Start the lookup BEFORE init has cached anything. With no cached secret,
    // no instance, and init not complete, it enters the backoff loop and waits.
    const pending = getManagedWebhookSigningSecret();

    // Drive init to completion — this caches whsec_managed_boot from the
    // findOrCreateManagedWebhook response well within the first backoff delay.
    await initStripeSync();

    await expect(pending).resolves.toBe("whsec_managed_boot");
    expect(h.findOrCreateManagedWebhook).toHaveBeenCalledOnce();
  });

  it("returns the cached secret immediately on subsequent calls", async () => {
    // After init, the cache is warm — no backoff, no DB query needed.
    await expect(getManagedWebhookSigningSecret()).resolves.toBe("whsec_managed_boot");
  });
});
