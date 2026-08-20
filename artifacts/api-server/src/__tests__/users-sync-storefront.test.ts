/**
 * Tests for the storeSlug logic in POST /users/me/sync.
 *
 * Verifies three scenarios added in the storefront self-registration feature:
 *
 * 1. Happy path: a brand-new user with a valid, active storeSlug receives
 *    role=CLIENT and tenantId=store.tenantId (not the default AGENCY_ADMIN).
 * 2. Existing user: storeSlug is silently ignored — neither role nor tenantId
 *    is changed on the update path.
 * 3. Unknown / inactive storeSlug: the storesTable lookup returns no row, so
 *    the user falls back to the default AGENCY_ADMIN role with tenantId=null.
 */

import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// vi.hoisted — factories must exist before any vi.mock factory executes
// ---------------------------------------------------------------------------

const {
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockInsertValues,
  mockInsert,
  mockUpdate,
  mockSyncMeBodySafeParse,
  mockGetUser,
  mockCheckPlanLimit,
  mockCheckTenantAccess,
} = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  const mockInsertValues = vi.fn().mockResolvedValue([]);
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

  const mockUpdateWhere = vi.fn().mockResolvedValue([]);
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

  const mockSyncMeBodySafeParse = vi.fn();
  const mockGetUser = vi.fn();
  const mockCheckPlanLimit = vi.fn().mockResolvedValue(true);
  const mockCheckTenantAccess = vi.fn().mockResolvedValue(true);

  return {
    mockLimit, mockWhere, mockFrom, mockSelect,
    mockInsertValues, mockInsert, mockUpdate,
    mockSyncMeBodySafeParse, mockGetUser, mockCheckPlanLimit, mockCheckTenantAccess,
  };
});

