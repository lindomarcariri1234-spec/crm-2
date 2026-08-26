/**
 * Regression tests for invite reconciliation robustness in POST /users/me/sync.
 *
 * Covers the "vendedor sem tenant vinculado" bug class: a staff member accepts
 * an invite (logs in) but their account never gets linked to the inviting
 * agency's tenant, so tenant-scoped queries (trips, clients, …) return empty
 * and the invite stays stuck as "pending" in the Team tab.
 *
 * Scenarios:
 * 1. A tenant-less account reconciles against a pending invite on a later
 *    login attempt (the invite didn't exist — or Clerk lookup previously
 *    failed — at account-creation time).
 * 2. Invite matching is tolerant of case/whitespace differences between the
 *    invite's stored email and Clerk's canonical email.
 * 3. A previous transient Clerk API failure does not permanently block
 *    reconciliation — the very next successful login retries it.
 * 4. An account that already has a tenantId, but only because it self-
 *    provisioned an unused placeholder tenant (sole member, zero trips)
 *    before a real invite arrived, is migrated onto the invite's tenant.
 * 5. That migration never touches a tenant with other members or real trip
 *    data, and never touches a user who isn't a self-provisioned admin —
 *    protecting every other agency/vendor from being disturbed.
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
  mockUpdateWhere,
  mockUpdateSet,
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
    mockInsertValues, mockInsert, mockUpdateWhere, mockUpdateSet, mockUpdate,
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
  usersTable: { __name: "users" },
  tenantsTable: { __name: "tenants" },
  invitesTable: { __name: "invites" },
  clientsTable: { __name: "clients" },
  storesTable: { __name: "stores" },
  tripsTable: { __name: "trips" },
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
  getAuth: vi.fn(() => ({ userId: "clerk_existing_user" })),
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
// Helpers / fixtures
// ---------------------------------------------------------------------------

function stubClerkUser(email: string) {
  mockGetUser.mockResolvedValue({
    emailAddresses: [{ id: "ea_1", emailAddress: email }],
    primaryEmailAddressId: "ea_1",
    publicMetadata: {},
  });
}

const BASE_BODY = { name: "Ana Vendedora", email: "fallback@example.com", avatarUrl: null };

function makeExistingUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-existing-1",
    clerkId: "clerk_existing_user",
    tenantId: null,
    name: "Ana Vendedora",
    email: "vendedor.novo@example.com",
    role: ROLES.AGENCY_ADMIN,
    avatarUrl: null,
    isActive: true,
    referralCode: "EXIST1",
    referralBalance: "0",
    createdAt: new Date(),
    commissionType: "percentage",
    commissionRate: "0",
    commissionFixed: "0",
    monthlyGoal: null,
    lastLoginAt: null,
    ...overrides,
  };
}

function makeInvite(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "invite-001",
    tenantId: "tenant-real-agency",
    email: "vendedor.novo@example.com",
    role: ROLES.SALES,
    accepted: false,
    acceptedAt: null,
    expiresAt: new Date(Date.now() + 7 * 86400_000),
    createdAt: new Date(),
    invitedBy: "admin-001",
    token: "tok-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLimit.mockReset();
  mockInsertValues.mockReset().mockResolvedValue([]);
  mockUpdateWhere.mockReset().mockResolvedValue([]);
  mockCheckPlanLimit.mockReset().mockResolvedValue(true);
  mockCheckTenantAccess.mockReset().mockResolvedValue(true);
  mockSyncMeBodySafeParse.mockReturnValue({ success: true, data: { ...BASE_BODY } });
});

// ---------------------------------------------------------------------------
// 1 & 3. Tenant-less account reconciliation, including on a later attempt
// ---------------------------------------------------------------------------

describe("POST /api/users/me/sync — reconciling a tenant-less existing account", () => {
  it("reconciles a tenant-less account against a matching pending invite", async () => {
    stubClerkUser("vendedor.novo@example.com");
    const existingUser = makeExistingUser({ tenantId: null });
    const invite = makeInvite();
    const updatedUser = makeExistingUser({ tenantId: invite.tenantId, role: invite.role });

    mockLimit
      .mockResolvedValueOnce([existingUser]) // 1. usersTable lookup
      .mockResolvedValueOnce([invite])       // 2. invitesTable byEmail
      .mockResolvedValueOnce([updatedUser]); // 3. usersTable re-fetch

    const res = await request(buildApp()).post("/api/users/me/sync").send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe("tenant-real-agency");
    expect(res.body.role).toBe(ROLES.SALES);

    // Invite must be marked accepted
    expect(mockUpdate).toHaveBeenCalledWith({ __name: "invites" });
    const inviteSetCall = mockUpdateSet.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).accepted === true,
    );
    expect(inviteSetCall).toBeTruthy();
  });

  it("retries reconciliation on the next login after a previous transient Clerk failure", async () => {
    const existingUserBefore = makeExistingUser({ tenantId: null });
    const invite = makeInvite();
    const updatedUser = makeExistingUser({ tenantId: invite.tenantId, role: invite.role });

    // First login: Clerk lookup fails transiently — reconciliation must be
    // skipped entirely (not attempted with an unverified client-supplied email).
    mockGetUser.mockRejectedValueOnce(new Error("Clerk temporarily unavailable"));
    mockLimit
      .mockResolvedValueOnce([existingUserBefore]) // 1st call: usersTable lookup
      .mockResolvedValueOnce([existingUserBefore]); // 1st call: usersTable re-fetch (unchanged)

    const app = buildApp();
    const firstRes = await request(app).post("/api/users/me/sync").send(BASE_BODY);
    expect(firstRes.status).toBe(200);
    expect(firstRes.body.tenantId).toBeNull();
    expect(mockUpdate).toHaveBeenCalledTimes(1); // only the profile update, no invite touched

    // Second login: Clerk succeeds — the same still-tenant-less account must
    // now reconcile against the pending invite.
    stubClerkUser("vendedor.novo@example.com");
    mockLimit
      .mockResolvedValueOnce([existingUserBefore]) // 2nd call: usersTable lookup (still tenant-less)
      .mockResolvedValueOnce([invite])             // 2nd call: invitesTable byEmail
      .mockResolvedValueOnce([updatedUser]);       // 2nd call: usersTable re-fetch

    const secondRes = await request(app).post("/api/users/me/sync").send(BASE_BODY);
    expect(secondRes.status).toBe(200);
    expect(secondRes.body.tenantId).toBe("tenant-real-agency");
    expect(secondRes.body.role).toBe(ROLES.SALES);
  });

  it("matches the invite even when its stored email differs in case/whitespace from Clerk's canonical email", async () => {
    // Clerk reports the clean, canonical email…
    stubClerkUser("vendedor.novo@example.com");
    const existingUser = makeExistingUser({ tenantId: null });
    // …but the invite was typed with different case and stray whitespace.
    const invite = makeInvite({ email: "  Vendedor.Novo@EXAMPLE.com  " });
    const updatedUser = makeExistingUser({ tenantId: invite.tenantId, role: invite.role });

    mockLimit
      .mockResolvedValueOnce([existingUser])
      .mockResolvedValueOnce([invite])
      .mockResolvedValueOnce([updatedUser]);

    const res = await request(buildApp()).post("/api/users/me/sync").send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe("tenant-real-agency");
    expect(res.body.role).toBe(ROLES.SALES);
  });
});

// ---------------------------------------------------------------------------
// 4 & 5. Migrating off a self-provisioned, unused placeholder tenant
// ---------------------------------------------------------------------------

describe("POST /api/users/me/sync — migrating off an unused self-provisioned tenant", () => {
  it("migrates a sole-member, trip-less agency owner onto a pending invite from a different agency", async () => {
    stubClerkUser("vendedor.novo@example.com");
    const existingUser = makeExistingUser({ tenantId: "tenant-placeholder", role: ROLES.AGENCY_ADMIN });
    const invite = makeInvite({ tenantId: "tenant-real-agency", role: ROLES.SALES });
    const updatedUser = makeExistingUser({ tenantId: invite.tenantId, role: invite.role });

    mockLimit
      .mockResolvedValueOnce([existingUser])       // 1. usersTable lookup
      .mockResolvedValueOnce([invite])             // 2. invitesTable byEmail
      .mockResolvedValueOnce([{ count: 1 }])       // 3. teammate count in current tenant (self only)
      .mockResolvedValueOnce([{ count: 0 }])       // 4. trip count in current tenant (none)
      .mockResolvedValueOnce([updatedUser]);       // 5. usersTable re-fetch

    const res = await request(buildApp()).post("/api/users/me/sync").send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe("tenant-real-agency");
    expect(res.body.role).toBe(ROLES.SALES);
    expect(mockUpdate).toHaveBeenCalledWith({ __name: "invites" });
    const inviteSetCall = mockUpdateSet.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).accepted === true,
    );
    expect(inviteSetCall).toBeTruthy();
  });

  it("does not migrate a user whose current tenant has other team members", async () => {
    stubClerkUser("vendedor.novo@example.com");
    const existingUser = makeExistingUser({ tenantId: "tenant-placeholder", role: ROLES.AGENCY_ADMIN });
    const invite = makeInvite({ tenantId: "tenant-real-agency", role: ROLES.SALES });

    mockLimit
      .mockResolvedValueOnce([existingUser])
      .mockResolvedValueOnce([invite])
      .mockResolvedValueOnce([{ count: 2 }])  // another teammate already exists in this tenant
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([existingUser]); // re-fetch: unchanged

    const res = await request(buildApp()).post("/api/users/me/sync").send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe("tenant-placeholder");
    // Only the routine profile update happened — the invite was never touched.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("does not migrate a user whose current tenant already has real trip data", async () => {
    stubClerkUser("vendedor.novo@example.com");
    const existingUser = makeExistingUser({ tenantId: "tenant-placeholder", role: ROLES.AGENCY_ADMIN });
    const invite = makeInvite({ tenantId: "tenant-real-agency", role: ROLES.SALES });

    mockLimit
      .mockResolvedValueOnce([existingUser])
      .mockResolvedValueOnce([invite])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ count: 3 }])  // this tenant already has real trips
      .mockResolvedValueOnce([existingUser]);

    const res = await request(buildApp()).post("/api/users/me/sync").send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe("tenant-placeholder");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("never reconsiders an already-established staff member's tenant, even if a stray invite matches their email", async () => {
    stubClerkUser("vendedor.estabelecido@example.com");
    // Already a properly-provisioned vendedor of a real tenant — must never be
    // silently reassigned, regardless of any other pending invite.
    const existingUser = makeExistingUser({
      tenantId: "tenant-established",
      role: ROLES.SALES,
      email: "vendedor.estabelecido@example.com",
    });

    mockLimit
      .mockResolvedValueOnce([existingUser]) // 1. usersTable lookup
      .mockResolvedValueOnce([existingUser]); // 2. usersTable re-fetch (unchanged) — no invite lookup at all

    const res = await request(buildApp()).post("/api/users/me/sync").send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe("tenant-established");
    expect(res.body.role).toBe(ROLES.SALES);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 6. Reconciliation must happen BEFORE the current tenant's access status is
//    enforced, so an expired/suspended self-provisioned placeholder never
//    blocks a valid invite from a different, active agency.
// ---------------------------------------------------------------------------

describe("POST /api/users/me/sync — reconciling despite the placeholder tenant's own access being blocked", () => {
  it("reconciles onto a pending invite even though the current placeholder tenant would fail its own access check", async () => {
    stubClerkUser("vendedor.novo@example.com");
    const existingUser = makeExistingUser({ tenantId: "tenant-placeholder-expired", role: ROLES.AGENCY_ADMIN });
    const invite = makeInvite({ tenantId: "tenant-real-agency", role: ROLES.SALES });
    const updatedUser = makeExistingUser({ tenantId: invite.tenantId, role: invite.role });

    // Simulate the placeholder tenant's trial having expired, while the
    // invite's target tenant is healthy. Reconciliation must go through:
    // the route now checks the *target* tenant's access (which passes),
    // never the now-irrelevant current placeholder tenant's.
    mockCheckTenantAccess.mockImplementation(async (tenantId: string, _req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      if (tenantId === "tenant-placeholder-expired") {
        res.status(403).json({ code: "TRIAL_EXPIRED", message: "O período de teste expirou." });
        return false;
      }
      return true;
    });

    mockLimit
      .mockResolvedValueOnce([existingUser])   // 1. usersTable lookup
      .mockResolvedValueOnce([invite])         // 2. invitesTable byEmail
      .mockResolvedValueOnce([{ count: 1 }])   // 3. teammate count in current tenant (self only)
      .mockResolvedValueOnce([{ count: 0 }])   // 4. trip count in current tenant (none)
      .mockResolvedValueOnce([updatedUser]);   // 5. usersTable re-fetch

    const res = await request(buildApp()).post("/api/users/me/sync").send(BASE_BODY);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe("tenant-real-agency");
    expect(res.body.role).toBe(ROLES.SALES);
    // The (now-irrelevant) placeholder tenant's access status must never have
    // been checked once a winning invite was found — only the invite's
    // target tenant is.
    expect(mockCheckTenantAccess).toHaveBeenCalledTimes(1);
    expect(mockCheckTenantAccess).toHaveBeenCalledWith(
      "tenant-real-agency",
      expect.any(Object),
      expect.any(Object),
    );
    expect(mockUpdate).toHaveBeenCalledWith({ __name: "invites" });
  });

  it("still blocks an existing user on an expired/suspended tenant when there is no matching invite", async () => {
    stubClerkUser("dono.sem.convite@example.com");
    const existingUser = makeExistingUser({
      tenantId: "tenant-expired-no-invite",
      role: ROLES.AGENCY_ADMIN,
      email: "dono.sem.convite@example.com",
    });

    mockCheckTenantAccess.mockImplementation(async (_tenantId: string, _req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      res.status(403).json({ code: "TRIAL_EXPIRED", message: "O período de teste expirou." });
      return false;
    });

    mockLimit
      .mockResolvedValueOnce([existingUser]) // 1. usersTable lookup
      .mockResolvedValueOnce([]);            // 2. invitesTable byEmail — no match

    const res = await request(buildApp()).post("/api/users/me/sync").send(BASE_BODY);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRIAL_EXPIRED");
    expect(mockCheckTenantAccess).toHaveBeenCalledWith(
      "tenant-expired-no-invite",
      expect.any(Object),
      expect.any(Object),
    );
    // No profile update or invite mutation should have happened.
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 7. The invite's TARGET tenant must also be checked before reconciliation is
//    finalized — reconciling onto a suspended/expired agency must not
//    silently succeed only to have the user blocked on their very next login.
// ---------------------------------------------------------------------------

describe("POST /api/users/me/sync — refusing to reconcile onto a blocked target tenant", () => {
  it("does not reconcile a tenant-less account onto an invite whose target tenant is suspended", async () => {
    stubClerkUser("vendedor.novo@example.com");
    const existingUser = makeExistingUser({ tenantId: null });
    const invite = makeInvite({ tenantId: "tenant-suspended-agency", role: ROLES.SALES });

    mockCheckTenantAccess.mockImplementation(async (tenantId: string, _req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      if (tenantId === "tenant-suspended-agency") {
        res.status(403).json({ code: "TENANT_SUSPENDED", message: "Esta conta está suspensa." });
        return false;
      }
      return true;
    });

    mockLimit
      .mockResolvedValueOnce([existingUser]) // 1. usersTable lookup
      .mockResolvedValueOnce([invite]);      // 2. invitesTable byEmail

    const res = await request(buildApp()).post("/api/users/me/sync").send(BASE_BODY);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TENANT_SUSPENDED");
    expect(mockCheckTenantAccess).toHaveBeenCalledWith(
      "tenant-suspended-agency",
      expect.any(Object),
      expect.any(Object),
    );
    // Neither the user's tenantId nor the invite should have been touched —
    // the invite must stay pending so this can be retried later.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does not migrate off a self-provisioned placeholder onto an invite whose target tenant's trial expired", async () => {
    stubClerkUser("vendedor.novo@example.com");
    const existingUser = makeExistingUser({ tenantId: "tenant-placeholder", role: ROLES.AGENCY_ADMIN });
    const invite = makeInvite({ tenantId: "tenant-real-agency-expired", role: ROLES.SALES });

    mockCheckTenantAccess.mockImplementation(async (tenantId: string, _req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) => {
      if (tenantId === "tenant-real-agency-expired") {
        res.status(403).json({ code: "TRIAL_EXPIRED", message: "O período de teste expirou." });
        return false;
      }
      return true;
    });

    mockLimit
      .mockResolvedValueOnce([existingUser])   // 1. usersTable lookup
      .mockResolvedValueOnce([invite])         // 2. invitesTable byEmail
      .mockResolvedValueOnce([{ count: 1 }])   // 3. teammate count in current tenant (self only)
      .mockResolvedValueOnce([{ count: 0 }]);  // 4. trip count in current tenant (none)

    const res = await request(buildApp()).post("/api/users/me/sync").send(BASE_BODY);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRIAL_EXPIRED");
    expect(mockCheckTenantAccess).toHaveBeenCalledWith(
      "tenant-real-agency-expired",
      expect.any(Object),
      expect.any(Object),
    );
    // The user must remain on their current (placeholder) tenant and the
    // invite must remain pending, not silently consumed onto a blocked tenant.
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
