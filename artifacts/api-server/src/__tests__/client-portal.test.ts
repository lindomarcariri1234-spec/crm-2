/**
 * Integration tests for GET /api/client/me and PATCH /api/client/me.
 *
 * Covers:
 *   - userId lookup (client found directly by userId)
 *   - email-fallback lookup (userId not linked, client found by email)
 *   - auto-link update (email fallback + userId is null → db.update called)
 *   - 403 for non-"cliente" roles
 *   - PATCH propagates name to both clientsTable and usersTable
 *
 * DB call order for GET /api/client/me:
 *   1. db.select usersTable.where.limit     → user row
 *   2. db.select tenantsTable.where.limit   → tenant row
 *   3. findClientRecord: userId lookup      → clientsTable.where.limit
 *   4. findClientRecord: email fallback     → clientsTable.where.limit  (if #3 empty)
 *   5. db.update clientsTable              → auto-link  (if #4 found & userId null)
 *   6. reservations: innerJoin → orderBy
 *   7. referrals: where → groupBy
 *
 * DB call order for PATCH /api/client/me:
 *   1. findClientRecord: userId lookup      → clientsTable.where.limit
 *   2. findClientRecord: email fallback     → clientsTable.where.limit  (if #1 empty)
 *   3. db.update clientsTable (profile)
 *   4. db.update usersTable (name)          (only when name is in payload)
 *   5. re-fetch: clientsTable.where.limit
 */

import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// vi.hoisted: shared mock builders — must exist before vi.mock factories run
// ---------------------------------------------------------------------------

const {
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockOrderBy,
  mockGroupBy,
  mockInnerJoinWhere,
  mockInnerJoin,
  mockSetWhere,
  mockReturning,
  mockSet,
  mockUpdate,
  mockGetClerkUser,
  mockTransaction,
  mockExecute,
} = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockGroupBy = vi.fn();
  const mockOrderBy = vi.fn();

  const mockInnerJoinWhere = vi.fn(() => ({ orderBy: mockOrderBy, limit: mockLimit }));
  const mockInnerJoin = vi.fn(() => ({ where: mockInnerJoinWhere }));

  const mockWhere = vi.fn(() => ({
    limit: mockLimit,
    groupBy: mockGroupBy,
    orderBy: mockOrderBy,
  }));

  const mockFrom = vi.fn(() => ({
    where: mockWhere,
    limit: mockLimit,
    innerJoin: mockInnerJoin,
  }));

  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockSetWhere = vi.fn(() => ({ returning: mockReturning }));
  const mockSet = vi.fn(() => ({ where: mockSetWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));
  const mockGetClerkUser = vi.fn();
  const mockTransaction = vi.fn();
  const mockExecute = vi.fn();

  return {
    mockLimit,
    mockWhere,
    mockFrom,
    mockSelect,
    mockOrderBy,
    mockGroupBy,
    mockInnerJoinWhere,
    mockInnerJoin,
    mockSetWhere,
    mockReturning,
    mockSet,
    mockUpdate,
    mockGetClerkUser,
    mockTransaction,
    mockExecute,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    transaction: mockTransaction,
  },
  clientsTable: {},
  usersTable: {},
  tenantsTable: {},
  reservationsTable: {},
  tripsTable: {},
  referralsTable: {},
  storesTable: {},
  storeOrdersTable: {},
  storeOrderItemsTable: {},
  storeProductsTable: {},
  storeProductVariantsTable: {},
  storeCouponsTable: {},
  storeReviewsTable: {},
  storeCategoriesTable: {},
  passengersTable: {},
  loyaltyMembersTable: {},
  loyaltyTransactionsTable: {},
  loyaltyProgramsTable: {},
  referralSettingsTable: {},
  dealsTable: {},
  pipelineStagesTable: {},
  emailLogsTable: {},
  referralTrackingTable: {},
  paymentsTable: {},
  commissionsTable: {},
  clientNpsResponsesTable: {},
  clientFavoritesTable: {},
  tripMediaTable: {},
  clientAchievementsTable: {},
  clientDreamDestinationsTable: {},
  clientNotificationsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn((...a) => a),
  or: vi.fn((...a) => a),
  inArray: vi.fn(() => "inArray"),
  desc: vi.fn(() => "desc"),
  asc: vi.fn(() => "asc"),
  lt: vi.fn(() => "lt"),
  isNull: vi.fn(() => "isNull"),
  ilike: vi.fn(() => "ilike"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: { getUser: mockGetClerkUser },
  },
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["admin"],
  MANAGEMENT_ROLES: ["admin", "manager"],
}));

