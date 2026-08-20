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
    stripeWebhookEventsTable: { __name: "stripe_webhook_events", id: { __col: "id" } },
  };

  // Results popped, in order, by each db.select() the handler performs.
  const selectQueue: unknown[][] = [];
  // Rows returned, in order, by each atomic-claim `.returning()` an invoice
  // UPDATE performs. Non-empty = claim WON; `[]` = LOSER (already PAID). Empty
  // queue defaults to WON.
  const claimQueue: unknown[][] = [];
  // Event-idempotency claim rows (INSERT … ON CONFLICT DO NOTHING RETURNING):
  // non-empty = claim WON; `[]` = duplicate/concurrent LOSER; empty queue → WON.
  const eventClaimQueue: unknown[][] = [];
  const updates: { table: string; values: Record<string, unknown> }[] = [];
  const inserts: { table: string; values: Record<string, unknown> }[] = [];
  const deletes: { table: string }[] = [];
  // stripe_webhook_events writes tracked separately so existing side-effect
  // assertions (updates.length === 0) stay meaningful.
  const eventUpdates: { values: Record<string, unknown> }[] = [];

  const makeChain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit"]) c[m] = () => c;
    c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return c;
  };

  // Buffered writes flushed on COMMIT and discarded on ROLLBACK — see the
  // activation suite for the rationale. Lets fault-injection tests assert that
  // an injected failure commits NO partial writes.
  type Buffers = {
    updates: { table: string; values: Record<string, unknown> }[];
    inserts: { table: string; values: Record<string, unknown> }[];
    deletes: { table: string }[];
    eventUpdates: { values: Record<string, unknown> }[];
  };

  const faultInjection: { shouldThrow: ((op: { kind: string; table?: string; values?: Record<string, unknown> }) => boolean) | null } = {
    shouldThrow: null,
  };

  const makeExecutor = (buf: Buffers) => {
    const maybeThrow = (op: { kind: string; table?: string; values?: Record<string, unknown> }) => {
      if (faultInjection.shouldThrow && faultInjection.shouldThrow(op)) {
        throw new Error(`injected-fault:${op.kind}:${op.table ?? ""}`);
      }
    };
    return {
      select: vi.fn(() => makeChain(selectQueue.length ? selectQueue.shift() : [])),
      update: vi.fn((table: { __name: string }) => ({
        set: (values: Record<string, unknown>) => {
          const record = () => {
            if (table.__name === "stripe_webhook_events") {
              buf.eventUpdates.push({ values });
            } else {
              buf.updates.push({ table: table.__name, values });
            }
            maybeThrow({ kind: "update", table: table.__name, values });
          };
          const whereResult = {
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
              try { record(); } catch (e) { return void (reject ? reject(e) : undefined); }
              return Promise.resolve().then(resolve, reject);
            },
            returning: () => {
              try { record(); } catch (e) { return Promise.reject(e); }
              const rows = claimQueue.length ? claimQueue.shift()! : [{ id: "claimed" }];
              return Promise.resolve(rows);
            },
          };
          return { where: () => whereResult };
        },
      })),
      insert: vi.fn((table: { __name: string }) => ({
        values: (values: Record<string, unknown>) => {
          // Event-idempotency ledger insert: chains
          // .onConflictDoNothing().returning() and is tracked via eventClaimQueue,
          // NOT recorded in `inserts` so side-effect assertions stay meaningful.
          if (table.__name === "stripe_webhook_events") {
            return {
              onConflictDoNothing: () => ({
                returning: () => {
                  const rows = eventClaimQueue.length ? eventClaimQueue.shift()! : [{ id: "claimed-event" }];
                  return Promise.resolve(rows);
                },
              }),
            };
          }
          buf.inserts.push({ table: table.__name, values });
          try { maybeThrow({ kind: "insert", table: table.__name, values }); }
          catch (e) { return Promise.reject(e); }
          return Promise.resolve();
        },
      })),
      delete: vi.fn((table: { __name: string }) => ({
        where: () => {
          buf.deletes.push({ table: table.__name });
          return Promise.resolve();
        },
      })),
    };
  };

  const db = {
    ...makeExecutor({ updates, inserts, deletes, eventUpdates }),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const buf: Buffers = { updates: [], inserts: [], deletes: [], eventUpdates: [] };
      const tx = makeExecutor(buf);
      const result = await cb(tx); // throws → propagate WITHOUT flushing (rollback)
      updates.push(...buf.updates);
      inserts.push(...buf.inserts);
      deletes.push(...buf.deletes);
      eventUpdates.push(...buf.eventUpdates);
      return result;
    }),
  };

  const stripe = { constructEvent: vi.fn() };

  return { tables, selectQueue, claimQueue, eventClaimQueue, updates, inserts, deletes, eventUpdates, faultInjection, db, stripe };
});

