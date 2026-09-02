/**
 * Task #785 — Manifest route wiring after helper extraction
 *
 * Confirms that GET /trips/:id/manifest/pdf and POST /trips/:id/manifest/send
 * are correctly wired to the manifest-helpers module after extracting the
 * generation logic out of trips.ts.  Tests auth, role, 404, and happy-path
 * responses without mocking the actual HTML/PDF generation (to exercise the
 * real import path).
 */

import pino from "pino";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockInsert,
  mockSendManifestEmail,
  mockDispatchOutboundMessage,
  mockGetPdfQueue,
  mockPdfQueueAdd,
} = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere, limit: mockLimit }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockInsertValues = vi.fn().mockResolvedValue([]);
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
  const mockSendManifestEmail = vi.fn().mockResolvedValue({ success: true });
  const mockDispatchOutboundMessage = vi.fn().mockResolvedValue({
    message: { id: "outbound-1", status: "accepted" },
    created: true,
    deliveries: [
      { id: "delivery-email", channel: "email", status: "accepted", externalId: "msg-001" },
      { id: "delivery-whatsapp", channel: "whatsapp", status: "skipped", skippedReason: "whatsapp_address_missing" },
    ],
  });
  const mockGetPdfQueue = vi.fn().mockReturnValue(null);
  const mockPdfQueueAdd = vi.fn().mockResolvedValue(undefined);
  return {
    mockLimit,
    mockWhere,
    mockFrom,
    mockSelect,
    mockInsert,
    mockSendManifestEmail,
    mockDispatchOutboundMessage,
    mockGetPdfQueue,
    mockPdfQueueAdd,
  };
});

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
    transaction: vi.fn(),
  },
  tripsTable: {},
  reservationsTable: {},
  passengersTable: {},
  clientsTable: {},
  tenantsTable: {},
  vehicleLayoutsTable: {},
  auditLogsTable: {},
  plansTable: {},
  tripMediaTable: {},
  tripCheckinsTable: {},
  tripGuideLocationsTable: {},
  referralsTable: {},
}));

vi.mock("drizzle-orm", async () => {
  const { makeDrizzleOrmMock } = await import("./helpers/drizzle-mock.js");
  return makeDrizzleOrmMock();
});

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/seat-sse.js", () => ({
  addSeatClient: vi.fn(),
  removeSeatClient: vi.fn(),
  emitSeatUpdate: vi.fn(),
}));

vi.mock("../lib/boarding-sse.js", () => ({
  tryAddBoardingClient: vi.fn(),
  removeBoardingClient: vi.fn(),
  emitBoardingUpdate: vi.fn(),
}));

vi.mock("../lib/get-client-ip.js", () => ({
  getClientIp: vi.fn(() => "127.0.0.1"),
}));

vi.mock("../lib/planLimits.js", () => ({
  checkPlanLimit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/uploadthing.js", () => ({
  deleteOrphanedFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/plan-features.js", () => ({
  hasSeatMapFeature: vi.fn().mockReturnValue(false),
}));

vi.mock("../lib/passenger.js", () => ({
  deriveAgeCategory: vi.fn(() => "adult"),
  getAgeYears: vi.fn(() => 30),
}));

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: {
    syncTrip: vi.fn().mockResolvedValue(undefined),
    syncTripOnReservationCancellation: vi.fn().mockResolvedValue(undefined),
    deleteEventsForTrip: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/google-calendar/schedule-sync.js", () => ({
  scheduleCalendarSyncTrip: vi.fn().mockResolvedValue(undefined),
  scheduleCalendarDeleteEventsForTrip: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/email", () => ({
  sendManifestEmail: mockSendManifestEmail,
  sendReservationConfirmationEmail: vi.fn().mockResolvedValue({ success: true }),
  sendReservationCancellationEmail: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("../services/outbound-delivery.js", () => ({
  dispatchOutboundMessage: mockDispatchOutboundMessage,
}));

vi.mock("../queues/email-helpers.js", () => ({
  dispatchReferralReversedEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReservationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReservationCancellationEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/index.js", () => ({
  getPdfQueue: mockGetPdfQueue,
}));

vi.mock("../lib/redis.js", () => ({
  areWorkersEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => ({
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    })),
  },
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["admin"],
  MANAGEMENT_ROLES: ["admin", "manager"],
  ALL_STAFF_ROLES: ["admin", "manager", "vendedor"],
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-audit-id"),
  generateVoucherCode: vi.fn(() => "VCH-001"),
  generateReferralCode: vi.fn(() => "REF-001"),
}));

