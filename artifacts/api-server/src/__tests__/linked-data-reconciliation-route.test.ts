import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { ROLES } from "@workspace/permissions";

const { requireAuth, reconcile, dbSelect, eq } = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  reconcile: vi.fn(),
  dbSelect: vi.fn(),
  eq: vi.fn(() => ({})),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth,
  getTenantUser: vi.fn(),
  ADMIN_ROLES: [ROLES.SUPER_ADMIN, ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER],
}));
vi.mock("../services/linked-data-reconciliation.js", () => ({ reconcileLinkedData: reconcile }));
vi.mock("../lib/linked-data.js", () => ({
  linkedDeal: vi.fn(), linkedReservation: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: { select: dbSelect }, pipelinesTable: {}, pipelineStagesTable: {}, dealsTable: {},
  clientsTable: {}, reservationsTable: {}, storeOrdersTable: {}, referralsTable: {},
  linkedDataReconciliationRunsTable: { tenantId: {}, id: {}, executedAt: {}, checkedCount: {}, repairedCount: {}, issueCount: {}, summary: {}, mode: {} },
}));
vi.mock("drizzle-orm", () => ({
  eq,
  and: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  count: vi.fn(() => ({})),
}));

import pipelineRouter from "../routes/pipeline.js";

describe("linked-data reconciliation admin endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is mounted and invokes the tenant-scoped service only for an admin", async () => {
    requireAuth.mockResolvedValue({ id: "admin", tenantId: "tenant-a", role: ROLES.AGENCY_ADMIN });
    reconcile.mockResolvedValue({ repaired: ["deal:d1"], issues: [] });
    const app = express();
    app.use(express.json());
    app.use("/api", pipelineRouter);
    app.use((err: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(err.status ?? 500).json({ error: true }));
    const response = await request(app).post("/api/admin/linked-data/reconcile").send({ repair: true });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ repaired: ["deal:d1"], issues: [] });
    expect(reconcile).toHaveBeenCalledWith("tenant-a", true);
  });

  it("keeps dry-run as the default and passes through structured reports", async () => {
    requireAuth.mockResolvedValue({ id: "admin", tenantId: "tenant-a", role: ROLES.AGENCY_ADMIN });
    const report = {
      mode: "dry-run", tenantId: "tenant-a", generatedAt: "2025-01-01T00:00:00.000Z",
      checked: 1, repairedCount: 0, issueCount: 0, repaired: [], issues: [],
      summary: { checked: { "trip-seats": 1 }, repaired: {}, issues: {} },
      categories: { "trip-seats": { checked: 1, repaired: [], issues: [] } },
    };
    reconcile.mockResolvedValue(report);
    const app = express();
    app.use(express.json());
    app.use("/api", pipelineRouter);
    const response = await request(app).post("/api/admin/linked-data/reconcile").send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual(report);
    expect(reconcile).toHaveBeenCalledWith("tenant-a", false);
  });

  it("lists only the current agency history with bounded pagination", async () => {
    requireAuth.mockResolvedValue({ id: "admin", tenantId: "tenant-a", role: ROLES.AGENCY_ADMIN });
    const rows = [{
      id: "run-1",
      mode: "dry-run",
      executedAt: "2025-01-01T00:00:00.000Z",
      checkedCount: 4,
      repairedCount: 0,
      issueCount: 1,
      summary: { "client-user": { checked: 2, repaired: 0, issues: 1, reasons: { ambiguous: 1 } } },
    }];
    const rowsChain: Record<string, ReturnType<typeof vi.fn>> = {};
    rowsChain.from = vi.fn(() => rowsChain);
    rowsChain.where = vi.fn(() => rowsChain);
    rowsChain.orderBy = vi.fn(() => rowsChain);
    rowsChain.limit = vi.fn(() => rowsChain);
    rowsChain.offset = vi.fn(async () => rows);
    const countChain: Record<string, ReturnType<typeof vi.fn>> = {};
    countChain.from = vi.fn(() => countChain);
    countChain.where = vi.fn(async () => [{ total: 11 }]);
    dbSelect.mockReturnValueOnce(rowsChain).mockReturnValueOnce(countChain);

    const app = express();
    app.use(express.json());
    app.use("/api", pipelineRouter);
    const response = await request(app).get("/api/admin/linked-data/reconcile/history?limit=5&offset=5");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: rows,
      pagination: { limit: 5, offset: 5, total: 11, hasMore: true },
    });
    expect(eq).toHaveBeenCalledWith({}, "tenant-a");
    expect(rowsChain.limit).toHaveBeenCalledWith(5);
    expect(rowsChain.offset).toHaveBeenCalledWith(5);
  });

  it("rejects pagination outside the supported history window", async () => {
    requireAuth.mockResolvedValue({ id: "admin", tenantId: "tenant-a", role: ROLES.AGENCY_ADMIN });
    const app = express();
    app.use(express.json());
    app.use("/api", pipelineRouter);
    app.use((err: { status?: number }, _req: express.Request, res: express.Response) => res.status(err.status ?? 500).json({ error: true }));

    const response = await request(app).get("/api/admin/linked-data/reconcile/history?limit=100");

    expect(response.status).toBe(400);
    expect(dbSelect).not.toHaveBeenCalled();
  });
});
