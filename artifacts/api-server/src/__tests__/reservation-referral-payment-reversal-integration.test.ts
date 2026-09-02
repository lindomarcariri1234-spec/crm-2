/**
 * Real PostgreSQL concurrency coverage for reservation referral reversals.
 *
 * The two requests intentionally use separate route transactions. This
 * verifies that the payment-first lock order in payments.ts and the
 * reservation/referral locks in reservation-referral-conversion.ts make the
 * reversal a one-time operation.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  loyaltyMembersTable,
  loyaltyProgramsTable,
  loyaltyTransactionsTable,
  paymentsTable,
  referralCommissionsTable,
  referralsTable,
  reservationsTable,
  tenantsTable,
  tripsTable,
  usersTable,
} from "@workspace/db";
import {
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  REFERRAL_STATUS,
  ROLES,
} from "@workspace/permissions";

const { mockRequireAuth } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  getTenantUser: vi.fn(),
  ADMIN_ROLES: [ROLES.AGENCY_ADMIN, ROLES.SUPER_ADMIN],
  MANAGEMENT_ROLES: [ROLES.AGENCY_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SUPER_ADMIN],
  ALL_STAFF_ROLES: [
    ROLES.AGENCY_ADMIN,
    ROLES.AGENCY_MANAGER,
    ROLES.SUPPORT,
    ROLES.SALES,
    ROLES.SUPER_ADMIN,
  ],
}));

vi.mock("../lib/activities.js", () => ({
  writeClientActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/loyalty-helpers.js", () => ({
  loyaltyAwardPoints: vi.fn().mockResolvedValue(undefined),
  loyaltyAwardPointsForReservation: vi.fn().mockResolvedValue(undefined),
  loyaltyReverseEarnedPoints: vi.fn().mockResolvedValue(undefined),
  calculateTier: vi.fn(() => "bronze"),
}));

vi.mock("../lib/google-calendar/sync-service.js", () => ({
  CalendarSyncService: {
    syncTrip: vi.fn().mockResolvedValue(undefined),
    syncPayment: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../services/checkout/create-reservations.js", () => ({
  createReservationsForOrder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/reservation-order-payment-sync.js", () => ({
  syncStoreOrderFromReservationPayment: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/email-helpers.js", () => ({
  enqueueNewBookingNotificationEmail: vi.fn().mockResolvedValue(undefined),
  dispatchReferralReversedEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../queues/whatsapp-helpers.js", () => ({
  dispatchWhatsAppPaymentReceived: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/pipeline-automation.js", () => ({
  moveDealToStage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/push-notifications.js", () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

import paymentsRouter from "../routes/payments.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const RUN = randomUUID().replaceAll("-", "").slice(0, 10);
const TENANT_ID = `rrpi-tenant-${RUN}`;
const USER_ID = `rrpi-user-${RUN}`;
const TRIP_ID = `rrpi-trip-${RUN}`;
const REFERRER_ID = `rrpi-referrer-${RUN}`;
const REFERRED_ID = `rrpi-referred-${RUN}`;
const PROGRAM_ID = `rrpi-program-${RUN}`;
const MEMBER_ID = `rrpi-member-${RUN}`;
const RESERVATION_ID = `rrpi-reservation-${RUN}`;
const PAYMENT_ID = `rrpi-payment-${RUN}`;
const REFERRAL_ID = `rrpi-referral-${RUN}`;
const REFERRAL_COMMISSION_ID = `rrpi-commission-${RUN}`;
const REFERRAL_POINTS_ID = `rrpi-referral-points-${RUN}`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, () => void> }).log = {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
    };
    next();
  });
  app.use("/api", paymentsRouter);
  app.use(errorHandler);
  return app;
}

async function resetFixture() {
  await db.delete(loyaltyTransactionsTable).where(eq(loyaltyTransactionsTable.tenantId, TENANT_ID));
  await db.delete(loyaltyMembersTable).where(eq(loyaltyMembersTable.tenantId, TENANT_ID));
  await db.delete(loyaltyProgramsTable).where(eq(loyaltyProgramsTable.tenantId, TENANT_ID));
  await db.delete(referralCommissionsTable).where(eq(referralCommissionsTable.tenantId, TENANT_ID));
  await db.delete(paymentsTable).where(eq(paymentsTable.tenantId, TENANT_ID));
  await db.delete(referralsTable).where(eq(referralsTable.tenantId, TENANT_ID));
  await db.delete(reservationsTable).where(eq(reservationsTable.tenantId, TENANT_ID));

  await db.update(clientsTable).set({
    successfulReferrals: 1,
    referralEarnings: "25.00",
  }).where(and(eq(clientsTable.id, REFERRER_ID), eq(clientsTable.tenantId, TENANT_ID)));

  await db.insert(loyaltyProgramsTable).values({
    id: PROGRAM_ID,
    tenantId: TENANT_ID,
    name: "Referral reversal integration program",
  });
  await db.insert(loyaltyMembersTable).values({
    id: MEMBER_ID,
    tenantId: TENANT_ID,
    programId: PROGRAM_ID,
    clientId: REFERRER_ID,
    totalPoints: 40,
    availablePoints: 40,
    tier: "bronze",
  });
  await db.insert(reservationsTable).values({
    id: RESERVATION_ID,
    tenantId: TENANT_ID,
    tripId: TRIP_ID,
    clientId: REFERRED_ID,
    seats: ["1A"],
    totalValue: "100.00",
    paidValue: "100.00",
    balance: "0.00",
    status: "confirmed",
    voucherCode: `RRPI-${RUN}`,
    qrCode: `RRPI-QR-${RUN}`,
    createdById: USER_ID,
    reservationNumber: `RRPI-${RUN}`,
  });
  await db.insert(paymentsTable).values({
    id: PAYMENT_ID,
    tenantId: TENANT_ID,
    reservationId: RESERVATION_ID,
    clientId: REFERRED_ID,
    type: PAYMENT_TYPE.RECEIVABLE,
    category: "reservation",
    amount: "100.00",
    paymentMethod: "pix",
    dueDate: new Date("2026-08-01T12:00:00.000Z"),
    paidAt: new Date("2026-08-01T12:00:00.000Z"),
    status: PAYMENT_STATUS.PAID,
  });
  await db.insert(referralsTable).values({
    id: REFERRAL_ID,
    tenantId: TENANT_ID,
    referrerId: REFERRER_ID,
    referredId: REFERRED_ID,
    code: `RRPI-CODE-${RUN}`,
    status: REFERRAL_STATUS.COMPLETED,
    bonusAmount: "25.00",
    reservationId: RESERVATION_ID,
  });
  await db.insert(referralCommissionsTable).values({
    id: REFERRAL_COMMISSION_ID,
    tenantId: TENANT_ID,
    referralId: REFERRAL_ID,
    referrerId: REFERRER_ID,
    recipientType: "ambassador",
    recipientId: REFERRER_ID,
    amount: "25.00",
    basis: "integration-test",
    status: "approved",
  });
  await db.insert(loyaltyTransactionsTable).values({
    id: REFERRAL_POINTS_ID,
    tenantId: TENANT_ID,
    memberId: MEMBER_ID,
    type: "referral",
    points: 40,
    description: "Pontos da indicação",
    referenceId: REFERRAL_ID,
    referenceType: "referral",
  });
}

async function assertReversedExactlyOnce() {
  const [referral] = await db.select({
    status: referralsTable.status,
  }).from(referralsTable).where(eq(referralsTable.id, REFERRAL_ID));
  const [referrer] = await db.select({
    successfulReferrals: clientsTable.successfulReferrals,
    referralEarnings: clientsTable.referralEarnings,
  }).from(clientsTable).where(eq(clientsTable.id, REFERRER_ID));
  const [commission] = await db.select({
    status: referralCommissionsTable.status,
    reversedAt: referralCommissionsTable.reversedAt,
  }).from(referralCommissionsTable).where(eq(referralCommissionsTable.id, REFERRAL_COMMISSION_ID));
  const [member] = await db.select({
    totalPoints: loyaltyMembersTable.totalPoints,
    availablePoints: loyaltyMembersTable.availablePoints,
  }).from(loyaltyMembersTable).where(eq(loyaltyMembersTable.id, MEMBER_ID));
  const reversalTransactions = await db.select({
    id: loyaltyTransactionsTable.id,
    points: loyaltyTransactionsTable.points,
  }).from(loyaltyTransactionsTable).where(and(
    eq(loyaltyTransactionsTable.memberId, MEMBER_ID),
    eq(loyaltyTransactionsTable.referenceId, REFERRAL_ID),
    eq(loyaltyTransactionsTable.referenceType, "referral_reversal"),
  ));

  expect(referral?.status).toBe(REFERRAL_STATUS.REVERSED);
  expect(referrer?.successfulReferrals).toBe(0);
  expect(Number(referrer?.referralEarnings)).toBe(0);
  expect(commission?.status).toBe("reversed");
  expect(commission?.reversedAt).toBeTruthy();
  expect(member).toEqual({ totalPoints: 0, availablePoints: 0 });
  expect(reversalTransactions).toEqual([{
    id: `${REFERRAL_ID}:reversal`,
    points: -40,
  }]);
}

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL must be set to run the referral payment reversal integration test");
  }

  mockRequireAuth.mockResolvedValue({
    id: USER_ID,
    tenantId: TENANT_ID,
    role: ROLES.AGENCY_ADMIN,
    name: "Referral reversal integration tester",
    email: `rrpi-${RUN}@example.com`,
  });

  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "Referral reversal integration agency",
    slug: `rrpi-${RUN}`,
    email: `rrpi-${RUN}@example.com`,
  });
  await db.insert(usersTable).values({
    id: USER_ID,
    clerkId: `rrpi-clerk-${RUN}`,
    tenantId: TENANT_ID,
    name: "Referral reversal integration tester",
    email: `rrpi-user-${RUN}@example.com`,
    role: ROLES.AGENCY_ADMIN,
    referralCode: `RRPI-USER-${RUN}`,
  });
  await db.insert(tripsTable).values({
    id: TRIP_ID,
    tenantId: TENANT_ID,
    name: "Referral reversal integration trip",
    slug: `rrpi-trip-${RUN}`,
    destination: "Fortaleza",
    destinationCity: "Fortaleza",
    destinationState: "CE",
    type: "excursao",
    category: "standard",
    departureDate: new Date("2027-08-01"),
    totalCapacity: 40,
    availableSeats: 39,
    priceAdult: "100.00",
    createdById: USER_ID,
  });
  await db.insert(clientsTable).values([
    {
      id: REFERRER_ID,
      tenantId: TENANT_ID,
      name: "Referrer",
      email: `rrpi-referrer-${RUN}@example.com`,
      whatsapp: "85999990001",
      createdById: USER_ID,
      successfulReferrals: 1,
      referralEarnings: "25.00",
    },
    {
      id: REFERRED_ID,
      tenantId: TENANT_ID,
      name: "Referred customer",
      email: `rrpi-referred-${RUN}@example.com`,
      whatsapp: "85999990002",
      createdById: USER_ID,
    },
  ]);
});

beforeEach(async () => {
  await resetFixture();
});

afterAll(async () => {
  await db.delete(loyaltyTransactionsTable).where(eq(loyaltyTransactionsTable.tenantId, TENANT_ID));
  await db.delete(loyaltyMembersTable).where(eq(loyaltyMembersTable.tenantId, TENANT_ID));
  await db.delete(loyaltyProgramsTable).where(eq(loyaltyProgramsTable.tenantId, TENANT_ID));
  await db.delete(referralCommissionsTable).where(eq(referralCommissionsTable.tenantId, TENANT_ID));
  await db.delete(paymentsTable).where(eq(paymentsTable.tenantId, TENANT_ID));
  await db.delete(referralsTable).where(eq(referralsTable.tenantId, TENANT_ID));
  await db.delete(reservationsTable).where(eq(reservationsTable.tenantId, TENANT_ID));
  await db.delete(clientsTable).where(eq(clientsTable.tenantId, TENANT_ID));
  await db.delete(tripsTable).where(eq(tripsTable.tenantId, TENANT_ID));
  await db.delete(usersTable).where(eq(usersTable.tenantId, TENANT_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

describe("reservation referral reversal under concurrent payment callbacks", () => {
  it("records only one referral, commission, and points reversal for two refunds", async () => {
    const app = buildApp();

    const responses = await Promise.all([
      request(app).patch(`/api/payments/${PAYMENT_ID}`).send({ status: PAYMENT_STATUS.REFUNDED }),
      request(app).patch(`/api/payments/${PAYMENT_ID}`).send({ status: PAYMENT_STATUS.REFUNDED }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    await assertReversedExactlyOnce();
  });

  it("keeps refund and deletion from applying the same reversal twice", async () => {
    const app = buildApp();

    const responses = await Promise.all([
      request(app).patch(`/api/payments/${PAYMENT_ID}`).send({ status: PAYMENT_STATUS.REFUNDED }),
      request(app).delete(`/api/payments/${PAYMENT_ID}`),
    ]);

    expect(responses.map((response) => response.status).every((status) => status === 200 || status === 404)).toBe(true);
    expect(responses.some((response) => response.status === 200)).toBe(true);

    const remainingPayments = await db.select({ id: paymentsTable.id })
      .from(paymentsTable)
      .where(eq(paymentsTable.id, PAYMENT_ID));
    expect(remainingPayments).toHaveLength(0);
    await assertReversedExactlyOnce();
  });
});