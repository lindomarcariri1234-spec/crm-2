import { describe, expect, it, vi, beforeEach } from "vitest";

const { db, tables, mockLockProducts } = vi.hoisted(() => {
  const makeTable = (name: string) => new Proxy({}, {
    get: (_target, property: string | symbol) => `${name}.${String(property)}`,
  });

  return {
    db: { transaction: vi.fn() },
    tables: {
      storesTable: makeTable("stores"),
      storeProductsTable: makeTable("store_products"),
      storeOrdersTable: makeTable("store_orders"),
      storeOrderItemsTable: makeTable("store_order_items"),
      storeCouponsTable: makeTable("store_coupons"),
      partnersTable: makeTable("partners"),
      partnerProductsTable: makeTable("partner_products"),
      partnerAvailabilityTable: makeTable("partner_availability"),
      partnerCommissionsTable: makeTable("partner_commissions"),
      referralsTable: makeTable("referrals"),
      settlementItemsTable: makeTable("settlement_items"),
    },
    mockLockProducts: vi.fn(),
  };
});

vi.mock("@workspace/db", () => ({
  db,
  ...tables,
}));

vi.mock("@workspace/permissions", () => ({
  REFERRAL_STATUS: { PENDING: "pending", COMPLETED: "completed", CONVERTED: "converted" },
  STORE_PAYMENT_STATUS: { PAID: "paid", PENDING: "pending" },
  STORE_ORDER_STATUS: { CANCELLED: "cancelled" },
}));

vi.mock("drizzle-orm", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: "sql",
    text: Array.from(strings).join("?"),
    values,
  });
  sql.raw = vi.fn();
  return {
    and: (...conditions: unknown[]) => conditions,
    asc: (column: unknown) => ({ kind: "asc", column }),
    eq: (left: unknown, right: unknown) => ({ kind: "eq", left, right }),
    inArray: (left: unknown, values: unknown[]) => ({ kind: "inArray", left, values }),
    sql,
  };
});

vi.mock("../services/checkout/order-locks.js", () => ({
  lockProductsForCheckout: mockLockProducts,
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "generated-id"),
}));

vi.mock("@workspace/shared", () => ({
  localToday: vi.fn(() => "2026-09-08"),
}));

vi.mock("../lib/pricing.js", () => ({
  roundMoney: (value: number) => Math.round(Number(value) * 100) / 100,
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  },
}));

import { persistCheckoutOrder } from "../services/checkout/persist-order.js";
import {
  applyDeferredOrderCredits,
  releaseReservedCreditForOrder,
} from "../services/checkout/deferred-referral-effects.js";

type StoredOrder = Record<string, any>;

const credit = {
  id: "credit-1",
  bonusAmount: 40,
  bonusCreditUsedAmount: 0,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};
const credits = [credit];

const state: {
  orders: StoredOrder[];
  transactions: number;
} = {
  orders: [],
  transactions: 0,
};

let lockTail = Promise.resolve();

function acquireCreditLock(): Promise<() => void> {
  let release!: () => void;
  const previous = lockTail;
  lockTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  return previous.then(() => release);
}

function findEqualityValue(condition: unknown): unknown {
  if (Array.isArray(condition)) {
    for (const nested of condition) {
      const value = findEqualityValue(nested);
      if (value !== undefined) return value;
    }
    return undefined;
  }
  if (condition && typeof condition === "object") {
    const candidate = condition as { kind?: string; right?: unknown };
    if (candidate.kind === "eq") return candidate.right;
  }
  return undefined;
}

function rowsFor(table: unknown, condition: unknown): object[] {
  if (table === tables.referralsTable) {
    return credits
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .map((row) => ({
        id: row.id,
        bonusAmount: row.bonusAmount.toFixed(2),
        bonusCreditUsedAmount: row.bonusCreditUsedAmount.toFixed(2),
      }));
  }

  if (table === tables.storeOrdersTable) {
    const orderId = findEqualityValue(condition);
    return state.orders.filter((order) => order.id === orderId);
  }

  return [];
}