vi.mock("../queues/email-helpers.js", () => ({
  dispatchReferralWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReferralBonusPaidEmail: vi.fn().mockResolvedValue(undefined),
  sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReservationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReservationCancellationEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/index.js", () => ({
  getPdfQueue: vi.fn().mockReturnValue({ add: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("../lib/client-sse.js", () => ({
  addClientSseConnection: vi.fn(),
  removeClientSseConnection: vi.fn(),
}));

vi.mock("../lib/client-notifications.js", () => ({
  getRecentNotifications: vi.fn().mockResolvedValue([]),
  getUnreadCount: vi.fn().mockResolvedValue(0),
  markAllRead: vi.fn().mockResolvedValue(undefined),
  insertClientNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/redis.js", () => ({
  areWorkersEnabled: vi.fn().mockResolvedValue(false),
  getRedis: vi.fn().mockReturnValue(null),
}));

vi.mock("../lib/referral-code.js", () => ({
  generateAndAssignReferralCode: vi.fn().mockResolvedValue("REF-TEST"),
}));

vi.mock("../lib/voucher-pdf.js", () => ({
  generateVoucherPdf: vi.fn().mockResolvedValue(Buffer.from("fake-pdf")),
}));

vi.mock("../lib/referral-tiers.js", () => ({
  computeReferralTier: vi.fn().mockReturnValue({
    tier: { level: "bronze", label: "Bronze", bonusMultiplier: 1, minReferrals: 0 },
    nextTier: null,
    progress: 0,
  }),
  DEFAULT_TIERS: [],
}));

// ---------------------------------------------------------------------------
// Import route + helpers AFTER all mocks
// ---------------------------------------------------------------------------

import { requireAuth } from "../lib/tenant.js";
import clientPortalRouter from "../routes/client-portal.js";
import { errorHandler } from "../middlewares/errorHandler.js";
import { computeReferralTier } from "../lib/referral-tiers.js";
import { generateVoucherPdf } from "../lib/voucher-pdf.js";

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

function stubLogger(req: express.Request, _res: express.Response, next: express.NextFunction) {
  const noop = () => {};
  (req as unknown as { log: unknown }).log = {
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
  };
  next();
}

function buildClientPortalApp() {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", clientPortalRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const FAKE_ME_CLIENTE = {
  id: "user-001",
  clerkId: "clerk-user-001",
  tenantId: "tenant-001",
  role: "cliente",
  name: "Maria Souza",
  email: "maria@example.com",
};

const FAKE_ME_ADMIN = {
  id: "user-002",
  tenantId: "tenant-001",
  role: ROLES.AGENCY_ADMIN,
  name: "Admin User",
  email: "admin@example.com",
};

const FAKE_USER_ROW = {
  id: "user-001",
  name: "Maria Souza",
  email: "maria@example.com",
  cpf: null,
  referralCode: "REF-MARIA",
  createdAt: new Date("2024-01-15T10:00:00Z"),
};

const FAKE_TENANT_ROW = {
  id: "tenant-001",
  name: "Agência Viagens",
  slug: "agencia-viagens",
  logoUrl: null,
  primaryColor: "#3B82F6",
};

const FAKE_CLIENT_WITH_USERID = {
  id: "client-001",
  tenantId: "tenant-001",
  userId: "user-001",
  name: "Maria Souza",
  email: "maria@example.com",
  phone: "+55 11 99999-0001",
  cpf: "123.456.789-00",
  birthDate: null,
  addressCity: "São Paulo",
  addressState: "SP",
  referralCode: "REF-CLIENT",
  updatedAt: new Date(),
};

const FAKE_CLIENT_NO_USERID = {
  ...FAKE_CLIENT_WITH_USERID,
  userId: null,
};

// ---------------------------------------------------------------------------
// Re-establish all mock implementations after vi.resetAllMocks()
// ---------------------------------------------------------------------------

function setupDefaultDbMocks() {
  // select chain
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit, innerJoin: mockInnerJoin });
  // mockWhere returns a thenable (resolves to []) that also exposes chain methods so that
  // both `await db.select().from(X).where(Y)` and `db.select().from(X).where(Y).limit(1)` work.
  mockWhere.mockReturnValue(
    Object.assign(Promise.resolve([]), { limit: mockLimit, groupBy: mockGroupBy, orderBy: mockOrderBy }),
  );
  mockInnerJoin.mockReturnValue({ where: mockInnerJoinWhere });
  mockInnerJoinWhere.mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });
  mockLimit.mockResolvedValue([]);
  mockOrderBy.mockResolvedValue([]);
  mockGroupBy.mockResolvedValue([]);

  // update chain
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockSetWhere });
  mockSetWhere.mockReturnValue({ returning: mockReturning });
  mockReturning.mockResolvedValue([{ id: "client-001" }]);
  mockExecute.mockResolvedValue([]);
  mockTransaction.mockImplementation(async (callback) => callback({
    select: mockSelect,
    update: mockUpdate,
    execute: mockExecute,
  }));
  mockGetClerkUser.mockResolvedValue({
    primaryEmailAddressId: "email-001",
    emailAddresses: [{
      id: "email-001",
      emailAddress: "maria@example.com",
      verification: { status: "verified" },
    }],
  });

  // re-establish computeReferralTier after vi.resetAllMocks() clears it
  vi.mocked(computeReferralTier).mockReturnValue({
    tier: { level: "bronze", label: "Bronze", bonusMultiplier: 1, minReferrals: 0 },
    nextTier: null,
    progress: 0,
  });
}

