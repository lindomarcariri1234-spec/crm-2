import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const settlementItemsTable = {
    tenantId: "settlementItems.tenantId",
    orderId: "settlementItems.orderId",
    createdAt: "settlementItems.createdAt",
  };
  const financialLedgerEntriesTable = {
    tenantId: "ledger.tenantId",
    orderId: "ledger.orderId",
    eventType: "ledger.eventType",
    reversalOfEntryId: "ledger.reversalOfEntryId",
    clientId: "ledger.clientId",
    idempotencyKey: "ledger.idempotencyKey",
  };
  let nextId = 0;
  return {
    settlementItemsTable,
    financialLedgerEntriesTable,
    nextId: () => `entry-${++nextId}`,
    resetIds: () => { nextId = 0; },
  };
});

vi.mock("@workspace/db", () => ({
  settlementItemsTable: h.settlementItemsTable,
  financialLedgerEntriesTable: h.financialLedgerEntriesTable,
}));

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  asc: vi.fn(),
  eq: (column: unknown, value: unknown) => ({ column, value }),
  isNull: (column: unknown) => ({ column, value: null }),
  lt: vi.fn(),
}));

vi.mock("../lib/id.js", () => ({ generateId: () => h.nextId() }));

import {
  createClientBenefitEntry,
  getClientBenefitBalances,
  recordOrderPaymentSettlement,
  reinstateOrderPaymentSettlementEvent,
  reverseOrderPaymentSettlementEvent,
  reverseOrderSettlement,
  adjustOrderSettlement,
  expireClientBenefits,
} from "../services/settlements/financial-ledger.js";

type Row = Record<string, any>;

function matches(condition: unknown, row: Row): boolean {
  if (!condition) return true;
  if (Array.isArray(condition)) return condition.every((item) => matches(item, row));
  if (typeof condition !== "object") return true;
  const item = condition as { column?: string; value?: unknown };
  if (!item.column) return true;
  const field = item.column.split(".").at(-1);
  const camelField = field?.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  return camelField ? row[camelField] === item.value : true;
}

