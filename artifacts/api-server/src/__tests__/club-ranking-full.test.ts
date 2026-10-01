import { ROLES } from "@workspace/permissions";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRequireAuth, selectQueue, selectBuilders, mockSelect } = vi.hoisted(() => {
  const mockRequireAuth = vi.fn();
  const selectQueue: unknown[][] = [];
  const selectBuilders: Array<{ limits: number[] }> = [];

  const mockSelect = vi.fn(() => {
    const rows = selectQueue.shift() ?? [];
    const builderInfo = { limits: [] as number[] };
    selectBuilders.push(builderInfo);
    let resultRows = rows;
    const chain: Record<string, unknown> = {
      then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(resultRows).then(resolve, reject),
    };
    for (const method of ["from", "where", "innerJoin", "groupBy", "orderBy"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.limit = vi.fn((limit: number) => {
      builderInfo.limits.push(limit);
      resultRows = rows.slice(0, limit);
      return chain;
    });
    return chain;
  });

  return { mockRequireAuth, selectQueue, selectBuilders, mockSelect };
});

vi.mock("@workspace/db", () => {
  const table = () => new Proxy({}, {
    get: (_target, property: string | symbol) => String(property),
  });
  return {
    db: { select: mockSelect },
    clientsTable: table(),
    clubConfigTable: table(),
    clubBenefitsTable: table(),
    referralsTable: table(),
    reservationsTable: table(),
    tripsTable: table(),
    tenantsTable: table(),
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  asc: vi.fn(() => "asc"),
  desc: vi.fn(() => "desc"),
  eq: vi.fn(() => "eq"),
  gte: vi.fn(() => "gte"),
  inArray: vi.fn(() => "inArray"),
  isNotNull: vi.fn(() => "isNotNull"),
  lt: vi.fn(() => "lt"),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  MANAGEMENT_ROLES: [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER],
}));

import clubRouter from "../routes/club.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const ADMIN = {
  id: "admin-1",
  tenantId: "tenant-1",
  role: ROLES.AGENCY_ADMIN,
  name: "Admin",
  email: "admin@example.com",
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", clubRouter);
  app.use(errorHandler);
  return app;
}

function rankingRow(index: number, ambassadorOptIn = false) {
  return {
    clientId: `client-${index}`,
    name: `Cliente ${index}`,
    email: `cliente${index}@example.com`,
    ambassadorOptIn,
    count: 100 - index,
  };
}

beforeEach(() => {
  selectQueue.length = 0;
  selectBuilders.length = 0;
  mockRequireAuth.mockReset().mockResolvedValue(ADMIN);
  mockSelect.mockClear();
});

describe("GET /api/club/ranking/full", () => {
  it("keeps the screen top-50 but counts opted-in ambassadors beyond those results", async () => {
    selectQueue.push(
      Array.from({ length: 55 }, (_, i) => rankingRow(i + 1)),
      Array.from({ length: 53 }, (_, i) => rankingRow(i + 101)),
      [{ clientId: "shared" }, { clientId: "referrer-only" }],
      [{ clientId: "shared" }, { clientId: "traveler-only" }],
    );

    const response = await request(buildApp()).get("/api/club/ranking/full");

    expect(response.status).toBe(200);
    expect(response.body.referrers).toHaveLength(50);
    expect(response.body.travelers).toHaveLength(50);
    expect(response.body.activeAmbassadorsCount).toBe(3);
    expect(selectBuilders.map(({ limits }) => limits)).toEqual([[50], [50], [], []]);
  });

  it("exports every eligible row instead of applying the screen limit", async () => {
    const referrers = Array.from({ length: 51 }, (_, i) => rankingRow(i + 1, i === 50));
    const travelers = Array.from({ length: 52 }, (_, i) => rankingRow(i + 101, i === 51));
    selectQueue.push(referrers, travelers);

    const response = await request(buildApp()).get("/api/club/ranking/full?export=csv");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.text).toContain("Cliente 51");
    expect(response.text).toContain("Cliente 152");
    expect(selectBuilders.map(({ limits }) => limits)).toEqual([[], []]);
  });

  it("does not allow support users to retrieve the full ranking", async () => {
    mockRequireAuth.mockResolvedValueOnce({ ...ADMIN, role: ROLES.SUPPORT });

    const response = await request(buildApp()).get("/api/club/ranking/full");

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FORBIDDEN_ROLE");
    expect(mockSelect).not.toHaveBeenCalled();
  });
});