function createTransaction(): { tx: Record<string, any>; release: () => void } {
  let release: (() => void) | null = null;
  let transactionLock: Promise<() => void> | null = null;

  const tx: Record<string, any> = {
    select: vi.fn(() => {
      let table: unknown;
      let condition: unknown;
      let lockPromise: Promise<() => void> | null = null;
      const chain: Record<string, any> = {};

      chain.from = vi.fn((selectedTable: unknown) => {
        table = selectedTable;
        return chain;
      });
      chain.where = vi.fn((whereCondition: unknown) => {
        condition = whereCondition;
        return chain;
      });
      chain.orderBy = vi.fn(() => chain);
      chain.limit = vi.fn(() => chain);
      chain.for = vi.fn(() => {
        lockPromise = transactionLock ??= acquireCreditLock();
        lockPromise.then((unlock) => {
          release ??= unlock;
        });
        return chain;
      });
      chain.then = (resolve: (value: object[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(lockPromise)
          .then(() => rowsFor(table, condition))
          .then(resolve, reject);
      return chain;
    }),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (values: StoredOrder) => {
        if (table === tables.storeOrdersTable) {
          state.orders.push({ ...values });
        }
        return [];
      }),
    })),
    update: vi.fn((table: unknown) => {
      let payload: Record<string, unknown> = {};
      const updateChain: Record<string, any> = {
        set: vi.fn((nextPayload: Record<string, unknown>) => {
          payload = nextPayload;
          return updateChain;
        }),
        where: vi.fn(async (condition: unknown) => {
          if (table === tables.referralsTable && payload.bonusCreditUsedAmount) {
            const expression = payload.bonusCreditUsedAmount as { text?: string; values?: unknown[] };
            const amount = Number(expression.values?.at(-1) ?? 0);
            const creditId = findEqualityValue(condition);
            const matchingCredit = credits.find((candidate) => candidate.id === creditId);
            if (matchingCredit) {
              matchingCredit.bonusCreditUsedAmount = expression.text?.includes("GREATEST")
                ? Math.max(0, matchingCredit.bonusCreditUsedAmount - amount)
                : matchingCredit.bonusCreditUsedAmount + amount;
            }
          }

          if (table === tables.storeOrdersTable) {
            const orderId = findEqualityValue(condition);
            const order = state.orders.find((candidate) => candidate.id === orderId);
            if (order) Object.assign(order, payload);
          }
          return [];
        }),
      };
      return updateChain;
    }),
  };

  return {
    tx,
    release: () => release?.(),
  };
}

function installDatabase() {
  state.orders = [];
  state.transactions = 0;
  credit.bonusCreditUsedAmount = 0;
  credits.splice(0, credits.length, credit);
  lockTail = Promise.resolve();
  mockLockProducts.mockResolvedValue(new Set());
  (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
    state.transactions += 1;
    const transaction = createTransaction();
    try {
      return await callback(transaction.tx);
    } finally {
      transaction.release();
    }
  });
}

function checkoutArgs(orderId: string, orderNumber: string) {
  return {
    store: { id: "store-1", tenantId: "tenant-1" },
    data: {
      customerName: "Cliente Cashback",
      customerEmail: "cliente@example.com",
      idempotencyKey: orderId,
      items: [{ productId: "product-1", quantity: 1 }],
      paymentMethod: "pending",
      paymentProvider: "manual",
    },
    orderId,
    orderNumber,
    orderPaymentToken: `token-${orderId}`,
    subtotal: 50,
    discountAmount: 0,
    promoDiscountAmount: 0,
    totalAmount: 50,
    appliedReferralDiscountValue: 0,
    appliedReferralDiscountType: "percentage",
    orderItemsData: [{
      id: `item-${orderId}`,
      orderId,
      productId: "product-1",
      productName: "Passeio",
      productType: "trip",
      productImage: null,
      variant: null,
      price: "50.00",
      quantity: 1,
      subtotal: "50.00",
      discount: "0.00",
      total: "50.00",
      metadata: null,
    }],
    fetchedProducts: new Map([["product-1", {
      id: "product-1",
      trackInventory: false,
      allowBackorder: true,
    }]]),
    quantityByProductId: new Map([["product-1", 1]]),
    tripLinkedProducts: new Map(),
    parsedBirthDate: null,
    referralCreditRequested: 30,
    referralCreditClientId: "client-1",
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  installDatabase();
});

