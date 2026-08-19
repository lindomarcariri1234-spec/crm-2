/**
 * Loyalty points clawback — real-DB integration test
 *
 * Exercises the full persistence round-trip:
 *   confirmed reservation (earn tx seeded) → cancel (clawback written) →
 *   reopen → cancel again (idempotency guard prevents double-deduction)
 *
 * Unlike cancellation-reversal.test.ts (which uses a fully-mocked DB layer),
 * this test does NOT mock @workspace/db or drizzle-orm. Every SELECT, INSERT,
 * and UPDATE goes through the real PostgreSQL database so regressions that
 * bypass the mock layer are caught.
 */

import { ROLES } from "@workspace/permissions";
import { randomUUID } from "crypto";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import express from "express";
import request from "supertest";
import {
  db,
  tenantsTable,
  usersTable,
  tripsTable,
  clientsTable,
  reservationsTable,
  loyaltyProgramsTable,
  loyaltyMembersTable,
  loyaltyTransactionsTable,
} from "@workspace/db";

// ---------------------------------------------------------------------------
// Module mocks — only non-DB external services are mocked
// ---------------------------------------------------------------------------

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "test_clerk" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/seat-sse.js", () => ({
  addSeatClient: vi.fn(),
  removeSeatClient: vi.fn(),
  emitSeatUpdate: vi.fn(),
}));

vi.mock("../lib/realtime.js", () => ({
  broadcastSeatUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: vi.fn(),
  getTenantUser: vi.fn(),
  ADMIN_ROLES: ["admin"],
  MANAGEMENT_ROLES: ["admin", "gerente"],
}));

vi.mock("../routes/payments.js", () => ({
  syncReservationCommission: vi.fn().mockResolvedValue(undefined),
  recalculateClientFinancials: vi.fn().mockResolvedValue(undefined),
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), use: vi.fn() },
}));

vi.mock("../queues/email-helpers.js", () => ({
  enqueueReservationConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueReservationCancellationEmail: vi.fn().mockResolvedValue(undefined),
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/commission-sync-helper.js", () => ({
  enqueueCommissionSync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: {
    syncTrip: vi.fn().mockResolvedValue(undefined),
    syncTripOnReservationCancellation: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../lib/activities.js", () => ({
  writeClientActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => randomUUID()),
  generateVoucherCode: vi.fn(() => `VCH-${randomUUID().slice(0, 8).toUpperCase()}`),
  generateReferralCode: vi.fn(() => "REF-0001"),
}));

vi.mock("../lib/reservation-number.js", () => ({
  getTenantReservationPrefix: vi.fn().mockResolvedValue("AG"),
  nextReservationSequence: vi.fn().mockResolvedValue(1),
  buildReservationNumber: vi.fn(() => "AG-EX-202507-0001"),
  getYearMonth: vi.fn(() => "202507"),
  tripTypeToCode: vi.fn(() => "EX"),
}));

vi.mock("../lib/passenger.js", () => ({
  deriveAgeCategory: vi.fn(() => "adult"),
  getAgeYears: vi.fn(() => 30),
}));

// ---------------------------------------------------------------------------
// Import router and middleware AFTER mocks
// ---------------------------------------------------------------------------

import { requireAuth } from "../lib/tenant.js";
import reservationsRouter from "../routes/reservations.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Test IDs — unique per run to avoid cross-test pollution
// ---------------------------------------------------------------------------

const RUN        = randomUUID().replace(/-/g, "").slice(0, 8);
const TENANT_ID  = `lci-${RUN}`;
const USER_ID    = `lciu-${RUN}`;
const TRIP_ID    = `lcit-${RUN}`;
const CLIENT_ID  = `lcicl-${RUN}`;
const PROGRAM_ID = `lciprg-${RUN}`;
const MEMBER_ID  = `lcimem-${RUN}`;
const RES_ID     = `lcires-${RUN}`;
const EARN_TX_ID = `lciearntx-${RUN}`;
const VOUCHER    = `VLCI${RUN.toUpperCase()}`;

const SEEDED_POINTS = 50;

