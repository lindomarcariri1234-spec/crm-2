/**
 * Commission rule calculate regression tests — GET /commissions/calculate
 *
 * Verifies the critical bug fix: fixed-type commission rules must return the
 * fixed BRL amount directly, while percentage-type rules multiply saleAmount
 * by rate / 100.
 */

import pino from "pino";
import { COMMISSION_STATUS, ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// Hoisted mock state — must be declared before any vi.mock factory
// ---------------------------------------------------------------------------

const {
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockUpdate,
  mockSet,
  mockUpdateWhere,
  mockReturning,
} = vi.hoisted(() => {
  // Use loose vi.fn() so we can enqueue arbitrary resolved values without TS
  // complaining about the inferred return type of mockReturnValue.
  const mockLimit = vi.fn();
  const mockWhere = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn();
  const mockUpdate = vi.fn();
  const mockSet = vi.fn();
  const mockUpdateWhere = vi.fn();
  const mockReturning = vi.fn();
  return { mockLimit, mockWhere, mockFrom, mockSelect, mockUpdate, mockSet, mockUpdateWhere, mockReturning };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: mockUpdate,
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
  },
  commissionRulesTable: {
    tenantId: "tenantId",
    isActive: "isActive",
    id: "id",
    appliesTo: "appliesTo",
    tripId: "tripId",
    type: "type",
    value: "value",
  },
  commissionsTable: {
    id: "id",
    tenantId: "tenantId",
    ruleId: "ruleId",
    userId: "userId",
    reservationId: "reservationId",
    baseAmount: "baseAmount",
    commissionAmount: "commissionAmount",
    commissionRate: "commissionRate",
    commissionType: "commissionType",
    status: "status",
    paidAt: "paidAt",
    createdAt: "createdAt",
  },
  usersTable: {
    id: "id",
    tenantId: "tenantId",
    name: "name",
    commissionType: "commissionType",
    commissionRate: "commissionRate",
    commissionFixed: "commissionFixed",
  },
  tripsTable: {
    id: "id",
    tenantId: "tenantId",
    destinationCountry: "destinationCountry",
  },
}));

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["admin", ROLES.AGENCY_ADMIN],
  MANAGEMENT_ROLES: ["admin", "manager"],
  ALL_STAFF_ROLES: ["admin", "manager", "vendedor"],
}));

