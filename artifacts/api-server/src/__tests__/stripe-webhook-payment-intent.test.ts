import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// stripeWebhookHandler — payment_intent.succeeded / payment_intent.payment_failed.
//
// The settings-page "Pagar com Cartão" flow (CardPaymentModal in
// configuracoes.tsx) creates a PaymentIntent directly (POST
// /invoices/:id/stripe/checkout) rather than going through Stripe Checkout,
// so it is this event pair — not checkout.session.completed — that actually
// flips the local invoice to PAID/FAILED and activates the subscription
// after a card payment succeeds or fails. This suite pins that behaviour
// since it previously had no coverage.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const tables = {
    tenantsTable: { __name: "tenants" },
    plansTable: { __name: "plans" },
    invoicesTable: { __name: "invoices" },
    subscriptionsTable: { __name: "subscriptions" },
    tripsTable: { __name: "trips" },
  };

  // Results popped, in order, by each db.select() the handler performs.
  const selectQueue: unknown[][] = [];
  const updates: { table: string; values: Record<string, unknown> }[] = [];
  const inserts: { table: string; values: Record<string, unknown> }[] = [];

  const makeChain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
    c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return c;
  };

  const db = {
    select: vi.fn(() => makeChain(selectQueue.length ? selectQueue.shift() : [])),
    update: vi.fn((table: { __name: string }) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push({ table: table.__name, values });
          return Promise.resolve();
        },
      }),
    })),
    insert: vi.fn((table: { __name: string }) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table: table.__name, values });
        return Promise.resolve();
      },
    })),
  };

  const stripe = { constructEvent: vi.fn() };

  return { tables, selectQueue, updates, inserts, db, stripe };
});

vi.mock("@workspace/db", () => ({
  db: h.db,
  tenantsTable: h.tables.tenantsTable,
  plansTable: h.tables.plansTable,
  invoicesTable: h.tables.invoicesTable,
  subscriptionsTable: h.tables.subscriptionsTable,
  tripsTable: h.tables.tripsTable,
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn(), desc: vi.fn() }));

vi.mock("@workspace/permissions", () => ({
  INVOICE_STATUS: { PAID: "paid", FAILED: "failed" },
  TENANT_STATUS: { ACTIVE: "active" },
  SUBSCRIPTION_STATUS: { ACTIVE: "active" },
}));

vi.mock("../lib/stripeClient", () => ({
  getUncachableStripeClient: vi.fn(async () => ({
    webhooks: { constructEvent: h.stripe.constructEvent },
  })),
  getStripeWebhookSecret: vi.fn(async () => "whsec_env"),
}));

vi.mock("../lib/stripeSync", () => ({
  getManagedWebhookSigningSecret: vi.fn(async () => null),
  isStripeSyncInitComplete: vi.fn(() => true),
}));

vi.mock("../lib/id", () => ({ generateId: vi.fn(() => "generated-sub-id") }));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Plan has the seat-map feature so the handler skips the trips.showSeatMap
// update — keeps the select/update sequence deterministic for this suite.
vi.mock("../lib/plan-features", () => ({ hasSeatMapFeature: vi.fn(() => true) }));

import { handleStripeWebhook } from "../lib/stripeWebhookHandler";

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

const PLAN = { id: "plan-pro", slug: "pro", supportedFeatures: ["seat_map"] };

beforeEach(() => {
  vi.clearAllMocks();
  h.selectQueue.length = 0;
  h.updates.length = 0;
  h.inserts.length = 0;
});

