import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  paymentsTable: {
    id: "payments.id",
    tenantId: "payments.tenant_id",
    orderId: "payments.order_id",
    gateway: "payments.gateway",
    transactionId: "payments.transaction_id",
    type: "payments.type",
    status: "payments.status",
    amount: "payments.amount",
    category: "payments.category",
    reservationId: "payments.reservation_id",
    clientId: "payments.client_id",
    paymentMethod: "payments.payment_method",
    installmentNumber: "payments.installment_number",
    totalInstallments: "payments.total_installments",
    dueDate: "payments.due_date",
    isTestMode: "payments.is_test_mode",
  },
  reservationsTable: {
    id: "reservations.id",
    tenantId: "reservations.tenant_id",
    clientId: "reservations.client_id",
    totalValue: "reservations.total_value",
  },
}));

vi.mock("@workspace/db", () => ({
  db: {},
  paymentsTable: h.paymentsTable,
  reservationsTable: h.reservationsTable,
  tripsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  asc: (column: unknown) => ({ direction: "asc", column }),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  inArray: (column: unknown, value: unknown) => ({ column, value }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock("../services/client-classification.js", () => ({
  recomputeClientClassification: vi.fn(),
}));

import {
  allocateCumulativeRefundCents,
  applyCumulativeStripeRefundToPayments,
  recalculateReservationPaymentAmountsPreservingStatus,
} from "./reservation-payments.js";

function createExecutor() {
  const receipts = [
    {
      id: "receipt-order",
      tenantId: "tenant-1",
      reservationId: null,
      clientId: "client-1",
      amount: "10.00",
      paymentMethod: "stripe",
      installmentNumber: 1,
      totalInstallments: 1,
      dueDate: new Date("2026-01-01T00:00:00Z"),
      isTestMode: false,
    },
    {
      id: "receipt-r1",
      tenantId: "tenant-1",
      reservationId: "reservation-1",
      clientId: "client-1",
      amount: "30.00",
      paymentMethod: "stripe",
      installmentNumber: 1,
      totalInstallments: 1,
      dueDate: new Date("2026-01-01T00:00:00Z"),
      isTestMode: false,
    },
    {
      id: "receipt-r2",
      tenantId: "tenant-1",
      reservationId: "reservation-2",
      clientId: "client-1",
      amount: "60.00",
      paymentMethod: "stripe",
      installmentNumber: 1,
      totalInstallments: 1,
      dueDate: new Date("2026-01-01T00:00:00Z"),
      isTestMode: false,
    },
  ];
  const refundRows: Array<Record<string, unknown>> = [];
  const insert = vi.fn(() => ({
    values: vi.fn(async (row: Record<string, unknown>) => {
      refundRows.push(row);
      return [];
    }),
  }));
  const update = vi.fn(() => {
    let values: Record<string, unknown> = {};
    return {
      set: (next: Record<string, unknown>) => {
        values = next;
        return {
          where: async (condition: unknown) => {
            const conditions = Array.isArray(condition) ? condition : [];
            const idCondition = conditions.find((item) =>
              (item as { column?: string }).column === h.paymentsTable.id,
            ) as { value?: string } | undefined;
            const row = refundRows.find((candidate) => candidate["id"] === idCondition?.value);
            if (row) Object.assign(row, values);
          },
        };
      },
    };
  });
  let selectCount = 0;
  const select = vi.fn(() => {
    const resultRows = selectCount++ % 2 === 0 ? receipts : refundRows;
    const chain: Record<string, unknown> = {};
    chain["from"] = () => chain;
    chain["leftJoin"] = () => chain;
    chain["where"] = () => chain;
    chain["orderBy"] = () => chain;
    chain["then"] = (resolve: (value: unknown[]) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(resultRows).then(resolve, reject);
    return chain;
  });
  return { executor: { select, insert, update }, receipts, refundRows, insert, update };
}

describe("Stripe partial-refund reservation allocation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allocates cumulative refund cents proportionally across order and reservation receipts", () => {
    const allocations = allocateCumulativeRefundCents([
      { id: "receipt-r2", reservationId: "reservation-2", amount: "60.00" },
      { id: "receipt-order", reservationId: null, amount: "10.00" },
      { id: "receipt-r1", reservationId: "reservation-1", amount: "30.00" },
    ], 5);

    expect(allocations).toEqual([
      { paymentId: "receipt-order", refundCents: 1 },
      { paymentId: "receipt-r1", refundCents: 1 },
      { paymentId: "receipt-r2", refundCents: 3 },
    ]);
    expect(allocations.reduce((sum, row) => sum + row.refundCents, 0)).toBe(5);
  });

  it("replays a cumulative refund without adding duplicate receipt adjustments or lowering reservation balances twice", async () => {
    const state = createExecutor();
    const args = {
      tenantId: "tenant-1",
      orderId: "order-1",
      paymentIntentId: "pi-test",
      amountRefundedCents: 5,
      chargeAmountCents: 10_000,
    };

    await applyCumulativeStripeRefundToPayments(state.executor as never, args);
    await applyCumulativeStripeRefundToPayments(state.executor as never, args);

    expect(state.insert).toHaveBeenCalledTimes(3);
    expect(state.update).toHaveBeenCalledTimes(3);
    expect(state.refundRows.map((row) => row["amount"]).sort()).toEqual(["-0.01", "-0.01", "-0.03"]);
    expect(state.refundRows.reduce((sum, row) => sum + Number(row["amount"]), 0)).toBe(-0.05);
    expect(state.refundRows.map((row) => row["reservationId"]).sort()).toEqual([
      null,
      "reservation-1",
      "reservation-2",
    ]);
  });

  it("does not reduce an already-applied cumulative refund when an older event arrives late", async () => {
    const state = createExecutor();
    const base = {
      tenantId: "tenant-1",
      orderId: "order-1",
      paymentIntentId: "pi-test",
      chargeAmountCents: 10_000,
    };

    await applyCumulativeStripeRefundToPayments(state.executor as never, {
      ...base,
      amountRefundedCents: 600,
    });
    await applyCumulativeStripeRefundToPayments(state.executor as never, {
      ...base,
      amountRefundedCents: 250,
    });

    expect(state.insert).toHaveBeenCalledTimes(3);
    expect(state.refundRows.reduce((sum, row) => sum + Math.abs(Number(row["amount"]) * 100), 0)).toBe(600);
  });

  it("refreshes paid value and balance without changing the active reservation status", async () => {
    const update = vi.fn(() => {
      const chain = {
        set: vi.fn(() => chain),
        where: vi.fn(async () => undefined),
      };
      return chain;
    });
    const reservation = { id: "reservation-1", totalValue: "100.00" };
    const chain: Record<string, unknown> = {};
    chain["from"] = () => chain;
    chain["where"] = () => chain;
    chain["for"] = () => chain;
    chain["limit"] = () => Promise.resolve([reservation]);
    const executor = {
      select: vi.fn(() => chain),
      execute: vi.fn(async () => ({ rows: [{ total_received: "72.50" }] })),
      update,
    };

    await recalculateReservationPaymentAmountsPreservingStatus(
      "reservation-1",
      "tenant-1",
      executor as never,
    );

    expect(update.mock.results[0]?.value.set).toHaveBeenCalledWith({
      paidValue: "72.5",
      balance: "27.5",
    });
  });
});
