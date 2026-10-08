import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const {
  selectQueue,
  mockSelect,
  mockUpdate,
  mockInsert,
  mockRequireAuth,
  mockStripeAccountsRetrieve,
  mockStripeConstructor,
  mockRequestLog,
} = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockInsert: vi.fn(),
  mockRequireAuth: vi.fn(),
  mockStripeAccountsRetrieve: vi.fn(),
  mockStripeConstructor: vi.fn(),
  mockRequestLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@workspace/db", () => {
  const makeTable = () => new Proxy({}, {
    get: (_target, property) => property,
  });
  return {
    db: {
      select: mockSelect,
      update: mockUpdate,
      insert: mockInsert,
    },
    storesTable: makeTable(),
    storeCategoriesTable: makeTable(),
    storeProductsTable: makeTable(),
    storeOrdersTable: makeTable(),
    storeOrderItemsTable: makeTable(),
    storeCouponsTable: makeTable(),
    storeReviewsTable: makeTable(),
    tenantsTable: makeTable(),
    paymentsTable: makeTable(),
    pipelineStagesTable: makeTable(),
    dealsTable: makeTable(),
    reservationsTable: makeTable(),
    referralsTable: makeTable(),
    partnerProductsTable: makeTable(),
    priceAlertSubscriptionsTable: makeTable(),
    tripsTable: makeTable(),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn(() => "and"),
  desc: vi.fn(() => "desc"),
  asc: vi.fn(() => "asc"),
  count: vi.fn(() => "count"),
  ilike: vi.fn(() => "ilike"),
  or: vi.fn(() => "or"),
  sql: vi.fn(() => "sql"),
  ne: vi.fn(() => "ne"),
  inArray: vi.fn(() => "inArray"),
}));

vi.mock("@workspace/permissions", () => ({
  PAYMENT_STATUS: { PAID: "paid", PENDING: "pending" },
  PAYMENT_TYPE: { RECEIVABLE: "receivable", PAYABLE: "payable" },
  RESERVATION_STATUS: { PENDING: "pending", CANCELLED: "cancelled", REFUNDED: "refunded", FAILED: "failed" },
  STORE_ORDER_STATUS: { CANCELLED: "cancelled", COMPLETED: "completed", PROCESSING: "processing", CONFIRMED: "confirmed", PENDING: "pending" },
  STORE_PAYMENT_STATUS: { PAID: "paid", PENDING: "pending", FAILED: "failed", REFUNDED: "refunded" },
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  ADMIN_ROLES: ["admin"],
}));

vi.mock("../lib/crypto.js", () => ({
  encryptCredential: vi.fn((value: string) => `enc:${value}`),
  decryptOrPassthrough: vi.fn((value: string | null | undefined) => {
    if (!value) return null;
    return value.startsWith("enc:") ? value.slice(4) : value;
  }),
}));

vi.mock("stripe", () => ({
  default: class StripeMock {
    accounts = { retrieve: mockStripeAccountsRetrieve };

    constructor(secretKey: string, options: unknown) {
      mockStripeConstructor(secretKey, options);
    }
  },
}));

vi.mock("../lib/id.js", () => ({ generateId: vi.fn(() => "generated-id") }));
vi.mock("../lib/realtime.js", () => ({ broadcastSeatUpdate: vi.fn() }));
vi.mock("../services/checkout/create-reservations.js", () => ({
  createReservationsForOrder: vi.fn(),
  confirmReservationsForOrder: vi.fn(),
}));
vi.mock("../services/checkout/post-booking.js", () => ({
  runDeferredOrderAccounting: vi.fn(),
  runPostPaymentSideEffects: vi.fn(),
}));
vi.mock("../services/checkout/deferred-referral-effects.js", () => ({
  expirePendingReferralForOrder: vi.fn(),
  restoreSpentCreditForOrder: vi.fn(),
}));
vi.mock("../queues/email-helpers.js", () => ({
  enqueueNewBookingNotificationEmail: vi.fn(),
  sendPriceDropAlertEmail: vi.fn(),
}));
vi.mock("../services/checkout/persist-order.js", () => ({
  applyOrderInventoryEffects: vi.fn(),
  reverseOrderInventoryEffects: vi.fn(),
}));
vi.mock("../services/checkout/cancel-partner-items.js", () => ({
  cancelPartnerOrderItems: vi.fn(),
}));
vi.mock("../services/settlements/financial-ledger.js", () => ({
  recordOrderPaymentSettlement: vi.fn(),
  reverseOrderSettlement: vi.fn(),
}));
vi.mock("../services/client-financials.js", () => ({
  recalculateClientFinancials: vi.fn(),
}));
vi.mock("../lib/linked-data.js", () => ({
  calculateReceivedAmount: vi.fn(),
  allocateOrderReceiptToReservation: vi.fn(),
  linkedReferral: vi.fn(),
  linkedReservation: vi.fn(),
  linkedOrder: vi.fn(),
  orderFinancialSummary: vi.fn(),
  reservationFinancialSummary: vi.fn(),
}));
vi.mock("../services/pipeline-deal-sync.js", () => ({ syncPaidProductOrderDeal: vi.fn() }));
vi.mock("../services/reservation-order-payment-sync.js", () => ({
  syncStoreOrderFromOrderPayment: vi.fn(),
}));
vi.mock("../lib/uploadthing.js", () => ({
  deleteOrphanedFile: vi.fn(),
  deleteOrphanedImages: vi.fn(),
}));
vi.mock("../lib/pricing.js", () => ({ roundMoney: vi.fn((value: number) => value) }));