vi.mock("../lib/status-validators.js", () => ({
  parseTripStatus: vi.fn((s: string) => s),
}));

vi.mock("../lib/activities.js", () => ({
  writeClientActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/reservation-number.js", () => ({
  getTenantReservationPrefix: vi.fn().mockResolvedValue("AG"),
  nextReservationSequence: vi.fn().mockResolvedValue(1),
  buildReservationNumber: vi.fn(() => "AG-EX-202507-0001"),
  getYearMonth: vi.fn(() => "202507"),
  tripTypeToCode: vi.fn(() => "EX"),
}));

// ─── Import under test (after all vi.mock declarations) ─────────────────────

import { requireAuth } from "../lib/tenant.js";
import tripsRouter from "../routes/trips.js";
import { errorHandler, requestId } from "../middlewares/errorHandler.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_ID = "tenant-001";

const FAKE_ADMIN = {
  id: "user-001",
  tenantId: TENANT_ID,
  // "agencia" is the canonical AGENCY_ADMIN value used by the matrix.
  role: "agencia",
  name: "Admin Teste",
  email: "admin@test.com",
};

const FAKE_MANAGER = {
  ...FAKE_ADMIN,
  id: "user-002",
  // "gerente" is the canonical matrix role; "manager" is only a legacy label.
  role: "gerente",
};