// ---------------------------------------------------------------------------
// Module mocks (must appear before route import)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    transaction: vi.fn(),
  },
  usersTable: {},
  tenantsTable: {},
  invitesTable: {},
  clientsTable: {},
  storesTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn((...a: unknown[]) => a),
  or: vi.fn((...a: unknown[]) => a),
  gt: vi.fn(() => "gt"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: {
    users: { getUser: mockGetUser },
  },
  getAuth: vi.fn(() => ({ userId: "clerk_new_user" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  checkTenantAccess: mockCheckTenantAccess,
  ADMIN_ROLES: [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN],
  MANAGEMENT_ROLES: [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER],
}));

vi.mock("../lib/planLimits.js", () => ({
  checkPlanLimit: mockCheckPlanLimit,
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-user-id"),
}));

// SyncMeBody.safeParse is overridden per-test via the hoisted mock reference.
// SyncMeResponse.parse returns its argument so the route can JSON-serialize it.
vi.mock("@workspace/api-zod", () => ({
  SyncMeBody: { safeParse: mockSyncMeBodySafeParse },
  CreateUserBody: { safeParse: vi.fn() },
  UpdateUserBody: { safeParse: vi.fn() },
  GetMeResponse: {},
  SyncMeResponse: { parse: vi.fn((x: unknown) => x) },
}));

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

import usersRouter from "../routes/users.js";
import { errorHandler } from "../middlewares/errorHandler.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { log?: Record<string, unknown> }, _res, next) => {
    const noop = () => {};
    req.log = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop } as never;
    next();
  });
  app.use("/api", usersRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stub Clerk getUser to return a user with the given email and no inviteId. */
function stubClerkUser(email = "traveller@example.com") {
  mockGetUser.mockResolvedValue({
    emailAddresses: [{ id: "ea_1", emailAddress: email }],
    primaryEmailAddressId: "ea_1",
    publicMetadata: {},
  });
}

const BASE_BODY = { name: "Ana Viajante", email: "traveller@example.com", avatarUrl: null };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/users/me/sync — storeSlug storefront registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset queues that clearAllMocks doesn't drain
    mockLimit.mockReset();
    mockInsertValues.mockReset().mockResolvedValue([]);
    mockCheckPlanLimit.mockReset().mockResolvedValue(true);
    mockCheckTenantAccess.mockReset().mockResolvedValue(true);
  });

  // -------------------------------------------------------------------------
  // 1. Happy path: new user, valid active storeSlug → CLIENT + store tenantId
  // -------------------------------------------------------------------------

  it("assigns role=CLIENT and store tenantId for a brand-new user with a valid storeSlug", async () => {
    stubClerkUser();

    mockSyncMeBodySafeParse.mockReturnValue({
      success: true,
      data: { ...BASE_BODY, clerkId: "spoofed-clerk-id", storeSlug: "agencia-abc" },
    });

    // Select call sequence for the new-user path:
    // 1. usersTable lookup → [] (user does not exist yet)
    // 2. invitesTable byEmail → [] (no pending invite)
    // 3. storesTable by slug → [{tenantId: "store-tenant-001"}]
    // 4. usersTable re-fetch after insert → [new user row]
    const newUserRow = {
      id: "gen-user-id",
      clerkId: "clerk_new_user",
      tenantId: "store-tenant-001",
      name: "Ana Viajante",
      email: "traveller@example.com",
      role: ROLES.CLIENT,
      avatarUrl: null,
      isActive: true,
      referralCode: "ABC123",
      referralBalance: "0",
      createdAt: new Date(),
      commissionType: "percentage",
      commissionRate: "0",
      commissionFixed: "0",
      monthlyGoal: null,
      lastLoginAt: null,
    };

    mockLimit
      .mockResolvedValueOnce([])                        // 1. usersTable (no existing)
      .mockResolvedValueOnce([])                        // 2. invitesTable byEmail (no invite)
      .mockResolvedValueOnce([{ tenantId: "store-tenant-001" }]) // 3. storesTable
      .mockResolvedValueOnce([newUserRow]);              // 4. usersTable re-fetch

    const res = await request(buildApp())
      .post("/api/users/me/sync")
      .send({ ...BASE_BODY, clerkId: "spoofed-clerk-id", storeSlug: "agencia-abc" });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe(ROLES.CLIENT);
    expect(res.body.tenantId).toBe("store-tenant-001");

    // Insert must have been called with role=CLIENT and the store tenantId
    expect(mockInsertValues).toHaveBeenCalledOnce();
    const insertedValues = mockInsertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedValues.role).toBe(ROLES.CLIENT);
    expect(insertedValues.tenantId).toBe("store-tenant-001");
    expect(insertedValues.clerkId).toBe("clerk_new_user");
    expect(mockSyncMeBodySafeParse).toHaveBeenCalledOnce();
  });

  // -------------------------------------------------------------------------
  // 2. Existing user: storeSlug must be ignored — no role/tenantId change
  // -------------------------------------------------------------------------

  it("ignores storeSlug for an already-registered user (update path)", async () => {
    stubClerkUser();

    mockSyncMeBodySafeParse.mockReturnValue({
      success: true,
      data: { ...BASE_BODY, storeSlug: "agencia-abc" },
    });

    const existingUser = {
      id: "existing-user-id",
      clerkId: "clerk_new_user",
      tenantId: "existing-tenant",
      name: "Ana Viajante",
      email: "traveller@example.com",
      role: ROLES.AGENCY_ADMIN,
      avatarUrl: null,
      isActive: true,
      referralCode: "EXI123",
      referralBalance: "0",
      createdAt: new Date(),
      commissionType: "percentage",
      commissionRate: "0",
      commissionFixed: "0",
      monthlyGoal: null,
      lastLoginAt: null,
    };

    // Select call sequence for the existing-user update path:
    // 1. usersTable → [existingUser] (user found)
    //    (no invite reconciliation because existing.tenantId != null)
    // 2. usersTable re-fetch after update → [existingUser (unchanged role)]
    mockLimit
      .mockResolvedValueOnce([existingUser])  // 1. usersTable lookup
      .mockResolvedValueOnce([existingUser]); // 2. usersTable re-fetch

    const res = await request(buildApp())
      .post("/api/users/me/sync")
      .send({ ...BASE_BODY, storeSlug: "agencia-abc" });

    expect(res.status).toBe(200);
    // Role and tenantId must remain from the existing record
    expect(res.body.role).toBe(ROLES.AGENCY_ADMIN);
    expect(res.body.tenantId).toBe("existing-tenant");

    // db.insert must NOT have been called (update path, not create)
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockCheckTenantAccess).toHaveBeenCalledWith(
      "existing-tenant",
      expect.any(Object),
      expect.any(Object),
    );
  });

  // -------------------------------------------------------------------------
  // 3. Unknown / inactive storeSlug → default AGENCY_ADMIN, tenantId=null
  // -------------------------------------------------------------------------

  it("falls back to AGENCY_ADMIN with null tenantId when storeSlug is not found", async () => {
    stubClerkUser();

    mockSyncMeBodySafeParse.mockReturnValue({
      success: true,
      data: { ...BASE_BODY, storeSlug: "nonexistent-store" },
    });

    const newUserRow = {
      id: "gen-user-id",
      clerkId: "clerk_new_user",
      tenantId: null,
      name: "Ana Viajante",
      email: "traveller@example.com",
      role: ROLES.AGENCY_ADMIN,
      avatarUrl: null,
      isActive: true,
      referralCode: "NEW123",
      referralBalance: "0",
      createdAt: new Date(),
      commissionType: "percentage",
      commissionRate: "0",
      commissionFixed: "0",
      monthlyGoal: null,
      lastLoginAt: null,
    };

    // Select call sequence:
    // 1. usersTable → [] (no existing user)
    // 2. invitesTable byEmail → [] (no invite)
    // 3. storesTable → [] (store not found)
    // 4. usersTable re-fetch → [newUserRow with AGENCY_ADMIN]
    mockLimit
      .mockResolvedValueOnce([])         // 1. usersTable (no existing)
      .mockResolvedValueOnce([])         // 2. invitesTable byEmail (no invite)
      .mockResolvedValueOnce([])         // 3. storesTable (store not found)
      .mockResolvedValueOnce([newUserRow]); // 4. usersTable re-fetch

    const res = await request(buildApp())
      .post("/api/users/me/sync")
      .send({ ...BASE_BODY, storeSlug: "nonexistent-store" });

    expect(res.status).toBe(200);
    expect(res.body.role).toBe(ROLES.AGENCY_ADMIN);
    expect(res.body.tenantId).toBeNull();

    // Insert must have been called with role=AGENCY_ADMIN and null tenantId
    expect(mockInsertValues).toHaveBeenCalledOnce();
    const insertedValues = mockInsertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedValues.role).toBe(ROLES.AGENCY_ADMIN);
    expect(insertedValues.tenantId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 4. Pending invite + storeSlug → invite wins (storesTable never queried)
  // -------------------------------------------------------------------------

  it("uses the pending invite role/tenantId and never queries storesTable when both are present", async () => {
    stubClerkUser();

    mockSyncMeBodySafeParse.mockReturnValue({
      success: true,
      data: { ...BASE_BODY, storeSlug: "agencia-abc" },
    });

    const pendingInviteRow = {
      id: "invite-001",
      email: "traveller@example.com",
      tenantId: "staff-tenant-001",
      role: ROLES.AGENCY_MANAGER,
      accepted: false,
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400_000),
      createdAt: new Date(),
      clerkId: null,
      invitedBy: "admin-001",
    };

    const newUserRow = {
      id: "gen-user-id",
      clerkId: "clerk_new_user",
      tenantId: "staff-tenant-001",
      name: "Ana Viajante",
      email: "traveller@example.com",
      role: ROLES.AGENCY_MANAGER,
      avatarUrl: null,
      isActive: true,
      referralCode: "INV123",
      referralBalance: "0",
      createdAt: new Date(),
      commissionType: "percentage",
      commissionRate: "0",
      commissionFixed: "0",
      monthlyGoal: null,
      lastLoginAt: null,
    };

    // Select call sequence when invite takes precedence:
    // 1. usersTable → [] (no existing user)
    // 2. invitesTable byEmail → [pendingInviteRow]  ← invite found, storeSlug block skipped
    // 3. usersTable re-fetch after insert → [newUserRow with invite role]
    // storesTable is NEVER queried (no 4th select)
    mockLimit
      .mockResolvedValueOnce([])                // 1. usersTable (no existing)
      .mockResolvedValueOnce([pendingInviteRow]) // 2. invitesTable byEmail (invite found)
      .mockResolvedValueOnce([newUserRow]);      // 3. usersTable re-fetch

    const selectCallsBefore = mockSelect.mock.calls.length;

    const res = await request(buildApp())
      .post("/api/users/me/sync")
      .send({ ...BASE_BODY, storeSlug: "agencia-abc" });

    expect(res.status).toBe(200);

    // Invite role and tenantId must win over the storeSlug
    expect(res.body.role).toBe(ROLES.AGENCY_MANAGER);
    expect(res.body.tenantId).toBe("staff-tenant-001");

    // storesTable must never have been queried — exactly 3 db.select() calls total
    const selectCallsDelta = mockSelect.mock.calls.length - selectCallsBefore;
    expect(selectCallsDelta).toBe(3);

    // Insert must reflect the invite's role and tenantId
    expect(mockInsertValues).toHaveBeenCalledOnce();
    const insertedValues = mockInsertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedValues.role).toBe(ROLES.AGENCY_MANAGER);
    expect(insertedValues.tenantId).toBe("staff-tenant-001");
  });

  // -------------------------------------------------------------------------
  // 5. No storeSlug at all → still gets AGENCY_ADMIN (baseline control case)
  // -------------------------------------------------------------------------

  it("assigns AGENCY_ADMIN by default when no storeSlug is provided (control case)", async () => {
    stubClerkUser();

    mockSyncMeBodySafeParse.mockReturnValue({
      success: true,
      data: { ...BASE_BODY },
    });

    const newUserRow = {
      id: "gen-user-id",
      clerkId: "clerk_new_user",
      tenantId: null,
      name: "Ana Viajante",
      email: "traveller@example.com",
      role: ROLES.AGENCY_ADMIN,
      avatarUrl: null,
      isActive: true,
      referralCode: "CTL123",
      referralBalance: "0",
      createdAt: new Date(),
      commissionType: "percentage",
      commissionRate: "0",
      commissionFixed: "0",
      monthlyGoal: null,
      lastLoginAt: null,
    };

    // No storeSlug → no storesTable lookup
    // 1. usersTable → []
    // 2. invitesTable byEmail → []
    // 3. usersTable re-fetch → [newUserRow]
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([newUserRow]);

    const res = await request(buildApp())
      .post("/api/users/me/sync")
      .send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.role).toBe(ROLES.AGENCY_ADMIN);
    expect(res.body.tenantId).toBeNull();

    const insertedValues = mockInsertValues.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedValues.role).toBe(ROLES.AGENCY_ADMIN);
    expect(insertedValues.tenantId).toBeNull();
  });

  it("returns the agency access error without updating an existing user", async () => {
    stubClerkUser();
    mockSyncMeBodySafeParse.mockReturnValue({
      success: true,
      data: { ...BASE_BODY, clerkId: "clerk_new_user" },
    });
    mockLimit.mockResolvedValueOnce([{
      id: "existing-user-id",
      clerkId: "clerk_new_user",
      tenantId: "blocked-tenant",
      name: "Ana Viajante",
      email: "traveller@example.com",
      role: ROLES.AGENCY_ADMIN,
      avatarUrl: null,
      isActive: true,
      referralCode: "BLOCKED",
      referralBalance: "0",
      createdAt: new Date(),
    }]);
    mockCheckTenantAccess.mockImplementation(async (_tenantId, _req, res) => {
      res.status(403).json({
        code: "TENANT_SUSPENDED",
        message: "Esta conta está suspensa.",
      });
      return false;
    });

    const res = await request(buildApp())
      .post("/api/users/me/sync")
      .send({ ...BASE_BODY, clerkId: "clerk_new_user" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT_SUSPENDED");
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockCheckPlanLimit).not.toHaveBeenCalled();
  });
});
