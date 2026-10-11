import { ROLES } from "@workspace/permissions";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRequireAuth,
  selectRows,
  insertResults,
  insertedValues,
  conflictTargets,
  mockSelect,
  mockInsert,
} = vi.hoisted(() => {
  const mockRequireAuth = vi.fn();
  const selectRows: unknown[][] = [];
  const insertResults: unknown[][] = [];
  const insertedValues: Array<Record<string, unknown>> = [];
  const conflictTargets: unknown[] = [];
  const mockSelect = vi.fn(() => {
    const rows = selectRows.shift() ?? [];
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  });
  const mockInsert = vi.fn(() => {
    const result = insertResults.shift() ?? [];
    const chain: Record<string, unknown> = {
      values: vi.fn((values: Record<string, unknown>) => {
        insertedValues.push(values);
        return chain;
      }),
      onConflictDoNothing: vi.fn((options: unknown) => {
        conflictTargets.push(options);
        return chain;
      }),
      returning: vi.fn(async () => result),
    };
    return chain;
  });
  return {
    mockRequireAuth,
    selectRows,
    insertResults,
    insertedValues,
    conflictTargets,
    mockSelect,
    mockInsert,
  };
});

vi.mock("@workspace/db", () => {
  const table = () => new Proxy({}, {
    get: (_target, property: string | symbol) => String(property),
  });
  return {
    db: { select: mockSelect, insert: mockInsert },
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
  eq: vi.fn((...args: unknown[]) => args),
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

const IDEMPOTENCY_KEY = "7f03a8e7-aef8-4495-b450-fc27a7ab18a0";
const benefit = {
  tier: "gold",
  benefitKey: "airport_lounge",
  label: "Acesso ao lounge",
  description: "Apresente o voucher",
  value: "1 acesso",
  sortOrder: 0,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", clubRouter);
  app.use(errorHandler);
  return app;
}

function postBenefit(key: string, body = benefit) {
  return request(buildApp())
    .post("/api/club/benefits")
    .set("Idempotency-Key", key)
    .send(body);
}

function storedBenefit(id: string) {
  return { id, tenantId: ADMIN.tenantId, idempotencyKey: IDEMPOTENCY_KEY, ...benefit };
}

beforeEach(() => {
  selectRows.length = 0;
  insertResults.length = 0;
  insertedValues.length = 0;
  conflictTargets.length = 0;
  mockRequireAuth.mockReset().mockResolvedValue(ADMIN);
  mockSelect.mockClear();
  mockInsert.mockClear();
});

describe("POST /api/club/benefits idempotency", () => {
  it("replays the saved benefit when the same attempt is retried", async () => {
    insertResults.push([{ id: "benefit-saved-once" }], []);
    selectRows.push([storedBenefit("benefit-saved-once")]);

    const first = await postBenefit(IDEMPOTENCY_KEY);
    const retry = await postBenefit(IDEMPOTENCY_KEY);

    expect(first.status).toBe(201);
    expect(first.body).toEqual({ id: "benefit-saved-once" });
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ id: "benefit-saved-once" });
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(insertedValues.map((values) => values["idempotencyKey"]))
      .toEqual([IDEMPOTENCY_KEY, IDEMPOTENCY_KEY]);
    expect(conflictTargets).toHaveLength(2);
  });

  it("rejects reusing an attempt key for different benefit data", async () => {
    insertResults.push([]);
    selectRows.push([storedBenefit("benefit-saved-once")]);

    const response = await postBenefit(IDEMPOTENCY_KEY, { ...benefit, label: "Outro benefício" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "idempotency_key_conflict" });
  });

  it("allows an intentional duplicate with a new attempt key", async () => {
    insertResults.push([{ id: "benefit-first" }], [{ id: "benefit-second" }]);

    const first = await postBenefit(IDEMPOTENCY_KEY);
    const second = await postBenefit("abfd4140-aef6-4a72-8d48-44224c8ab66a");

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual({ id: "benefit-second" });
    expect(insertedValues).toHaveLength(2);
    expect(new Set(insertedValues.map((values) => values["idempotencyKey"])).size).toBe(2);
  });
});