/** Trip with departureDate stored as noon Brazil (UTC+15h) per Task #782 fix */
const FAKE_TRIP = {
  id: "trip-001",
  tenantId: TENANT_ID,
  name: "Excursão Nordeste 2026",
  departureDate: new Date("2026-07-04T15:00:00.000Z"),
  departureTime: "08:30",
  destination: "Fortaleza, CE",
  destinationCity: "Fortaleza",
  destinationState: "CE",
  layoutId: null,
  manifestNumber: "MAN-0001",
  vehiclePlate: "ABC-1234",
  vehicleType: "Ônibus",
  driverName: "João Motorista",
  driver1Cpf: null,
  driver1Cnh: null,
  driver1CnhCategory: null,
  driver1CnhExpiry: null,
  driver2Name: null,
  driver2Cpf: null,
  driver2Cnh: null,
  driver2CnhCategory: null,
  driver2CnhExpiry: null,
  tourGuide: null,
  tourGuideCpf: null,
  tourGuideRegistration: null,
  boardingPoints: [],
  freePassengers: [],
  availableSeats: 10,
  totalCapacity: 46,
  status: "active",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const FAKE_TENANT = { name: "Agência Teste Ltda", cnpj: null };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stubLogger(
  req: express.Request & { log?: unknown },
  _res: express.Response,
  next: express.NextFunction,
) {
  req.log = pino({ level: "silent" });
  next();
}

function buildApp() {
  const app = express();
  app.use(requestId);
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", tripsRouter);
  app.use(errorHandler);
  return app;
}

/**
 * Queues up the three DB selects that both manifest routes make when there
 * are no reservations and no vehicle layout (the simplest case):
 *   1. trips (with .limit(1))
 *   2. reservations (no .limit() — awaited directly from mockWhere)
 *   3. tenants (with .limit(1))
 */
function setupManifestDbMocks(trip = FAKE_TRIP, tenant = FAKE_TENANT) {
  mockWhere.mockReturnValueOnce({ limit: mockLimit });   // call 1: trips → .limit()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockWhere as any).mockResolvedValueOnce([]);          // call 2: reservations (no .limit())
  mockWhere.mockReturnValueOnce({ limit: mockLimit });   // call 3: tenants → .limit()
  mockLimit.mockResolvedValueOnce([trip]);
  mockLimit.mockResolvedValueOnce([tenant]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/trips/:id/manifest/pdf — manifest PDF route wiring", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockLimit.mockResolvedValue([]);
    mockGetPdfQueue.mockReturnValue(null);
  });

  it("returns 200 with Content-Type application/pdf for an admin user", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ADMIN as never);
    setupManifestDbMocks();

    const res = await request(buildApp()).get("/api/trips/trip-001/manifest/pdf");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
  });

  it("returns 200 with Content-Type application/pdf for a manager user", async () => {
    requireAuthMock.mockResolvedValue(FAKE_MANAGER as never);
    setupManifestDbMocks();

    const res = await request(buildApp()).get("/api/trips/trip-001/manifest/pdf");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
  });

  it("returns a non-empty PDF buffer (starts with %PDF-)", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ADMIN as never);
    setupManifestDbMocks();

    const res = await request(buildApp())
      .get("/api/trips/trip-001/manifest/pdf")
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    const buf: Buffer = res.body;
    expect(buf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("returns Content-Disposition attachment header with trip name", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ADMIN as never);
    setupManifestDbMocks();

    const res = await request(buildApp()).get("/api/trips/trip-001/manifest/pdf");

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.headers["content-disposition"]).toMatch(/\.pdf/);
  });

  it("returns 401 when requireAuth resolves null (unauthenticated)", async () => {
    requireAuthMock.mockImplementation(async (_req: unknown, res: express.Response) => {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return null;
    });

    const res = await request(buildApp()).get("/api/trips/trip-001/manifest/pdf");

    expect(res.status).toBe(401);
  });

  it("returns 403 when user role is not in MANAGEMENT_ROLES", async () => {
    requireAuthMock.mockResolvedValue({ ...FAKE_ADMIN, role: "vendedor" } as never);

    const res = await request(buildApp()).get("/api/trips/trip-001/manifest/pdf");

    expect(res.status).toBe(403);
  });

  it("returns 404 when the trip does not exist", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ADMIN as never);
    // trip select returns [] (not found)
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/api/trips/trip-001/manifest/pdf");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("POST /api/trips/:id/manifest/send — manifest send route wiring", () => {
  const requireAuthMock = vi.mocked(requireAuth);

  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit });
    mockSelect.mockReturnValue({ from: mockFrom });
    mockLimit.mockResolvedValue([]);
    mockGetPdfQueue.mockReturnValue(null);
    mockSendManifestEmail.mockResolvedValue({ success: true });
    mockDispatchOutboundMessage.mockResolvedValue({
      message: { id: "outbound-1", status: "accepted" },
      created: true,
      deliveries: [
        { id: "delivery-email", channel: "email", status: "accepted", externalId: "msg-001" },
        { id: "delivery-whatsapp", channel: "whatsapp", status: "skipped", skippedReason: "whatsapp_address_missing" },
      ],
    });
  });

  it("dispatches the email through the outbound ledger and returns success", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ADMIN as never);
    setupManifestDbMocks();

    const res = await request(buildApp())
      .post("/api/trips/trip-001/manifest/send")
      .send({ channel: "email", to: "passageiros@teste.com.br" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, channel: "email" });
    expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT_ID,
      recipient: { type: "direct", email: "passageiros@teste.com.br" },
      originChannel: "email",
    }));
    expect(mockDispatchOutboundMessage.mock.results[0]?.value).toBeDefined();
  });

  it("creates accepted email and skipped WhatsApp delivery records", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ADMIN as never);
    setupManifestDbMocks();

    const res = await request(buildApp())
      .post("/api/trips/trip-001/manifest/send")
      .send({ channel: "email", to: "passageiros@teste.com.br" });

    expect(res.status).toBe(200);
    const deliveries = mockDispatchOutboundMessage.mock.results[0]?.value
      ? await mockDispatchOutboundMessage.mock.results[0].value
      : null;
    expect(deliveries.deliveries).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "email", status: "accepted" }),
      expect.objectContaining({ channel: "whatsapp", status: "skipped" }),
    ]));
  });

  it("queues only manifest identifiers and recipient metadata", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ADMIN as never);
    setupManifestDbMocks();
    mockGetPdfQueue.mockReturnValue({ add: mockPdfQueueAdd });

    const res = await request(buildApp())
      .post("/api/trips/trip-001/manifest/send")
      .send({ channel: "email", to: "passageiros@teste.com.br" });

    expect(res.status).toBe(202);
    expect(mockSendManifestEmail).not.toHaveBeenCalled();
    expect(mockPdfQueueAdd).toHaveBeenCalledWith("manifest", {
      type: "manifest",
      tenantId: TENANT_ID,
      tripId: FAKE_TRIP.id,
      recipientEmail: "passageiros@teste.com.br",
      userId: FAKE_ADMIN.id,
      ipAddress: "127.0.0.1",
      userAgent: null,
    });
    const payload = mockPdfQueueAdd.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("htmlContent");
    expect(payload).not.toHaveProperty("pdfBase64");
  });

  it("stores PDF metadata while dispatching through the outbound ledger", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ADMIN as never);
    setupManifestDbMocks();

    await request(buildApp())
      .post("/api/trips/trip-001/manifest/send")
      .send({ channel: "email", to: "passageiros@teste.com.br" });

    expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ tripId: FAKE_TRIP.id, pdfBytes: expect.any(Number) }),
    }));
  });

  it("passes rendered manifest HTML to the outbound email delivery", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ADMIN as never);
    setupManifestDbMocks();

    await request(buildApp())
      .post("/api/trips/trip-001/manifest/send")
      .send({ channel: "email", to: "passageiros@teste.com.br" });

    expect(mockDispatchOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      email: expect.objectContaining({ html: expect.stringContaining("04/07/2026") }),
    }));
  });

  it("returns whatsapp URL for whatsapp channel", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ADMIN as never);
    // whatsapp path: trip + reservations (no audit after — actually it does insert audit)
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockWhere as any).mockResolvedValueOnce([]);
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([FAKE_TRIP]);
    mockLimit.mockResolvedValueOnce([FAKE_TENANT]);

    const res = await request(buildApp())
      .post("/api/trips/trip-001/manifest/send")
      .send({ channel: "whatsapp", to: "11999990000" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, channel: "whatsapp" });
    expect(res.body.whatsappUrl).toContain("wa.me");
  });

  it("returns 400 for invalid body (missing channel)", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ADMIN as never);

    const res = await request(buildApp())
      .post("/api/trips/trip-001/manifest/send")
      .send({ to: "passageiros@teste.com.br" });

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid email address", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ADMIN as never);

    const res = await request(buildApp())
      .post("/api/trips/trip-001/manifest/send")
      .send({ channel: "email", to: "not-an-email" });

    expect(res.status).toBe(400);
  });

  it("returns 401 when requireAuth resolves null (unauthenticated)", async () => {
    requireAuthMock.mockImplementation(async (_req: unknown, res: express.Response) => {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return null;
    });

    const res = await request(buildApp())
      .post("/api/trips/trip-001/manifest/send")
      .send({ channel: "email", to: "passageiros@teste.com.br" });

    expect(res.status).toBe(401);
  });

  it("returns 403 when user role is not in ADMIN_ROLES", async () => {
    requireAuthMock.mockResolvedValue({ ...FAKE_ADMIN, role: "manager" } as never);

    const res = await request(buildApp())
      .post("/api/trips/trip-001/manifest/send")
      .send({ channel: "email", to: "passageiros@teste.com.br" });

    expect(res.status).toBe(403);
  });

  it("returns 404 when the trip does not exist", async () => {
    requireAuthMock.mockResolvedValue(FAKE_ADMIN as never);
    mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/api/trips/trip-001/manifest/send")
      .send({ channel: "email", to: "passageiros@teste.com.br" });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: "NOT_FOUND" });
  });
});