// ---------------------------------------------------------------------------
// Tests: GET /api/client/me
// ---------------------------------------------------------------------------

describe("GET /api/client/me", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  // vi.resetAllMocks() clears the "once" queue AND resets implementations;
  // setupDefaultDbMocks re-establishes sane defaults for every test.
  beforeEach(() => {
    vi.resetAllMocks();
    setupDefaultDbMocks();
  });

  it("returns 403 when authenticated user has role other than 'cliente'", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_ADMIN as never);

    const app = buildClientPortalApp();
    const res = await request(app).get("/api/client/me");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
  });

  it("returns 200 and client profile when client is found by userId", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    // Actual DB call order inside GET /api/client/me:
    //   1. user lookup (usersTable)
    //   2. tenant lookup (tenantsTable)
    //   3. findClientRecord: userId hit (clientsTable)
    mockLimit
      .mockResolvedValueOnce([FAKE_USER_ROW])           // #1 user
      .mockResolvedValueOnce([FAKE_TENANT_ROW])          // #2 tenant
      .mockResolvedValueOnce([FAKE_CLIENT_WITH_USERID]); // #3 userId hit → found

    const app = buildClientPortalApp();
    const res = await request(app).get("/api/client/me");

    expect(res.status).toBe(200);
    expect(res.body.client).toMatchObject({
      id: "client-001",
      name: "Maria Souza",
      email: "maria@example.com",
    });
    expect(res.body.user).toMatchObject({ id: "user-001" });
    expect(res.body.tenant).toMatchObject({ id: "tenant-001" });
    expect(res.body.reservations).toEqual([]);
    expect(res.body.referral).toMatchObject({ totalReferrals: 0 });
  });

  it("finds client via email fallback when userId lookup returns nothing", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    // 1. user lookup
    // 2. tenant lookup
    // 3. findClientRecord: userId → empty
    // 4. findClientRecord: email → found (client already has userId set)
    mockLimit
      .mockResolvedValueOnce([FAKE_USER_ROW])           // #1 user
      .mockResolvedValueOnce([FAKE_TENANT_ROW])          // #2 tenant
      .mockResolvedValueOnce([])                         // #3 userId miss
      .mockResolvedValueOnce([FAKE_CLIENT_WITH_USERID]); // #4 email hit

    const app = buildClientPortalApp();
    const res = await request(app).get("/api/client/me");

    expect(res.status).toBe(200);
    expect(res.body.client).toMatchObject({ id: "client-001" });
    // client already had userId set → no auto-link update
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("auto-links userId when email fallback finds a client with no userId", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    // 1. user lookup
    // 2. tenant lookup
    // 3. findClientRecord: userId → empty
    // 4. findClientRecord: email → found (userId is null → triggers update)
    mockLimit
      .mockResolvedValueOnce([FAKE_USER_ROW])          // #1 user
      .mockResolvedValueOnce([FAKE_TENANT_ROW])         // #2 tenant
      .mockResolvedValueOnce([])                        // #3 userId miss
      .mockResolvedValueOnce([FAKE_CLIENT_NO_USERID]);  // #4 email hit, no userId

    const app = buildClientPortalApp();
    const res = await request(app).get("/api/client/me");

    expect(res.status).toBe(200);
    // db.update must have been called once to persist the userId link
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ userId: FAKE_ME_CLIENTE.id }));
    expect(res.body.client).toMatchObject({ id: "client-001" });
  });

  it("matches the email fallback ignoring case and surrounding spaces", async () => {
    requireAuthMock.mockResolvedValue({
      ...FAKE_ME_CLIENTE,
      email: "  MARIA@EXAMPLE.COM  ",
    } as never);

    mockLimit
      .mockResolvedValueOnce([FAKE_USER_ROW])
      .mockResolvedValueOnce([FAKE_TENANT_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([FAKE_CLIENT_WITH_USERID]);

    const res = await request(buildClientPortalApp()).get("/api/client/me");

    expect(res.status).toBe(200);
    expect(res.body.client).toMatchObject({ id: "client-001" });
  });

  it("does not expose an ambiguous email shared by multiple client records", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    mockLimit
      .mockResolvedValueOnce([FAKE_USER_ROW])
      .mockResolvedValueOnce([FAKE_TENANT_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        FAKE_CLIENT_NO_USERID,
        { ...FAKE_CLIENT_NO_USERID, id: "client-002" },
      ]);

    const res = await request(buildClientPortalApp()).get("/api/client/me");

    expect(res.status).toBe(200);
    expect(res.body.client).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does not expose a client record already linked to another user", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    mockLimit
      .mockResolvedValueOnce([FAKE_USER_ROW])
      .mockResolvedValueOnce([FAKE_TENANT_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        ...FAKE_CLIENT_WITH_USERID,
        userId: "different-user",
      }]);

    const res = await request(buildClientPortalApp()).get("/api/client/me");

    expect(res.status).toBe(200);
    expect(res.body.client).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns no client when a concurrent account wins the conditional link", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);
    mockReturning.mockResolvedValueOnce([]);

    mockLimit
      .mockResolvedValueOnce([FAKE_USER_ROW])
      .mockResolvedValueOnce([FAKE_TENANT_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([FAKE_CLIENT_NO_USERID]);

    const res = await request(buildClientPortalApp()).get("/api/client/me");

    expect(res.status).toBe(200);
    expect(res.body.client).toBeNull();
  });

  it("does not claim when the protected lookup sees a newly duplicated client", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    mockLimit
      .mockResolvedValueOnce([FAKE_USER_ROW])
      .mockResolvedValueOnce([FAKE_TENANT_ROW])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        FAKE_CLIENT_NO_USERID,
        { ...FAKE_CLIENT_NO_USERID, id: "client-002" },
      ]);

    const res = await request(buildClientPortalApp()).get("/api/client/me");

    expect(res.status).toBe(200);
    expect(res.body.client).toBeNull();
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does not use or claim the email fallback when Clerk has not verified it", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);
    mockGetClerkUser.mockResolvedValueOnce({
      primaryEmailAddressId: "email-001",
      emailAddresses: [{
        id: "email-001",
        emailAddress: "maria@example.com",
        verification: { status: "unverified" },
      }],
    });

    mockLimit
      .mockResolvedValueOnce([FAKE_USER_ROW])
      .mockResolvedValueOnce([FAKE_TENANT_ROW])
      .mockResolvedValueOnce([]);

    const res = await request(buildClientPortalApp()).get("/api/client/me");

    expect(res.status).toBe(200);
    expect(res.body.client).toBeNull();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLimit).toHaveBeenCalledTimes(3);
  });

  it("returns null client and empty reservations when no client record exists", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    // 1. user lookup
    // 2. tenant lookup
    // 3. findClientRecord: userId → empty
    // 4. findClientRecord: email → empty → returns null
    mockLimit
      .mockResolvedValueOnce([FAKE_USER_ROW])   // #1 user
      .mockResolvedValueOnce([FAKE_TENANT_ROW]) // #2 tenant
      .mockResolvedValueOnce([])                // #3 userId miss
      .mockResolvedValueOnce([]);               // #4 email miss

    const app = buildClientPortalApp();
    const res = await request(app).get("/api/client/me");

    expect(res.status).toBe(200);
    expect(res.body.client).toBeNull();
    expect(res.body.reservations).toEqual([]);
    expect(res.body.referral.totalReferrals).toBe(0);
  });

  it("includes reservations and referral stats when client has data", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    const fakeReservationRow = {
      id: "res-001",
      reservationNumber: "AG-EX-202507-0001",
      status: "confirmed",
      voucherCode: "VCHR-0001",
      totalValue: "1200.00",
      paidValue: "600.00",
      paymentMethod: "pix",
      storeOrderId: null,
      createdAt: new Date("2025-01-10T08:00:00Z"),
      tripName: "Nordeste Express",
      tripDestination: "Fortaleza, CE",
      tripDepartureDate: new Date("2025-07-10T12:00:00Z"),
      tripReturnDate: new Date("2025-07-17T12:00:00Z"),
      tripType: "excursao",
    };

    const fakeReferralRow = {
      status: "completed",
      cnt: 3,
      total: "150.00",
    };

    // 1. user lookup
    // 2. tenant lookup
    // 3. findClientRecord: userId hit
    mockLimit
      .mockResolvedValueOnce([FAKE_USER_ROW])           // #1 user
      .mockResolvedValueOnce([FAKE_TENANT_ROW])          // #2 tenant
      .mockResolvedValueOnce([FAKE_CLIENT_WITH_USERID]); // #3 userId hit

    // reservations: innerJoin(...).where(...).orderBy(...)
    mockOrderBy.mockResolvedValueOnce([fakeReservationRow]);
    // referrals: where(...).groupBy(...)
    mockGroupBy.mockResolvedValueOnce([fakeReferralRow]);

    const app = buildClientPortalApp();
    const res = await request(app).get("/api/client/me");

    expect(res.status).toBe(200);
    expect(res.body.reservations).toHaveLength(1);
    expect(res.body.reservations[0]).toMatchObject({
      id: "res-001",
      totalValue: 1200,
      paidValue: 600,
      tripName: "Nordeste Express",
      tripDepartureDate: "2025-07-10",
      tripReturnDate: "2025-07-17",
    });
    expect(res.body.referral).toMatchObject({
      totalReferrals: 3,
      completedReferrals: 3,
      pendingReferrals: 0,
      totalEarnings: "150.00",
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/client/me/memories
// ---------------------------------------------------------------------------

describe("GET /api/client/me/memories", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  const fakeTrip = {
    reservationId: "reservation-memory-001",
    tripId: "trip-memory-001",
    tripName: "Férias em Porto Seguro",
    tripDestination: "Porto Seguro, BA",
    tripDestinationCity: "Porto Seguro",
    tripDestinationState: "BA",
    tripCoverImage: "https://cdn.example.com/porto-seguro-cover.jpg",
    tripDepartureDate: new Date("2025-01-10T12:00:00Z"),
    tripReturnDate: new Date("2025-01-17T12:00:00Z"),
    tripVideos: [
      "https://cdn.example.com/videos/porto-seguro-1.mp4",
      "https://www.youtube.com/watch?v=porto-seguro",
    ],
  };
  type MemoryTripRow = Omit<typeof fakeTrip, "tripVideos"> & {
    tripVideos: string[] | null;
  };

  const fakePhoto = {
    id: "trip-media-001",
    tripId: fakeTrip.tripId,
    tenantId: FAKE_ME_CLIENTE.tenantId,
    url: "https://cdn.example.com/photos/porto-seguro-1.jpg",
    type: "photo",
    caption: "Praia",
    createdAt: new Date("2025-01-18T12:00:00Z"),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    setupDefaultDbMocks();
  });

  function setupMemoryQuery({
    trip = fakeTrip,
    nps = [],
    media = [],
  }: {
    trip?: MemoryTripRow | null;
    nps?: { reservationId: string }[];
    media?: typeof fakePhoto[];
  } = {}) {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    // findClientRecord: userId lookup.
    mockLimit.mockResolvedValueOnce([FAKE_CLIENT_WITH_USERID]);

    // reservationsWithTrips: innerJoin(...).where(...).orderBy(...)
    mockOrderBy.mockResolvedValueOnce(trip ? [trip] : []);

    if (!trip) return;

    // Promise.all in the route starts the NPS query first and the media query
    // second. Both `.where()` calls are awaited directly before media chains
    // into `.orderBy()`, so queue those two where results before orderBy.
    mockWhere
      .mockReturnValueOnce(
        Object.assign(Promise.resolve(nps), {
          limit: mockLimit,
          groupBy: mockGroupBy,
          orderBy: mockOrderBy,
        }),
      )
      .mockReturnValueOnce(
        Object.assign(Promise.resolve(media), {
          limit: mockLimit,
          groupBy: mockGroupBy,
          orderBy: mockOrderBy,
        }),
      );
    mockOrderBy.mockResolvedValueOnce(media);
  }

  it("returns video URLs in the memories contract for a trip with videos", async () => {
    setupMemoryQuery({ media: [fakePhoto] });

    const app = buildClientPortalApp();
    const res = await request(app).get("/api/client/me/memories");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      memories: [
        {
          reservationId: fakeTrip.reservationId,
          tripId: fakeTrip.tripId,
          tripName: fakeTrip.tripName,
          tripDestination: fakeTrip.tripDestination,
          tripDestinationCity: fakeTrip.tripDestinationCity,
          tripDestinationState: fakeTrip.tripDestinationState,
          tripCoverImage: fakeTrip.tripCoverImage,
          tripDepartureDate: fakeTrip.tripDepartureDate.toISOString(),
          tripReturnDate: fakeTrip.tripReturnDate.toISOString(),
          npsSubmitted: false,
          tripVideos: fakeTrip.tripVideos,
          media: [
            {
              id: fakePhoto.id,
              url: fakePhoto.url,
              type: fakePhoto.type,
              caption: fakePhoto.caption,
              createdAt: fakePhoto.createdAt.toISOString(),
            },
          ],
        },
      ],
    });
  });

  it("returns an empty tripVideos array when a trip has no videos", async () => {
    setupMemoryQuery({
      trip: { ...fakeTrip, tripVideos: null },
    });

    const app = buildClientPortalApp();
    const res = await request(app).get("/api/client/me/memories");

    expect(res.status).toBe(200);
    expect(res.body.memories).toHaveLength(1);
    expect(res.body.memories[0]).toMatchObject({
      tripId: fakeTrip.tripId,
      tripVideos: [],
      media: [],
    });
  });

  it("returns the empty memories state when the client has no past trips", async () => {
    setupMemoryQuery({ trip: null });

    const app = buildClientPortalApp();
    const res = await request(app).get("/api/client/me/memories");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ memories: [] });
    // The route must not query media when there are no qualifying trips.
    expect(mockWhere).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: PATCH /api/client/me
// ---------------------------------------------------------------------------

describe("PATCH /api/client/me", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.resetAllMocks();
    setupDefaultDbMocks();
  });

  it("returns 403 when user is not a 'cliente'", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_ADMIN as never);

    const app = buildClientPortalApp();
    const res = await request(app).patch("/api/client/me").send({ name: "New Name" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
  });

  it("returns 400 when body fails schema validation", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    const app = buildClientPortalApp();
    // name must be min 1 char; sending empty string triggers validation error
    const res = await request(app).patch("/api/client/me").send({ name: "" });

    expect(res.status).toBe(400);
  });

  it("returns 404 when no client record is found for the authenticated user", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    // PATCH call order:
    //   1. findClientRecord: userId → empty
    //   2. findClientRecord: email → empty → null
    // Default mockLimit.mockResolvedValue([]) handles both lookups.
    // No further once-values needed.

    const app = buildClientPortalApp();
    const res = await request(app).patch("/api/client/me").send({ name: "Maria Nova" });

    expect(res.status).toBe(404);
  });

  it("updates clientsTable and usersTable when name is provided", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    const updatedClient = { ...FAKE_CLIENT_WITH_USERID, name: "Maria Nova" };

    // PATCH call order:
    //   1. findClientRecord: userId hit
    //   (2 db.update calls follow — mockUpdate chain, not mockLimit)
    //   3. re-fetch after update
    mockLimit
      .mockResolvedValueOnce([FAKE_CLIENT_WITH_USERID]) // #1 userId hit
      .mockResolvedValueOnce([updatedClient]);           // #2 re-fetch

    const app = buildClientPortalApp();
    const res = await request(app)
      .patch("/api/client/me")
      .send({ name: "Maria Nova" });

    expect(res.status).toBe(200);

    // db.update called twice: clientsTable then usersTable
    expect(mockUpdate).toHaveBeenCalledTimes(2);

    // First call (clientsTable): must include name + updatedAt timestamp
    expect(mockSet).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ name: "Maria Nova", updatedAt: expect.any(Date) }),
    );

    // Second call (usersTable): name only
    expect(mockSet).toHaveBeenNthCalledWith(2, expect.objectContaining({ name: "Maria Nova" }));

    expect(res.body.name).toBe("Maria Nova");
  });

  it("updates only clientsTable (not usersTable) when name is absent from the payload", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    const updatedClient = { ...FAKE_CLIENT_WITH_USERID, phone: "+55 11 88888-0002" };

    mockLimit
      .mockResolvedValueOnce([FAKE_CLIENT_WITH_USERID]) // #1 userId hit
      .mockResolvedValueOnce([updatedClient]);           // #2 re-fetch

    const app = buildClientPortalApp();
    const res = await request(app)
      .patch("/api/client/me")
      .send({ phone: "+55 11 88888-0002" });

    expect(res.status).toBe(200);
    // Only one db.update call: clientsTable (no name → usersTable skipped)
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    // Update includes the phone field but NOT name
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ phone: "+55 11 88888-0002" }));
    expect(mockSet).not.toHaveBeenCalledWith(expect.objectContaining({ name: expect.anything() }));
  });

  it("propagates cpf and birthDate updates to clientsTable", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    const updatedClient = {
      ...FAKE_CLIENT_WITH_USERID,
      cpf: "987.654.321-00",
      birthDate: new Date("1990-05-20T12:00:00Z"),
    };

    mockLimit
      .mockResolvedValueOnce([FAKE_CLIENT_WITH_USERID]) // #1 userId hit
      .mockResolvedValueOnce([updatedClient]);           // #2 re-fetch

    const app = buildClientPortalApp();
    const res = await request(app)
      .patch("/api/client/me")
      .send({ cpf: "987.654.321-00", birthDate: "1990-05-20" });

    expect(res.status).toBe(200);

    // clientsTable update: cpf present and birthDate stored as a Date instance
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ cpf: "98765432100", birthDate: expect.any(Date) }),
    );

    // birthDate in response formatted as YYYY-MM-DD
    expect(res.body.birthDate).toBe("1990-05-20");
  });
});