// ---------------------------------------------------------------------------
// App builder
// ---------------------------------------------------------------------------

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: express.Request, _res, next) => {
    const noop = () => {};
    (req as unknown as Record<string, unknown>).log = {
      trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
    };
    (req as unknown as Record<string, unknown>).id = "test-req";
    next();
  });
  app.use("/api", reservationsRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Seed and teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  vi.mocked(requireAuth).mockResolvedValue({
    id: USER_ID,
    tenantId: TENANT_ID,
    role: ROLES.AGENCY_ADMIN,
    name: "Integration Tester",
    email: `tester-${RUN}@example.com`,
  } as never);

  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "LCI Agency",
    slug: `lci-agency-${RUN}`,
    email: `lci-${RUN}@agency.com`,
    planId: "starter",
    status: "trial",
  });

  await db.insert(usersTable).values({
    id: USER_ID,
    clerkId: `lci_clerk_${RUN}`,
    tenantId: TENANT_ID,
    name: "Integration Tester",
    email: `tester-${RUN}@example.com`,
    role: ROLES.AGENCY_ADMIN,
    referralCode: `LCIRF${RUN.toUpperCase()}`,
  });

  await db.insert(tripsTable).values({
    id: TRIP_ID,
    tenantId: TENANT_ID,
    name: "LCI Test Trip",
    slug: `lci-trip-${RUN}`,
    destination: "Fortaleza",
    destinationCity: "Fortaleza",
    destinationState: "CE",
    type: "excursao",
    category: "standard",
    departureDate: new Date("2027-08-01"),
    totalCapacity: 40,
    availableSeats: 39,
    reservedSeats: 0,
    confirmedSeats: 1,
    priceAdult: "500",
    createdById: USER_ID,
  });

  await db.insert(clientsTable).values({
    id: CLIENT_ID,
    tenantId: TENANT_ID,
    name: "Loyalty Tester",
    email: `client-${RUN}@example.com`,
    whatsapp: "11999990000",
    createdById: USER_ID,
  });

  await db.insert(loyaltyProgramsTable).values({
    id: PROGRAM_ID,
    tenantId: TENANT_ID,
    name: "LCI Fidelidade",
  });

  await db.insert(loyaltyMembersTable).values({
    id: MEMBER_ID,
    tenantId: TENANT_ID,
    programId: PROGRAM_ID,
    clientId: CLIENT_ID,
    totalPoints: SEEDED_POINTS,
    availablePoints: SEEDED_POINTS,
    tier: "bronze",
  });

  await db.insert(reservationsTable).values({
    id: RES_ID,
    tenantId: TENANT_ID,
    tripId: TRIP_ID,
    clientId: CLIENT_ID,
    seats: ["1A"],
    status: "confirmed",
    totalValue: "500",
    paidValue: "0",
    balance: "500",
    voucherCode: VOUCHER,
    qrCode: `QR-${VOUCHER}`,
    createdById: USER_ID,
    reservationNumber: "AG-EX-202708-0001",
  });

  // Seed the earn transaction representing points awarded at confirmation time.
  // In production loyaltyAwardPointsForReservation writes this row when the
  // reservation transitions from pending → confirmed.
  await db.insert(loyaltyTransactionsTable).values({
    id: EARN_TX_ID,
    tenantId: TENANT_ID,
    memberId: MEMBER_ID,
    type: "earn",
    points: SEEDED_POINTS,
    description: "Pontos ganhos pela confirmação da reserva",
    referenceId: RES_ID,
    referenceType: "reservation",
  });
});

