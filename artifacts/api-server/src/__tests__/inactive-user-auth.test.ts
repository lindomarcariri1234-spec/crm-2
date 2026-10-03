import type { Request, Response } from "express";
import express from "express";
import request from "supertest";
import { ROLES } from "@workspace/permissions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockGetAuth,
  mockUpdate,
  mockSet,
  mockUpdateWhere,
} = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockWhere: vi.fn(),
  mockFrom: vi.fn(),
  mockSelect: vi.fn(),
  mockGetAuth: vi.fn(() => ({ userId: "clerk-inactive" })),
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: vi.fn(),
    update: mockUpdate,
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
  auditLogsTable: {},
  invoicesTable: {},
  featureFlagsTable: {},
  storeProductsTable: {},
  storeCategoriesTable: {},
  storeOrderItemsTable: {},
  storeReviewsTable: {},
  tripsTable: {},
  productCategoriesTable: {},
  productImagesTable: {},
  vehiclesTable: {},
  accommodationsTable: {},
  destinationsTable: {},
  clientsTable: {},
  documentsTable: {},
  storeOrdersTable: {},
  referralsTable: {},
}));

vi.mock("drizzle-orm", () => {
  const sql = Object.assign(
    vi.fn(() => "sql"),
    { raw: vi.fn(() => "sql") },
  );
  return {
    eq: vi.fn(() => "eq"),
    asc: vi.fn(() => "asc"),
    desc: vi.fn(() => "desc"),
    count: vi.fn(() => "count"),
    sql,
    and: vi.fn(() => "and"),
    gte: vi.fn(() => "gte"),
    lte: vi.fn(() => "lte"),
    ne: vi.fn(() => "ne"),
    isNull: vi.fn(() => "isNull"),
    isNotNull: vi.fn(() => "isNotNull"),
    ilike: vi.fn(() => "ilike"),
  };
});

vi.mock("@clerk/express", () => ({
  getAuth: mockGetAuth,
  clerkClient: { users: { getUser: vi.fn() } },
}));

vi.mock("../lib/uploadthing.js", () => ({
  utapi: {},
  extractVerifiedUploadThingKey: vi.fn(() => null),
  deleteOrphanedFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/collectReferencedUploadThingKeys.js", () => ({
  collectReferencedUploadThingKeys: vi.fn().mockResolvedValue([]),
}));

vi.mock("../lib/stripeClient.js", () => ({
  getStripeSecretKey: vi.fn().mockResolvedValue(null),
}));

vi.mock("stripe", () => ({
  default: vi.fn(),
}));

import {
  getTenantUser,
  isClerkUserActiveOrUnprovisioned,
  requireAuth,
} from "../lib/tenant.js";
import adminRouter from "../routes/admin.js";
import onboardingRouter from "../routes/onboarding.js";
import { uploadRouter } from "../routes/uploadthing.js";
import { ForbiddenError } from "../lib/errors.js";
import { errorHandler } from "../middlewares/errorHandler.js";

function resetSelectMock() {
  mockLimit.mockReset();
  mockWhere.mockReset().mockReturnValue({ limit: mockLimit });
  mockFrom.mockReset().mockReturnValue({ where: mockWhere });
  mockSelect.mockReset().mockReturnValue({ from: mockFrom });
  mockUpdate.mockReset().mockReturnValue({ set: mockSet });
  mockSet.mockReset().mockReturnValue({ where: mockUpdateWhere });
  mockUpdateWhere.mockReset().mockResolvedValue([]);
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

function buildAdminApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", adminRouter);
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

const protectedUploadRoutes = [
  "tripCoverImage",
  "tripGalleryImages",
  "storeLogo",
  "storeBanner",
  "storeProductImage",
  "agencyLogo",
  "accommodationGallery",
  "clientDocument",
] as const;

const unprovisionedUploadRoutes = [
  "storeLogo",
  "storeBanner",
  "storeProductImage",
  "agencyLogo",
  "accommodationGallery",
  "clientDocument",
] as const;

type UploadRouteName = (typeof protectedUploadRoutes)[number];
type UploadMiddleware = (input: { req: Request }) => Promise<unknown>;

function getUploadMiddleware(routeName: UploadRouteName): UploadMiddleware {
  return (
    uploadRouter[routeName] as unknown as { middleware: UploadMiddleware }
  ).middleware;
}

describe("UploadThing account activity guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSelectMock();
    mockGetAuth.mockReturnValue({ userId: "clerk-inactive" });
  });

  it("keeps the activity test matrix synchronized with every UploadThing route", () => {
    expect(Object.keys(uploadRouter).sort()).toEqual(
      [...protectedUploadRoutes].sort(),
    );
  });

  it.each(protectedUploadRoutes)(
    "blocks inactive users in %s before the provider upload",
    async (routeName) => {
      mockLimit.mockResolvedValueOnce([
        {
          id: "user-inactive",
          tenantId: "tenant-1",
          isActive: false,
        },
      ]);
      const providerUpload = vi.fn();
      const runUpload = async () => {
        const metadata = await getUploadMiddleware(routeName)({
          req: {} as Request,
        });
        await providerUpload(metadata);
      };

      await expect(runUpload()).rejects.toThrow("Unauthorized");
      expect(providerUpload).not.toHaveBeenCalled();
    },
  );

  it.each(protectedUploadRoutes)(
    "keeps %s available to an active user",
    async (routeName) => {
      mockGetAuth.mockReturnValue({ userId: "clerk-active" });
      mockLimit.mockResolvedValueOnce([
        {
          id: "user-active",
          tenantId: "tenant-1",
          isActive: true,
        },
      ]);

      const result = await getUploadMiddleware(routeName)({
        req: {} as Request,
      });

      if (routeName === "tripCoverImage" || routeName === "tripGalleryImages") {
        expect(result).toEqual({ userId: "user-active", tenantId: "tenant-1" });
      } else {
        expect(result).toEqual({ userId: "clerk-active" });
      }
    },
  );

  it.each(unprovisionedUploadRoutes)(
    "preserves %s for an identity without a local user row",
    async (routeName) => {
      mockGetAuth.mockReturnValue({ userId: "clerk-new" });
      mockLimit.mockResolvedValueOnce([]);

      await expect(
        getUploadMiddleware(routeName)({ req: {} as Request }),
      ).resolves.toEqual({ userId: "clerk-new" });
    },
  );
});

describe("inactive superadmin bootstrap guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSelectMock();
    mockGetAuth.mockReturnValue({ userId: "clerk-inactive" });
    vi.stubEnv("SUPERADMIN_CLERK_ID", "clerk-inactive");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 403 USER_INACTIVE and does not promote an inactive account", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: "user-inactive",
        clerkId: "clerk-inactive",
        role: ROLES.AGENCY_ADMIN,
        isActive: false,
      },
    ]);

    const res = await request(buildAdminApp())
      .post("/api/admin/sync-superadmin")
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("USER_INACTIVE");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("still promotes an active superadmin identity", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: "user-active",
        clerkId: "clerk-inactive",
        role: ROLES.AGENCY_ADMIN,
        isActive: true,
      },
    ]);

    const res = await request(buildAdminApp())
      .post("/api/admin/sync-superadmin")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      already: false,
      userId: "user-active",
      role: ROLES.SUPER_ADMIN,
    });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith({ role: ROLES.SUPER_ADMIN });
    expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
  });
});
