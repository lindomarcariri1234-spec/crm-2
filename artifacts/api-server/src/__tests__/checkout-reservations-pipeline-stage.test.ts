import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tx } from "../services/checkout/tx.js";

const {
  mockSyncClientDeal,
  mockLoadReservationContext,
  mockInsertValues,
  mockInsert,
  mockExecute,
} = vi.hoisted(() => {
  const mockSyncClientDeal = vi.fn().mockResolvedValue(undefined);
  const mockLoadReservationContext = vi.fn().mockResolvedValue({
    reservationCreatedById: "agency-user-1",
    vitrineStageId: "stage-vitrine",
    reservaCriadaStageId: "stage-reserva-criada",
    tripNameMap: new Map(),
  });
  const mockInsertValues = vi.fn().mockResolvedValue([]);
  const mockInsert = vi.fn(() => ({ values: mockInsertValues }));
  const mockExecute = vi.fn();

  return {
    mockSyncClientDeal,
    mockLoadReservationContext,
    mockInsertValues,
    mockInsert,
    mockExecute,
  };
});

vi.mock("@workspace/db", () => ({
  db: { transaction: vi.fn() },
  storesTable: {},
  storeOrdersTable: {},
  storeOrderItemsTable: {},
  storeProductsTable: {},
  reservationsTable: {},
  passengersTable: {},
  tripsTable: {},
  paymentsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn(() => "eq"),
  inArray: vi.fn(() => "inArray"),
  sql: vi.fn(() => "sql"),
}));

vi.mock("@workspace/permissions", () => ({
  RESERVATION_STATUS: { CONFIRMED: "confirmed", PENDING: "pending" },
  PAYMENT_STATUS: { PAID: "paid" },
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "reservation-1"),
  generateVoucherCode: vi.fn(() => "voucher-1"),
}));

vi.mock("../lib/reservation-number.js", () => ({
  tripTypeToCode: vi.fn(() => "EX"),
  nextReservationSequence: vi.fn().mockResolvedValue(1),
  buildReservationNumber: vi.fn(() => "AG-EX-202608-0001"),
  getYearMonth: vi.fn(() => "202608"),
  getTenantReservationPrefix: vi.fn().mockResolvedValue("AG"),
}));

vi.mock("../services/checkout/reservation-context.js", () => ({
  loadReservationContext: mockLoadReservationContext,
}));

vi.mock("../services/checkout/checkout-user.js", () => ({
  upsertCheckoutClient: vi.fn(),
}));

vi.mock("../lib/pricing.js", () => ({
  roundMoney: vi.fn((value: number) => Math.round(value * 100) / 100),
}));

vi.mock("../lib/reservation-payments.js", () => ({
  syncReservationPaymentStatus: vi.fn(),
  paymentExistsForGatewayTx: vi.fn(),
}));

vi.mock("../services/pipeline-deal-sync.js", () => ({
  syncClientDeal: mockSyncClientDeal,
}));

vi.mock("../services/pipeline-automation.js", () => ({
  moveDealToStage: vi.fn(),
}));

import { createReservationsForOrder } from "../services/checkout/create-reservations.js";

const BASE_ORDER = {
  id: "order-1",
  orderNumber: "ORDER-001",
  tenantId: "tenant-1",
  storeId: "store-1",
  clientId: "client-1",
  customerName: "Maria Silva",
  customerEmail: "maria@example.com",
  customerPhone: "+55 88 99999-0000",
  customerCpf: null,
  customerBirthdate: null,
  customerNotes: null,
  boardingLocationId: null,
  seats: ["1"],
  coPassengers: [],
  paymentMethod: "pix",
  installments: 1,
  amountRemaining: "100",
};

const TRIP_PRODUCT = {
  id: "product-1",
  tripId: "trip-1",
  name: "Passeio pelo Cariri",
};

function makeSelectQueueExecutor(rows: unknown[][]) {
  const selectQueue = [...rows];
  const select = vi.fn(() => {
    const value = selectQueue.shift() ?? [];
    const limit = vi.fn().mockResolvedValue(value);
    const whereResult = Object.assign(Promise.resolve(value), { limit });
    return {
      from: vi.fn(() => ({
        where: vi.fn(() => whereResult),
        limit,
      })),
    };
  });
  const update = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
  }));

  return {
    select,
    insert: mockInsert,
    update,
    execute: mockExecute,
  } as unknown as Tx;
}

function queueTripReservation(order: typeof BASE_ORDER) {
  return makeSelectQueueExecutor([
    [order],
    [{ id: "store-1", tenantId: "tenant-1", slug: "minha-loja" }],
    [{ productId: "product-1", quantity: 1, price: "100" }],
    [TRIP_PRODUCT],
    [],
  ]);
}

describe("createReservationsForOrder — storefront Pipeline stage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadReservationContext.mockResolvedValue({
      reservationCreatedById: "agency-user-1",
      vitrineStageId: "stage-vitrine",
      reservaCriadaStageId: "stage-reserva-criada",
      tripNameMap: new Map(),
    });
    mockInsertValues.mockResolvedValue([]);
    mockInsert.mockReturnValue({ values: mockInsertValues });
    mockExecute
      .mockResolvedValueOnce({
        rows: [{
          id: "trip-1",
          available_seats: 10,
          total_capacity: 10,
          show_seat_map: true,
          type: "excursao",
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1 });
  });

  it.each([
    { description: "without a deposit", depositAmount: "0", status: "pending" },
    { description: "with a deposit", depositAmount: "25", status: "confirmed" },
  ])("sends $description reservations to Vitrine", async ({ depositAmount, status }) => {
    const order = { ...BASE_ORDER, depositAmount };
    const tx = queueTripReservation(order);

    const result = await createReservationsForOrder(order.id, tx);

    expect(result.reservationIds).toEqual(["reservation-1"]);
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        status,
        clientId: "client-1",
        tripId: "trip-1",
      }),
    );
    expect(mockSyncClientDeal).toHaveBeenCalledOnce();
    expect(mockSyncClientDeal).toHaveBeenCalledWith(
      "client-1",
      "tenant-1",
      "trip-1",
      100,
      "agency-user-1",
      expect.objectContaining({
        reservationId: "reservation-1",
        source: "website",
        targetStageName: "Vitrine",
        executor: tx,
      }),
    );
  });

  it("does not create a reservation or Pipeline card for products without a trip", async () => {
    const tx = makeSelectQueueExecutor([
      [BASE_ORDER],
      [{ id: "store-1", tenantId: "tenant-1", slug: "minha-loja" }],
      [{ productId: "product-2", quantity: 1, price: "50" }],
      [{ id: "product-2", tripId: null, name: "Produto avulso" }],
    ]);

    const result = await createReservationsForOrder(BASE_ORDER.id, tx);

    expect(result).toEqual({
      reservationIds: [],
      reservationClientId: null,
      tripIds: [],
    });
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockSyncClientDeal).not.toHaveBeenCalled();
  });
});