describe("stripeWebhookHandler — payment_intent.succeeded", () => {
  it("marks the linked invoice PAID and activates the subscription using PaymentIntent metadata", async () => {
    h.selectQueue.push([{ id: "inv-1", status: "pending", tenantId: "tenant-fallback", planId: "plan-fallback" }]); // invoice lookup
    h.selectQueue.push([PLAN]); // plansTable lookup (activateSubscriptionForTenant)
    h.selectQueue.push([]); // subscriptionsTable existing → none → insert

    h.stripe.constructEvent.mockReturnValue({
      type: "payment_intent.succeeded",
      data: {
        object: {
          metadata: { invoiceId: "inv-1", tenantId: "tenant-1", planId: "plan-pro" },
          customer: "cus_TEST123",
        },
      },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    const invUpdate = h.updates.find((u) => u.table === "invoices");
    expect(invUpdate?.values.status).toBe("paid");
    expect(invUpdate?.values.paidAt).toBeInstanceOf(Date);
    expect(invUpdate?.values.stripeCustomerId).toBe("cus_TEST123");

    const tenantUpdate = h.updates.find((u) => u.table === "tenants");
    expect(tenantUpdate?.values.status).toBe("active");
    expect(tenantUpdate?.values.planId).toBe("pro");

    const subInsert = h.inserts.find((i) => i.table === "subscriptions");
    expect(subInsert).toBeDefined();
    expect(subInsert?.values.status).toBe("active");

    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it("falls back to the invoice's own tenantId/planId when the PaymentIntent metadata omits them", async () => {
    h.selectQueue.push([{ id: "inv-2", status: "pending", tenantId: "tenant-from-invoice", planId: "plan-from-invoice" }]);
    h.selectQueue.push([PLAN]); // plansTable lookup by id "plan-from-invoice" (mock returns PLAN regardless of id)
    h.selectQueue.push([{ id: "existing-sub", createdAt: new Date() }]); // existing subscription → update path

    h.stripe.constructEvent.mockReturnValue({
      type: "payment_intent.succeeded",
      data: {
        object: {
          metadata: { invoiceId: "inv-2" },
          customer: "cus_TEST999",
        },
      },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    expect(h.inserts.find((i) => i.table === "subscriptions")).toBeUndefined();
    const subUpdate = h.updates.find((u) => u.table === "subscriptions");
    expect(subUpdate?.values.status).toBe("active");

    const invUpdate = h.updates.find((u) => u.table === "invoices");
    expect(invUpdate?.values.status).toBe("paid");
  });

  it("is idempotent — does nothing when the invoice is already PAID", async () => {
    h.selectQueue.push([{ id: "inv-3", status: "paid", tenantId: "tenant-1", planId: "plan-pro" }]);

    h.stripe.constructEvent.mockReturnValue({
      type: "payment_intent.succeeded",
      data: {
        object: {
          metadata: { invoiceId: "inv-3", tenantId: "tenant-1", planId: "plan-pro" },
          customer: "cus_TEST",
        },
      },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    expect(h.updates.find((u) => u.table === "invoices")).toBeUndefined();
    expect(h.updates.find((u) => u.table === "tenants")).toBeUndefined();
    expect(h.inserts.find((i) => i.table === "subscriptions")).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it("does nothing when the PaymentIntent has no invoiceId metadata", async () => {
    h.stripe.constructEvent.mockReturnValue({
      type: "payment_intent.succeeded",
      data: { object: { metadata: {}, customer: "cus_x" } },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    expect(h.db.select).not.toHaveBeenCalled();
    expect(h.updates.length).toBe(0);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});

describe("stripeWebhookHandler — payment_intent.payment_failed", () => {
  it("marks the linked invoice FAILED with a Portuguese failure note", async () => {
    h.stripe.constructEvent.mockReturnValue({
      type: "payment_intent.payment_failed",
      data: {
        object: {
          metadata: { invoiceId: "inv-4" },
        },
      },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    const invUpdate = h.updates.find((u) => u.table === "invoices");
    expect(invUpdate?.values.status).toBe("failed");
    expect(invUpdate?.values.notes).toBe("Pagamento falhou via Stripe");
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it("does nothing when the failed PaymentIntent has no invoiceId metadata", async () => {
    h.stripe.constructEvent.mockReturnValue({
      type: "payment_intent.payment_failed",
      data: { object: { metadata: {} } },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    expect(h.updates.length).toBe(0);
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});