vi.mock("@workspace/db", () => ({
  db: h.db,
  tenantsTable: h.tables.tenantsTable,
  plansTable: h.tables.plansTable,
  invoicesTable: h.tables.invoicesTable,
  subscriptionsTable: h.tables.subscriptionsTable,
  tripsTable: h.tables.tripsTable,
  stripeWebhookEventsTable: h.tables.stripeWebhookEventsTable,
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn(), desc: vi.fn(), and: vi.fn(), ne: vi.fn() }));

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
  h.claimQueue.length = 0;
  h.eventClaimQueue.length = 0;
  h.updates.length = 0;
  h.inserts.length = 0;
  h.deletes.length = 0;
  h.eventUpdates.length = 0;
  h.faultInjection.shouldThrow = null;
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

  it("preserves the invoice billingPeriodEnd so an annual PaymentIntent activates for a full year (not 30 days)", async () => {
    // Annual invoice: billingPeriodEnd is ~365 days out. The handler must pass
    // this through to activateSubscriptionForTenant so the subscription's
    // currentPeriodEnd matches the annual term, instead of defaulting to +30d.
    const annualPeriodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    h.selectQueue.push([
      {
        id: "inv-annual",
        status: "pending",
        tenantId: "tenant-annual",
        planId: "plan-pro",
        billingPeriodEnd: annualPeriodEnd,
      },
    ]); // invoice lookup
    h.selectQueue.push([PLAN]); // plansTable lookup
    h.selectQueue.push([]); // subscriptionsTable existing → none → insert

    h.stripe.constructEvent.mockReturnValue({
      type: "payment_intent.succeeded",
      data: {
        object: {
          metadata: { invoiceId: "inv-annual", tenantId: "tenant-annual", planId: "plan-pro" },
          customer: "cus_ANNUAL",
        },
      },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    const invUpdate = h.updates.find((u) => u.table === "invoices");
    expect(invUpdate?.values.status).toBe("paid");

    const subInsert = h.inserts.find((i) => i.table === "subscriptions");
    expect(subInsert).toBeDefined();
    expect(subInsert?.values.status).toBe("active");

    // The subscription period must reflect the annual invoice's billing period,
    // exactly — proving the 30-day default was NOT used.
    expect(subInsert?.values.currentPeriodEnd).toBe(annualPeriodEnd);

    const daysAway =
      ((subInsert?.values.currentPeriodEnd as Date).getTime() - Date.now()) /
      (24 * 60 * 60 * 1000);
    expect(daysAway).toBeGreaterThan(360);

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

  it("is idempotent — the atomic claim loses and nothing activates when the invoice is already PAID", async () => {
    h.selectQueue.push([{ id: "inv-3", status: "paid", tenantId: "tenant-1", planId: "plan-pro" }]);
    // Atomic claim (…WHERE status != PAID) matches zero rows.
    h.claimQueue.push([]);

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

    // The claim lost → no activation: tenant untouched, no subscription writes.
    expect(h.updates.find((u) => u.table === "tenants")).toBeUndefined();
    expect(h.inserts.find((i) => i.table === "subscriptions")).toBeUndefined();
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it("activates exactly once under duplicate delivery — the second (losing) claim does not re-activate", async () => {
    const annualPeriodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    // ── Delivery 1: claim WINS ──
    h.selectQueue.push([
      { id: "inv-dup", status: "pending", tenantId: "tenant-dup", planId: "plan-pro", billingPeriodEnd: annualPeriodEnd },
    ]);
    h.selectQueue.push([PLAN]); // plansTable lookup
    h.selectQueue.push([]); // subscriptionsTable existing → none → insert

    h.stripe.constructEvent.mockReturnValue({
      type: "payment_intent.succeeded",
      data: {
        object: {
          metadata: { invoiceId: "inv-dup", tenantId: "tenant-dup", planId: "plan-pro" },
          customer: "cus_DUP",
        },
      },
    });

    const first = makeReqRes();
    await handleStripeWebhook(first.req as never, first.res as never);

    const subInsert = h.inserts.find((i) => i.table === "subscriptions");
    expect(subInsert).toBeDefined();
    expect(subInsert?.values.currentPeriodEnd).toBe(annualPeriodEnd);
    expect(first.res.json).toHaveBeenCalledWith({ received: true });

    // ── Delivery 2 (duplicate): claim LOSES ──
    vi.clearAllMocks();
    h.selectQueue.length = 0;
    h.claimQueue.length = 0;
    h.updates.length = 0;
    h.inserts.length = 0;

    // The invoice is now PAID; the conditional claim matches zero rows.
    h.selectQueue.push([
      { id: "inv-dup", status: "paid", tenantId: "tenant-dup", planId: "plan-pro", billingPeriodEnd: annualPeriodEnd },
    ]);
    h.claimQueue.push([]);

    h.stripe.constructEvent.mockReturnValue({
      type: "payment_intent.succeeded",
      data: {
        object: {
          metadata: { invoiceId: "inv-dup", tenantId: "tenant-dup", planId: "plan-pro" },
          customer: "cus_DUP",
        },
      },
    });

    const second = makeReqRes();
    await handleStripeWebhook(second.req as never, second.res as never);

    // No re-activation on the duplicate.
    expect(h.updates.find((u) => u.table === "tenants")).toBeUndefined();
    expect(h.updates.find((u) => u.table === "subscriptions")).toBeUndefined();
    expect(h.inserts.length).toBe(0);
    expect(second.res.json).toHaveBeenCalledWith({ received: true });
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
