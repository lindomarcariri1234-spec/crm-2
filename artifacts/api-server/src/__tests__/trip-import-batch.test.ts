import { describe, expect, it, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const {
  selectQueue,
  insertedTrips,
  insertedBatches,
  mockRequireAuth,
  mockExecute,
  mockTransaction,
  tripsTable,
  tripImportBatchesTable,
} = vi.hoisted(() => ({
  selectQueue: [] as unknown[][],
  insertedTrips: [] as Array<Record<string, unknown>>,
  insertedBatches: [] as Array<Record<string, unknown>>,
  mockRequireAuth: vi.fn(),
  mockExecute: vi.fn(),
  mockTransaction: vi.fn(),
  tripsTable: { id: "trips.id", tenantId: "trips.tenantId", importFingerprint: "trips.importFingerprint" },
  tripImportBatchesTable: { tenantId: "trip_import_batches.tenantId", idempotencyKey: "trip_import_batches.idempotencyKey" },
}));

type QueryChain = Promise<unknown[]> & {
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

function query(data: unknown[]): QueryChain {
  const chain = Promise.resolve(data) as QueryChain;
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn().mockResolvedValue(data);
  return chain;
}

const tx = {
  execute: mockExecute,
  select: vi.fn(() => query(selectQueue.shift() ?? [])),
  insert: vi.fn((table: unknown) => ({
    values: vi.fn((values: Record<string, unknown>) => {
      if (table === tripsTable) {
        insertedTrips.push(values);
        return {
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ id: values.id }]),
          })),
        };
      }
      insertedBatches.push(values);
      return Promise.resolve([]);
    }),
  })),
};

vi.mock("@workspace/db", () => ({
  db: {
    transaction: mockTransaction,
  },
  tripsTable,
  tripImportBatchesTable,
  reservationsTable: {},
  passengersTable: {},
  clientsTable: {},
  tenantsTable: { id: "tenants.id", planId: "tenants.planId" },
  vehicleLayoutsTable: { id: "vehicle_layouts.id", tenantId: "vehicle_layouts.tenantId" },
  auditLogsTable: {},
  plansTable: { id: "plans.id", slug: "plans.slug", maxTrips: "plans.maxTrips", supportedFeatures: "plans.supportedFeatures" },
  tripMediaTable: {},
  tripCheckinsTable: {},
  tripGuideLocationsTable: {},
  referralsTable: {},
  boardingLocationsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
  ilike: vi.fn(),
  desc: vi.fn(),
  asc: vi.fn(),
  inArray: vi.fn(),
  gt: vi.fn(),
  isNotNull: vi.fn(),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ text: strings.join("?"), values }),
    { raw: vi.fn() },
  ),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["admin"],
  MANAGEMENT_ROLES: ["admin", "manager"],
}));
vi.mock("../lib/id.js", () => {
  let sequence = 0;
  return { generateId: vi.fn(() => `generated-${++sequence}`) };
});
vi.mock("../lib/seat-sse.js", () => ({ addSeatClient: vi.fn(), removeSeatClient: vi.fn() }));
vi.mock("../lib/realtime.js", () => ({ broadcastSeatUpdate: vi.fn() }));
vi.mock("../lib/boarding-sse.js", () => ({ tryAddBoardingClient: vi.fn(), removeBoardingClient: vi.fn(), emitBoardingUpdate: vi.fn() }));
vi.mock("../lib/planLimits.js", () => ({ checkPlanLimit: vi.fn() }));
vi.mock("../lib/plan-features.js", () => ({ hasSeatMapFeature: vi.fn(() => true) }));
vi.mock("../lib/passenger.js", () => ({ deriveAgeCategory: vi.fn(), getAgeYears: vi.fn(), syncIsChildUnder7: vi.fn() }));
vi.mock("../lib/uploadthing.js", () => ({ deleteOrphanedFile: vi.fn() }));
vi.mock("../lib/status-validators.js", () => ({ parseTripStatus: vi.fn((value: string) => value) }));
vi.mock("../lib/google-calendar/sync-service.js", () => ({ CalendarSyncService: {} }));
vi.mock("../lib/google-calendar/schedule-sync.js", () => ({ scheduleCalendarSyncTrip: vi.fn().mockResolvedValue(undefined), scheduleCalendarDeleteEventsForTrip: vi.fn() }));
vi.mock("../lib/get-client-ip.js", () => ({ getClientIp: vi.fn() }));
vi.mock("../lib/redis.js", () => ({ areWorkersEnabled: vi.fn(() => false) }));
vi.mock("../lib/logger.js", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("@workspace/email", () => ({ sendManifestEmail: vi.fn() }));
vi.mock("../queues/index.js", () => ({ getPdfQueue: vi.fn() }));
vi.mock("../queues/email-helpers.js", () => ({
  dispatchReferralReversedEmail: vi.fn(),
  enqueueReservationCancellationEmail: vi.fn(),
  dispatchTripRestorationNotification: vi.fn(),
}));
vi.mock("../services/pipeline-automation.js", () => ({ cancelDealOnReservationCancellation: vi.fn() }));

import tripsRouter from "../routes/trips.js";
import { errorHandler } from "../middlewares/errorHandler.js";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/api", tripsRouter);
  instance.use(errorHandler);
  return instance;
}

