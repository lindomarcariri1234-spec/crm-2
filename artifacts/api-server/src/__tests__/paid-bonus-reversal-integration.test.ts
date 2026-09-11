/**
 * Real PostgreSQL concurrency coverage for paid referral bonus reversals.
 *
 * Two route requests use separate transactions and the same referral. The
 * referral row lock plus the unique reversal key must allow only one request
 * to apply the financial side effects and dispatch the notification.
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
  referralBonusReversalsTable,
  referralCommissionsTable,
  referralsTable,
  tenantsTable,
  usersTable,
} from "@workspace/db";
import { REFERRAL_STATUS, ROLES } from "@workspace/permissions";

const { mockRequireAuth, dispatchReferralReversedEmail } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
  dispatchReferralReversedEmail: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../queues/email-helpers.js", () => ({
  enqueueReferralBonusPaidEmail: vi.fn().mockResolvedValue(undefined),
  dispatchReferralExpiringSoonEmail: vi.fn().mockResolvedValue(undefined),
  dispatchReferralBonusReleasedEmail: vi.fn().mockResolvedValue(undefined),
  dispatchReferralReversedEmail,
}));

import referralsRouter from "../routes/referrals.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const RUN = randomUUID().replaceAll("-", "").slice(0, 10);
const TENANT_ID = `pbr-tenant-${RUN}`;
const OTHER_TENANT_ID = `pbr-other-tenant-${RUN}`;
const USER_ID = `pbr-user-${RUN}`;
const OTHER_USER_ID = `pbr-other-user-${RUN}`;
const REFERRER_ID = `pbr-referrer-${RUN}`;
const REFERRED_ID = `pbr-referred-${RUN}`;
const OTHER_REFERRER_ID = `pbr-other-referrer-${RUN}`;
const OTHER_REFERRED_ID = `pbr-other-referred-${RUN}`;
const PROGRAM_ID = `pbr-program-${RUN}`;
const OTHER_PROGRAM_ID = `pbr-other-program-${RUN}`;
const MEMBER_ID = `pbr-member-${RUN}`;
const OTHER_MEMBER_ID = `pbr-other-member-${RUN}`;
const REFERRAL_ID = `pbr-referral-${RUN}`;
const OTHER_REFERRAL_ID = `pbr-other-referral-${RUN}`;
const COMMISSION_ID = `pbr-commission-${RUN}`;
const OTHER_COMMISSION_ID = `pbr-other-commission-${RUN}`;
const POINTS_ID = `pbr-points-${RUN}`;
const OTHER_POINTS_ID = `pbr-other-points-${RUN}`;

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
  app.use("/api", referralsRouter);
  app.use(errorHandler);
  return app;
}

async function deleteFixtureRows() {
  await db.delete(referralBonusReversalsTable).where(eq(referralBonusReversalsTable.tenantId, TENANT_ID));
  await db.delete(referralBonusReversalsTable).where(eq(referralBonusReversalsTable.tenantId, OTHER_TENANT_ID));
  await db.delete(loyaltyTransactionsTable).where(eq(loyaltyTransactionsTable.tenantId, TENANT_ID));
  await db.delete(loyaltyTransactionsTable).where(eq(loyaltyTransactionsTable.tenantId, OTHER_TENANT_ID));
  await db.delete(loyaltyMembersTable).where(eq(loyaltyMembersTable.tenantId, TENANT_ID));
  await db.delete(loyaltyMembersTable).where(eq(loyaltyMembersTable.tenantId, OTHER_TENANT_ID));
  await db.delete(loyaltyProgramsTable).where(eq(loyaltyProgramsTable.tenantId, TENANT_ID));
  await db.delete(loyaltyProgramsTable).where(eq(loyaltyProgramsTable.tenantId, OTHER_TENANT_ID));
  await db.delete(referralCommissionsTable).where(eq(referralCommissionsTable.tenantId, TENANT_ID));
  await db.delete(referralCommissionsTable).where(eq(referralCommissionsTable.tenantId, OTHER_TENANT_ID));
  await db.delete(referralsTable).where(eq(referralsTable.tenantId, TENANT_ID));
  await db.delete(referralsTable).where(eq(referralsTable.tenantId, OTHER_TENANT_ID));
}

async function seedReferralFixture() {
  await db.insert(loyaltyProgramsTable).values([
    {
      id: PROGRAM_ID,
      tenantId: TENANT_ID,
      name: "Paid bonus reversal integration program",
    },
    {
      id: OTHER_PROGRAM_ID,
      tenantId: OTHER_TENANT_ID,
      name: "Other agency reversal integration program",
    },
  ]);
  await db.insert(loyaltyMembersTable).values([
    {
      id: MEMBER_ID,
      tenantId: TENANT_ID,
      programId: PROGRAM_ID,
      clientId: REFERRER_ID,
      totalPoints: 140,
      availablePoints: 100,
      tier: "silver",
    },
    {
      id: OTHER_MEMBER_ID,
      tenantId: OTHER_TENANT_ID,
      programId: OTHER_PROGRAM_ID,
      clientId: OTHER_REFERRER_ID,
      totalPoints: 90,
      availablePoints: 70,
      tier: "bronze",
    },
  ]);
  await db.insert(referralsTable).values([
    {
      id: REFERRAL_ID,
      tenantId: TENANT_ID,
      referrerId: REFERRER_ID,
      referredId: REFERRED_ID,
      code: `PBR-CODE-${RUN}`,
      status: REFERRAL_STATUS.COMPLETED,
      bonusPaid: true,
      bonusPaidAt: new Date("2026-01-10T12:00:00.000Z"),
      bonusAmount: "25.00",
      convertedAt: new Date("2026-01-01T12:00:00.000Z"),
    },
    {
      id: OTHER_REFERRAL_ID,
      tenantId: OTHER_TENANT_ID,
      referrerId: OTHER_REFERRER_ID,
      referredId: OTHER_REFERRED_ID,
      code: `PBR-OTHER-CODE-${RUN}`,
      status: REFERRAL_STATUS.COMPLETED,
      bonusPaid: true,
      bonusPaidAt: new Date("2026-01-10T12:00:00.000Z"),
      bonusAmount: "25.00",
      convertedAt: new Date("2026-01-01T12:00:00.000Z"),
    },
  ]);
  await db.insert(referralCommissionsTable).values([
    {
      id: COMMISSION_ID,
      tenantId: TENANT_ID,
      referralId: REFERRAL_ID,
      referrerId: REFERRER_ID,
      recipientType: "ambassador",
      recipientId: REFERRER_ID,
      amount: "25.00",
      basis: "paid-bonus-reversal-integration",
      status: "paid",
    },
    {
      id: OTHER_COMMISSION_ID,
      tenantId: OTHER_TENANT_ID,
      referralId: OTHER_REFERRAL_ID,
      referrerId: OTHER_REFERRER_ID,
      recipientType: "ambassador",
      recipientId: OTHER_REFERRER_ID,
      amount: "25.00",
      basis: "paid-bonus-reversal-integration",
      status: "paid",
    },
  ]);
  await db.insert(loyaltyTransactionsTable).values([
    {
      id: POINTS_ID,
      tenantId: TENANT_ID,
      memberId: MEMBER_ID,
      type: "referral",
      points: 40,
      description: "Pontos da indicação",
      referenceId: REFERRAL_ID,
      referenceType: "referral",
    },
    {
      id: OTHER_POINTS_ID,
      tenantId: OTHER_TENANT_ID,
      memberId: OTHER_MEMBER_ID,
      type: "referral",
      points: 20,
      description: "Pontos da outra indicação",
      referenceId: OTHER_REFERRAL_ID,
      referenceType: "referral",
    },
  ]);
}

async function assertPrimaryReferralReversedOnce() {
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
  }).from(referralCommissionsTable).where(eq(referralCommissionsTable.id, COMMISSION_ID));
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
  const reversalAudits = await db.select({
    id: referralBonusReversalsTable.id,
    amount: referralBonusReversalsTable.amount,
  }).from(referralBonusReversalsTable).where(and(
    eq(referralBonusReversalsTable.tenantId, TENANT_ID),
    eq(referralBonusReversalsTable.referralId, REFERRAL_ID),
  ));

  expect(referral?.status).toBe(REFERRAL_STATUS.REVERSED);
  expect(referrer).toEqual({ successfulReferrals: 0, referralEarnings: "0.00" });
  expect(commission?.status).toBe("reversed");
  expect(commission?.reversedAt).toBeTruthy();
  expect(member).toEqual({ totalPoints: 100, availablePoints: 60 });
  expect(reversalTransactions).toEqual([{
    id: `${REFERRAL_ID}:reversal`,
    points: -40,
  }]);
  expect(reversalAudits).toHaveLength(1);
  expect(reversalAudits[0]?.amount).toBe("25.00");
}

async function assertOtherAgencyIsUnchanged() {
  const [referral] = await db.select({
    status: referralsTable.status,
    bonusPaid: referralsTable.bonusPaid,
  }).from(referralsTable).where(eq(referralsTable.id, OTHER_REFERRAL_ID));
  const [referrer] = await db.select({
    successfulReferrals: clientsTable.successfulReferrals,
    referralEarnings: clientsTable.referralEarnings,
  }).from(clientsTable).where(eq(clientsTable.id, OTHER_REFERRER_ID));
  const [commission] = await db.select({
    status: referralCommissionsTable.status,
  }).from(referralCommissionsTable).where(eq(referralCommissionsTable.id, OTHER_COMMISSION_ID));
  const [member] = await db.select({
    totalPoints: loyaltyMembersTable.totalPoints,
    availablePoints: loyaltyMembersTable.availablePoints,
  }).from(loyaltyMembersTable).where(eq(loyaltyMembersTable.id, OTHER_MEMBER_ID));
  const reversalAudits = await db.select({
    id: referralBonusReversalsTable.id,
  }).from(referralBonusReversalsTable).where(and(
    eq(referralBonusReversalsTable.tenantId, OTHER_TENANT_ID),
    eq(referralBonusReversalsTable.referralId, OTHER_REFERRAL_ID),
  ));

  expect(referral).toEqual({ status: REFERRAL_STATUS.COMPLETED, bonusPaid: true });
  expect(referrer).toEqual({ successfulReferrals: 1, referralEarnings: "25.00" });
  expect(commission?.status).toBe("paid");
  expect(member).toEqual({ totalPoints: 90, availablePoints: 70 });
  expect(reversalAudits).toHaveLength(0);
}

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL must be set to run the paid bonus reversal integration test");
  }

  await db.insert(tenantsTable).values([
    {
      id: TENANT_ID,
      name: "Paid bonus reversal integration agency",
      slug: `pbr-${RUN}`,
      email: `pbr-${RUN}@example.com`,
    },
    {
      id: OTHER_TENANT_ID,
      name: "Other paid bonus reversal agency",
      slug: `pbr-other-${RUN}`,
      email: `pbr-other-${RUN}@example.com`,
    },
  ]);
  await db.insert(usersTable).values([
    {
      id: USER_ID,
      clerkId: `pbr-clerk-${RUN}`,
      tenantId: TENANT_ID,
      name: "Paid bonus reversal tester",
      email: `pbr-user-${RUN}@example.com`,
      role: ROLES.AGENCY_ADMIN,
      referralCode: `PBR-USER-${RUN}`,
    },
    {
      id: OTHER_USER_ID,
      clerkId: `pbr-other-clerk-${RUN}`,
      tenantId: OTHER_TENANT_ID,
      name: "Other paid bonus reversal tester",
      email: `pbr-other-user-${RUN}@example.com`,
      role: ROLES.AGENCY_ADMIN,
      referralCode: `PBR-OTHER-USER-${RUN}`,
    },
  ]);
  await db.insert(clientsTable).values([
    {
      id: REFERRER_ID,
      tenantId: TENANT_ID,
      name: "Primary referrer",
      email: `pbr-referrer-${RUN}@example.com`,
      whatsapp: `8599${RUN.slice(0, 7)}`,
      createdById: USER_ID,
      successfulReferrals: 1,
      referralEarnings: "25.00",
    },
    {
      id: REFERRED_ID,
      tenantId: TENANT_ID,
      name: "Primary referred",
      email: `pbr-referred-${RUN}@example.com`,
      whatsapp: `8598${RUN.slice(0, 7)}`,
      createdById: USER_ID,
    },
    {
      id: OTHER_REFERRER_ID,
      tenantId: OTHER_TENANT_ID,
      name: "Other referrer",
      email: `pbr-other-referrer-${RUN}@example.com`,
      whatsapp: `8597${RUN.slice(0, 7)}`,
      createdById: OTHER_USER_ID,
      successfulReferrals: 1,
      referralEarnings: "25.00",
    },
    {
      id: OTHER_REFERRED_ID,
      tenantId: OTHER_TENANT_ID,
      name: "Other referred",
      email: `pbr-other-referred-${RUN}@example.com`,
      whatsapp: `8596${RUN.slice(0, 7)}`,
      createdById: OTHER_USER_ID,
    },
  ]);
});

beforeEach(async () => {
  await deleteFixtureRows();
  await db.update(clientsTable).set({
    successfulReferrals: 1,
    referralEarnings: "25.00",
  }).where(and(
    eq(clientsTable.id, REFERRER_ID),
    eq(clientsTable.tenantId, TENANT_ID),
  ));
  await db.update(clientsTable).set({
    successfulReferrals: 1,
    referralEarnings: "25.00",
  }).where(and(
    eq(clientsTable.id, OTHER_REFERRER_ID),
    eq(clientsTable.tenantId, OTHER_TENANT_ID),
  ));
  await seedReferralFixture();
  mockRequireAuth.mockResolvedValue({
    id: USER_ID,
    tenantId: TENANT_ID,
    role: ROLES.AGENCY_ADMIN,
    name: "Paid bonus reversal tester",
    email: `pbr-user-${RUN}@example.com`,
  });
  dispatchReferralReversedEmail.mockClear();
});

afterAll(async () => {
  await deleteFixtureRows();
  await db.delete(clientsTable).where(eq(clientsTable.tenantId, TENANT_ID));
  await db.delete(clientsTable).where(eq(clientsTable.tenantId, OTHER_TENANT_ID));
  await db.delete(usersTable).where(eq(usersTable.tenantId, TENANT_ID));
  await db.delete(usersTable).where(eq(usersTable.tenantId, OTHER_TENANT_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, OTHER_TENANT_ID));
});

describe("paid referral bonus reversal under concurrent requests — real PostgreSQL", () => {
  it("applies balance, commission, points, audit and notification exactly once", async () => {
    const app = buildApp();
    const responses = await Promise.all([
      request(app)
        .post(`/api/referrals/${REFERRAL_ID}/reverse-paid-bonus`)
        .send({ reason: "Correção financeira concorrente", confirmed: true }),
      request(app)
        .post(`/api/referrals/${REFERRAL_ID}/reverse-paid-bonus`)
        .send({ reason: "Correção financeira concorrente", confirmed: true }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(responses.map((response) => response.body.reversal.alreadyApplied).sort()).toEqual([false, true]);
    expect(dispatchReferralReversedEmail).toHaveBeenCalledTimes(1);
    await assertPrimaryReferralReversedOnce();
  });

  it("does not allow one agency to reverse another agency's referral", async () => {
    const app = buildApp();

    const response = await request(app)
      .post(`/api/referrals/${OTHER_REFERRAL_ID}/reverse-paid-bonus`)
      .send({ reason: "Tentativa cross-tenant", confirmed: true });

    expect(response.status).toBe(404);
    expect(dispatchReferralReversedEmail).not.toHaveBeenCalled();
    await assertOtherAgencyIsUnchanged();
  });
});