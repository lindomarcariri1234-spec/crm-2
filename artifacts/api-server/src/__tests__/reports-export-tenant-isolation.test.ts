import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { tenantA, tables, fixtures, queryConditions, mockRequireAuth } = vi.hoisted(() => {
  const tenantA = "tenant-a";
  const tableNames = [
    "paymentsTable", "expensesTable", "pmsPaymentAdjustmentsTable",
    "pmsReservationsTable", "usersTable", "reservationsTable", "clientsTable",
    "tripsTable", "passengersTable",
  ];
  const tables: Record<string, Record<string, string>> = {};
  for (const name of tableNames) {
    tables[name] = new Proxy({}, {
      get: (_target, property: string | symbol) =>
        typeof property === "string" ? `${name}.${property}` : undefined,
    }) as Record<string, string>;
  }

  const fixtures = new Map<unknown, Record<string, unknown>[]>();
  const queryConditions: Array<{ table: unknown; condition: unknown }> = [];
  const mockRequireAuth = vi.fn();
  return { tenantA, tables, fixtures, queryConditions, mockRequireAuth };
});

function matches(row: Record<string, unknown>, condition: unknown): boolean {
  if (!condition || typeof condition !== "object") return true;
  const item = condition as { kind?: string; column?: string; value?: unknown; conditions?: unknown[] };
  if (item.kind === "and") return (item.conditions ?? []).every((part) => matches(row, part));
  const key = item.column?.split(".").at(-1) ?? "";
  if (item.kind === "eq") return row[key] === item.value;
  const left = row[key] instanceof Date ? (row[key] as Date).getTime() : String(row[key]);
  const right = item.value instanceof Date ? item.value.getTime() : String(item.value);
  if (item.kind === "gte") return left >= right;
  if (item.kind === "lte") return left <= right;
  return true;
}

vi.mock("@workspace/db", () => {
  const db = {
    select: vi.fn(() => {
      let table: unknown;
      let condition: unknown;
      const chain: Record<string, (...args: unknown[]) => unknown> = {
        from: (value: unknown) => { table = value; return chain; },
        where: (value: unknown) => {
          condition = value;
          queryConditions.push({ table, condition });
          return chain;
        },
        innerJoin: () => chain,
        leftJoin: () => chain,
        limit: () => Promise.resolve((fixtures.get(table) ?? []).filter((row) => matches(row, condition))),
      };
      return chain;
    }),
  };
  return { db, ...tables };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ kind: "eq", column, value }),
  gte: (column: unknown, value: unknown) => ({ kind: "gte", column, value }),
  lte: (column: unknown, value: unknown) => ({ kind: "lte", column, value }),
  ilike: (column: unknown, value: unknown) => ({ kind: "ilike", column, value }),
  inArray: (column: unknown, values: unknown[]) => ({ kind: "inArray", column, values }),
}));

vi.mock("../lib/tenant.js", () => ({ requireAuth: mockRequireAuth }));
vi.mock("@workspace/permissions", () => ({
  ACTIONS: { VIEW: "view" },
  RESOURCES: { REPORTS: "reports" },
  PAYMENT_TYPE: { RECEIVABLE: "receivable", PAYABLE: "payable" },
  PAYMENT_STATUS: { PAID: "paid", PENDING: "pending" },
  EXPENSE_STATUS: { PAID: "paid", PENDING: "pending" },
  RESERVATION_STATUS: { CONFIRMED: "confirmed", CANCELLED: "cancelled" },
  ACTIVE_RESERVATION_STATUSES: ["pending", "confirmed"],
  hasPermission: vi.fn(() => true),
}));
vi.mock("@workspace/shared", () => ({
  formatBRLPlain: (value: number) => String(value),
  localToday: () => "2026-10-15",
}));

import reportsRouter from "../routes/reports.js";
import { errorHandler } from "../middlewares/errorHandler.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(reportsRouter);
  app.use(errorHandler);
  return app;
}

describe("POST /reports/export tenant isolation", () => {
  beforeEach(() => {
    queryConditions.length = 0;
    fixtures.clear();
    mockRequireAuth.mockResolvedValue({
      id: "user-a", tenantId: tenantA, role: "agencia",
    });
    fixtures.set(tables.paymentsTable, [
      {
        id: "payment-a", tenantId: tenantA, type: "receivable", category: "ticket",
        description: "TENANT_A_REPORT_ROW", amount: "120", status: "paid",
        paymentMethod: "pix", dueDate: new Date("2026-10-02T12:00:00Z"),
        paidAt: new Date("2026-10-02T12:00:00Z"), createdAt: new Date("2026-10-02T12:00:00Z"),
        isTestMode: false,
      },
      {
        id: "payment-b", tenantId: "tenant-b", type: "receivable", category: "ticket",
        description: "TENANT_B_PRIVATE_ROW", amount: "999", status: "paid",
        paymentMethod: "pix", dueDate: new Date("2026-10-02T12:00:00Z"),
        paidAt: new Date("2026-10-02T12:00:00Z"), createdAt: new Date("2026-10-02T12:00:00Z"),
        isTestMode: false,
      },
    ]);
    fixtures.set(tables.expensesTable, []);
    fixtures.set(tables.pmsPaymentAdjustmentsTable, []);
  });

  it("exports only caller-tenant rows when another tenant has matching financial data", async () => {
    const response = await request(buildApp())
      .post("/reports/export")
      .send({ reportType: "financial", format: "csv", startDate: "2026-10-01", endDate: "2026-10-15" });

    expect(response.status).toBe(200);
    expect(response.text).toContain("TENANT_A_REPORT_ROW");
    expect(response.text).not.toContain("TENANT_B_PRIVATE_ROW");
    expect(queryConditions).toHaveLength(3);
    for (const { condition } of queryConditions) {
      expect(JSON.stringify(condition)).toContain(tenantA);
      expect(JSON.stringify(condition)).not.toContain("tenant-b");
    }
  });
});