import storeRouter from "../routes/store.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const STORE_WITH_SAVED_KEY = {
  id: "store-001",
  tenantId: "tenant-001",
  stripeSecretKey: "enc:sk_live_storedsecret",
};

function createSelectChain() {
  const rows = selectQueue.shift() ?? [];
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(rows));
  return chain;
}

function attachRequestLog(req: Request, _res: Response, next: NextFunction) {
  (req as unknown as { log?: typeof mockRequestLog }).log = mockRequestLog;
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(attachRequestLog);
  app.use("/api", storeRouter);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  selectQueue.length = 0;
  vi.clearAllMocks();
  mockSelect.mockImplementation(createSelectChain);
  mockRequireAuth.mockResolvedValue({
    id: "user-001",
    tenantId: "tenant-001",
    role: "admin",
  });
  mockStripeAccountsRetrieve.mockResolvedValue({ id: "acct_123", object: "account" });
});

describe("POST /api/store/settings/stripe/test", () => {
  it("permits only authenticated store administrators", async () => {
    mockRequireAuth.mockResolvedValueOnce({
      id: "user-001",
      tenantId: "tenant-001",
      role: "sales",
    });

    const response = await request(buildApp())
      .post("/api/store/settings/stripe/test")
      .send({ secretKey: "sk_test_candidate" });

    expect(response.status).toBe(403);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockStripeAccountsRetrieve).not.toHaveBeenCalled();
  });

  it("tests a new credential without saving, returning, or logging it", async () => {
    const candidateKey = "sk_test_new_candidate_secret";
    selectQueue.push([STORE_WITH_SAVED_KEY]);

    const response = await request(buildApp())
      .post("/api/store/settings/stripe/test")
      .send({ secretKey: candidateKey });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ connected: true, livemode: false });
    expect(mockStripeConstructor).toHaveBeenCalledWith(
      candidateKey,
      expect.objectContaining({ timeout: 10_000, maxNetworkRetries: 0 }),
    );
    expect(mockStripeAccountsRetrieve).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain(candidateKey);
    expect(mockRequestLog.info).not.toHaveBeenCalled();
    expect(mockRequestLog.warn).not.toHaveBeenCalled();
    expect(mockRequestLog.error).not.toHaveBeenCalled();
  });

  it("uses the stored write-only key when no new key is submitted", async () => {
    selectQueue.push([STORE_WITH_SAVED_KEY]);
    mockStripeAccountsRetrieve.mockResolvedValueOnce({ livemode: true });

    const response = await request(buildApp())
      .post("/api/store/settings/stripe/test")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ connected: true, livemode: true });
    expect(mockStripeConstructor).toHaveBeenCalledWith(
      "sk_live_storedsecret",
      expect.any(Object),
    );
    expect(mockStripeAccountsRetrieve).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(response.body)).not.toContain("sk_live_storedsecret");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns a safe, useful error when Stripe rejects an invalid or revoked key", async () => {
    const candidateKey = "sk_test_revoked_secret";
    selectQueue.push([STORE_WITH_SAVED_KEY]);
    mockStripeAccountsRetrieve.mockRejectedValueOnce(Object.assign(
      new Error(`Invalid API key: ${candidateKey}`),
      { type: "StripeAuthenticationError", statusCode: 401 },
    ));

    const response = await request(buildApp())
      .post("/api/store/settings/stripe/test")
      .send({ secretKey: candidateKey });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: "STRIPE_AUTHENTICATION_FAILED",
      error: expect.stringContaining("continua ativa"),
    });
    expect(JSON.stringify(response.body)).not.toContain(candidateKey);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRequestLog.error).not.toHaveBeenCalled();
  });

  it("requires authentication before reading a store or contacting Stripe", async () => {
    mockRequireAuth.mockImplementationOnce(async (_req: Request, res: Response) => {
      res.status(401).json({ error: "Authentication required" });
      return null;
    });

    const response = await request(buildApp())
      .post("/api/store/settings/stripe/test")
      .send({ secretKey: "sk_test_candidate" });

    expect(response.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockStripeAccountsRetrieve).not.toHaveBeenCalled();
  });
});

describe("GET /api/store/settings write-only Stripe key behavior", () => {
  it("returns only the configured flag instead of the saved secret", async () => {
    selectQueue.push(
      [STORE_WITH_SAVED_KEY],
      [{ settings: { pixQrDeliveryMode: "screen" } }],
    );

    const response = await request(buildApp()).get("/api/store/settings");

    expect(response.status).toBe(200);
    expect(response.body.stripeSecretKeyConfigured).toBe(true);
    expect(response.body).not.toHaveProperty("stripeSecretKey");
    expect(JSON.stringify(response.body)).not.toContain("sk_live_storedsecret");
  });
});