// ---------------------------------------------------------------------------
// Tests: POST /api/client/push-token
// ---------------------------------------------------------------------------

describe("POST /api/client/push-token", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.resetAllMocks();
    setupDefaultDbMocks();
  });

  it("returns 401 when the request is unauthenticated", async () => {
    // Mirror requireAuth's no-auth behavior: it writes the 401 itself and resolves null.
    requireAuthMock.mockImplementation(async (_req, res) => {
      res.status(401).json({
        error: "Not authenticated",
        code: "UNAUTHORIZED",
        message: "Not authenticated",
        requestId: "unknown",
      });
      return null;
    });

    const app = buildClientPortalApp();
    const res = await request(app)
      .post("/api/client/push-token")
      .send({ token: "ExponentPushToken[abc123]" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHORIZED");
    // Handler bails before touching the DB
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 when authenticated user has role other than 'cliente'", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_ADMIN as never);

    const app = buildClientPortalApp();
    const res = await request(app)
      .post("/api/client/push-token")
      .send({ token: "ExponentPushToken[abc123]" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when token is missing from the body", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    const app = buildClientPortalApp();
    const res = await request(app).post("/api/client/push-token").send({});

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when token is an empty string", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    const app = buildClientPortalApp();
    const res = await request(app).post("/api/client/push-token").send({ token: "" });

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 204 and updates clientsTable.expoPushToken when a valid token is provided", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    // findClientRecord: userId lookup hits on the first clientsTable query.
    mockLimit.mockResolvedValueOnce([FAKE_CLIENT_WITH_USERID]);

    const app = buildClientPortalApp();
    const res = await request(app)
      .post("/api/client/push-token")
      .send({ token: "ExponentPushToken[xyz789]" });

    expect(res.status).toBe(204);
    // db.update called once to persist the push token
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ expoPushToken: "ExponentPushToken[xyz789]" }),
    );
  });

  it("returns 404 when no client record is found for the authenticated user", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    // Default mockLimit.mockResolvedValue([]) makes both findClientRecord lookups miss → null.

    const app = buildClientPortalApp();
    const res = await request(app)
      .post("/api/client/push-token")
      .send({ token: "ExponentPushToken[abc123]" });

    expect(res.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: GET /api/client/reservations/:id/voucher  (lapChildCount)
// ---------------------------------------------------------------------------

/**
 * DB call order for GET /client/reservations/:id/voucher (userId hit path):
 *   mockLimit #1  – findClientRecord userId lookup        → [client]
 *   mockLimit #2  – reservation innerJoin where limit(1)  → [reservation row]
 *   mockLimit #3  – tenant (Promise.all first leg)        → [tenant row]
 *   mockLimit #4  – user   (Promise.all second leg)       → [user row]
 *
 *   mockWhere #1  – findClientRecord where (then .limit)
 *   mockWhere #2  – tenant where (then .limit)
 *   mockWhere #3  – user   where (then .limit)
 *   mockWhere #4  – passengers where — awaited directly   → passenger rows
 */

describe("GET /api/client/reservations/:id/voucher — lapChildCount", () => {
  const requireAuthMock = vi.mocked(requireAuth);
  const generateVoucherPdfMock = vi.mocked(generateVoucherPdf);

  const FAKE_RESERVATION_ROW = {
    id: "res-001",
    reservationNumber: "AG-EX-202507-0001",
    status: "confirmed",
    voucherCode: "VCHR-0001",
    totalValue: "1200.00",
    paidValue: "600.00",
    paymentMethod: "pix",
    createdAt: new Date("2025-07-01T10:00:00Z"),
    seats: ["1A"],
    boardingLocationId: null,
    tripName: "Nordeste Express",
    tripDestination: "Fortaleza, CE",
    tripDepartureDate: new Date("2025-07-10T12:00:00Z"),
    tripReturnDate: new Date("2025-07-17T12:00:00Z"),
    tripBoardingPoints: [],
  };

  const FAKE_TENANT_ROW_VOUCHER = {
    name: "Agência Viagens",
    primaryColor: "#3B82F6",
  };

  const FAKE_USER_ROW_VOUCHER = {
    name: "Maria Souza",
  };

  // Helper: shared thenable compatible with the .where() mock default behaviour.
  // Calls to mockWhere that are followed by .limit() need to expose .limit on the returned value.
  // The passengers query awaits mockWhere directly — we control that via the 4th once-value.
  function buildWhereMock() {
    return Object.assign(Promise.resolve([]), {
      limit: mockLimit,
      groupBy: mockGroupBy,
      orderBy: mockOrderBy,
    });
  }

  beforeEach(() => {
    vi.resetAllMocks();
    setupDefaultDbMocks();

    // generateVoucherPdf is synchronous in production code — return a real Buffer so
    // res.setHeader("Content-Length", pdfBuffer.length) doesn't blow up.
    generateVoucherPdfMock.mockReturnValue(Buffer.from("fake-pdf"));

    // Re-establish computeReferralTier after vi.resetAllMocks() clears it.
    vi.mocked(computeReferralTier).mockReturnValue({
      tier: { level: "bronze", label: "Bronze", bonusMultiplier: 1, minReferrals: 0 },
      nextTier: null,
      progress: 0,
    });
  });

  /**
   * Queues all four mockLimit slots plus the four mockWhere slots.
   * The caller supplies the passengers array that will be returned by the
   * fourth mockWhere call (the passengersTable query, awaited directly).
   */
  function setupVoucherMocks(passengers: { ageCategory: string; seatNumber: string | null }[]) {
    // mockLimit slots: client, reservation (via mockInnerJoinWhere→limit), tenant, user
    mockLimit
      .mockResolvedValueOnce([FAKE_CLIENT_WITH_USERID])  // #1 findClientRecord userId hit
      .mockResolvedValueOnce([FAKE_RESERVATION_ROW])      // #2 reservation innerJoin where limit
      .mockResolvedValueOnce([FAKE_TENANT_ROW_VOUCHER])   // #3 tenant (Promise.all)
      .mockResolvedValueOnce([FAKE_USER_ROW_VOUCHER]);    // #4 user  (Promise.all)

    // mockWhere slots: client, tenant, user chains consume once-values #1-#3;
    // slot #4 is the passengers query — awaited directly, so return a plain Promise.
    // All four mockWhere once-values use the same shape (Object.assign keeps TypeScript happy).
    // The 4th slot resolves to `passengers` — the passengersTable query is awaited directly
    // (no .limit/.orderBy chained after it), so its resolved value is what the route sees.
    mockWhere
      .mockReturnValueOnce(buildWhereMock())                                                    // #1 findClientRecord .where().limit()
      .mockReturnValueOnce(buildWhereMock())                                                    // #2 tenant .where().limit()
      .mockReturnValueOnce(buildWhereMock())                                                    // #3 user   .where().limit()
      .mockReturnValueOnce(                                                                     // #4 passengersTable .where() (awaited directly)
        Object.assign(Promise.resolve(passengers), {
          limit: mockLimit,
          groupBy: mockGroupBy,
          orderBy: mockOrderBy,
        }),
      );
  }

  it("calls generateVoucherPdf with lapChildCount:1 when one baby passenger has no seat", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    setupVoucherMocks([
      { ageCategory: "baby", seatNumber: null },  // lap child — should be counted
    ]);

    const app = buildClientPortalApp();
    const res = await request(app).get("/api/client/reservations/res-001/voucher");

    expect(res.status).toBe(200);
    expect(generateVoucherPdfMock).toHaveBeenCalledOnce();
    expect(generateVoucherPdfMock).toHaveBeenCalledWith(
      expect.objectContaining({ lapChildCount: 1 }),
    );
  });

  it("calls generateVoucherPdf with lapChildCount:undefined when baby passenger has a seat", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    setupVoucherMocks([
      { ageCategory: "baby", seatNumber: "1A" },  // has a seat — NOT a lap child
    ]);

    const app = buildClientPortalApp();
    const res = await request(app).get("/api/client/reservations/res-001/voucher");

    expect(res.status).toBe(200);
    expect(generateVoucherPdfMock).toHaveBeenCalledOnce();
    expect(generateVoucherPdfMock).toHaveBeenCalledWith(
      expect.objectContaining({ lapChildCount: undefined }),
    );
  });

  it("calls generateVoucherPdf with lapChildCount:undefined when there are no baby passengers", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ME_CLIENTE as never);

    setupVoucherMocks([
      { ageCategory: "adult", seatNumber: "1A" },
      { ageCategory: "child", seatNumber: "1B" },
    ]);

    const app = buildClientPortalApp();
    const res = await request(app).get("/api/client/reservations/res-001/voucher");

    expect(res.status).toBe(200);
    expect(generateVoucherPdfMock).toHaveBeenCalledOnce();
    expect(generateVoucherPdfMock).toHaveBeenCalledWith(
      expect.objectContaining({ lapChildCount: undefined }),
    );
  });
});