afterAll(async () => {
  // Short settle to let any fire-and-forget async work finish before deletes
  await new Promise((r) => setTimeout(r, 150));

  await db.delete(loyaltyTransactionsTable).where(eq(loyaltyTransactionsTable.tenantId, TENANT_ID));
  await db.delete(loyaltyMembersTable).where(eq(loyaltyMembersTable.tenantId, TENANT_ID));
  await db.delete(loyaltyProgramsTable).where(eq(loyaltyProgramsTable.tenantId, TENANT_ID));
  await db.delete(reservationsTable).where(eq(reservationsTable.tenantId, TENANT_ID));
  await db.delete(clientsTable).where(eq(clientsTable.tenantId, TENANT_ID));
  await db.delete(tripsTable).where(eq(tripsTable.tenantId, TENANT_ID));
  await db.delete(usersTable).where(eq(usersTable.tenantId, TENANT_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

// ---------------------------------------------------------------------------
// Helpers for DB state assertions
// ---------------------------------------------------------------------------

async function getMember() {
  const [m] = await db
    .select({ availablePoints: loyaltyMembersTable.availablePoints, totalPoints: loyaltyMembersTable.totalPoints })
    .from(loyaltyMembersTable)
    .where(eq(loyaltyMembersTable.id, MEMBER_ID))
    .limit(1);
  return m;
}

async function getCancellationTxs() {
  return db
    .select({ id: loyaltyTransactionsTable.id, points: loyaltyTransactionsTable.points })
    .from(loyaltyTransactionsTable)
    .where(
      and(
        eq(loyaltyTransactionsTable.memberId, MEMBER_ID),
        eq(loyaltyTransactionsTable.type, "cancellation"),
      ),
    );
}

// ---------------------------------------------------------------------------
// Integration test
// ---------------------------------------------------------------------------

describe("Loyalty clawback — real DB end-to-end lifecycle", () => {
  it("confirmed → cancel (clawback written) → reopen → cancel again (idempotency guard prevents double-deduction)", async () => {
    const app = buildApp();

    // ── Pre-conditions ──────────────────────────────────────────────────────
    // Confirm the earn tx was seeded correctly
    const memberBefore = await getMember();
    expect(memberBefore).toBeDefined();
    expect(memberBefore.availablePoints).toBe(SEEDED_POINTS);

    const cancellationTxsBefore = await getCancellationTxs();
    expect(cancellationTxsBefore).toHaveLength(0);

    // ── Step 1: PATCH confirmed → cancelled (first cancellation) ────────────
    // The route detects wasActive = true, wasConfirmed = true, isBeingCancelled = true.
    // Reversal 4 runs: finds the seeded earn tx, inserts a "cancellation" tx,
    // and decrements the member's available points to 0.
    const firstCancelRes = await request(app)
      .patch(`/api/reservations/${RES_ID}`)
      .send({ status: "cancelled" });

    expect(firstCancelRes.status).toBe(200);
    expect(firstCancelRes.body.status).toBe("cancelled");

    // Verify the cancellation transaction was persisted to the real DB
    const txsAfterFirstCancel = await getCancellationTxs();
    expect(txsAfterFirstCancel).toHaveLength(1);
    expect(txsAfterFirstCancel[0].points).toBe(-SEEDED_POINTS);

    // Verify the member's available points were decremented (Math.max(0, 50-50) = 0)
    const memberAfterFirstCancel = await getMember();
    expect(memberAfterFirstCancel.availablePoints).toBe(0);

    // ── Step 2: PATCH cancelled → pending (admin reopens) ───────────────────
    // wasActive = ACTIVE_STATUSES.includes("cancelled") → false
    // isBeingCancelled = false → entire reversal block is skipped.
    // No loyalty rows should be added or modified.
    const reopenRes = await request(app)
      .patch(`/api/reservations/${RES_ID}`)
      .send({ status: "pending" });

    expect(reopenRes.status).toBe(200);
    expect(reopenRes.body.status).toBe("pending");

    // Cancellation txs unchanged — no new rows written during reopen
    const txsAfterReopen = await getCancellationTxs();
    expect(txsAfterReopen).toHaveLength(1);

    // Member points unchanged — no DB update during reopen
    const memberAfterReopen = await getMember();
    expect(memberAfterReopen.availablePoints).toBe(0);

    // ── Step 3: PATCH pending → cancelled again (idempotency guard) ─────────
    // wasActive = true (pending is in ACTIVE_STATUSES), isBeingCancelled = true.
    // Reversal 4 runs again, but the idempotency check finds the existing
    // "cancellation" tx from step 1 and SHORT-CIRCUITS — no second deduction.
    const secondCancelRes = await request(app)
      .patch(`/api/reservations/${RES_ID}`)
      .send({ status: "cancelled" });

    expect(secondCancelRes.status).toBe(200);
    expect(secondCancelRes.body.status).toBe("cancelled");

    // Idempotency guard fired: still exactly ONE cancellation tx in the DB
    const txsAfterSecondCancel = await getCancellationTxs();
    expect(txsAfterSecondCancel).toHaveLength(1);

    // Member's available points remain at 0 — no double-deduction
    const memberAfterSecondCancel = await getMember();
    expect(memberAfterSecondCancel.availablePoints).toBe(0);
  });
});
