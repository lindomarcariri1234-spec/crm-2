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
    stripeWebhookEventsTable: { __name: "stripe_webhook_events", id: { __col: "id" } },
  };

  // Results popped, in order, by each db.select() the handler performs.
  const selectQueue: unknown[][] = [];
  // Rows returned, in order, by each atomic-claim `.returning()` an invoice
  // UPDATE performs. A non-empty array means the conditional claim WON (the row
  // was still PENDING); an empty array `[]` simulates a LOSER (already PAID /
  // claimed concurrently) so activation is skipped. When the queue is empty the
  // claim defaults to WON.
  const claimQueue: unknown[][] = [];
  // Per-table select queues. Consulted LAZILY at `.from(table)` time so that
  // GENUINELY CONCURRENT handlers (dispatched before either is awaited) each
  // read the correct rows for the table they query — independent of the
  // microtask interleaving order that a single positional queue cannot survive.
  // When empty for a table, the chain falls back to the positional selectQueue.
  const selectByTable: Record<string, unknown[][]> = {};
  const updates: { table: string; values: Record<string, unknown> }[] = [];
  const inserts: { table: string; values: Record<string, unknown> }[] = [];
  const deletes: { table: string }[] = [];
  // stripe_webhook_events writes are tracked separately so existing
  // side-effect assertions (updates.length === 0) stay meaningful.
  const eventUpdates: { values: Record<string, unknown> }[] = [];
  // Rows returned, in order, by each event-idempotency claim
  // (INSERT … ON CONFLICT DO NOTHING RETURNING). A non-empty array means the
  // claim WON (event id was new); an empty array `[]` simulates a duplicate /
  // concurrent LOSER so the handler short-circuits. Empty queue defaults to WON.
  const eventClaimQueue: unknown[][] = [];

  const makeChain = () => {
    const c: Record<string, unknown> = {};
    let fromTable: string | undefined;
    c.from = (table: { __name?: string }) => { fromTable = table?.__name; return c; };
    for (const m of ["where", "orderBy", "limit"]) c[m] = () => c;
    c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
      const perTable = fromTable ? selectByTable[fromTable] : undefined;
      const result = perTable && perTable.length
        ? perTable.shift()!
        : (selectQueue.length ? selectQueue.shift()! : []);
      return Promise.resolve(result).then(resolve, reject);
    };
    return c;
  };

  // Buffers written to by `tx` inside a transaction. On successful COMMIT they
  // are flushed into the durable arrays (updates/inserts/deletes/eventUpdates);
  // on ROLLBACK (callback throws) they are discarded, so a failure-injected
  // handler leaves NO committed writes — exactly the real transaction semantics.
  type Buffers = {
    updates: { table: string; values: Record<string, unknown> }[];
    inserts: { table: string; values: Record<string, unknown> }[];
    deletes: { table: string }[];
    eventUpdates: { values: Record<string, unknown> }[];
  };

  // Fault injection: when set, the given predicate is consulted after each
  // buffered write; returning true makes the executor throw, simulating a
  // handler/DB failure mid-transaction so we can assert full rollback.
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
      select: vi.fn(() => makeChain()),
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
            // Awaited directly (non-claim updates): records the write.
            then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
              try { record(); } catch (e) { return void (reject ? reject(e) : undefined); }
              return Promise.resolve().then(resolve, reject);
            },
            // Atomic conditional claim: records the write and yields the claimed
            // rows so the handler can decide whether it won.
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
          // The event-idempotency ledger insert chains
          // .onConflictDoNothing().returning(). It is tracked separately (via
          // eventClaimQueue) and NOT recorded in `inserts` so existing
          // side-effect assertions (e.g. inserts.length === 0) stay meaningful.
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
    // Single-transaction wrapper: buffers all writes, flushes on commit, and
    // discards them (rollback) if the callback throws.
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

  return { tables, selectQueue, selectByTable, claimQueue, eventClaimQueue, updates, inserts, deletes, eventUpdates, faultInjection, db, stripe };
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
  for (const k of Object.keys(h.selectByTable)) delete h.selectByTable[k];
  h.claimQueue.length = 0;
  h.eventClaimQueue.length = 0;
  h.updates.length = 0;
  h.inserts.length = 0;
  h.deletes.length = 0;
  h.eventUpdates.length = 0;
  h.faultInjection.shouldThrow = null;
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
          payment_status: "paid",
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
          payment_status: "paid",
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
          payment_status: "paid",
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
    // db.select order in the paid checkout path:
    //   1. lookup local invoice by metadata.invoiceId → pending (not yet paid)
    //   2. plansTable lookup (inside activateSubscriptionForTenant)
    //   3. subscriptionsTable existing → none → insert
    h.selectQueue.push([
      { id: "inv-123", status: "pending", tenantId: "tenant-3", planId: "plan-pro", billingPeriodEnd: null },
    ]);
    h.selectQueue.push([PLAN]);
    h.selectQueue.push([]);

    h.stripe.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: "tenant-3", planId: "plan-pro", invoiceId: "inv-123" },
          customer: "cus_inv",
          subscription: "sub_inv",
          payment_status: "paid",
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
      data: { object: { metadata: {}, customer: "cus_a", payment_status: "paid" } },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    expect(h.updates.find((u) => u.table === "tenants")).toBeUndefined();
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "[stripe-webhook] checkout.session.completed — subscription activated",
    );
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Regression: unpaid / delayed sessions MUST NOT activate.
  // `checkout.session.completed` also fires for async payment methods (boleto,
  // PIX, bank debit) where the money has not settled yet — `payment_status`
  // is "unpaid". Activating on those would flip the tenant to ACTIVE and mark
  // the invoice PAID before payment confirms. Activation is deferred to the
  // later invoice.payment_succeeded / payment_intent.succeeded event.
  // ─────────────────────────────────────────────────────────────────────────
  it("does NOT activate the tenant or mark the invoice paid when payment_status is 'unpaid'", async () => {
    h.stripe.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: "tenant-unpaid", planId: "plan-pro", invoiceId: "inv-unpaid" },
          client_reference_id: "tenant-unpaid",
          customer: "cus_unpaid",
          subscription: "sub_unpaid",
          payment_status: "unpaid",
          status: "complete",
        },
      },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    // No activation: the tenant is NOT flipped to ACTIVE and no subscription is
    // inserted/updated. The ONLY permitted write is stamping the durable
    // correlation ids (Stripe subscription/customer) onto the local pending
    // invoice — it must NOT be marked paid.
    expect(h.updates.find((u) => u.table === "tenants")).toBeUndefined();
    expect(h.updates.find((u) => u.table === "subscriptions")).toBeUndefined();
    expect(h.inserts.length).toBe(0);
    const invUpdate = h.updates.find((u) => u.table === "invoices");
    expect(invUpdate?.values.stripeSubscriptionId).toBe("sub_unpaid");
    expect(invUpdate?.values.status).toBeUndefined(); // NOT marked paid
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "[stripe-webhook] checkout.session.completed — subscription activated",
    );
    // Still acknowledges receipt so Stripe does not retry.
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it("activates on a Stripe-native trial session where payment_status is 'no_payment_required'", async () => {
    h.selectQueue.push([PLAN]); // plansTable lookup
    h.selectQueue.push([]); // subscriptionsTable → none → insert

    h.stripe.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: "tenant-trial", planId: "plan-pro" },
          customer: "cus_trial",
          subscription: "sub_trial",
          payment_status: "no_payment_required",
          status: "complete",
        },
      },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    const tenantUpdate = h.updates.find((u) => u.table === "tenants");
    expect(tenantUpdate?.values.status).toBe("active");
    expect(logger.info).toHaveBeenCalledWith(
      { tenantId: "tenant-trial", planId: "plan-pro" },
      "[stripe-webhook] checkout.session.completed — subscription activated",
    );
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// End-to-end regression: async Subscription Checkout → later invoice webhook.
//
// Flow being pinned:
//   1. POST /subscriptions/upgrade (Stripe subscription path) created a local
//      PENDING annual invoice and stamped it with the Checkout Session id.
//   2. The customer completed an *async* checkout (payment_status "unpaid"),
//      so checkout.session.completed deferred activation but persisted the
//      Stripe subscription id onto the local invoice.
//   3. Later, Stripe settles the payment and POSTs invoice.payment_succeeded.
//      This event carries ONLY the Stripe subscription id (no local invoiceId
//      metadata). The handler must correlate it back to the EXACT local
//      pending invoice, mark that invoice paid, and activate the tenant
//      subscription for the ANNUAL term (using the invoice's billingPeriodEnd,
//      not the Stripe invoice period nor a 30-day default).
// ─────────────────────────────────────────────────────────────────────────
describe("stripeWebhookHandler — async Subscription Checkout invoice correlation", () => {
  it("marks the exact local pending invoice paid and activates the tenant for the annual term when its invoice.payment_succeeded arrives", async () => {
    const annualPeriodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    // db.select order inside invoice.payment_succeeded:
    //   1. lookup local invoice by stripeSubscriptionId → the pending annual invoice
    //   2. plansTable lookup (inside activateSubscriptionForTenant)
    //   3. subscriptionsTable existing → none → insert
    h.selectQueue.push([
      {
        id: "inv-annual-checkout",
        status: "pending",
        tenantId: "tenant-annual",
        planId: "plan-pro",
        billingPeriodEnd: annualPeriodEnd,
        stripeSubscriptionId: "sub_ASYNC123",
      },
    ]);
    h.selectQueue.push([PLAN]);
    h.selectQueue.push([]);

    h.stripe.constructEvent.mockReturnValue({
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_STRIPE_INV_1",
          customer: "cus_ASYNC",
          subscription: "sub_ASYNC123",
          period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          // No invoiceId metadata, no tenantId/planId on the invoice itself —
          // they arrive via subscription_details.metadata (Subscription Checkout).
          metadata: {},
          subscription_details: { metadata: { tenantId: "tenant-annual", planId: "plan-pro" } },
        },
      },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    // The EXACT local invoice was marked paid.
    const invUpdate = h.updates.find(
      (u) => u.table === "invoices" && u.values.status === "paid",
    );
    expect(invUpdate).toBeDefined();
    expect(invUpdate?.values.status).toBe("paid");
    expect(invUpdate?.values.paidAt).toBeInstanceOf(Date);
    expect(invUpdate?.values.stripeInvoiceId).toBe("in_STRIPE_INV_1");

    // Tenant activated.
    const tenantUpdate = h.updates.find((u) => u.table === "tenants");
    expect(tenantUpdate?.values.status).toBe("active");
    expect(tenantUpdate?.values.planId).toBe("pro");

    // Subscription created for the ANNUAL term — must use the invoice's
    // billingPeriodEnd, proving the 30-day (period_end) fallback was NOT used.
    const subInsert = h.inserts.find((i) => i.table === "subscriptions");
    expect(subInsert).toBeDefined();
    expect(subInsert?.values.status).toBe("active");
    expect(subInsert?.values.stripeSubscriptionId).toBe("sub_ASYNC123");
    expect(subInsert?.values.currentPeriodEnd).toBe(annualPeriodEnd);

    const daysAway =
      ((subInsert?.values.currentPeriodEnd as Date).getTime() - Date.now()) /
      (24 * 60 * 60 * 1000);
    expect(daysAway).toBeGreaterThan(360);

    expect(res.json).toHaveBeenCalledWith({ received: true });
  });

  it("persists the Stripe subscription id onto the local invoice on a deferred (unpaid) checkout.session.completed", async () => {
    h.stripe.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_async_1",
          metadata: { tenantId: "tenant-async", planId: "plan-pro", invoiceId: "inv-async" },
          client_reference_id: "tenant-async",
          customer: "cus_async",
          subscription: "sub_async_created",
          payment_status: "unpaid",
          status: "complete",
        },
      },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    // No activation (deferred), but the invoice was stamped with the sub id
    // so the later invoice.payment_succeeded can find it.
    expect(h.updates.find((u) => u.table === "tenants")).toBeUndefined();
    const invUpdate = h.updates.find((u) => u.table === "invoices");
    expect(invUpdate?.values.stripeSubscriptionId).toBe("sub_async_created");
    expect(invUpdate?.values.stripeCustomerId).toBe("cus_async");
    expect(invUpdate?.values.status).toBeUndefined(); // NOT marked paid yet
    expect(res.json).toHaveBeenCalledWith({ received: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression: invoice.payment_succeeded arrives BEFORE the (unpaid) deferred
// checkout.session.completed (async payment race).
//
// /subscriptions/upgrade now stamps the LOCAL invoiceId onto the Stripe
// subscription metadata (subscription_data.metadata), which Stripe surfaces on
// the invoice via subscription_details.metadata. So even though the deferred
// checkout.session.completed has NOT yet run (the local invoice has NO
// stripeSubscriptionId stamped, so the sub-id correlation cannot match), the
// handler must still:
//   - look up the EXACT local pending invoice by its local invoiceId,
//   - mark that exact invoice paid,
//   - activate the tenant for the ANNUAL term (invoice.billingPeriodEnd).
// When the delayed unpaid checkout.session.completed finally arrives, it must
// be an idempotent no-op (no regression: invoice stays paid, tenant untouched).
// ─────────────────────────────────────────────────────────────────────────
describe("stripeWebhookHandler — invoice.payment_succeeded before delayed checkout completion", () => {
  it("marks the exact local invoice paid & activates annual via local invoiceId, then the delayed unpaid completion is idempotent", async () => {
    const annualPeriodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    // ── Step 1: invoice.payment_succeeded arrives FIRST ──
    // db.select order inside the local-invoiceId correlation path:
    //   1. lookup local invoice by its local id → the pending annual invoice
    //      (note: it has NO stripeSubscriptionId — the deferred
    //       checkout.session.completed has not run yet).
    //   2. plansTable lookup (inside activateSubscriptionForTenant)
    //   3. subscriptionsTable existing → none → insert
    h.selectQueue.push([
      {
        id: "inv-annual-race",
        status: "pending",
        tenantId: "tenant-race",
        planId: "plan-pro",
        billingPeriodEnd: annualPeriodEnd,
        stripeSubscriptionId: null,
      },
    ]);
    h.selectQueue.push([PLAN]);
    h.selectQueue.push([]);

    h.stripe.constructEvent.mockReturnValue({
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_STRIPE_RACE_1",
          customer: "cus_RACE",
          subscription: "sub_RACE123",
          period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          // No invoiceId on the invoice metadata — it arrives via the
          // subscription metadata (subscription_data.metadata) surfaced as
          // subscription_details.metadata.
          metadata: {},
          subscription_details: {
            metadata: { tenantId: "tenant-race", planId: "plan-pro", invoiceId: "inv-annual-race" },
          },
        },
      },
    });

    const first = makeReqRes();
    await handleStripeWebhook(first.req as never, first.res as never);

    // The EXACT local invoice (matched by its local id) was marked paid.
    const invPaid = h.updates.find(
      (u) => u.table === "invoices" && u.values.status === "paid",
    );
    expect(invPaid).toBeDefined();
    expect(invPaid?.values.paidAt).toBeInstanceOf(Date);
    expect(invPaid?.values.stripeInvoiceId).toBe("in_STRIPE_RACE_1");

    // Tenant activated.
    const tenantUpdate = h.updates.find((u) => u.table === "tenants");
    expect(tenantUpdate?.values.status).toBe("active");
    expect(tenantUpdate?.values.planId).toBe("pro");

    // Subscription created for the ANNUAL term — proves the LOCAL invoice's
    // billingPeriodEnd was used, not the 30-day Stripe period_end fallback.
    const subInsert = h.inserts.find((i) => i.table === "subscriptions");
    expect(subInsert).toBeDefined();
    expect(subInsert?.values.status).toBe("active");
    expect(subInsert?.values.currentPeriodEnd).toBe(annualPeriodEnd);
    const daysAway =
      ((subInsert?.values.currentPeriodEnd as Date).getTime() - Date.now()) /
      (24 * 60 * 60 * 1000);
    expect(daysAway).toBeGreaterThan(360);

    expect(logger.info).toHaveBeenCalledWith(
      { tenantId: "tenant-race", planId: "plan-pro", invoiceId: "inv-annual-race" },
      "[stripe-webhook] invoice.payment_succeeded — local invoice paid & activated",
    );
    expect(first.res.json).toHaveBeenCalledWith({ received: true });

    // ── Step 2: the delayed unpaid checkout.session.completed arrives ──
    // It must NOT activate (payment_status "unpaid") and must NOT mark the
    // already-paid invoice paid again — idempotent, no regression.
    vi.clearAllMocks();
    h.selectQueue.length = 0;
    h.claimQueue.length = 0;
    h.updates.length = 0;
    h.inserts.length = 0;

    h.stripe.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_race_delayed",
          metadata: { tenantId: "tenant-race", planId: "plan-pro", invoiceId: "inv-annual-race" },
          client_reference_id: "tenant-race",
          customer: "cus_RACE",
          subscription: "sub_RACE123",
          payment_status: "unpaid",
          status: "complete",
        },
      },
    });

    const second = makeReqRes();
    await handleStripeWebhook(second.req as never, second.res as never);

    // No regression: tenant not touched, no subscription writes, and the
    // invoice is only stamped with correlation ids (never re-marked paid here).
    expect(h.updates.find((u) => u.table === "tenants")).toBeUndefined();
    expect(h.updates.find((u) => u.table === "subscriptions")).toBeUndefined();
    expect(h.inserts.length).toBe(0);
    const invStamp = h.updates.find((u) => u.table === "invoices");
    expect(invStamp?.values.stripeSubscriptionId).toBe("sub_RACE123");
    expect(invStamp?.values.status).toBeUndefined(); // NOT re-marked paid
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "[stripe-webhook] checkout.session.completed — subscription activated",
    );
    expect(second.res.json).toHaveBeenCalledWith({ received: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression: annual invoice.payment_succeeded settles FIRST, then a *paid*
// checkout.session.completed arrives for the same local invoice.
//
// The annual invoice.payment_succeeded already marked the local invoice paid
// and activated the subscription for the ANNUAL term (invoice.billingPeriodEnd).
// The later paid checkout.session.completed carries the same invoiceId. It must
// idempotently SKIP activation for the already-paid local invoice so it cannot
// overwrite the annual currentPeriodEnd with the 30-day default, and must not
// re-mark the invoice paid or emit a duplicate activation.
// ─────────────────────────────────────────────────────────────────────────
describe("stripeWebhookHandler — annual invoice.payment_succeeded before paid checkout completion", () => {
  it("preserves the annual period and does not duplicate activation when the paid checkout.session.completed arrives after the annual invoice settled", async () => {
    const annualPeriodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    // ── Step 1: annual invoice.payment_succeeded arrives FIRST ──
    // db.select order inside the local-invoiceId correlation path:
    //   1. lookup local invoice by its local id → the pending annual invoice
    //   2. plansTable lookup (inside activateSubscriptionForTenant)
    //   3. subscriptionsTable existing → none → insert
    h.selectQueue.push([
      {
        id: "inv-annual-first",
        status: "pending",
        tenantId: "tenant-order",
        planId: "plan-pro",
        billingPeriodEnd: annualPeriodEnd,
        stripeSubscriptionId: null,
      },
    ]);
    h.selectQueue.push([PLAN]);
    h.selectQueue.push([]);

    h.stripe.constructEvent.mockReturnValue({
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_STRIPE_ORDER_1",
          customer: "cus_ORDER",
          subscription: "sub_ORDER123",
          period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          metadata: {},
          subscription_details: {
            metadata: { tenantId: "tenant-order", planId: "plan-pro", invoiceId: "inv-annual-first" },
          },
        },
      },
    });

    const first = makeReqRes();
    await handleStripeWebhook(first.req as never, first.res as never);

    // Subscription created for the ANNUAL term.
    const firstSubInsert = h.inserts.find((i) => i.table === "subscriptions");
    expect(firstSubInsert).toBeDefined();
    expect(firstSubInsert?.values.currentPeriodEnd).toBe(annualPeriodEnd);
    expect(first.res.json).toHaveBeenCalledWith({ received: true });

    // ── Step 2: the paid checkout.session.completed arrives afterwards ──
    // db.select order inside checkout.session.completed (paid path):
    //   1. lookup local invoice by metadata.invoiceId → already PAID
    // The handler attempts an ATOMIC claim (…WHERE status != PAID) which loses
    // (0 rows), so NO activation follows.
    vi.clearAllMocks();
    h.selectQueue.length = 0;
    h.claimQueue.length = 0;
    h.updates.length = 0;
    h.inserts.length = 0;

    h.selectQueue.push([
      {
        id: "inv-annual-first",
        status: "paid",
        tenantId: "tenant-order",
        planId: "plan-pro",
        billingPeriodEnd: annualPeriodEnd,
        stripeSubscriptionId: "sub_ORDER123",
      },
    ]);
    // The atomic claim loses — the invoice is already PAID.
    h.claimQueue.push([]);

    h.stripe.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_order_paid",
          metadata: { tenantId: "tenant-order", planId: "plan-pro", invoiceId: "inv-annual-first" },
          client_reference_id: "tenant-order",
          customer: "cus_ORDER",
          subscription: "sub_ORDER123",
          payment_status: "paid",
          status: "complete",
        },
      },
    });

    const second = makeReqRes();
    await handleStripeWebhook(second.req as never, second.res as never);

    // No duplicate activation: the atomic claim lost (invoice already PAID), so
    // the tenant is untouched and no subscription is inserted/updated — the
    // annual period is preserved.
    expect(h.updates.find((u) => u.table === "tenants")).toBeUndefined();
    expect(h.updates.find((u) => u.table === "subscriptions")).toBeUndefined();
    expect(h.inserts.length).toBe(0);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "[stripe-webhook] checkout.session.completed — subscription activated",
    );
    expect(second.res.json).toHaveBeenCalledWith({ received: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression: Stripe-native trial completion must PRESERVE the pre-provisioned
// trial period, and a duplicate delivery must be idempotent.
//
// The /subscriptions/upgrade native-trial path creates a Stripe Checkout
// Session WITHOUT a local invoiceId and pre-inserts a PENDING_PAYMENT
// subscription whose currentPeriodEnd is the planned trial end (with
// trialStart/trialEnd set). When the customer completes checkout Stripe POSTs
// checkout.session.completed with payment_status "no_payment_required" and NO
// invoiceId. The handler must activate the tenant/subscription WITHOUT
// overwriting the established trial period with the 30-day activation default,
// and a redelivered event must be an idempotent no-op.
// ─────────────────────────────────────────────────────────────────────────
describe("stripeWebhookHandler — Stripe-native trial completion & duplicate", () => {
  it("preserves the pre-provisioned trial period (no 30-day clobber) and is idempotent on redelivery", async () => {
    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    // db.select order inside checkout.session.completed (no invoiceId → no
    // invoice lookup; native-trial activation path):
    //   1. plansTable lookup (inside activateSubscriptionForTenant)
    //   2. subscriptionsTable existing → the pre-provisioned trial sub
    h.selectQueue.push([PLAN]);
    h.selectQueue.push([
      {
        id: "sub-trial-existing",
        createdAt: new Date(),
        status: "pending_payment",
        planId: "plan-pro",
        currentPeriodEnd: trialEnd,
        trialEnd,
        stripeSubscriptionId: null,
      },
    ]);

    h.stripe.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: "tenant-native-trial", planId: "plan-pro" },
          client_reference_id: "tenant-native-trial",
          customer: "cus_native_trial",
          subscription: "sub_native_trial",
          payment_status: "no_payment_required",
          status: "complete",
          // NO invoiceId — native trial creates no local invoice.
        },
      },
    });

    const first = makeReqRes();
    await handleStripeWebhook(first.req as never, first.res as never);

    // Tenant activated.
    const tenantUpdate = h.updates.find((u) => u.table === "tenants");
    expect(tenantUpdate?.values.status).toBe("active");

    // The existing subscription is updated in place — and its currentPeriodEnd
    // is the PRESERVED trial end (not a fresh +30 days).
    const subUpdate = h.updates.find((u) => u.table === "subscriptions");
    expect(subUpdate).toBeDefined();
    expect(subUpdate?.values.status).toBe("active");
    expect(subUpdate?.values.currentPeriodEnd).toBe(trialEnd);
    // No fresh subscription row was inserted.
    expect(h.inserts.find((i) => i.table === "subscriptions")).toBeUndefined();

    const daysAway =
      ((subUpdate?.values.currentPeriodEnd as Date).getTime() - Date.now()) /
      (24 * 60 * 60 * 1000);
    expect(daysAway).toBeLessThan(20); // trial term, NOT the 30-day default
    expect(daysAway).toBeGreaterThan(10);
    expect(first.res.json).toHaveBeenCalledWith({ received: true });

    // ── Duplicate delivery ──
    // The subscription is now ACTIVE for the same plan + Stripe subscription id.
    // A redelivered native-trial completion must be an idempotent no-op: the
    // activation helper detects the already-provisioned row and skips the write.
    vi.clearAllMocks();
    h.selectQueue.length = 0;
    h.claimQueue.length = 0;
    h.updates.length = 0;
    h.inserts.length = 0;

    h.selectQueue.push([PLAN]);
    h.selectQueue.push([
      {
        id: "sub-trial-existing",
        createdAt: new Date(),
        status: "active",
        planId: "plan-pro",
        currentPeriodEnd: trialEnd,
        trialEnd,
        stripeSubscriptionId: "sub_native_trial",
      },
    ]);

    h.stripe.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: "tenant-native-trial", planId: "plan-pro" },
          client_reference_id: "tenant-native-trial",
          customer: "cus_native_trial",
          subscription: "sub_native_trial",
          payment_status: "no_payment_required",
          status: "complete",
        },
      },
    });

    const second = makeReqRes();
    await handleStripeWebhook(second.req as never, second.res as never);

    // The subscription row is NOT rewritten on the duplicate (period preserved).
    expect(h.updates.find((u) => u.table === "subscriptions")).toBeUndefined();
    expect(h.inserts.find((i) => i.table === "subscriptions")).toBeUndefined();
    expect(second.res.json).toHaveBeenCalledWith({ received: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression: two GENUINELY CONCURRENT no_payment_required trial deliveries
// must activate exactly once via the durable atomic subscription-level claim.
//
// For a confirmed checkout.session.completed with NO local invoice (a native
// trial), there is no invoice to claim against. The concurrency defence lives
// on the pre-provisioned PENDING_PAYMENT subscription row: activation flips it
// to ACTIVE with a conditional UPDATE (…WHERE id=? AND status != ACTIVE) and
// RETURNs the claimed id. When two parallel deliveries race, exactly ONE wins
// the row and reports activation; the other matches zero rows and performs no
// activation/write. We simulate the race by dispatching both handlers before
// awaiting either, and seed the claim queue so the second conditional UPDATE
// matches zero rows (the winner already flipped it to ACTIVE).
// ─────────────────────────────────────────────────────────────────────────
describe("stripeWebhookHandler — concurrent no_payment_required trial claim", () => {
  it("activates exactly once when two parallel native-trial deliveries race for the same pre-provisioned subscription", async () => {
    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    // Both deliveries read the SAME pre-provisioned PENDING_PAYMENT sub before
    // either commits. db.select order per delivery (no invoiceId → native-trial
    // activation path):
    //   1. plansTable lookup (inside activateSubscriptionForTenant)
    //   2. subscriptionsTable existing → the pre-provisioned trial sub (pending)
    const pendingSub = {
      id: "sub-trial-race",
      createdAt: new Date(),
      status: "pending_payment",
      planId: "plan-pro",
      currentPeriodEnd: trialEnd,
      trialEnd,
      stripeSubscriptionId: null,
    };
    // Table-keyed queues so the two concurrent handlers each read the correct
    // rows regardless of microtask interleaving: every plansTable lookup gets
    // PLAN; every subscriptionsTable lookup gets the pre-provisioned pending
    // sub (both deliveries read PENDING — the loser read before the winner
    // committed).
    h.selectByTable["plans"] = [[PLAN], [PLAN]];
    h.selectByTable["subscriptions"] = [[pendingSub], [pendingSub]];

    // Atomic subscription claims, in dispatch order: A WINS (row returned),
    // B LOSES (zero rows — A already flipped status to ACTIVE).
    h.claimQueue.push([{ id: "sub-trial-race" }]);
    h.claimQueue.push([]);

    const makeEvent = () => ({
      type: "checkout.session.completed" as const,
      data: {
        object: {
          metadata: { tenantId: "tenant-trial-race", planId: "plan-pro" },
          client_reference_id: "tenant-trial-race",
          customer: "cus_trial_race",
          subscription: "sub_native_trial_race",
          payment_status: "no_payment_required",
          status: "complete",
          // NO invoiceId, NO session.id → native-trial activation fallback.
        },
      },
    });

    h.stripe.constructEvent.mockReturnValue(makeEvent());

    // Dispatch BOTH handlers before awaiting either → genuinely concurrent.
    const a = makeReqRes();
    const b = makeReqRes();
    const pa = handleStripeWebhook(a.req as never, a.res as never);
    const pb = handleStripeWebhook(b.req as never, b.res as never);
    await Promise.all([pa, pb]);

    // Both deliveries issue the conditional UPDATE (…WHERE status != ACTIVE),
    // but only the winner matches a row. Every conditional UPDATE that DID run
    // targeted the ACTIVE transition and PRESERVED the pre-provisioned trial
    // period (no 30-day clobber, even from the loser's no-op statement).
    const subUpdates = h.updates.filter(
      (u) => u.table === "subscriptions" && u.values.status === "active",
    );
    for (const u of subUpdates) {
      expect(u.values.currentPeriodEnd).toBe(trialEnd);
    }
    // No fresh subscription row was inserted by either delivery.
    expect(h.inserts.find((i) => i.table === "subscriptions")).toBeUndefined();

    // The durable atomic claim guarantees EXACTLY ONE activation: only the
    // delivery whose conditional UPDATE matched a row (RETURNING a claimed id)
    // reports activation. So precisely one "subscription activated" log is
    // emitted across the two parallel deliveries — never two.
    const activationLogs = (logger.info as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => c[1] === "[stripe-webhook] checkout.session.completed — subscription activated",
    );
    expect(activationLogs.length).toBe(1);

    // Both deliveries acknowledge receipt so Stripe does not retry.
    expect(a.res.json).toHaveBeenCalledWith({ received: true });
    expect(b.res.json).toHaveBeenCalledWith({ received: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression: legacy paid checkout.session.completed with NO local invoice but
// WITH a Checkout Session id must activate via the durable atomic
// subscription-level claim, and a duplicate delivery must be an idempotent
// no-op.
//
// This is the legacy paid session shape: payment_status "paid", no invoiceId,
// but session.id present. Activation transitions the pre-provisioned pending
// subscription to ACTIVE via the conditional UPDATE (…WHERE status != ACTIVE);
// a redelivered event whose conditional UPDATE matches zero rows performs no
// second activation.
// ─────────────────────────────────────────────────────────────────────────
describe("stripeWebhookHandler — legacy paid session (no local invoice) atomic claim", () => {
  it("activates via the subscription claim on first delivery and is idempotent on a duplicate", async () => {
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // ── First delivery ──
    // db.select order (no invoiceId → session.id path):
    //   1. plansTable lookup (inside activateSubscriptionForTenant)
    //   2. subscriptionsTable existing → the pre-provisioned pending sub
    h.selectQueue.push([PLAN]);
    h.selectQueue.push([
      {
        id: "sub-legacy",
        createdAt: new Date(),
        status: "pending_payment",
        planId: "plan-pro",
        currentPeriodEnd: periodEnd,
        stripeSubscriptionId: null,
      },
    ]);
    // Subscription claim WINS, then the invoice-by-session UPDATE (non-claim).
    h.claimQueue.push([{ id: "sub-legacy" }]);

    h.stripe.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_legacy_paid",
          metadata: { tenantId: "tenant-legacy", planId: "plan-pro" },
          client_reference_id: "tenant-legacy",
          customer: "cus_legacy",
          subscription: "sub_legacy_created",
          payment_status: "paid",
          status: "complete",
          // NO invoiceId, but session.id present → legacy paid session path.
        },
      },
    });

    const first = makeReqRes();
    await handleStripeWebhook(first.req as never, first.res as never);

    const subActivation = h.updates.find(
      (u) => u.table === "subscriptions" && u.values.status === "active",
    );
    expect(subActivation).toBeDefined();
    expect(subActivation?.values.stripeSubscriptionId).toBe("sub_legacy_created");
    expect(logger.info).toHaveBeenCalledWith(
      { tenantId: "tenant-legacy", planId: "plan-pro" },
      "[stripe-webhook] checkout.session.completed — subscription activated",
    );
    expect(first.res.json).toHaveBeenCalledWith({ received: true });

    // ── Duplicate delivery ──
    // The sub still reads PENDING at select time (redelivery read before the
    // first committed), but the conditional claim matches ZERO rows because the
    // first delivery already flipped it to ACTIVE → no second activation.
    vi.clearAllMocks();
    h.selectQueue.length = 0;
    h.claimQueue.length = 0;
    h.updates.length = 0;
    h.inserts.length = 0;

    h.selectQueue.push([PLAN]);
    h.selectQueue.push([
      {
        id: "sub-legacy",
        createdAt: new Date(),
        status: "pending_payment",
        planId: "plan-pro",
        currentPeriodEnd: periodEnd,
        stripeSubscriptionId: null,
      },
    ]);
    h.claimQueue.push([]); // subscription claim LOSES

    h.stripe.constructEvent.mockReturnValue({
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_legacy_paid",
          metadata: { tenantId: "tenant-legacy", planId: "plan-pro" },
          client_reference_id: "tenant-legacy",
          customer: "cus_legacy",
          subscription: "sub_legacy_created",
          payment_status: "paid",
          status: "complete",
        },
      },
    });

    const second = makeReqRes();
    await handleStripeWebhook(second.req as never, second.res as never);

    // No second activation: the conditional claim lost, so no activation log
    // and no fresh subscription insert.
    expect(h.inserts.find((i) => i.table === "subscriptions")).toBeUndefined();
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "[stripe-webhook] checkout.session.completed — subscription activated",
    );
    expect(second.res.json).toHaveBeenCalledWith({ received: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Regression: concurrent / duplicate confirmed deliveries must settle & activate
// exactly once via the atomic invoice claim.
//
// Two invoice.payment_succeeded deliveries (or a paid checkout racing an
// invoice.payment_succeeded) target the same local PENDING invoice. Only the
// winning conditional UPDATE (…WHERE status != PAID) may activate; the loser
// matches zero rows and performs no activation — so the tenant is activated
// exactly once and no billing period is overwritten.
// ─────────────────────────────────────────────────────────────────────────
describe("stripeWebhookHandler — concurrent invoice settlement claim", () => {
  it("activates exactly once when two invoice.payment_succeeded events race for the same invoice", async () => {
    const annualPeriodEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

    const makeEvent = () => ({
      type: "invoice.payment_succeeded" as const,
      data: {
        object: {
          id: "in_RACE_DUP",
          customer: "cus_RACE_DUP",
          subscription: "sub_RACE_DUP",
          period_end: Math.floor((Date.now() + 30 * 24 * 60 * 60 * 1000) / 1000),
          metadata: {},
          subscription_details: {
            metadata: { tenantId: "tenant-claim", planId: "plan-pro", invoiceId: "inv-claim" },
          },
        },
      },
    });

    // ── Winner ──
    // db.select order in the local-invoiceId correlation path:
    //   1. lookup local invoice by its local id → pending annual invoice
    //   2. plansTable lookup (activateSubscriptionForTenant)
    //   3. subscriptionsTable existing → none → insert
    h.selectQueue.push([
      {
        id: "inv-claim",
        status: "pending",
        tenantId: "tenant-claim",
        planId: "plan-pro",
        billingPeriodEnd: annualPeriodEnd,
        stripeSubscriptionId: null,
      },
    ]);
    h.selectQueue.push([PLAN]);
    h.selectQueue.push([]);
    // Claim WINS (default), but be explicit.
    h.claimQueue.push([{ id: "inv-claim" }]);

    h.stripe.constructEvent.mockReturnValue(makeEvent());
    const winner = makeReqRes();
    await handleStripeWebhook(winner.req as never, winner.res as never);

    const subInsert = h.inserts.find((i) => i.table === "subscriptions");
    expect(subInsert).toBeDefined();
    expect(subInsert?.values.currentPeriodEnd).toBe(annualPeriodEnd);
    expect(logger.info).toHaveBeenCalledWith(
      { tenantId: "tenant-claim", planId: "plan-pro", invoiceId: "inv-claim" },
      "[stripe-webhook] invoice.payment_succeeded — local invoice paid & activated",
    );
    expect(winner.res.json).toHaveBeenCalledWith({ received: true });

    // ── Loser (concurrent duplicate) ──
    vi.clearAllMocks();
    h.selectQueue.length = 0;
    h.claimQueue.length = 0;
    h.updates.length = 0;
    h.inserts.length = 0;

    // The invoice still reads PENDING at select time (the loser read before the
    // winner committed), but the conditional claim matches ZERO rows because the
    // winner already flipped it to PAID.
    h.selectQueue.push([
      {
        id: "inv-claim",
        status: "pending",
        tenantId: "tenant-claim",
        planId: "plan-pro",
        billingPeriodEnd: annualPeriodEnd,
        stripeSubscriptionId: null,
      },
    ]);
    h.claimQueue.push([]); // claim LOSES

    h.stripe.constructEvent.mockReturnValue(makeEvent());
    const loser = makeReqRes();
    await handleStripeWebhook(loser.req as never, loser.res as never);

    // No second activation: tenant untouched, no subscription writes.
    expect(h.updates.find((u) => u.table === "tenants")).toBeUndefined();
    expect(h.updates.find((u) => u.table === "subscriptions")).toBeUndefined();
    expect(h.inserts.length).toBe(0);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "[stripe-webhook] invoice.payment_succeeded — local invoice paid & activated",
    );
    expect(loser.res.json).toHaveBeenCalledWith({ received: true });
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

// ─────────────────────────────────────────────────────────────────────────
// Durable event-level idempotency.
//
// Stripe delivers events at-least-once. Before running ANY side effect the
// handler claims the event id with an INSERT … ON CONFLICT DO NOTHING
// RETURNING against stripe_webhook_events:
//   - winning delivery  → row returned → proceeds through the switch and, on
//     success, marks the claim "processed".
//   - duplicate/concurrent delivery → zero rows returned → 200 with NO side
//     effects (no tenant/subscription/invoice writes).
//   - handler failure → the claim is RELEASED (deleted) so Stripe's retry can
//     reprocess; failed events are never permanently suppressed.
// ─────────────────────────────────────────────────────────────────────────
describe("stripeWebhookHandler — durable event idempotency", () => {
  const paidCheckoutEvent = (eventId: string) => ({
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        metadata: { tenantId: "tenant-idem", planId: "plan-pro" },
        client_reference_id: "tenant-idem",
        customer: "cus_IDEM",
        subscription: "sub_IDEM",
        payment_status: "paid",
      },
    },
  });

  it("sequential duplicate: the first delivery activates & is marked processed; the redelivered same event id is a 200 no-op", async () => {
    // ── Delivery 1: event claim WINS ──
    h.selectQueue.push([PLAN]);
    h.selectQueue.push([]); // no existing subscription → insert
    h.stripe.constructEvent.mockReturnValue(paidCheckoutEvent("evt_seq_1"));

    const first = makeReqRes();
    await handleStripeWebhook(first.req as never, first.res as never);

    // Activated, and the claim was flipped to processed.
    expect(h.updates.find((u) => u.table === "tenants")?.values.status).toBe("active");
    expect(h.inserts.find((i) => i.table === "subscriptions")).toBeDefined();
    const processed = h.eventUpdates[0];
    expect(processed?.values.status).toBe("processed");
    expect(processed?.values.processedAt).toBeInstanceOf(Date);
    expect(first.res.json).toHaveBeenCalledWith({ received: true });
    expect(h.deletes.length).toBe(0);

    // ── Delivery 2: SAME event id redelivered → claim LOSES ──
    vi.clearAllMocks();
    h.selectQueue.length = 0;
    for (const k of Object.keys(h.selectByTable)) delete h.selectByTable[k];
    h.claimQueue.length = 0;
    h.eventClaimQueue.length = 0;
    h.updates.length = 0;
    h.inserts.length = 0;
    h.deletes.length = 0;
    h.eventUpdates.length = 0;

    h.eventClaimQueue.push([]); // ON CONFLICT DO NOTHING → zero rows → duplicate
    h.stripe.constructEvent.mockReturnValue(paidCheckoutEvent("evt_seq_1"));

    const second = makeReqRes();
    await handleStripeWebhook(second.req as never, second.res as never);

    // No side effects whatsoever on the duplicate, but still a 200.
    expect(h.updates.length).toBe(0);
    expect(h.inserts.length).toBe(0);
    expect(h.deletes.length).toBe(0);
    expect(h.eventUpdates.length).toBe(0);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      "[stripe-webhook] checkout.session.completed — subscription activated",
    );
    expect(second.res.json).toHaveBeenCalledWith({ received: true });
  });

  it("true concurrent duplicate: two deliveries of the same event id race — exactly one claims & activates, the other is a 200 no-op", async () => {
    // Winner reads plan + no existing sub (activates & inserts). Loser's claim
    // returns zero rows so it never reaches any select. Because the DB primary
    // key serialises the two inserts, exactly one wins regardless of ordering.
    h.selectQueue.push([PLAN]);
    h.selectQueue.push([]);
    // Two events dispatched concurrently; first claim WINS, second LOSES.
    h.eventClaimQueue.push([{ id: "claimed-event" }]);
    h.eventClaimQueue.push([]);
    h.stripe.constructEvent.mockReturnValue(paidCheckoutEvent("evt_concurrent_1"));

    const a = makeReqRes();
    const b = makeReqRes();
    // Dispatch BOTH before awaiting either → genuine interleaving.
    await Promise.all([
      handleStripeWebhook(a.req as never, a.res as never),
      handleStripeWebhook(b.req as never, b.res as never),
    ]);

    // Exactly one tenant activation and one subscription insert across BOTH.
    expect(h.updates.filter((u) => u.table === "tenants").length).toBe(1);
    expect(h.inserts.filter((i) => i.table === "subscriptions").length).toBe(1);
    // The winner marked its claim processed; the loser wrote nothing.
    expect(h.eventUpdates.length).toBe(1);
    expect(h.eventUpdates[0]?.values.status).toBe("processed");
    expect(h.deletes.length).toBe(0);
    // Both deliveries acknowledged with 200.
    expect(a.res.json).toHaveBeenCalledWith({ received: true });
    expect(b.res.json).toHaveBeenCalledWith({ received: true });
  });

  it("failed-then-retried: a handler failure ROLLS BACK the claim (no committed writes) so the retry (same event id) reclaims and succeeds", async () => {
    // ── Delivery 1: claim WINS, but the handler THROWS mid-processing ──
    // Force a throw inside the switch by making the plan lookup reject.
    h.selectQueue.push([PLAN]);
    h.selectQueue.push([]);
    h.faultInjection.shouldThrow = (op) => op.kind === "update" && op.table === "tenants";
    h.stripe.constructEvent.mockReturnValue(paidCheckoutEvent("evt_retry_1"));

    const first = makeReqRes();
    await handleStripeWebhook(first.req as never, first.res as never);

    // 500, and because the whole transaction ROLLED BACK, NOTHING committed:
    // no claim mark, no business writes, and crucially no manual DELETE (the
    // rollback releases the claim implicitly). Stripe will retry the same id.
    expect(first.res.status).toHaveBeenCalledWith(500);
    expect(h.deletes.length).toBe(0);
    expect(h.eventUpdates.length).toBe(0);
    expect(h.updates.length).toBe(0);
    expect(h.inserts.length).toBe(0);

    // ── Delivery 2: Stripe retries the SAME event id → claim reclaims & succeeds ──
    vi.clearAllMocks();
    h.selectQueue.length = 0;
    for (const k of Object.keys(h.selectByTable)) delete h.selectByTable[k];
    h.claimQueue.length = 0;
    h.eventClaimQueue.length = 0;
    h.updates.length = 0;
    h.inserts.length = 0;
    h.deletes.length = 0;
    h.eventUpdates.length = 0;
    h.faultInjection.shouldThrow = null;

    // The rolled-back claim means the reinsert WINS again (default empty queue).
    h.selectQueue.push([PLAN]);
    h.selectQueue.push([]);
    h.stripe.constructEvent.mockReturnValue(paidCheckoutEvent("evt_retry_1"));

    const second = makeReqRes();
    await handleStripeWebhook(second.req as never, second.res as never);

    // Now it activates and marks the claim processed — no permanent suppression.
    expect(h.updates.find((u) => u.table === "tenants")?.values.status).toBe("active");
    expect(h.inserts.find((i) => i.table === "subscriptions")).toBeDefined();
    expect(h.eventUpdates[0]?.values.status).toBe("processed");
    expect(h.deletes.length).toBe(0);
    expect(second.res.json).toHaveBeenCalledWith({ received: true });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Fault-injection regressions: prove FULL failure-atomicity. On an injected
  // failure at various points, the single transaction must roll back so NO
  // partial DB writes are committed (claim, business mutations, processed mark
  // all vanish) — leaving nothing for a Stripe retry to trip over.
  // ─────────────────────────────────────────────────────────────────────────

  it("failure AFTER the invoice claim rolls back the invoice write and the event claim (no committed writes)", async () => {
    // Paid checkout with a local invoice: the handler claims the invoice PAID,
    // then activation runs. Inject a failure on the invoice UPDATE itself so we
    // fail right at/after the claim — the buffered invoice write must NOT commit.
    h.selectQueue.push([
      { id: "inv-fault-1", status: "pending", tenantId: "tenant-fault", planId: "plan-pro", billingPeriodEnd: null },
    ]);
    h.faultInjection.shouldThrow = (op) => op.kind === "update" && op.table === "invoices";

    h.stripe.constructEvent.mockReturnValue({
      id: "evt_fault_invoice",
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: "tenant-fault", planId: "plan-pro", invoiceId: "inv-fault-1" },
          client_reference_id: "tenant-fault",
          customer: "cus_FAULT",
          subscription: "sub_FAULT",
          payment_status: "paid",
        },
      },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    // Full rollback: 500 and absolutely no committed writes of any kind.
    expect(res.status).toHaveBeenCalledWith(500);
    expect(h.updates.length).toBe(0);
    expect(h.inserts.length).toBe(0);
    expect(h.eventUpdates.length).toBe(0); // claim never marked processed
    expect(h.deletes.length).toBe(0); // no manual release — rollback handles it
  });

  it("failure AFTER activation but BEFORE the processed mark rolls EVERYTHING back (invoice + subscription + tenant + claim)", async () => {
    // Paid checkout, no local invoice → activation inserts a subscription and
    // updates the tenant. Inject the failure on the PROCESSED-MARK update
    // (stripe_webhook_events) so activation has fully "run" in-transaction, then
    // the final mark fails — the entire transaction must roll back.
    h.selectQueue.push([PLAN]); // plan lookup in activation
    h.selectQueue.push([]); // no existing subscription → insert
    h.faultInjection.shouldThrow = (op) =>
      op.kind === "update" && op.table === "stripe_webhook_events" && op.values?.status === "processed";

    h.stripe.constructEvent.mockReturnValue({
      id: "evt_fault_processed",
      type: "checkout.session.completed",
      data: {
        object: {
          metadata: { tenantId: "tenant-fault2", planId: "plan-pro" },
          client_reference_id: "tenant-fault2",
          customer: "cus_FAULT2",
          subscription: "sub_FAULT2",
          payment_status: "paid",
        },
      },
    });

    const { req, res } = makeReqRes();
    await handleStripeWebhook(req as never, res as never);

    // Even though activation ran inside the transaction, the processed-mark
    // failure rolls back the tenant update, the subscription insert, AND the
    // event claim — nothing is committed, so a retry cleanly reprocesses.
    expect(res.status).toHaveBeenCalledWith(500);
    expect(h.updates.find((u) => u.table === "tenants")).toBeUndefined();
    expect(h.inserts.find((i) => i.table === "subscriptions")).toBeUndefined();
    expect(h.updates.length).toBe(0);
    expect(h.inserts.length).toBe(0);
    expect(h.eventUpdates.length).toBe(0);
    expect(h.deletes.length).toBe(0);
  });
});
