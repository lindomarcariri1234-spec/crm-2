import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { capturedConditions, mockRequireAuth } = vi.hoisted(() => ({
  capturedConditions: [] as unknown[],
  mockRequireAuth: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: () => {
      const query: any = {
        from: () => query,
        leftJoin: () => query,
        where: (condition: unknown) => {
          capturedConditions.push(condition);
          return query;
        },
        orderBy: async () => [],
        then: (resolve: (rows: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve([]).then(resolve, reject),
      };
      return query;
    },
  },
  campaignsTable: {},
  npsResponsesTable: {
    tenantId: "store.tenantId",
    createdAt: "store.createdAt",
    score: "store.score",
    classification: "store.classification",
  },
  clientNpsResponsesTable: {
    tenantId: "travel.tenantId",
    tripId: "travel.tripId",
    createdAt: "travel.createdAt",
    score: "travel.score",
    scoreTransport: "travel.scoreTransport",
    scoreService: "travel.scoreService",
    scoreOrganization: "travel.scoreOrganization",
    scoreGuide: "travel.scoreGuide",
  },
  productsTable: {},
  ordersTable: {},
  orderItemsTable: {},
  clientsTable: { name: "clients.name" },
  reservationsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  avg: (column: unknown) => ({ kind: "avg", column }),
  desc: (column: unknown) => ({ kind: "desc", column }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  inArray: (column: unknown, values: unknown[]) => ({ kind: "inArray", column, values }),
  or: (...conditions: unknown[]) => ({ kind: "or", conditions }),
  sql: (parts: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    parts: [...parts],
    values,
  }),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["agencia", "gerente"],
}));

import marketingRouter from "../routes/marketing.js";

function makeApp() {
  const app = express();
  app.use(marketingRouter);
  app.use((
    error: Error & { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    res.status(error.status ?? 500).json({ error: error.message });
  });
  return app;
}

describe("NPS civil date filters", () => {
  beforeEach(() => {
    capturedConditions.length = 0;
    mockRequireAuth.mockReset();
    mockRequireAuth.mockResolvedValue({
      id: "user-a",
      tenantId: "tenant-a",
      role: "agencia",
    });
  });

  it("applies São Paulo start and exclusive next-day bounds to store and trip responses", async () => {
    const response = await request(makeApp())
      .get("/nps/summary")
      .query({ dateFrom: "2026-08-31", dateTo: "2026-08-31" });

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const sqlConditions = capturedConditions
      .flatMap((condition: any) => condition.conditions)
      .filter((condition: any) => condition.kind === "sql");

    expect(sqlConditions).toHaveLength(4);
    expect(sqlConditions.map((condition: any) => condition.values.at(-1).toISOString()).sort()).toEqual([
      "2026-08-31T03:00:00.000Z",
      "2026-08-31T03:00:00.000Z",
      "2026-09-01T03:00:00.000Z",
      "2026-09-01T03:00:00.000Z",
    ]);
    expect(sqlConditions.filter((condition: any) => condition.parts.join("").includes(">="))).toHaveLength(2);
    expect(sqlConditions.filter((condition: any) => condition.parts.join("").includes(" < "))).toHaveLength(2);
  });
});