describe("cashback reservation across concurrent checkouts", () => {
  it("caps the second checkout, keeps total consumption within the balance, confirms paid credit once, and releases abandoned credit", async () => {
    const [first, second] = await Promise.all([
      persistCheckoutOrder(checkoutArgs("order-1", "ORDER-1")),
      persistCheckoutOrder(checkoutArgs("order-2", "ORDER-2")),
    ]);

    expect(state.transactions).toBe(2);
    expect([first.appliedCreditAmount, second.appliedCreditAmount].sort((a, b) => a - b)).toEqual([10, 30]);
    expect(first.appliedCreditAmount + second.appliedCreditAmount).toBe(credit.bonusAmount);
    expect(first.appliedCreditAmount + second.appliedCreditAmount).toBeLessThanOrEqual(credit.bonusAmount);
    expect([first.totalAmount, second.totalAmount].sort((a, b) => a - b)).toEqual([20, 40]);
    expect(credit.bonusCreditUsedAmount).toBe(40);
    expect(credit.bonusCreditUsedAmount).toBeLessThanOrEqual(credit.bonusAmount);
    expect(state.orders.map((order) => Number(order.totalAmount)).sort((a, b) => a - b)).toEqual([20, 40]);
    expect(state.orders.reduce((sum, order) => (
      sum + Number(order.pendingCreditSpend?.[0]?.consumedAmount ?? 0)
    ), 0)).toBe(40);

    const paidOrder = state.orders.find((order) => order.pendingCreditSpend?.[0]?.consumedAmount === 30)!;
    paidOrder.paymentStatus = "paid";
    await applyDeferredOrderCredits(paidOrder.id);

    expect(credit.bonusCreditUsedAmount).toBe(40);
    expect(paidOrder.referralEffectsAppliedAt).toBeInstanceOf(Date);

    const abandonedOrder = state.orders.find((order) => order.pendingCreditSpend?.[0]?.consumedAmount === 10)!;
    await releaseReservedCreditForOrder(abandonedOrder.id);

    expect(credit.bonusCreditUsedAmount).toBe(30);
    expect(abandonedOrder.pendingCreditSpend).toBeNull();

    await releaseReservedCreditForOrder(abandonedOrder.id);
    expect(credit.bonusCreditUsedAmount).toBe(30);
  });

  it("consumes multiple credits oldest-first, confirms once, and releases the exact reservation", async () => {
    credits.splice(0, credits.length,
      {
        id: "credit-oldest",
        bonusAmount: 20,
        bonusCreditUsedAmount: 0,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
      {
        id: "credit-newest",
        bonusAmount: 25,
        bonusCreditUsedAmount: 0,
        createdAt: new Date("2026-02-01T00:00:00Z"),
      },
    );

    const unpaid = await persistCheckoutOrder(checkoutArgs("order-unpaid", "ORDER-UNPAID"));
    const unpaidOrder = state.orders.find((order) => order.id === "order-unpaid")!;

    expect(unpaid.appliedCreditAmount).toBe(30);
    expect(unpaidOrder.pendingCreditSpend).toEqual([
      { id: "credit-oldest", consumedAmount: 20, reserved: true },
      { id: "credit-newest", consumedAmount: 10, reserved: true },
    ]);
    expect(credits.map((row) => row.bonusCreditUsedAmount)).toEqual([20, 10]);
    expect(credits.reduce((sum, row) => sum + row.bonusCreditUsedAmount, 0)).toBe(30);

    await releaseReservedCreditForOrder(unpaidOrder.id);
    expect(credits.map((row) => row.bonusCreditUsedAmount)).toEqual([0, 0]);
    expect(unpaidOrder.pendingCreditSpend).toBeNull();

    const paid = await persistCheckoutOrder(checkoutArgs("order-paid", "ORDER-PAID"));
    const paidOrder = state.orders.find((order) => order.id === "order-paid")!;
    paidOrder.paymentStatus = "paid";

    expect(paid.appliedCreditAmount).toBe(30);
    expect(paidOrder.pendingCreditSpend).toEqual([
      { id: "credit-oldest", consumedAmount: 20, reserved: true },
      { id: "credit-newest", consumedAmount: 10, reserved: true },
    ]);

    await applyDeferredOrderCredits(paidOrder.id);
    await applyDeferredOrderCredits(paidOrder.id);

    expect(credits.map((row) => row.bonusCreditUsedAmount)).toEqual([20, 10]);
    expect(credits.reduce((sum, row) => sum + row.bonusCreditUsedAmount, 0)).toBe(30);
  });
});