vi.mock("@workspace/shared", () => ({
  localToday: vi.fn(() => "2025-01-01"),
  roundMoney: (n: number) => Math.round(n * 100) / 100,
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { requireAuth } from "../lib/tenant.js";
import commissionsRouter from "../routes/commissions.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const FAKE_USER = {
  id: "user-001",
  tenantId: "tenant-001",
  role: ROLES.AGENCY_ADMIN,
  name: "Test Admin",
  email: "admin@example.com",
};

function stubLogger(
  req: express.Request & { log?: Record<string, unknown> },
  _res: express.Response,
  next: express.NextFunction,
) {
  req.log = pino({ level: "silent" }) as unknown as typeof req.log;
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", commissionsRouter);
  app.use(errorHandler);
  return app;
}

/**
 * Returns a mock chain for db.select().from().where() that resolves to `rows`.
 * The route's calculate handler calls: db.select().from(rulesTable).where(...)
 * which resolves to the rules array.
 */
function stubRulesQuery(rows: unknown[]) {
  mockWhere.mockReturnValueOnce(Promise.resolve(rows));
  mockFrom.mockReturnValueOnce({ where: mockWhere });
  mockSelect.mockReturnValueOnce({ from: mockFrom });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/commissions/calculate — rule type dispatch", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    requireAuthMock.mockResolvedValue(FAKE_USER as never);
    // Default fallback chain (for un-stubbed calls)
    mockWhere.mockReturnValue(Promise.resolve([]));
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockLimit.mockResolvedValue([]);
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockUpdateWhere });
    mockUpdateWhere.mockReturnValue({ returning: mockReturning });
    mockReturning.mockResolvedValue([]);
  });

  it("percentage rule: commissionAmount = saleAmount * rate / 100", async () => {
    // db.select().from(commissionRulesTable).where(...) → percentage rule
    stubRulesQuery([
      {
        id: "rule-001",
        type: "percentage",
        value: "10",
        appliesTo: "all",
        tripId: null,
        isActive: true,
        tenantId: FAKE_USER.tenantId,
      },
    ]);

    const app = buildApp();
    const res = await request(app)
      .get("/api/commissions/calculate")
      .query({ sellerId: "seller-001", saleAmount: "2000" });

    expect(res.status).toBe(200);
    expect(res.body.commissionType).toBe("percentage");
    expect(res.body.commissionAmount).toBe(200); // 2000 * 10 / 100
    expect(res.body.commissionRate).toBe(10);
    expect(res.body.source).toBe("rule");
  });

  it("fixed rule: commissionAmount equals the fixed BRL value, not saleAmount * value / 100", async () => {
    // A fixed rule with value "150" should yield 150.00, not (2000 * 150 / 100) = 3000
    stubRulesQuery([
      {
        id: "rule-002",
        type: "fixed",
        value: "150",
        appliesTo: "all",
        tripId: null,
        isActive: true,
        tenantId: FAKE_USER.tenantId,
      },
    ]);

    const app = buildApp();
    const res = await request(app)
      .get("/api/commissions/calculate")
      .query({ sellerId: "seller-001", saleAmount: "2000" });

    expect(res.status).toBe(200);
    expect(res.body.commissionType).toBe("fixed");
    expect(res.body.commissionAmount).toBe(150); // fixed BRL amount, NOT 2000*150/100=3000
    expect(res.body.commissionRate).toBeNull();   // no rate for fixed rules
    expect(res.body.source).toBe("rule");
  });

  it("fixed rule with decimal value: rounds correctly to 2 decimal places", async () => {
    stubRulesQuery([
      {
        id: "rule-003",
        type: "fixed",
        value: "99.99",
        appliesTo: "all",
        tripId: null,
        isActive: true,
        tenantId: FAKE_USER.tenantId,
      },
    ]);

    const app = buildApp();
    const res = await request(app)
      .get("/api/commissions/calculate")
      .query({ sellerId: "seller-001", saleAmount: "5000" });

    expect(res.status).toBe(200);
    expect(res.body.commissionType).toBe("fixed");
    expect(res.body.commissionAmount).toBe(99.99);
    expect(res.body.commissionRate).toBeNull();
    expect(res.body.source).toBe("rule");
  });

  it("percentage rule: zero rate yields zero commission", async () => {
    stubRulesQuery([
      {
        id: "rule-004",
        type: "percentage",
        value: "0",
        appliesTo: "all",
        tripId: null,
        isActive: true,
        tenantId: FAKE_USER.tenantId,
      },
    ]);

    const app = buildApp();
    const res = await request(app)
      .get("/api/commissions/calculate")
      .query({ sellerId: "seller-001", saleAmount: "1000" });

    expect(res.status).toBe(200);
    expect(res.body.commissionType).toBe("percentage");
    expect(res.body.commissionAmount).toBe(0);
    expect(res.body.commissionRate).toBe(0);
    expect(res.body.source).toBe("rule");
  });

  it("missing saleAmount returns 400", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/api/commissions/calculate")
      .query({ sellerId: "seller-001" });

    expect(res.status).toBe(400);
  });

  it("invalid saleAmount (non-numeric) returns 400", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/api/commissions/calculate")
      .query({ sellerId: "seller-001", saleAmount: "abc" });

    expect(res.status).toBe(400);
  });

  it("falls back to seller when no rule matches", async () => {
    const sellerRows = [
      {
        commissionType: "percentage",
        commissionRate: "5",
        commissionFixed: null,
      },
    ];

    // First db.select() call → rules query → empty array (no rules)
    // Second db.select() call → seller query → sellerRows via .limit(1)
    mockLimit
      .mockResolvedValueOnce(sellerRows); // seller lookup .limit(1)

    // Override mockWhere so rules query resolves to []
    // and seller query chain has { limit: mockLimit }
    mockWhere
      .mockReturnValueOnce(Promise.resolve([]))          // rules: .where() → [] (awaited directly)
      .mockReturnValueOnce({ limit: mockLimit });         // seller: .where() → { limit }

    mockFrom
      .mockReturnValueOnce({ where: mockWhere })          // rules from()
      .mockReturnValueOnce({ where: mockWhere });         // seller from()

    mockSelect
      .mockReturnValueOnce({ from: mockFrom })            // rules select()
      .mockReturnValueOnce({ from: mockFrom });           // seller select()

    const app = buildApp();
    const res = await request(app)
      .get("/api/commissions/calculate")
      .query({ sellerId: "seller-001", saleAmount: "1000" });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("seller");
    expect(res.body.commissionAmount).toBe(50); // 1000 * 5 / 100
    expect(res.body.commissionType).toBe("percentage");
  });

  it("applies a national rule before the general rule", async () => {
    const rules = [
      { id: "rule-all", type: "percentage", value: "2", appliesTo: "all", tripId: null, isActive: true },
      { id: "rule-national", type: "percentage", value: "10", appliesTo: "national", tripId: null, isActive: true },
    ];
    mockWhere
      .mockReturnValueOnce(Promise.resolve(rules))
      .mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([{ destinationCountry: "Brasil" }]);
    mockFrom
      .mockReturnValueOnce({ where: mockWhere })
      .mockReturnValueOnce({ where: mockWhere });
    mockSelect
      .mockReturnValueOnce({ from: mockFrom })
      .mockReturnValueOnce({ from: mockFrom });

    const res = await request(buildApp())
      .get("/api/commissions/calculate")
      .query({ sellerId: "seller-001", saleAmount: "1000", tripId: "trip-001" });

    expect(res.status).toBe(200);
    expect(res.body.commissionAmount).toBe(100);
    expect(res.body.source).toBe("rule");
  });

  it("includes the fixed part when previewing a hybrid seller commission", async () => {
    const sellerRows = [{
      commissionType: "hybrid",
      commissionRate: "5",
      commissionFixed: "30",
    }];
    mockLimit.mockResolvedValueOnce(sellerRows);
    mockWhere
      .mockReturnValueOnce(Promise.resolve([]))
      .mockReturnValueOnce({ limit: mockLimit });
    mockFrom
      .mockReturnValueOnce({ where: mockWhere })
      .mockReturnValueOnce({ where: mockWhere });
    mockSelect
      .mockReturnValueOnce({ from: mockFrom })
      .mockReturnValueOnce({ from: mockFrom });

    const res = await request(buildApp())
      .get("/api/commissions/calculate")
      .query({ sellerId: "seller-001", saleAmount: "1000" });

    expect(res.status).toBe(200);
    expect(res.body.commissionAmount).toBe(80);
    expect(res.body.commissionRate).toBe(5);
    expect(res.body.commissionType).toBe("hybrid");
  });

  it("denies commission reads to roles without COMMISSIONS.VIEW", async () => {
    requireAuthMock.mockResolvedValue({ ...FAKE_USER, role: ROLES.SUPPORT } as never);

    const res = await request(buildApp()).get("/api/commissions");

    expect(res.status).toBe(403);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("includes inactive rules so managers can review and reactivate them", async () => {
    const rules = [
      { id: "rule-active", isActive: true },
      { id: "rule-inactive", isActive: false },
    ];
    stubRulesQuery(rules);

    const res = await request(buildApp()).get("/api/commission-rules");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rules);
  });

  it("rejects direct transitions from pending to paid", async () => {
    const current = {
      id: "commission-001",
      tenantId: FAKE_USER.tenantId,
      status: "pending",
      paidAt: null,
    };
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([current]);
    mockFrom.mockReturnValueOnce({ where: mockWhere });
    mockSelect.mockReturnValueOnce({ from: mockFrom });

    const res = await request(buildApp())
      .patch("/api/commissions/commission-001")
      .send({ status: COMMISSION_STATUS.PAID });

    expect(res.status).toBe(409);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates a commission through the pending-to-approved transition", async () => {
    const current = {
      id: "commission-002",
      tenantId: FAKE_USER.tenantId,
      status: "pending",
      paidAt: null,
    };
    const updated = { ...current, status: "approved" };
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([current]);
    mockFrom.mockReturnValueOnce({ where: mockWhere });
    mockSelect.mockReturnValueOnce({ from: mockFrom });
    mockReturning.mockResolvedValueOnce([updated]);

    const res = await request(buildApp())
      .patch("/api/commissions/commission-002")
      .send({ status: COMMISSION_STATUS.APPROVED });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(COMMISSION_STATUS.APPROVED);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});
