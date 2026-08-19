/**
 * Endpoint-level tests for the duplicate client detection and merge flow:
 *   GET  /api/clients/duplicates
 *   POST /api/clients/:id/merge
 *
 * Uses supertest with vi.mock to drive real Express route handlers while
 * isolating the DB and all external services.
 */

import pino from "pino";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// vi.hoisted: shared mock builders must exist before any vi.mock factory runs
// ---------------------------------------------------------------------------

const {
  mockHaving,
  mockGroupBy,
  mockOrderBy,
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockTransaction,
  mockUpdate,
  mockInsert,
  capturedInsertValues,
} = vi.hoisted(() => {
  const capturedInsertValues: Record<string, unknown>[] = [];

  // Terminal mocks (awaitable query results)
  const mockHaving = vi.fn();
  const mockOrderBy = vi.fn();
  const mockLimit = vi.fn();

  // Intermediate chain
  const mockGroupBy = vi.fn(() => ({ having: mockHaving }));
  const mockWhere = vi.fn(() => ({
    limit: mockLimit,
    groupBy: mockGroupBy,
    orderBy: mockOrderBy,
  }));
  const mockFrom = vi.fn(() => ({
    where: mockWhere,
    limit: mockLimit,
    orderBy: mockOrderBy,
  }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  const mockTransaction = vi.fn();

  const mockUpdateWhere = vi.fn().mockResolvedValue([]);
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

  const mockInsertValues = vi.fn().mockImplementation((vals: Record<string, unknown>) => {
    capturedInsertValues.push(vals);
    return Promise.resolve([]);
  });
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

  return {
    mockHaving,
    mockGroupBy,
    mockOrderBy,
    mockLimit,
    mockWhere,
    mockFrom,
    mockSelect,
    mockTransaction,
    mockUpdate,
    mockInsert,
    capturedInsertValues,
  };
});

// ---------------------------------------------------------------------------
// Module mocks — table sentinels carry _table names so tx.update() calls
// can be inspected per-table in assertions.
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
    transaction: mockTransaction,
  },
  clientsTable:          { _table: "clients" },
  notesTable:            { _table: "notes" },
  reservationsTable:     { _table: "reservations" },
  tripsTable:            { _table: "trips" },
  npsResponsesTable:     { _table: "npsResponses" },
  referralsTable:        { _table: "referrals" },
  usersTable:            { _table: "users" },
  paymentsTable:         { _table: "payments" },
  dealsTable:            { _table: "deals" },
  storeOrdersTable:      { _table: "storeOrders" },
  storeReviewsTable:     { _table: "storeReviews" },
  clientScoresTable:     { _table: "clientScores" },
  loyaltyMembersTable:   { _table: "loyaltyMembers" },
  tenantsTable:          { _table: "tenants" },
  referralAttemptLogsTable: { _table: "referralAttemptLogs" },
  calendarEventsTable:   { _table: "calendarEvents" },
  campaignSendsTable:    { _table: "campaignSends" },
  clientNpsResponsesTable: { _table: "clientNpsResponses" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn((...a: unknown[]) => a),
  or: vi.fn((...a: unknown[]) => a),
  inArray: vi.fn(() => "inArray"),
  desc: vi.fn(() => "desc"),
  asc: vi.fn(() => "asc"),
  ilike: vi.fn(() => "ilike"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
  count: vi.fn(() => "count"),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["admin"],
  MANAGEMENT_ROLES: ["admin", "manager"],
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "note-gen-id"),
  generateReferralCode: vi.fn(() => "REF-001"),
  generateVoucherCode: vi.fn(() => "VCHR-001"),
}));

vi.mock("../lib/referral-code.js", () => ({
  generateAndAssignReferralCode: vi.fn().mockResolvedValue("REF-001"),
}));

vi.mock("../queues/email-helpers.js", () => ({
  dispatchReferralWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  dispatchReferralCodeSuspendedEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReservationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/cpf.js", () => ({
  validateCPF: vi.fn(() => true),
  cleanCPF: vi.fn((v: string) => v),
}));

