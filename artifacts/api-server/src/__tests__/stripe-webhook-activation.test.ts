import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// stripeWebhookHandler — checkout.session.completed activation guard.
//
// The end-to-end "pay with a test card on Stripe's hosted page" step is a
// human-in-the-loop action that cannot run in CI (and cannot run at all
// against the production LIVE key). What we CAN pin durably is the backend
// behaviour the manual test is meant to confirm: when Stripe POSTs a
// signature-valid `checkout.session.completed` event carrying tenantId/planId
// metadata, the handler must
//   1. flip tenants.status to ACTIVE,
//   2. persist the Stripe customer + subscription ids on subscriptions,
//   3. emit the "checkout.session.completed — subscription activated" log,
//   4. mark the linked local invoice paid,
// and a forged/invalid signature must be rejected with 400 "Assinatura inválida"
// (never silently activating a tenant).
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
  INVOICE_STATUS: { PAID: "paid" },
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
import { logger } from "../lib/logger";

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

describe("stripeWebhookHandler — checkout.session.completed", () => {
  it("activates the tenant and persists the Stripe subscription id (insert path)", async () => {
    h.selectQueue.push([PLAN]); // plansTable lookup by id
    h.selectQueue.push([]); // subscriptionsTable existing → none → insert

    h.stripe.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: "tenant-1", planId: "plan-pro" },
          client_reference_id: "tenant-1",
          customer: "cus_TEST123",
          subscription: "sub_TEST456",
        },
      },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    const tenantUpdate = h.updates.find((u) => u.table === "tenants");
    expect(tenantUpdate?.values.status).toBe("active");
    expect(tenantUpdate?.values.planId).toBe("pro");

    const subInsert = h.inserts.find((i) => i.table === "subscriptions");
    expect(subInsert).toBeDefined();
    expect(subInsert?.values.status).toBe("active");
    expect(subInsert?.values.stripeSubscriptionId).toBe("sub_TEST456");
    expect(subInsert?.values.stripeCustomerId).toBe("cus_TEST123");

    expect(logger.info).toHaveBeenCalledWith(
      { tenantId: "tenant-1", planId: "plan-pro" },
      "[stripe-webhook] checkout.session.completed — subscription activated",
    );
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it("updates an existing subscription row with the new Stripe ids (update path)", async () => {
    h.selectQueue.push([PLAN]);
    h.selectQueue.push([{ id: "existing-sub", createdAt: new Date() }]);

    h.stripe.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: "tenant-2", planId: "plan-pro" },
          customer: "cus_TEST999",
          subscription: "sub_TEST888",
        },
      },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    expect(h.inserts.find((i) => i.table === "subscriptions")).toBeUndefined();
    const subUpdate = h.updates.find((u) => u.table === "subscriptions");
    expect(subUpdate?.values.status).toBe("active");
    expect(subUpdate?.values.stripeSubscriptionId).toBe("sub_TEST888");
    expect(subUpdate?.values.stripeCustomerId).toBe("cus_TEST999");
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it("falls back to client_reference_id when metadata.tenantId is absent", async () => {
    h.selectQueue.push([PLAN]);
    h.selectQueue.push([]);

    h.stripe.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { planId: "plan-pro" },
          client_reference_id: "tenant-from-ref",
          customer: "cus_x",
          subscription: "sub_x",
        },
      },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    expect(logger.info).toHaveBeenCalledWith(
      { tenantId: "tenant-from-ref", planId: "plan-pro" },
      "[stripe-webhook] checkout.session.completed — subscription activated",
    );
  });

  it("marks the linked local invoice paid when invoiceId metadata is present", async () => {
    h.selectQueue.push([PLAN]);
    h.selectQueue.push([]);

    h.stripe.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: "tenant-3", planId: "plan-pro", invoiceId: "inv-123" },
          customer: "cus_inv",
          subscription: "sub_inv",
        },
      },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    const invUpdate = h.updates.find((u) => u.table === "invoices");
    expect(invUpdate?.values.status).toBe("paid");
    expect(invUpdate?.values.stripeCustomerId).toBe("cus_inv");
  });

  it("does NOT activate when tenantId/planId metadata is missing", async () => {
    h.stripe.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: { object: { metadata: {}, customer: "cus_a" } },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    expect(h.updates.find((u) => u.table === "tenants")).toBeUndefined();
    expect(logger.info).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});

describe("stripeWebhookHandler — signature enforcement", () => {
  it("rejects an invalid signature with 400 'Assinatura inválida' and never activates", async () => {
    h.stripe.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res._statusJson).toHaveBeenCalledWith({ error: "Assinatura inválida" });
    expect(h.updates.find((u) => u.table === "tenants")).toBeUndefined();
    expect(res.json).not.toHaveBeenCalledWith({ received: true });
  });

  it("returns 400 when the stripe-signature header is missing", async () => {
    const _statusJson = vi.fn();
    const res = { json: vi.fn(), status: vi.fn(() => ({ json: _statusJson })) };
    const req = { headers: {}, body: Buffer.from("{}") };

    await handleStripeWebhook(req as never, res as never);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(_statusJson).toHaveBeenCalledWith({ error: "Missing stripe-signature header" });
  });
});
