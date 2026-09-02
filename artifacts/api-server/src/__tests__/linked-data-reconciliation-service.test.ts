import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLES } from "@workspace/permissions";

const { select, update, insert, syncClientDeal, syncStoreOrderFromReservationPayment, convertPaidReservationReferral } = vi.hoisted(() => ({
  select: vi.fn(), update: vi.fn(), insert: vi.fn(), syncClientDeal: vi.fn(),
  syncStoreOrderFromReservationPayment: vi.fn(), convertPaidReservationReferral: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: { select, update, insert },
  reservationsTable: {}, storeOrdersTable: {}, referralsTable: {}, dealsTable: {}, linkedDataReconciliationRunsTable: {},
  clientsTable: {}, paymentsTable: {}, tripsTable: {}, usersTable: {}, passengersTable: {},
}));
vi.mock("../services/pipeline-deal-sync.js", () => ({ syncClientDeal }));
vi.mock("../services/reservation-order-payment-sync.js", () => ({ syncStoreOrderFromReservationPayment }));
vi.mock("../services/reservation-referral-conversion.js", () => ({ convertPaidReservationReferral }));
import { reconcileLinkedData } from "../services/linked-data-reconciliation.js";

function queueSelect(results: unknown[][]) {
  select.mockImplementation(() => {
    const value = results.shift() ?? [];
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(async () => value);
    return chain;
  });
}

describe("reconcileLinkedData referral links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    update.mockImplementation(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) }));
    insert.mockImplementation(() => ({ values: vi.fn(() => ({ onConflictDoNothing: vi.fn(async () => []) })) }));
    syncStoreOrderFromReservationPayment.mockResolvedValue({ orderId: "o1", transitionedToPaid: true });
  });

  it("repairs an unequivocal single-reservation referral and replay is a no-op", async () => {
    const reservation = { id: "r1", tenantId: "t1", storeOrderId: "SO1", clientId: "c1", createdAt: new Date() };
    const order = { id: "o1", tenantId: "t1", orderNumber: "SO1", clientId: "c1", pendingReferral: { referralId: "ref1" } };
    queueSelect([[reservation], [order], [{ id: "ref1", tenantId: "t1", reservationId: null, status: "pending" }], []]);
    const first = await reconcileLinkedData("t1", true);
    expect(first.repaired).toContain("referral-reservation:ref1");
    expect(update).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    update.mockImplementation(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) }));
    queueSelect([[reservation], [order], [{ id: "ref1", tenantId: "t1", reservationId: "r1", status: "completed" }], []]);
    const replay = await reconcileLinkedData("t1", true);
    expect(replay.repaired).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });

  it("reports multi-reservation ambiguity without updating", async () => {
    const base = { tenantId: "t1", storeOrderId: "SO1", clientId: "c1", createdAt: new Date() };
    queueSelect([[{ ...base, id: "r1" }, { ...base, id: "r2" }], [{ id: "o1", orderNumber: "SO1", clientId: "c1", pendingReferral: { referralId: "ref1" } }], [{ id: "ref1", reservationId: null, status: "pending" }], []]);
    const result = await reconcileLinkedData("t1", true);
    expect(result.issues).toContainEqual(expect.objectContaining({ reason: "ambiguous_multi_reservation_order" }));
    expect(update).not.toHaveBeenCalled();
  });

  it("promotes an order exactly once when all linked reservations are fully paid", async () => {
    const reservations = [
      { id: "r1", tenantId: "t1", storeOrderId: "SO1", clientId: "c1", balance: "0", createdAt: new Date() },
      { id: "r2", tenantId: "t1", storeOrderId: "SO1", clientId: "c1", balance: "0", createdAt: new Date() },
    ];
    const order = { id: "o1", tenantId: "t1", orderNumber: "SO1", clientId: "c1", paymentStatus: "pending", status: "pending" };
    queueSelect([reservations, [order], [], []]);

    const result = await reconcileLinkedData("t1", true);

    expect(syncStoreOrderFromReservationPayment).toHaveBeenCalledTimes(1);
    expect(syncStoreOrderFromReservationPayment).toHaveBeenCalledWith("r1", "t1");
    expect(result.repaired).toContain("order-payment:o1");
  });

  it("converts a paid pending referral after repairing its unambiguous reservation link", async () => {
    const reservation = {
      id: "r1", tenantId: "t1", storeOrderId: "SO1", clientId: "c1",
      balance: "0", paidValue: "100", status: "confirmed", createdAt: new Date(),
    };
    const order = {
      id: "o1", tenantId: "t1", orderNumber: "SO1", clientId: "c1",
      paymentStatus: "paid", status: "confirmed", pendingReferral: { referralId: "ref1" },
    };
    queueSelect([[reservation], [order], [{ id: "ref1", tenantId: "t1", reservationId: null, status: "pending" }], []]);

    await reconcileLinkedData("t1", true);

    expect(convertPaidReservationReferral).toHaveBeenCalledWith("r1", "t1");
  });

  it("does not promote a multi-reservation order while any sibling still has balance", async () => {
    const reservations = [
      { id: "r1", tenantId: "t1", storeOrderId: "SO1", clientId: "c1", balance: "0", createdAt: new Date() },
      { id: "r2", tenantId: "t1", storeOrderId: "SO1", clientId: "c1", balance: "10", createdAt: new Date() },
    ];
    const order = { id: "o1", tenantId: "t1", orderNumber: "SO1", clientId: "c1", paymentStatus: "pending", status: "pending" };
    queueSelect([reservations, [order], [], []]);

    await reconcileLinkedData("t1", true);

    expect(syncStoreOrderFromReservationPayment).not.toHaveBeenCalled();
  });

  it("cannot repair from an order excluded by tenant scoping", async () => {
    queueSelect([[], [], [{ id: "ref1", reservationId: null, status: "pending" }], []]);
    const result = await reconcileLinkedData("tenant-a", true);
    expect(result.repaired).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });
});


