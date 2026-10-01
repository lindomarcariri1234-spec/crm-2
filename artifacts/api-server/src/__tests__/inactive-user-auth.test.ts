import type { Request, Response } from "express";
import express from "express";
import request from "supertest";
import { ROLES } from "@workspace/permissions";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockLimit, mockWhere, mockFrom, mockSelect, mockGetAuth } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockWhere: vi.fn(),
  mockFrom: vi.fn(),
  mockSelect: vi.fn(),
  mockGetAuth: vi.fn(() => ({ userId: "clerk-inactive" })),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  usersTable: {
    id: "id",
    clerkId: "clerkId",
    tenantId: "tenantId",
    role: "role",
    isActive: "isActive",
  },
  tenantsTable: {
    id: "id",
    status: "status",
    trialEndsAt: "trialEndsAt",
    slug: "slug",
  },
  plansTable: { isActive: "isActive", sortOrder: "sortOrder", createdAt: "createdAt" },
  storesTable: { slug: "slug", tenantId: "tenantId", id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  asc: vi.fn(() => "asc"),
  ilike: vi.fn(() => "ilike"),
}));

vi.mock("@clerk/express", () => ({
  getAuth: mockGetAuth,
  clerkClient: { users: { getUser: vi.fn() } },
}));

import {
  getTenantUser,
  isClerkUserActiveOrUnprovisioned,
  requireAuth,
} from "../lib/tenant.js";
import onboardingRouter from "../routes/onboarding.js";
import { ForbiddenError } from "../lib/errors.js";
import { errorHandler } from "../middlewares/errorHandler.js";

function resetSelectMock() {
  mockLimit.mockReset();
  mockWhere.mockReset().mockReturnValue({ limit: mockLimit });
  mockFrom.mockReset().mockReturnValue({ where: mockWhere });
  mockSelect.mockReset().mockReturnValue({ from: mockFrom });
}

function buildOnboardingApp() {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { log?: Record<string, unknown> }, _res, next) => {
    const noop = () => {};
    req.log = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop } as never;
    next();
  });
  app.use("/api", onboardingRouter);
  app.use(errorHandler);
  return app;
}

describe("inactive account access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSelectMock();
    mockGetAuth.mockReturnValue({ userId: "clerk-inactive" });
  });

  it("blocks inactive users in the shared API authorization guard with 403", async () => {
    mockLimit.mockResolvedValueOnce([{
      id: "user-1",
      clerkId: "clerk-inactive",
      tenantId: "tenant-1",
      role: ROLES.AGENCY_ADMIN,
      isActive: false,
    }]);
    const req = { id: "request-1" } as Request;
    const response = {
      status: vi.fn(),
      json: vi.fn(),
    };
    response.status.mockReturnValue(response);

    const user = await requireAuth(req, response as unknown as Response);

    expect(user).toBeNull();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      code: "USER_INACTIVE",
      requestId: "request-1",
    }));
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it("keeps active superadmin access and returns no tenant scope", async () => {
    mockLimit.mockResolvedValueOnce([{
      id: "user-2",
      clerkId: "clerk-active",
      tenantId: null,
      role: ROLES.SUPER_ADMIN,
      isActive: true,
    }]);
    const req = {} as Request & { tenantId?: string; userId?: string };
    const response = {
      status: vi.fn(),
      json: vi.fn(),
    };
    response.status.mockReturnValue(response);

    const user = await requireAuth(req, response as unknown as Response);

    expect(user?.tenantId).toBe("");
    expect(req.userId).toBe("user-2");
    expect(response.status).not.toHaveBeenCalled();
  });

  it("rejects inactive users on the optional tenant-user path used for cashback", async () => {
    mockLimit.mockResolvedValueOnce([{
      id: "user-1",
      clerkId: "clerk-inactive",
      tenantId: "tenant-1",
      role: ROLES.CLIENT,
      isActive: false,
    }]);

    let error: unknown;
    try {
      await getTenantUser({} as Request);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toMatchObject({ code: "USER_INACTIVE" });
  });

  it("allows missing local rows only in the explicit pre-provisioning helper", async () => {
    mockLimit.mockResolvedValueOnce([{ isActive: false }]);
    await expect(isClerkUserActiveOrUnprovisioned("clerk-inactive")).resolves.toBe(false);

    mockLimit.mockResolvedValueOnce([]);
    await expect(isClerkUserActiveOrUnprovisioned("clerk-new")).resolves.toBe(true);
  });
});

describe("onboarding inactive-account guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSelectMock();
    mockGetAuth.mockReturnValue({ userId: "clerk-inactive" });
  });

  it("blocks inactive users from reading onboarding status", async () => {
    mockLimit.mockResolvedValueOnce([{ isActive: false, tenantId: null }]);

    const res = await request(buildOnboardingApp()).get("/api/onboarding/status");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("USER_INACTIVE");
  });

  it("blocks inactive users from creating an onboarding agency", async () => {
    mockLimit.mockResolvedValueOnce([{ isActive: false, tenantId: null }]);

    const res = await request(buildOnboardingApp())
      .post("/api/onboarding/agency")
      .send({ name: "Agência Teste", slug: "agencia-teste" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("USER_INACTIVE");
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });
});