const tenant = {
  id: "tenant-a",
  status: "active",
  trial_ends_at: null,
  plan_id: "starter",
  max_trips_override: null,
};

const trip = {
  name: "Excursão de teste",
  destination: "Natal",
  destinationCity: "Natal",
  destinationState: "RN",
  type: "excursao",
  category: "standard",
  departureDate: "2027-01-10",
  totalCapacity: 40,
  priceAdult: 100,
};

function queueSuccessfulNewImport() {
  selectQueue.push(
    [], // idempotency lookup
    [{ maxTrips: 20 }], // plan limit
    [{ count: 0 }], // current trip count
    [], // existing fingerprints
    [{ planId: "starter" }], // helper tenant plan
    [{ supportedFeatures: [] }], // helper supported features
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  insertedTrips.length = 0;
  insertedBatches.length = 0;
  tx.select.mockClear();
  tx.insert.mockClear();
  mockExecute.mockResolvedValue({ rows: [tenant] });
  mockTransaction.mockImplementation(async (callback: (transaction: typeof tx) => unknown) => callback(tx));
  mockRequireAuth.mockResolvedValue({ id: "user-1", tenantId: "tenant-a", role: "admin" });
});

describe("POST /api/trips/import", () => {
  it("repeats the saved per-line result for the same idempotency key without inserting twice", async () => {
    queueSuccessfulNewImport();
    const first = await request(app()).post("/api/trips/import").send({
      idempotencyKey: "same-file",
      rows: [{ line: 2, data: trip }],
    });
    expect(first.status).toBe(200);
    expect(first.body.results).toEqual([expect.objectContaining({ line: 2, status: "created" })]);
    expect(insertedTrips).toHaveLength(1);

    selectQueue.push([{
      requestHash: insertedBatches[0].requestHash,
      results: first.body.results,
    }]);
    const repeated = await request(app()).post("/api/trips/import").send({
      idempotencyKey: "same-file",
      rows: [{ line: 2, data: trip }],
    });
    expect(repeated.status).toBe(200);
    expect(repeated.body.replayed).toBe(true);
    expect(repeated.body.results).toEqual(first.body.results);
    expect(insertedTrips).toHaveLength(1);
  });

  it("reports a rolled-back interruption instead of recording a completed batch", async () => {
    queueSuccessfulNewImport();
    tx.insert.mockImplementationOnce((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        if (table !== tripsTable) return Promise.resolve([]);
        insertedTrips.push(values);
        return {
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn().mockRejectedValue(new Error("connection lost")),
          })),
        };
      }),
    }));

    const response = await request(app()).post("/api/trips/import").send({
      idempotencyKey: "retry-after-failure",
      rows: [{ line: 2, data: trip }],
    });
    expect(response.status).toBe(500);
    expect(response.body.code).toBe("TRIP_IMPORT_FAILED");
    expect(insertedBatches).toHaveLength(0);
  });

  it("locks the tenant and rejects the whole new portion when a concurrent import would exceed its plan", async () => {
    mockExecute.mockResolvedValue({
      rows: [{ ...tenant, max_trips_override: 1 }],
    });
    selectQueue.push(
      [], // idempotency lookup
      [{ maxTrips: 20 }], // plan limit
      [{ count: 0 }], // current trip count
      [], // existing fingerprints
    );
    const response = await request(app()).post("/api/trips/import").send({
      idempotencyKey: "limited-file",
      rows: [
        { line: 2, data: trip },
        { line: 3, data: { ...trip, name: "Outra excursão", departureDate: "2027-01-11" } },
      ],
    });
    expect(response.status).toBe(200);
    expect(response.body.results).toEqual([
      expect.objectContaining({ line: 2, status: "error", error: expect.stringMatching(/Limite do plano/) }),
      expect.objectContaining({ line: 3, status: "error", error: expect.stringMatching(/Limite do plano/) }),
    ]);
    expect(insertedTrips).toHaveLength(0);
    expect(mockExecute.mock.calls[0][0].text).toContain("FOR UPDATE");
  });

  it("keeps idempotency keys scoped to the authenticated tenant", async () => {
    queueSuccessfulNewImport();
    const tenantA = await request(app()).post("/api/trips/import").send({
      idempotencyKey: "shared-key",
      rows: [{ line: 2, data: trip }],
    });
    expect(tenantA.status).toBe(200);

    mockRequireAuth.mockResolvedValue({ id: "user-2", tenantId: "tenant-b", role: "admin" });
    mockExecute.mockResolvedValue({ rows: [{ ...tenant, id: "tenant-b" }] });
    queueSuccessfulNewImport();
    const tenantB = await request(app()).post("/api/trips/import").send({
      idempotencyKey: "shared-key",
      rows: [{ line: 2, data: { ...trip, name: "Viagem da outra agência" } }],
    });
    expect(tenantB.status).toBe(200);
    expect(tenantB.body.replayed).toBeUndefined();
    expect(insertedBatches.map(batch => batch.tenantId)).toEqual(["tenant-a", "tenant-b"]);
  });
});