describe("reconcileLinkedData integrity report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    update.mockImplementation(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) }));
    insert.mockImplementation(() => ({ values: vi.fn(() => ({ onConflictDoNothing: vi.fn(async () => []) })) }));
  });

  it("is dry-run by default and returns metadata, summaries and category arrays", async () => {
    const client = { id: "c1", tenantId: "t1", email: "client@example.com", userId: null, totalSpent: "0", outstandingBalance: "0" };
    const payment = { id: "p1", tenantId: "t1", clientId: "c1", type: "receivable", status: "paid", amount: "25" };
    queueSelect([[], [], [], [], [client], [payment], [], []]);

    const result = await reconcileLinkedData("t1");
    expect(result).toMatchObject({ mode: "dry-run", tenantId: "t1", repaired: [], repairedCount: 0 });
    expect(result.generatedAt).toEqual(expect.any(String));
    expect(result.summary.issues["client-financial"]).toBe(1);
    expect(result.categories["client-financial"]?.issues).toHaveLength(1);
    expect(insert).toHaveBeenLastCalledWith({});
    const insertChain = insert.mock.results.at(-1)?.value as { values: ReturnType<typeof vi.fn> };
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "t1",
      mode: "dry-run",
      checkedCount: result.checked,
      repairedCount: 0,
      issueCount: 1,
      summary: expect.objectContaining({
        "client-financial": expect.objectContaining({
          checked: 1,
          repaired: 0,
          issues: 1,
          reasons: { receivable_totals_mismatch: 1 },
        }),
      }),
    }));
    const historyPayload = insertChain.values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(JSON.stringify(historyPayload)).not.toContain("c1");
    expect(update).not.toHaveBeenCalled();
  });

  it("repairs tenant receivable totals using paid, pending and overdue semantics", async () => {
    const client = { id: "c1", tenantId: "t1", email: null, userId: null, totalSpent: "1", outstandingBalance: "1" };
    queueSelect([[], [], [], [], [client], [
      { tenantId: "t1", clientId: "c1", type: "receivable", status: "paid", amount: "12.5" },
      { tenantId: "t1", clientId: "c1", type: "receivable", status: "pending", amount: "3" },
      { tenantId: "t1", clientId: "c1", type: "receivable", status: "overdue", amount: "2" },
      { tenantId: "t1", clientId: "c1", type: "payable", status: "paid", amount: "999" },
    ], [], []]);
    const result = await reconcileLinkedData("t1", true);
    expect(result.repaired).toContain("client-financial:c1");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("repairs active trip counters from reservation seats and free passengers", async () => {
    const reservation = { id: "r1", tenantId: "t1", tripId: "trip1", clientId: null, status: "pending", seats: ["1", "2"], totalValue: "0", createdById: "u1" };
    const trip = { id: "trip1", tenantId: "t1", status: "active", totalCapacity: 10, reservedSeats: 0, confirmedSeats: 0, availableSeats: 10, freePassengers: [{ id: "free" }] };
    queueSelect([[reservation], [], [], [], [], [], [trip], [], []]);
    const result = await reconcileLinkedData("t1", true);
    expect(result.repaired).toContain("trip-seats:trip1");
    expect(result.categories["trip-seats"]?.repaired).toContain("trip-seats:trip1");
  });

  it("repairs exactly one normalized client-user match but reports ambiguity", async () => {
    const client = { id: "c1", tenantId: "t1", email: " Client@Example.COM ", userId: null, totalSpent: "0", outstandingBalance: "0" };
    const user = { id: "u1", tenantId: "t1", email: "client@example.com", role: ROLES.CLIENT, isActive: true };
    queueSelect([[], [], [], [], [client], [], [], [user]]);
    const repaired = await reconcileLinkedData("t1", true);
    expect(repaired.repaired).toContain("client-user:c1");

    vi.clearAllMocks();
    update.mockImplementation(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => []) })) }));
    const other = { ...client, id: "c2" };
    queueSelect([[], [], [], [], [client, other], [], [], [user]]);
    const ambiguous = await reconcileLinkedData("t1", true);
    expect(ambiguous.issues).toContainEqual(expect.objectContaining({ type: "client-user", reason: "ambiguous_or_already_linked_email" }));
    expect(update).not.toHaveBeenCalled();
  });

  it("uses the tenant-local sync helper only for a valid missing deal and reports duplicates", async () => {
    const reservation = { id: "r1", tenantId: "t1", tripId: "trip1", clientId: "c1", status: "pending", seats: [], totalValue: "75", createdById: "u1" };
    const client = { id: "c1", tenantId: "t1", email: null, userId: null, totalSpent: "0", outstandingBalance: "0" };
    const trip = { id: "trip1", tenantId: "t1", status: "active", totalCapacity: 1, reservedSeats: 0, confirmedSeats: 0, availableSeats: 1, freePassengers: [] };
    queueSelect([[reservation], [], [], [], [client], [], [trip], [], []]);
    await reconcileLinkedData("t1", true);
    expect(syncClientDeal).toHaveBeenCalledWith("c1", "t1", "trip1", 75, "u1", { reservationId: "r1" });

    vi.clearAllMocks();
    queueSelect([[reservation], [], [], [
      { id: "d1", tenantId: "t1", reservationId: "r1" },
      { id: "d2", tenantId: "t1", reservationId: "r1" },
    ], [client], [], [trip], [], []]);
    const duplicates = await reconcileLinkedData("t1", true);
    expect(duplicates.issues).toContainEqual(expect.objectContaining({ reason: "duplicate_reservation_deals" }));
    expect(syncClientDeal).not.toHaveBeenCalled();
  });

  it("does not mutate records excluded by tenant-scoped source queries and a repaired replay is clean", async () => {
    // Tenant B data is deliberately absent from every tenant A query result.
    queueSelect([[], [], [], [], [], [], [], []]);
    const isolated = await reconcileLinkedData("tenant-a", true);
    expect(isolated.repaired).toEqual([]);
    expect(update).not.toHaveBeenCalled();

    // First pass observes drift. The replay receives the persisted post-repair
    // values, which is how the database behaves after a successful update.
    const staleClient = { id: "c1", tenantId: "t1", email: null, userId: null, totalSpent: "0", outstandingBalance: "0" };
    const paidPayment = { id: "p1", tenantId: "t1", clientId: "c1", type: "receivable", status: "paid", amount: "10" };
    queueSelect([[], [], [], [], [staleClient], [paidPayment], [], []]);
    const first = await reconcileLinkedData("t1", true);
    expect(first.repaired).toContain("client-financial:c1");

    vi.clearAllMocks();
    update.mockImplementation(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => [{ id: "c1" }]) })),
    }));
    const repairedClient = { ...staleClient, totalSpent: "10" };
    queueSelect([[], [], [], [], [repairedClient], [paidPayment], [], []]);
    const replay = await reconcileLinkedData("t1", true);
    expect(replay.repaired).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });
});
