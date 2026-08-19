import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// stripeWebhookHandler — StripeSync boot-window behaviour.
//
// The handler was hardened so that a Stripe event delivered during the server's
// startup window (right after a deploy/restart, before initStripeSync() has
// cached the managed webhook signing secret) is NOT hard-rejected. Instead, when
// no signing secret is available AND StripeSync init has not yet completed, the
// handler responds 503 so Stripe retries delivery (5xx is retried automatically
// for ~3 days). Once init HAS completed and there is still no secret configured,
// the event is genuinely unprocessable and the handler responds 400.
//
// This behaviour was previously unverified by any automated test — a regression
// would silently drop real payment events delivered immediately after a deploy.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  // Mutable knobs read by the mocked secret/init helpers, set per test.
  envSecret: null as string | null,
  managedSecret: null as string | null,
  initComplete: true,
}));

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), update: vi.fn(), insert: vi.fn() },
  tenantsTable: {},
  plansTable: {},
  invoicesTable: {},
  subscriptionsTable: {},
  tripsTable: {},
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn(), desc: vi.fn() }));

vi.mock("@workspace/permissions", () => ({
  INVOICE_STATUS: { PAID: "paid" },
  TENANT_STATUS: { ACTIVE: "active" },
  SUBSCRIPTION_STATUS: { ACTIVE: "active" },
}));

vi.mock("../lib/stripeClient", () => ({
  getUncachableStripeClient: vi.fn(),
  getStripeWebhookSecret: vi.fn(async () => h.envSecret),
}));

vi.mock("../lib/stripeSync", () => ({
  getManagedWebhookSigningSecret: vi.fn(async () => h.managedSecret),
  isStripeSyncInitComplete: vi.fn(() => h.initComplete),
}));

vi.mock("../lib/id", () => ({ generateId: vi.fn(() => "generated-id") }));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/plan-features", () => ({ hasSeatMapFeature: vi.fn(() => true) }));

import { handleStripeWebhook } from "../lib/stripeWebhookHandler";
import { getUncachableStripeClient } from "../lib/stripeClient";

type ResStub = {
  json: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  _statusJson: ReturnType<typeof vi.fn>;
};

function makeReqRes(): { req: unknown; res: ResStub } {
  const _statusJson = vi.fn();
  const res: ResStub = {
    json: vi.fn(),
    status: vi.fn(() => ({ json: _statusJson })),
    _statusJson,
  };
  const req = { headers: { "stripe-signature": "t=1,v1=abc" }, body: Buffer.from("{}") };
  return { req, res };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.envSecret = null;
  h.managedSecret = null;
  h.initComplete = true;
});

describe("stripeWebhookHandler — boot-window secret availability", () => {
  it("responds 503 (Stripe retries) when no secret is cached and StripeSync init is still in progress", async () => {
    h.envSecret = null;
    h.managedSecret = null;
    h.initComplete = false; // event delivered during the startup window

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res._statusJson).toHaveBeenCalledWith({
      error: "Stripe sync inicializando — tente novamente em breve",
    });
    // Must not fall through to signature verification when telling Stripe to retry.
    expect(getUncachableStripeClient).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalledWith({ received: true });
  });

  it("responds 400 once init has completed and no secret is configured", async () => {
    h.envSecret = null;
    h.managedSecret = null;
    h.initComplete = true; // init finished, genuinely unconfigured

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._statusJson).toHaveBeenCalledWith({
      error: "Stripe webhook não configurado",
    });
    expect(getUncachableStripeClient).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalledWith({ received: true });
  });

  it("does NOT respond 503 once a managed secret has been cached, even mid-init", async () => {
    // If the secret became available during the window, the handler proceeds to
    // signature verification regardless of init progress (no spurious 503).
    h.envSecret = null;
    h.managedSecret = "whsec_managed";
    h.initComplete = false;

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    expect(res.status).not.toHaveBeenCalledWith(503);
    // Proceeds far enough to attempt signature verification (Stripe client lookup).
    expect(getUncachableStripeClient).toHaveBeenCalled();
  });
});