function makeExecutor(state: { snapshots: Row[]; entries: Row[] }) {
  return {
    select: vi.fn(() => {
      let table: unknown;
      let condition: unknown;
      const chain: Record<string, any> = {
        from: (selected: unknown) => { table = selected; return chain; },
        where: (whereCondition: unknown) => { condition = whereCondition; return chain; },
        orderBy: () => chain,
        then: (resolve: (value: Row[]) => unknown, reject?: (error: unknown) => unknown) => {
          const source = table === h.settlementItemsTable ? state.snapshots : state.entries;
          return Promise.resolve(source.filter((row) => matches(condition, row))).then(resolve, reject);
        },
      };
      return chain;
    }),
    insert: vi.fn((table: unknown) => ({
      values: (values: Row) => ({
        onConflictDoNothing: () => {
          const target = table === h.settlementItemsTable ? state.snapshots : state.entries;
          if (!target.some((row) => row.idempotencyKey && row.idempotencyKey === values.idempotencyKey)) {
            target.push({ ...values });
          }
          return Promise.resolve();
        },
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: (values: Row) => ({
        where: (condition: unknown) => {
          const target = table === h.settlementItemsTable ? state.snapshots : state.entries;
          for (const row of target) if (matches(condition, row)) Object.assign(row, values);
          return Promise.resolve();
        },
      }),
    })),
  };
}

function snapshot(overrides: Row = {}): Row {
  return {
    id: overrides.id ?? "snapshot-1",
    tenantId: overrides.tenantId ?? "tenant-a",
    orderId: overrides.orderId ?? "order-1",
    source: "marketplace",
    sellerType: "partner",
    sellerId: "partner-1",
    grossAmount: "100.00",
    commissionAmount: "10.00",
    sellerNetAmount: "90.00",
    settlementStatus: "pending",
    createdAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

function paymentEntry(overrides: Row = {}): Row {
  return {
    id: overrides.id ?? "payment-entry",
    tenantId: overrides.tenantId ?? "tenant-a",
    settlementItemId: "snapshot-1",
    orderId: overrides.orderId ?? "order-1",
    participantType: "agency",
    participantId: "tenant-a",
    category: "agency_sale",
    direction: "credit",
    amount: "100.00",
    currency: "BRL",
    settlementStatus: "available",
    eventType: "order_payment",
    idempotencyKey: "payment:entry",
    metadata: {},
    reversalOfEntryId: null,
    clientId: null,
    expiresAt: null,
    occurredAt: new Date("2026-08-01T00:00:00Z"),
    ...overrides,
  };
}

beforeEach(() => h.resetIds());

describe("financial ledger settlement invariants", () => {
  it("rates a received payment across participants and is idempotent under duplicate delivery", async () => {
    const state = {
      snapshots: [snapshot()],
      entries: [] as Row[],
    };
    const tx = makeExecutor(state);

    await Promise.all([
      recordOrderPaymentSettlement(tx as never, {
        tenantId: "tenant-a", orderId: "order-1", gateway: "stripe",
        transactionId: "tx-1", occurredAt: new Date("2026-08-02T00:00:00Z"), receivedAmount: 50,
      }),
      recordOrderPaymentSettlement(tx as never, {
        tenantId: "tenant-a", orderId: "order-1", gateway: "stripe",
        transactionId: "tx-1", occurredAt: new Date("2026-08-02T00:00:00Z"), receivedAmount: 50,
      }),
    ]);

    expect(state.entries).toHaveLength(2);
    expect(state.entries.map((entry) => entry.amount)).toEqual(["5.00", "45.00"]);
    expect(new Set(state.entries.map((entry) => entry.idempotencyKey)).size).toBe(2);
    expect(state.snapshots[0].settlementStatus).toBe("available");
  });

  it("never distributes more cents than the payment received", async () => {
    const state = {
      snapshots: [
        snapshot({ id: "snapshot-1", grossAmount: "50.00" }),
        snapshot({ id: "snapshot-2", grossAmount: "50.00" }),
      ],
      entries: [] as Row[],
    };
    const tx = makeExecutor(state);

    await recordOrderPaymentSettlement(tx as never, {
      tenantId: "tenant-a",
      orderId: "order-1",
      gateway: "stripe",
      transactionId: "one-cent",
      occurredAt: new Date("2026-08-02T00:00:00Z"),
      receivedAmount: 0.01,
    });

    expect(state.entries.reduce((sum, entry) => sum + Number(entry.amount), 0)).toBe(0.01);
  });

  it("reinstates a payment settlement after paid-to-refunded-to-paid", async () => {
    const state = {
      snapshots: [],
      entries: [
        paymentEntry({
          id: "original",
          amount: "100.00",
          metadata: { gateway: "stripe", transactionId: "tx-1" },
        }),
        paymentEntry({
          id: "refund",
          amount: "100.00",
          direction: "debit",
          eventType: "order_refund_adjustment",
          reversalOfEntryId: "original",
          metadata: { originalEntryId: "original" },
        }),
      ] as Row[],
    };
    const tx = makeExecutor(state);

    const reinstated = await reinstateOrderPaymentSettlementEvent(tx as never, {
      tenantId: "tenant-a",
      orderId: "order-1",
      gateway: "stripe",
      transactionId: "tx-1",
      amount: 100,
      eventKey: "payment-reinstated:tx-1",
      occurredAt: new Date("2026-08-04T00:00:00Z"),
    });

    expect(reinstated).toBe(10000);
    expect(state.entries.filter((entry) => entry.eventType === "order_payment_reinstatement"))
      .toHaveLength(1);
    expect(state.entries.at(-1)?.amount).toBe("100.00");

    // A later refund can compensate the original claim again; the
    // reinstatement is not mistaken for a second reversal.
    await reverseOrderPaymentSettlementEvent(tx as never, {
      tenantId: "tenant-a",
      orderId: "order-1",
      gateway: "stripe",
      transactionId: "tx-1",
      amount: 100,
      eventKey: "payment-refunded-again",
      occurredAt: new Date("2026-08-05T00:00:00Z"),
      reason: "second refund",
    });
    expect(
      state.entries
        .filter((entry) => entry.eventType === "order_refund_adjustment")
        .map((entry) => entry.amount),
    ).toEqual(["100.00", "100.00"]);
  });

  it("books only the cumulative delta for partial refunds", async () => {
    const state = { snapshots: [], entries: [paymentEntry()] };
    const tx = makeExecutor(state);

    await adjustOrderSettlement(tx as never, {
      tenantId: "tenant-a", orderId: "order-1", amount: 25, totalAmount: 100,
      eventKey: "refund-1", occurredAt: new Date("2026-08-03T00:00:00Z"), reason: "partial",
    });
    await adjustOrderSettlement(tx as never, {
      tenantId: "tenant-a", orderId: "order-1", amount: 60, totalAmount: 100,
      eventKey: "refund-2", occurredAt: new Date("2026-08-04T00:00:00Z"), reason: "cumulative",
    });
    await adjustOrderSettlement(tx as never, {
      tenantId: "tenant-a", orderId: "order-1", amount: 60, totalAmount: 100,
      eventKey: "refund-2", occurredAt: new Date("2026-08-04T00:00:00Z"), reason: "duplicate",
    });

    const adjustments = state.entries.filter((entry) => entry.eventType === "order_refund_adjustment");
    expect(adjustments.map((entry) => entry.amount)).toEqual(["25.00", "35.00"]);
    expect(adjustments.reduce((sum, entry) => sum + Number(entry.amount), 0)).toBe(60);
  });

  it("reverses only the remaining balance after a partial refund, including chargebacks", async () => {
    const state = { snapshots: [], entries: [
      paymentEntry({ id: "payment-agency", amount: "40.00", category: "agency_sale" }),
      paymentEntry({ id: "payment-partner", amount: "60.00", category: "partner_payout" }),
    ] as Row[] };
    const tx = makeExecutor(state);

    await adjustOrderSettlement(tx as never, {
      tenantId: "tenant-a", orderId: "order-1", amount: 50, totalAmount: 100,
      eventKey: "refund-1", occurredAt: new Date("2026-08-03T00:00:00Z"), reason: "partial",
    });
    await reverseOrderSettlement(tx as never, {
      tenantId: "tenant-a", orderId: "order-1", eventType: "order_charged_back",
      eventKey: "chargeback-1", occurredAt: new Date("2026-08-05T00:00:00Z"), reason: "dispute",
    });
    await reverseOrderSettlement(tx as never, {
      tenantId: "tenant-a", orderId: "order-1", eventType: "order_charged_back",
      eventKey: "chargeback-1", occurredAt: new Date("2026-08-05T00:00:00Z"), reason: "duplicate",
    });

    const reversals = state.entries.filter((entry) => entry.eventType === "order_charged_back");
    expect(reversals.map((entry) => entry.amount)).toEqual(["20.00", "30.00"]);
    expect(reversals.every((entry) => entry.direction === "debit")).toBe(true);
  });

  it("keeps benefit lots tenant-scoped and consumes non-expired credits FIFO", async () => {
    const now = new Date("2026-08-23T00:00:00Z");
    const state = {
      snapshots: [],
      entries: [
        {
          id: "expired-a", tenantId: "tenant-a", clientId: "client-a", category: "wallet",
          direction: "credit", amount: "10.00", expiresAt: new Date("2026-08-22T00:00:00Z"),
          metadata: {}, orderId: null,
        },
        {
          id: "valid-a", tenantId: "tenant-a", clientId: "client-a", category: "wallet",
          direction: "credit", amount: "20.00", expiresAt: new Date("2026-09-01T00:00:00Z"),
          metadata: {}, orderId: null,
        },
        {
          id: "other-tenant", tenantId: "tenant-b", clientId: "client-a", category: "wallet",
          direction: "credit", amount: "100.00", expiresAt: null, metadata: {}, orderId: null,
        },
      ] as Row[],
    };
    const tx = makeExecutor(state);

    await createClientBenefitEntry(tx as never, {
      tenantId: "tenant-a", clientId: "client-a", category: "wallet", direction: "debit",
      amount: 15, eventType: "wallet_spend", idempotencyKey: "spend-1",
      description: "purchase", occurredAt: now,
    });

    const debit = state.entries.find((entry) => entry.idempotencyKey === "spend-1");
    expect(debit).toBeDefined();
    if (!debit) throw new Error("expected wallet debit entry");
    expect(debit.metadata.allocations).toEqual([{ creditId: "valid-a", amount: 15 }]);
    const balance = await getClientBenefitBalances(tx as never, { tenantId: "tenant-a", clientId: "client-a" });
    expect(balance.wallet).toBe(15);
  });

  it("expires only the remaining value of expired lots and is safe to replay", async () => {
    const now = new Date("2026-08-23T00:00:00Z");
    const state = {
      snapshots: [],
      entries: [{
        id: "expired-a", tenantId: "tenant-a", clientId: "client-a", category: "cashback",
        direction: "credit", amount: "20.00", expiresAt: new Date("2026-08-22T00:00:00Z"),
        metadata: {}, orderId: null,
      }] as Row[],
    };
    const tx = makeExecutor(state);

    await expireClientBenefits(tx as never, { tenantId: "tenant-a", clientId: "client-a", occurredAt: now });
    await expireClientBenefits(tx as never, { tenantId: "tenant-a", clientId: "client-a", occurredAt: now });

    const expired = state.entries.filter((entry) => entry.eventType === "benefit_expired");
    expect(expired).toHaveLength(1);
    expect(expired[0].amount).toBe("20.00");
  });

  it("does not let another tenant's payment entry affect a reversal", async () => {
    const state = {
      snapshots: [],
      entries: [
        paymentEntry({ id: "a-payment", amount: "25.00", orderId: "order-a", tenantId: "tenant-a", idempotencyKey: "a" }),
        paymentEntry({ id: "b-payment", amount: "75.00", orderId: "order-a", tenantId: "tenant-b", idempotencyKey: "b" }),
      ] as Row[],
    };
    const tx = makeExecutor(state);

    await reverseOrderSettlement(tx as never, {
      tenantId: "tenant-a", orderId: "order-a", eventType: "order_refunded",
      eventKey: "refund-a", occurredAt: new Date("2026-08-06T00:00:00Z"), reason: "refund",
    });

    const reversals = state.entries.filter((entry) => entry.eventType === "order_refunded");
    expect(reversals).toHaveLength(1);
    expect(reversals[0].tenantId).toBe("tenant-a");
    expect(reversals[0].amount).toBe("25.00");
  });
});