/**
 * Regression tests for GET /users authorization gate.
 *
 * Verifies that only roles with TEAM.VIEW permission (superadmin, agency_admin,
 * agency_manager) can list tenant users. Roles without TEAM permissions
 * (sales, support, client) must receive 403 FORBIDDEN_ROLE.
 */

import { ROLES } from "@workspace/permissions";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { mockLimit, mockWhere, mockFrom, mockSelect } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockLimit, mockWhere, mockFrom, mockSelect };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    transaction: vi.fn(),
  },
  usersTable: {},
  tenantsTable: {},
  invitesTable: {},
  clientsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn((...a: unknown[]) => a),
  or: vi.fn((...a: unknown[]) => a),
  gt: vi.fn(() => "gt"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  ADMIN_ROLES: [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN],
  MANAGEMENT_ROLES: [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER],
}));

vi.mock("../lib/planLimits.js", () => ({
  checkPlanLimit: vi.fn().mockResolvedValue(true),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-id"),
  generateReferralCode: vi.fn(() => "REF-0001"),
}));

vi.mock("@workspace/api-zod", () => ({
  SyncMeBody: { safeParse: vi.fn() },
  CreateUserBody: { safeParse: vi.fn() },
  UpdateUserBody: { safeParse: vi.fn() },
  GetMeResponse: {},
  SyncMeResponse: {},
}));

import { requireAuth } from "../lib/tenant.js";
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

const requireAuthMock = vi.mocked(requireAuth);

function authAs(role: string) {
  requireAuthMock.mockResolvedValue({
    id: "user-001",
    tenantId: "tenant-001",
    role,
    name: "Test User",
    email: "test@example.com",
  } as never);
}

describe("GET /api/users — TEAM.VIEW authorization gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
  });

  it("allows SUPER_ADMIN to list users (200)", async () => {
    authAs(ROLES.SUPER_ADMIN);
    mockWhere.mockReturnValue([] as unknown as { limit: typeof mockLimit });
    const res = await request(buildApp()).get("/api/users");
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(403);
  });

  it("allows AGENCY_ADMIN to list users (200)", async () => {
    authAs(ROLES.AGENCY_ADMIN);
    mockWhere.mockReturnValue([] as unknown as { limit: typeof mockLimit });
    const res = await request(buildApp()).get("/api/users");
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(403);
  });

  it("allows AGENCY_MANAGER to list users (200)", async () => {
    authAs(ROLES.AGENCY_MANAGER);
    mockWhere.mockReturnValue([] as unknown as { limit: typeof mockLimit });
    const res = await request(buildApp()).get("/api/users");
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(403);
  });

  it("rejects SALES with 403 FORBIDDEN_ROLE", async () => {
    authAs(ROLES.SALES);
    const res = await request(buildApp()).get("/api/users");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects SUPPORT with 403 FORBIDDEN_ROLE", async () => {
    authAs(ROLES.SUPPORT);
    const res = await request(buildApp()).get("/api/users");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
  });

  it("rejects CLIENT with 403 FORBIDDEN_ROLE", async () => {
    authAs(ROLES.CLIENT);
    const res = await request(buildApp()).get("/api/users");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
  });
});