vi.mock("../lib/planLimits.js", () => ({
  checkPlanLimit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: {
    syncTrip: vi.fn().mockResolvedValue(undefined),
    syncBirthday: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/google-calendar/schedule-sync.js", () => ({
  scheduleCalendarSyncBirthday: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/client-scores.js", () => ({
  calculateScoresForClient: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/redis.js", () => ({
  getRedisConnection: vi.fn(() => null),
}));

vi.mock("../lib/ai-client.js", () => ({
  getAIClientForTenant: vi.fn(() => null),
}));

vi.mock("../lib/activities.js", () => ({
  writeClientActivity: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Import router and error handler AFTER all mocks
// ---------------------------------------------------------------------------

import { requireAuth } from "../lib/tenant.js";
import clientsRouter from "../routes/clients.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

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
  app.use("/api", clientsRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const ADMIN_USER = {
  id: "user-001",
  tenantId: "tenant-001",
  role: "admin",
  name: "Admin User",
  email: "admin@example.com",
};

const NON_ADMIN_USER = {
  id: "user-002",
  tenantId: "tenant-001",
  role: "vendedor",
  name: "Vendedor",
  email: "seller@example.com",
};

function makeFakeClient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "client-001",
    tenantId: "tenant-001",
    name: "Maria Silva",
    email: "maria@example.com",
    whatsapp: "+5511999999999",
    phone: null,
    cpf: "11111111100",
    rg: null,
    birthDate: null,
    gender: null,
    photoUrl: null,
    instagram: null,
    addressCity: null,
    addressState: null,
    classification: null,
    status: "active",
    tags: [],
    pipelineStage: null,
    totalSpent: "0",
    outstandingBalance: "0",
    npsScore: null,
    observations: null,
    dreamDestinations: [],
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    lastContactAt: null,
    origin: null,
    maritalStatus: null,
    professionalArea: null,
    favoriteDrink: null,
    companyFeedback: null,
    musicalPreferences: null,
    foodPreferences: null,
    internalRating: null,
    companyNps: null,
    travelInterests: [],
    ambassadorOptIn: null,
    customerCode: null,
    referralCode: null,
    referralSource: null,
    loyaltyPoints: null,
    sellerUserId: null,
    ...overrides,
  };
}

const PRIMARY   = makeFakeClient({ id: "client-001", name: "Maria Silva" });
const SECONDARY = makeFakeClient({ id: "client-002", name: "Maria Silva Duplicada", cpf: "11111111100" });
const SECONDARY_MERGED = makeFakeClient({ id: "client-002", status: "merged" });

// ---------------------------------------------------------------------------
// tx mock builder
// The tx.update spy captures which table object each call receives so tests
// can verify all expected FK tables are covered.
// ---------------------------------------------------------------------------

function buildTxMock() {
  const txWhere = vi.fn().mockResolvedValue([]);
  const txUpdateSet = vi.fn(() => ({ where: txWhere }));
  const txUpdate = vi.fn(() => ({ set: txUpdateSet }));
  const txDeleteWhere = vi.fn().mockResolvedValue([]);
  const txDelete = vi.fn(() => ({ where: txDeleteWhere }));
  const txInsertValues = vi.fn().mockImplementation((vals: Record<string, unknown>) => {
    capturedInsertValues.push(vals);
    return Promise.resolve([]);
  });
  const txInsert = vi.fn(() => ({ values: txInsertValues }));
  return { update: txUpdate, delete: txDelete, insert: txInsert };
}

// Helper: returns the _table sentinel names passed to tx.update(table) in call order.
function updatedTables(txUpdate: ReturnType<typeof vi.fn>): string[] {
  return (txUpdate.mock.calls as Array<[{ _table?: string }]>)
    .map((args) => args[0]?._table ?? "unknown");
}

// ---------------------------------------------------------------------------
// Tests: GET /api/clients/duplicates
// ---------------------------------------------------------------------------

describe("GET /api/clients/duplicates — duplicate detection", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    capturedInsertValues.length = 0;
    mockWhere.mockReturnValue({ limit: mockLimit, groupBy: mockGroupBy, orderBy: mockOrderBy });
    mockGroupBy.mockReturnValue({ having: mockHaving });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit, orderBy: mockOrderBy });
    mockSelect.mockReturnValue({ from: mockFrom });
    requireAuthMock.mockResolvedValue(ADMIN_USER as never);
  });

  it("returns 403 when the caller is not an admin", async () => {
    requireAuthMock.mockResolvedValue(NON_ADMIN_USER as never);
    const res = await request(buildApp()).get("/api/clients/duplicates");
    expect(res.status).toBe(403);
  });

  it("returns empty pairs when no duplicates exist", async () => {
    mockHaving.mockResolvedValueOnce([]); // CPF group query
    mockHaving.mockResolvedValueOnce([]); // name+WA group query

    const res = await request(buildApp()).get("/api/clients/duplicates");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ pairs: [], total: 0 });
  });

  it("returns a CPF duplicate pair when two clients share the same CPF", async () => {
    const client1 = makeFakeClient({ id: "c-001", cpf: "11111111100" });
    const client2 = makeFakeClient({ id: "c-002", cpf: "11111111100", name: "Maria S. Duplicada" });

    mockHaving.mockResolvedValueOnce([{ cpf: "11111111100" }]); // CPF groups
    mockOrderBy.mockResolvedValueOnce([client1, client2]);        // fetch CPF dupes
    mockHaving.mockResolvedValueOnce([]);                         // name+WA groups

    const res = await request(buildApp()).get("/api/clients/duplicates");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.pairs[0].reason).toBe("cpf");
    expect(res.body.pairs[0].clients).toHaveLength(2);
    expect(res.body.pairs[0].clients[0].id).toBe("c-001");
    expect(res.body.pairs[0].clients[1].id).toBe("c-002");
  });

  it("returns a name+whatsapp duplicate pair when clients share the same name and whatsapp", async () => {
    const client3 = makeFakeClient({ id: "c-003", cpf: null, name: "João Costa", whatsapp: "+5511888888888" });
    const client4 = makeFakeClient({ id: "c-004", cpf: null, name: "João Costa", whatsapp: "+5511888888888" });

    mockHaving.mockResolvedValueOnce([]);                                                           // CPF groups
    mockHaving.mockResolvedValueOnce([{ normName: "joão costa", whatsapp: "+5511888888888" }]);     // name+WA groups
    mockOrderBy.mockResolvedValueOnce([client3, client4]);                                          // fetch name+WA dupes

    const res = await request(buildApp()).get("/api/clients/duplicates");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.pairs[0].reason).toBe("name_whatsapp");
    expect(res.body.pairs[0].clients[0].id).toBe("c-003");
    expect(res.body.pairs[0].clients[1].id).toBe("c-004");
  });

  it("excludes clients whose status is 'merged' from duplicate pairs", async () => {
    // The SQL WHERE already filters merged records; the mock simulates this:
    // CPF group is found but the fetch of duplicate clients returns only one
    // active record (the second was merged and filtered by the DB).
    mockHaving.mockResolvedValueOnce([{ cpf: "11111111100" }]); // CPF group found
    mockOrderBy.mockResolvedValueOnce([                          // only one non-merged client remains
      makeFakeClient({ id: "c-001", cpf: "11111111100", status: "active" }),
    ]);
    mockHaving.mockResolvedValueOnce([]); // name+WA groups

    const res = await request(buildApp()).get("/api/clients/duplicates");

    expect(res.status).toBe(200);
    // Fewer than 2 active clients → no pair created
    expect(res.body.pairs).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it("excludes CPF-matched clients from the name+whatsapp group to prevent double-counting", async () => {
    const client1 = makeFakeClient({ id: "c-001", cpf: "11111111100", name: "Maria Silva", whatsapp: "+5511999" });
    const client2 = makeFakeClient({ id: "c-002", cpf: "11111111100", name: "Maria Silva", whatsapp: "+5511999" });

    mockHaving.mockResolvedValueOnce([{ cpf: "11111111100" }]);
    mockOrderBy.mockResolvedValueOnce([client1, client2]);     // CPF pair
    mockHaving.mockResolvedValueOnce([{ normName: "maria silva", whatsapp: "+5511999" }]);
    mockOrderBy.mockResolvedValueOnce([client1, client2]);     // same clients → filtered out

    const res = await request(buildApp()).get("/api/clients/duplicates");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);          // only the CPF pair
    expect(res.body.pairs[0].reason).toBe("cpf");
  });

  it("returns multiple CPF groups when multiple CPFs are duplicated", async () => {
    const ca1 = makeFakeClient({ id: "ca1", cpf: "11111111100" });
    const ca2 = makeFakeClient({ id: "ca2", cpf: "11111111100" });
    const cb1 = makeFakeClient({ id: "cb1", cpf: "22222222200" });
    const cb2 = makeFakeClient({ id: "cb2", cpf: "22222222200" });

    mockHaving.mockResolvedValueOnce([{ cpf: "11111111100" }, { cpf: "22222222200" }]);
    mockOrderBy.mockResolvedValueOnce([ca1, ca2, cb1, cb2]);
    mockHaving.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/api/clients/duplicates");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.pairs).toHaveLength(2);
    expect(res.body.pairs.every((p: { reason: string }) => p.reason === "cpf")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/clients/:id/merge
// ---------------------------------------------------------------------------

describe("POST /api/clients/:id/merge — transactional merge", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    capturedInsertValues.length = 0;
    mockWhere.mockReturnValue({ limit: mockLimit, groupBy: mockGroupBy, orderBy: mockOrderBy });
    mockGroupBy.mockReturnValue({ having: mockHaving });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit, orderBy: mockOrderBy });
    mockSelect.mockReturnValue({ from: mockFrom });
    requireAuthMock.mockResolvedValue(ADMIN_USER as never);
  });

  it("returns 403 when the caller is not an admin", async () => {
    requireAuthMock.mockResolvedValue(NON_ADMIN_USER as never);
    const res = await request(buildApp())
      .post("/api/clients/client-001/merge")
      .send({ secondaryId: "client-002" });
    expect(res.status).toBe(403);
  });

  it("returns 400 when secondaryId is missing from the request body", async () => {
    const res = await request(buildApp())
      .post("/api/clients/client-001/merge")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when primaryId and secondaryId are the same", async () => {
    const res = await request(buildApp())
      .post("/api/clients/client-001/merge")
      .send({ secondaryId: "client-001" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when the primary client is not found in the tenant", async () => {
    mockLimit
      .mockResolvedValueOnce([])          // primary → not found
      .mockResolvedValueOnce([SECONDARY]); // secondary → found

    const res = await request(buildApp())
      .post("/api/clients/nonexistent/merge")
      .send({ secondaryId: "client-002" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("returns 404 when the secondary client is not found in the tenant", async () => {
    mockLimit
      .mockResolvedValueOnce([PRIMARY])
      .mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/api/clients/client-001/merge")
      .send({ secondaryId: "nonexistent-secondary" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("returns 400 when the secondary client has already been merged", async () => {
    mockLimit
      .mockResolvedValueOnce([PRIMARY])
      .mockResolvedValueOnce([SECONDARY_MERGED]);

    const res = await request(buildApp())
      .post("/api/clients/client-001/merge")
      .send({ secondaryId: "client-002" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("executes the transaction and reassigns all FK tables to the primary client", async () => {
    const tx = buildTxMock();
    mockTransaction.mockImplementation(
      async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    );

    mockLimit
      .mockResolvedValueOnce([PRIMARY])    // primary lookup
      .mockResolvedValueOnce([SECONDARY])  // secondary lookup
      .mockResolvedValueOnce([PRIMARY]);    // final re-fetch

    const res = await request(buildApp())
      .post("/api/clients/client-001/merge")
      .send({ secondaryId: "client-002" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.client.id).toBe("client-001");

    // Both clientScores and campaignSends must be deleted for secondary
    expect(tx.delete).toHaveBeenCalledTimes(2);

    // Verify all expected FK tables are updated (10 FK updates + 1 status update = 11 total)
    const tables = updatedTables(tx.update);
    const EXPECTED_FK_TABLES = [
      "reservations",
      "payments",
      "deals",
      "storeOrders",
      "storeReviews",
      "notes",
      "calendarEvents",
      "referrals",
      "loyaltyMembers",
      "clientNpsResponses",
    ];
    for (const table of EXPECTED_FK_TABLES) {
      expect(tables, `expected tx.update to be called for table "${table}"`).toContain(table);
    }

    // The secondary client's status must be updated to "merged"
    expect(tables).toContain("clients");

    // Exactly 11 update calls (10 FK + 1 status)
    expect(tx.update).toHaveBeenCalledTimes(11);
  });

  it("inserts an audit note on the primary client during the merge transaction", async () => {
    const tx = buildTxMock();
    mockTransaction.mockImplementation(
      async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
    );

    mockLimit
      .mockResolvedValueOnce([PRIMARY])
      .mockResolvedValueOnce([SECONDARY])
      .mockResolvedValueOnce([PRIMARY]);

    await request(buildApp())
      .post("/api/clients/client-001/merge")
      .send({ secondaryId: "client-002" });

    expect(tx.insert).toHaveBeenCalled();
    const noteInsert = capturedInsertValues.find(
      (v) => (v as Record<string, unknown>).type === "merge",
    );
    expect(noteInsert).toBeDefined();
    expect((noteInsert as Record<string, unknown>).clientId).toBe("client-001");
    expect((noteInsert as Record<string, unknown>).isPrivate).toBe(true);
    expect(typeof (noteInsert as Record<string, unknown>).content).toBe("string");
    // Audit note must mention the secondary client's name
    expect((noteInsert as Record<string, unknown>).content as string).toContain(
      (SECONDARY as Record<string, unknown>).name as string,
    );
  });

  it("returns 404 and does not start the transaction when secondary is from another tenant", async () => {
    mockLimit
      .mockResolvedValueOnce([PRIMARY])
      .mockResolvedValueOnce([]); // cross-tenant secondary absent in this tenant

    const res = await request(buildApp())
      .post("/api/clients/client-001/merge")
      .send({ secondaryId: "other-tenant-client" });

    expect(res.status).toBe(404);
    expect(mockTransaction).not.toHaveBeenCalled();
  });
});
