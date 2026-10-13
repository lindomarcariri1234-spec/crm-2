import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  db,
  clientsTable,
  paymentsTable,
  reservationsTable,
  spreadsheetImportBatchesTable,
  spreadsheetImportRecordsTable,
  tenantsTable,
  tripsTable,
  usersTable,
} from "@workspace/db";
import { ROLES } from "@workspace/permissions";

const { mockRequireAuth } = vi.hoisted(() => ({
  mockRequireAuth: vi.fn(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  getTenantUser: vi.fn(),
  ADMIN_ROLES: [ROLES.AGENCY_ADMIN],
}));
vi.mock("../lib/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

import spreadsheetImportsRouter from "../routes/spreadsheet-imports.js";
import { errorHandler } from "../middlewares/errorHandler.js";

const RUN = randomUUID().replaceAll("-", "").slice(0, 10);
const TENANT_ID = `sipl-tenant-${RUN}`;
const USER_ID = `sipl-user-${RUN}`;
const TRIP_ID = `sipl-trip-${RUN}`;
const RESERVATION_A = `sipl-res-${RUN}-a`;
const RESERVATION_B = `sipl-res-${RUN}-b`;

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
  app.use("/api", spreadsheetImportsRouter);
  app.use(errorHandler);
  return app;
}

function paymentImport(
  idempotencyKey: string,
  rows: Array<[string, string]>,
) {
  const csv = [
    "id_externo,reserva_id_externo,tipo,categoria,valor,status,forma_pagamento,vencimento",
    ...rows.map(([paymentKey, reservationKey]) =>
      `${paymentKey},${reservationKey},receivable,reserva,"10,00",pending,pix,15/12/2026`,
    ),
  ].join("\n");
  return {
    entity: "payments",
    filename: `${idempotencyKey}.csv`,
    idempotencyKey,
    contentBase64: Buffer.from(csv).toString("base64"),
  };
}

beforeAll(async () => {
  if (!process.env["DATABASE_URL"]) {
    throw new Error("DATABASE_URL must be set to run spreadsheet import payment lock integration tests");
  }

  mockRequireAuth.mockResolvedValue({
    id: USER_ID,
    tenantId: TENANT_ID,
    role: ROLES.AGENCY_ADMIN,
    name: "Spreadsheet payment lock tester",
    email: `sipl-${RUN}@example.com`,
  });

  await db.insert(tenantsTable).values({
    id: TENANT_ID,
    name: "Spreadsheet payment lock integration tenant",
    slug: `sipl-${RUN}`,
    email: `sipl-tenant-${RUN}@example.com`,
  });
  await db.insert(usersTable).values({
    id: USER_ID,
    clerkId: `sipl-clerk-${RUN}`,
    tenantId: TENANT_ID,
    name: "Spreadsheet payment lock tester",
    email: `sipl-user-${RUN}@example.com`,
    role: ROLES.AGENCY_ADMIN,
    referralCode: `SIPL-${RUN}`,
  });
  await db.insert(tripsTable).values({
    id: TRIP_ID,
    tenantId: TENANT_ID,
    name: "Spreadsheet payment lock trip",
    slug: `sipl-trip-${RUN}`,
    destination: "Fortaleza",
    destinationCity: "Fortaleza",
    destinationState: "CE",
    type: "excursao",
    category: "standard",
    departureDate: new Date("2027-01-10"),
    totalCapacity: 10,
    availableSeats: 10,
    reservedSeats: 0,
    priceAdult: "100.00",
    createdById: USER_ID,
  });
  await db.insert(reservationsTable).values([
    {
      id: RESERVATION_A,
      tenantId: TENANT_ID,
      tripId: TRIP_ID,
      createdById: USER_ID,
      totalValue: "100.00",
      balance: "100.00",
      voucherCode: `SIPL-VOUCHER-A-${RUN}`,
      qrCode: `sipl-qr-a-${RUN}`,
      status: "pending",
    },
    {
      id: RESERVATION_B,
      tenantId: TENANT_ID,
      tripId: TRIP_ID,
      createdById: USER_ID,
      totalValue: "100.00",
      balance: "100.00",
      voucherCode: `SIPL-VOUCHER-B-${RUN}`,
      qrCode: `sipl-qr-b-${RUN}`,
      status: "pending",
    },
  ]);
  await db.insert(spreadsheetImportRecordsTable).values([
    {
      id: `sipl-record-a-${RUN}`,
      tenantId: TENANT_ID,
      entity: "reservations",
      sourceKey: "RES-A",
      targetId: RESERVATION_A,
      lastBatchId: `sipl-fixture-${RUN}`,
      lastLine: 2,
    },
    {
      id: `sipl-record-b-${RUN}`,
      tenantId: TENANT_ID,
      entity: "reservations",
      sourceKey: "RES-B",
      targetId: RESERVATION_B,
      lastBatchId: `sipl-fixture-${RUN}`,
      lastLine: 3,
    },
  ]);
});

afterAll(async () => {
  await db.delete(paymentsTable).where(eq(paymentsTable.tenantId, TENANT_ID));
  await db.delete(spreadsheetImportRecordsTable).where(eq(spreadsheetImportRecordsTable.tenantId, TENANT_ID));
  await db.delete(spreadsheetImportBatchesTable).where(eq(spreadsheetImportBatchesTable.tenantId, TENANT_ID));
  await db.delete(reservationsTable).where(eq(reservationsTable.tenantId, TENANT_ID));
  await db.delete(tripsTable).where(eq(tripsTable.id, TRIP_ID));
  await db.delete(clientsTable).where(eq(clientsTable.tenantId, TENANT_ID));
  await db.delete(usersTable).where(eq(usersTable.id, USER_ID));
  await db.delete(tenantsTable).where(eq(tenantsTable.id, TENANT_ID));
});

describe("financial spreadsheet imports reservation lock order", () => {
  it("completes concurrent imports that list the same reservations in opposite orders", async () => {
    const app = buildApp();
    const [forward, reverse] = await Promise.all([
      request(app).post("/api/spreadsheet-imports/import").send(paymentImport(
        `sipl-forward-${RUN}`,
        [["PAY-A1", "RES-A"], ["PAY-B1", "RES-B"]],
      )),
      request(app).post("/api/spreadsheet-imports/import").send(paymentImport(
        `sipl-reverse-${RUN}`,
        [["PAY-B2", "RES-B"], ["PAY-A2", "RES-A"]],
      )),
    ]);

    expect(forward.status).toBe(200);
    expect(reverse.status).toBe(200);
    expect(forward.body.report.results.map((row: { action: string }) => row.action)).toEqual(["created", "created"]);
    expect(reverse.body.report.results.map((row: { action: string }) => row.action)).toEqual(["created", "created"]);

    const imported = await db.select({ id: paymentsTable.id }).from(paymentsTable)
      .where(and(
        eq(paymentsTable.tenantId, TENANT_ID),
        eq(paymentsTable.category, "reserva"),
      ));
    expect(imported).toHaveLength(4);
  });
});
