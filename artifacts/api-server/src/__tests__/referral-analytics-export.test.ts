import { ROLES } from "@workspace/permissions";
import { describe, expect, it, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import ExcelJS from "exceljs";

const { selectQueue, mockRequireAuth } = vi.hoisted(() => {
  const selectQueue: unknown[][] = [];
  const mockRequireAuth = vi.fn();

  function makeChain(rows: unknown[]) {
    const chain: Record<string, unknown> = {
      then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    for (const method of ["from", "where", "leftJoin", "groupBy", "orderBy", "limit"]) {
      chain[method] = vi.fn(() => chain);
    }
    return chain;
  }

  return { selectQueue, mockRequireAuth, makeChain };
});

vi.mock("@workspace/db", () => {
  const table = () => new Proxy({}, {
    get: (_target, property: string | symbol) => String(property),
  });
  const mockSelect = vi.fn(() => {
    const rows = selectQueue.shift() ?? [];
    const chain: Record<string, unknown> = {
      then: (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
        Promise.resolve(rows).then(resolve, reject),
    };
    for (const method of ["from", "where", "leftJoin", "groupBy", "orderBy", "limit"]) {
      chain[method] = vi.fn(() => chain);
    }
    return chain;
  });

  return {
    db: { select: mockSelect },
    clientsTable: table(),
    emailLogsTable: table(),
    referralCampaignsTable: table(),
    referralSettingsTable: table(),
    referralTrackingTable: table(),
    referralsTable: table(),
    reservationsTable: table(),
    tenantsTable: table(),
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  count: vi.fn(() => "count"),
  desc: vi.fn(() => "desc"),
  eq: vi.fn((column: unknown, value: unknown) => `${String(column)}=${String(value)}`),
  getTableColumns: vi.fn(() => ({})),
  ilike: vi.fn(() => "ilike"),
  inArray: vi.fn(() => "inArray"),
  isNotNull: vi.fn(() => "isNotNull"),
  isNull: vi.fn(() => "isNull"),
  or: vi.fn((...args: unknown[]) => args),
  sql: Object.assign(vi.fn(() => "sql"), { raw: vi.fn() }),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  ADMIN_ROLES: [ROLES.AGENCY_ADMIN, ROLES.SUPER_ADMIN],
  MANAGEMENT_ROLES: [ROLES.AGENCY_ADMIN, ROLES.SUPER_ADMIN],
  ALL_STAFF_ROLES: [ROLES.AGENCY_ADMIN, ROLES.SUPER_ADMIN, ROLES.AGENCY_MANAGER, ROLES.SALES, ROLES.SUPPORT],
}));

vi.mock("../queues/email-helpers.js", () => ({
  dispatchReferralBonusReleasedEmail: vi.fn(),
  dispatchReferralBonusPaidEmail: vi.fn(),
  dispatchReferralExpiringSoonEmail: vi.fn(),
  dispatchReferralReversedEmail: vi.fn(),
  dispatchReferralWelcomeEmail: vi.fn(),
  enqueueReferralBonusPaidEmail: vi.fn(),
}));

vi.mock("../queues/whatsapp-helpers.js", () => ({
  dispatchWhatsAppReferralBonusPaid: vi.fn(),
}));

vi.mock("../lib/whatsapp.js", () => ({
  interpolateWhatsAppMessage: vi.fn((template: string) => template),
  sendTenantWhatsAppMessage: vi.fn(),
}));

vi.mock("../lib/referral-tiers.js", () => ({
  DEFAULT_TIERS: [],
  computeReferralTier: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import referralsRouter from "../routes/referrals.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const ADMIN = {
  id: "admin-001",
  tenantId: "tenant-a",
  role: ROLES.AGENCY_ADMIN,
  name: "Admin",
  email: "admin@example.com",
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", referralsRouter);
  app.use(errorHandler);
  return app;
}

function commercialRow(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: "tenant-a",
    referrerId: "referrer-a",
    referrerName: "Ana",
    status: "completed",
    convertedAt: new Date("2026-08-10T12:00:00.000Z"),
    bonusAmount: "10.00",
    bonusPaid: true,
    bonusPaidAt: new Date("2026-08-11T12:00:00.000Z"),
    bonusCreditUsedAmount: null,
    discountAmount: "5.00",
    reservationStatus: "confirmed",
    reservationPaidValue: "100.00",
    ...overrides,
  };
}

beforeEach(() => {
  selectQueue.length = 0;
  mockRequireAuth.mockReset();
  mockRequireAuth.mockResolvedValue(ADMIN);
});

describe("GET /api/referrals/analytics/export", () => {
  it("keeps the XLSX commercial result aligned with valid linked conversions", async () => {
    selectQueue.push(
      [
        { month: "2026-08", created: 4, converted: 2, bonusPaid: 1, bonusTotal: "10.00" },
      ],
      [
        { source: "whatsapp", visitors: 4, converted: 2 },
      ],
      [
        commercialRow(),
        commercialRow({
          referrerId: "referrer-b",
          referrerName: "Bruno",
          convertedAt: new Date("2026-08-20T12:00:00.000Z"),
          bonusAmount: "20.00",
          bonusPaid: false,
          bonusPaidAt: null,
          bonusCreditUsedAmount: "5.00",
          discountAmount: "10.00",
          reservationPaidValue: "300.00",
        }),
        commercialRow({
          referrerId: "referrer-c",
          referrerName: "Carla",
          status: "reversed",
          reservationPaidValue: "500.00",
          bonusAmount: "40.00",
          discountAmount: "20.00",
        }),
        commercialRow({
          referrerId: "referrer-d",
          referrerName: "Depois do período",
          convertedAt: new Date("2026-09-01T12:00:00.000Z"),
          reservationPaidValue: "900.00",
        }),
        commercialRow({
          referrerId: "referrer-e",
          referrerName: "Reserva cancelada",
          reservationStatus: "cancelled",
          reservationPaidValue: "700.00",
        }),
      ],
    );

    const response = await request(buildApp())
      .get("/api/referrals/analytics/export")
      .query({ startDate: "2026-08-01T00:00:00.000Z", endDate: "2026-08-31T23:59:59.000Z" })
      .expect(200);

    expect(response.headers["content-type"]).toContain("spreadsheetml");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(response.body));

    const resultSheet = workbook.getWorksheet("Resultado Comercial");
    expect(resultSheet).toBeDefined();
    expect(resultSheet?.getCell("B2").value).toBe(2);
    expect(resultSheet?.getCell("B3").value).toBe("400.00");
    expect(resultSheet?.getCell("B4").value).toBe("10.00");
    expect(resultSheet?.getCell("B5").value).toBe("15.00");
    expect(resultSheet?.getCell("B6").value).toBe("15.00");
    expect(resultSheet?.getCell("B7").value).toBe("25.00");
    expect(resultSheet?.getCell("B8").value).toBe("12.50");
    expect(resultSheet?.getCell("B9").value).toBe("1500.00");
    expect(resultSheet?.getCell("B10").value).toBe("16.00");

    const rankingSheet = workbook.getWorksheet("Ranking Comercial");
    expect(rankingSheet?.getRow(2).getCell(2).value).toBe("Bruno");
    expect(rankingSheet?.getRow(2).getCell(4).value).toBe("300.00");
    expect(rankingSheet?.getRow(2).getCell(5).value).toBe("0.00");
    expect(rankingSheet?.getRow(2).getCell(6).value).toBe("0.00");
    expect(rankingSheet?.getRow(3).getCell(2).value).toBe("Ana");
    expect(rankingSheet?.rowCount).toBe(3);
  });

  it("exports safe zero values when the selected period has no valid conversions", async () => {
    selectQueue.push([], [], []);

    const response = await request(buildApp())
      .get("/api/referrals/analytics/export")
      .query({ startDate: "2026-08-01T00:00:00.000Z", endDate: "2026-08-31T23:59:59.000Z" })
      .expect(200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(response.body));
    const resultSheet = workbook.getWorksheet("Resultado Comercial");
    expect(resultSheet?.getCell("B2").value).toBe(0);
    expect(resultSheet?.getCell("B7").value).toBe("0.00");
    expect(resultSheet?.getCell("B10").value).toBe("—");
    expect(workbook.getWorksheet("Ranking Comercial")?.rowCount).toBe(1);
  });
});