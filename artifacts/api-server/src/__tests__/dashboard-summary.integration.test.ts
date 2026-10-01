import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { db, pool } from "@workspace/db";
import {
  ACTIVE_RESERVATION_STATUSES,
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  RESERVATION_STATUS,
  ROLES,
  TRIP_STATUS,
} from "@workspace/permissions";
import { localToday } from "@workspace/shared";
import { requireAuth } from "../lib/tenant.js";
import dashboardRouter from "../routes/dashboard.js";

vi.mock("../lib/tenant.js", () => ({ requireAuth: vi.fn() }));

type FixturePayment = {
  id: string;
  tenantId: string;
  reservationId: string | null;
  clientId: string | null;
  type: string;
  status: string;
  amount: string;
  paidAt: Date | null;
  dueDate: Date;
};

type FixtureReservation = {
  id: string;
  tripId: string;
  clientId: string;
  status: string;
  totalValue: number;
  createdAt: Date;
};

type FixtureTrip = {
  id: string;
  status: string;
  totalCapacity: number;
  reservedSeats: number;
  createdAt: Date;
};

type DashboardFixture = {
  tenantId: string;
  otherTenantId: string;
  sellerId: string;
  adminId: string;
  clientAId: string;
  clientBId: string;
  startOfMonth: Date;
  startOfToday: Date;
  next3Days: Date;
  trips: FixtureTrip[];
  reservations: FixtureReservation[];
  payments: FixturePayment[];
  npsScores: number[];
};

const requireAuthMock = vi.mocked(requireAuth);
let fixture: DashboardFixture;

function brazilUTC(year: number, month1Based: number, day: number): Date {
  return new Date(Date.UTC(year, month1Based - 1, day, 3, 0, 0, 0));
}

async function seedFixture(): Promise<DashboardFixture> {
  const suffix = `${process.pid}-${Date.now()}`;
  const tenantId = `dash-summary-${suffix}`;
  const otherTenantId = `dash-summary-other-${suffix}`;
  const adminId = `dash-summary-admin-${suffix}`;
  const sellerId = `dash-summary-seller-${suffix}`;
  const clientAId = `dash-summary-client-a-${suffix}`;
  const clientBId = `dash-summary-client-b-${suffix}`;
  const activeTripId = `dash-summary-trip-active-${suffix}`;
  const inactiveTripId = `dash-summary-trip-inactive-${suffix}`;
  const [year, month, day] = localToday().split("-").map(Number);
  const startOfMonth = brazilUTC(year, month, 1);
  const startOfToday = brazilUTC(year, month, day);
  const next3Days = new Date(startOfToday.getTime() + 3 * 86_400_000);
  const dayBeforeToday = new Date(startOfToday.getTime() - 86_400_000);
  const dayBeforeMonth = new Date(startOfMonth.getTime() - 86_400_000);
  const monthHistoryPaidAt = new Date(startOfMonth.getTime() - 30 * 86_400_000);

  await pool.query(
    `INSERT INTO tenants (id, name, slug, email)
     VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)`,
    [
      tenantId, "Dashboard Summary Test", `${tenantId}-agency`, `${tenantId}@example.test`,
      otherTenantId, "Dashboard Summary Other Tenant", `${otherTenantId}-agency`, `${otherTenantId}@example.test`,
    ],
  );
  await pool.query(
    `INSERT INTO users (id, clerk_id, name, email, referral_code)
     VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)`,
    [
      adminId, `${adminId}-clerk`, "Dashboard Admin", `${adminId}@example.test`, `${adminId}-ref`,
      sellerId, `${sellerId}-clerk`, "Dashboard Seller", `${sellerId}@example.test`, `${sellerId}-ref`,
    ],
  );
  await pool.query(
    `INSERT INTO clients (id, tenant_id, name, email, whatsapp, created_by_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7), ($8, $2, $9, $10, $11, $12, $13)`,
    [
      clientAId, tenantId, "Client A", `${clientAId}@example.test`, `+551199${suffix.slice(-7)}`, sellerId, startOfMonth,
      clientBId, "Client B", `${clientBId}@example.test`, `+551188${suffix.slice(-7)}`, adminId, dayBeforeMonth,
    ],
  );

  const trips: FixtureTrip[] = [
    { id: activeTripId, status: TRIP_STATUS.ACTIVE, totalCapacity: 10, reservedSeats: 3, createdAt: startOfMonth },
    { id: inactiveTripId, status: "draft", totalCapacity: 99, reservedSeats: 50, createdAt: dayBeforeMonth },
  ];
  for (const [index, trip] of trips.entries()) {
    const isActive = index === 0;
    await pool.query(
      `INSERT INTO trips (
        id, tenant_id, name, slug, destination, destination_city, destination_state,
        type, category, departure_date, total_capacity, available_seats, reserved_seats,
        price_adult, created_by_id, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        trip.id, tenantId, `Summary trip ${index}`, `${trip.id}-slug`, "Praia", "Fortaleza", "CE",
        "excursao", "lazer", startOfMonth.toISOString().slice(0, 10), trip.totalCapacity,
        trip.totalCapacity - trip.reservedSeats, trip.reservedSeats, "100.00", adminId,
        isActive ? TRIP_STATUS.ACTIVE : "draft", trip.createdAt,
      ],
    );
  }

  const reservations: FixtureReservation[] = [
    { id: `dash-summary-res-a1-${suffix}`, tripId: activeTripId, clientId: clientAId, status: RESERVATION_STATUS.CONFIRMED, totalValue: 100, createdAt: startOfToday },
    { id: `dash-summary-res-a2-${suffix}`, tripId: activeTripId, clientId: clientBId, status: RESERVATION_STATUS.PENDING, totalValue: 80, createdAt: dayBeforeToday },
    { id: `dash-summary-res-b1-${suffix}`, tripId: inactiveTripId, clientId: clientBId, status: RESERVATION_STATUS.CONFIRMED, totalValue: 200, createdAt: dayBeforeMonth },
    { id: `dash-summary-res-b2-${suffix}`, tripId: activeTripId, clientId: clientBId, status: RESERVATION_STATUS.CANCELLED, totalValue: 150, createdAt: dayBeforeToday },
    { id: `dash-summary-res-a3-${suffix}`, tripId: inactiveTripId, clientId: clientAId, status: RESERVATION_STATUS.CONFIRMED, totalValue: 300, createdAt: new Date(startOfMonth.getTime() + 86_400_000) },
  ];
  for (const [index, reservation] of reservations.entries()) {
    await pool.query(
      `INSERT INTO reservations (
        id, tenant_id, trip_id, client_id, total_value, balance, status,
        voucher_code, qr_code, created_by_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        reservation.id, tenantId, reservation.tripId, reservation.clientId,
        reservation.totalValue, reservation.totalValue, reservation.status,
        `${reservation.id}-voucher`, `${reservation.id}-qr`,
        index === 0 || index === 4 ? sellerId : adminId,
        reservation.createdAt,
      ],
    );
  }

  const [activeConfirmed, activePending, inactiveConfirmed, activeCancelled] = reservations;
  const payments: FixturePayment[] = Array.from({ length: 400 }, (_, index) => ({
    id: `dash-summary-history-${suffix}-${index}`,
    tenantId,
    reservationId: null,
    clientId: clientAId,
    type: PAYMENT_TYPE.RECEIVABLE,
    status: PAYMENT_STATUS.PAID,
    amount: "1.25",
    paidAt: monthHistoryPaidAt,
    dueDate: monthHistoryPaidAt,
  }));
  payments.push(
    { id: `dash-summary-before-month-${suffix}`, tenantId, reservationId: null, clientId: clientAId, type: PAYMENT_TYPE.RECEIVABLE, status: PAYMENT_STATUS.PAID, amount: "20.00", paidAt: dayBeforeMonth, dueDate: dayBeforeMonth },
    { id: `dash-summary-at-month-start-${suffix}`, tenantId, reservationId: null, clientId: clientAId, type: PAYMENT_TYPE.RECEIVABLE, status: PAYMENT_STATUS.PAID, amount: "10.00", paidAt: startOfMonth, dueDate: startOfMonth },
    { id: `dash-summary-today-${suffix}`, tenantId, reservationId: null, clientId: clientAId, type: PAYMENT_TYPE.RECEIVABLE, status: PAYMENT_STATUS.PAID, amount: "30.00", paidAt: startOfToday, dueDate: startOfToday },
    { id: `dash-summary-client-b-paid-${suffix}`, tenantId, reservationId: null, clientId: clientBId, type: PAYMENT_TYPE.RECEIVABLE, status: PAYMENT_STATUS.PAID, amount: "40.00", paidAt: dayBeforeMonth, dueDate: dayBeforeMonth },
    { id: `dash-summary-active-paid-${suffix}`, tenantId, reservationId: activeConfirmed!.id, clientId: clientAId, type: PAYMENT_TYPE.RECEIVABLE, status: PAYMENT_STATUS.PAID, amount: "120.00", paidAt: startOfMonth, dueDate: startOfMonth },
    { id: `dash-summary-inactive-paid-${suffix}`, tenantId, reservationId: inactiveConfirmed!.id, clientId: clientBId, type: PAYMENT_TYPE.RECEIVABLE, status: PAYMENT_STATUS.PAID, amount: "140.00", paidAt: startOfMonth, dueDate: startOfMonth },
    { id: `dash-summary-cancelled-paid-${suffix}`, tenantId, reservationId: activeCancelled!.id, clientId: clientBId, type: PAYMENT_TYPE.RECEIVABLE, status: PAYMENT_STATUS.PAID, amount: "150.00", paidAt: startOfMonth, dueDate: startOfMonth },
    { id: `dash-summary-active-due-today-${suffix}`, tenantId, reservationId: activeConfirmed!.id, clientId: clientAId, type: PAYMENT_TYPE.RECEIVABLE, status: PAYMENT_STATUS.PENDING, amount: "50.00", paidAt: null, dueDate: startOfToday },
    { id: `dash-summary-active-due-end-${suffix}`, tenantId, reservationId: activePending!.id, clientId: clientBId, type: PAYMENT_TYPE.RECEIVABLE, status: PAYMENT_STATUS.PENDING, amount: "60.00", paidAt: null, dueDate: next3Days },
    { id: `dash-summary-overdue-${suffix}`, tenantId, reservationId: null, clientId: clientAId, type: PAYMENT_TYPE.RECEIVABLE, status: PAYMENT_STATUS.PENDING, amount: "70.00", paidAt: null, dueDate: dayBeforeToday },
    { id: `dash-summary-outside-window-${suffix}`, tenantId, reservationId: null, clientId: clientAId, type: PAYMENT_TYPE.RECEIVABLE, status: PAYMENT_STATUS.PENDING, amount: "80.00", paidAt: null, dueDate: new Date(next3Days.getTime() + 1) },
    { id: `dash-summary-active-pending-${suffix}`, tenantId, reservationId: activePending!.id, clientId: clientBId, type: PAYMENT_TYPE.RECEIVABLE, status: PAYMENT_STATUS.PENDING, amount: "130.00", paidAt: null, dueDate: new Date(startOfToday.getTime() + 2 * 86_400_000) },
    { id: `dash-summary-pending-payable-${suffix}`, tenantId, reservationId: null, clientId: clientAId, type: PAYMENT_TYPE.PAYABLE, status: PAYMENT_STATUS.PENDING, amount: "90.00", paidAt: null, dueDate: new Date(startOfToday.getTime() + 86_400_000) },
    { id: `dash-summary-paid-payable-${suffix}`, tenantId, reservationId: null, clientId: clientAId, type: PAYMENT_TYPE.PAYABLE, status: PAYMENT_STATUS.PAID, amount: "100.00", paidAt: startOfToday, dueDate: startOfToday },
    { id: `dash-summary-cancelled-payment-${suffix}`, tenantId, reservationId: null, clientId: clientAId, type: PAYMENT_TYPE.RECEIVABLE, status: "cancelled", amount: "110.00", paidAt: null, dueDate: startOfToday },
  );

  const allPaymentRows = [
    ...payments.map((payment) => [
      payment.id, tenantId, payment.reservationId, payment.clientId, payment.type,
      "booking", payment.amount, "pix", payment.dueDate, payment.paidAt, payment.status,
    ]),
    [`dash-summary-other-tenant-payment-${suffix}`, otherTenantId, null, null, PAYMENT_TYPE.RECEIVABLE, "booking", "999999.00", "pix", dayBeforeMonth, dayBeforeMonth, PAYMENT_STATUS.PAID],
  ];
  const paymentValues = allPaymentRows.flat();
  const paymentTuples = allPaymentRows.map((_, index) => {
    const offset = index * 11;
    return `(${Array.from({ length: 11 }, (_value, column) => `$${offset + column + 1}`).join(", ")})`;
  });
  await pool.query(
    `INSERT INTO payments (
      id, tenant_id, reservation_id, client_id, type, category, amount,
      payment_method, due_date, paid_at, status
    ) VALUES ${paymentTuples.join(", ")}`,
    paymentValues,
  );

  const npsScores = [9, 6, 7];
  await pool.query(
    `INSERT INTO nps_responses (id, tenant_id, user_id, score, classification)
     VALUES ($1, $2, $3, $4, $5), ($6, $2, $7, $8, $9), ($10, $2, $11, $12, $13)`,
    [
      `dash-summary-nps-1-${suffix}`, tenantId, adminId, npsScores[0], "promoter",
      `dash-summary-nps-2-${suffix}`, sellerId, npsScores[1], "detractor",
      `dash-summary-nps-3-${suffix}`, adminId, npsScores[2], "passive",
    ],
  );

  return {
    tenantId, otherTenantId, sellerId, adminId, clientAId, clientBId,
    startOfMonth, startOfToday, next3Days, trips, reservations, payments, npsScores,
  };
}

function calculateLegacyPaymentTotals(
  payments: FixturePayment[],
  startOfMonth: Date,
  startOfToday: Date,
  next3Days: Date,
  now: Date,
) {
  const paidReceivable = payments.filter((payment) =>
    payment.type === PAYMENT_TYPE.RECEIVABLE && payment.status === PAYMENT_STATUS.PAID,
  );
  const pendingReceivable = payments.filter((payment) =>
    payment.type === PAYMENT_TYPE.RECEIVABLE && payment.status === PAYMENT_STATUS.PENDING,
  );
  const pendingPayments = payments.filter((payment) => payment.status === PAYMENT_STATUS.PENDING);
  const sum = (rows: FixturePayment[]) => rows.reduce((total, payment) => total + Number(payment.amount), 0);

  return {
    totalRevenue: sum(paidReceivable),
    revenueThisMonth: sum(paidReceivable.filter((payment) => payment.paidAt && payment.paidAt >= startOfMonth)),
    receivedToday: sum(paidReceivable.filter((payment) => payment.paidAt && payment.paidAt >= startOfToday)),
    pendingPayments: sum(pendingPayments),
    pendingReceivable: sum(pendingReceivable),
    totalPayable: sum(payments.filter((payment) =>
      payment.type === PAYMENT_TYPE.PAYABLE && payment.status === PAYMENT_STATUS.PENDING,
    )),
    toReceiveNext3Days: sum(pendingReceivable.filter((payment) =>
      payment.dueDate >= startOfToday && payment.dueDate <= next3Days,
    )),
    overduePayments: sum(pendingReceivable.filter((payment) => payment.dueDate < now)),
    overduePaymentsCount: pendingReceivable.filter((payment) => payment.dueDate < now).length,
  };
}

function assertNoHistoryRowsWereSelected(calls: readonly unknown[][]) {
  const projections = calls.map((call) => call[0] as Record<string, unknown> | undefined);
  expect(projections.length).toBeGreaterThan(0);
  expect(projections.every((projection) => projection !== undefined && typeof projection === "object")).toBe(true);

  const selectedKeys = new Set(projections.flatMap((projection) => Object.keys(projection ?? {})));
  for (const rawColumn of ["id", "clientId", "score", "amount", "type", "status", "totalCapacity", "reservedSeats"]) {
    expect(selectedKeys.has(rawColumn)).toBe(false);
  }
}

beforeAll(async () => {
  fixture = await seedFixture();
}, 15_000);

afterAll(async () => {
  vi.restoreAllMocks();
  if (fixture) {
    const tenantIds = [fixture.tenantId, fixture.otherTenantId];
    await pool.query("DELETE FROM nps_responses WHERE tenant_id = ANY($1::text[])", [tenantIds]);
    await pool.query("DELETE FROM payments WHERE tenant_id = ANY($1::text[])", [tenantIds]);
    await pool.query("DELETE FROM reservations WHERE tenant_id = $1", [fixture.tenantId]);
    await pool.query("DELETE FROM trips WHERE tenant_id = $1", [fixture.tenantId]);
    await pool.query("DELETE FROM clients WHERE tenant_id = $1", [fixture.tenantId]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::text[])", [[fixture.adminId, fixture.sellerId]]);
    await pool.query("DELETE FROM tenants WHERE id = ANY($1::text[])", [tenantIds]);
  }
  await pool.end();
}, 15_000);

describe("GET /dashboard/summary aggregate scaling", () => {
  it("preserves dashboard totals for a large history without selecting historical rows", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", dashboardRouter);
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    });

    const selectSpy = vi.spyOn(db, "select");
    requireAuthMock.mockResolvedValue({
      id: fixture.adminId,
      tenantId: fixture.tenantId,
      role: "agency_admin",
    } as never);
    const adminStart = selectSpy.mock.calls.length;
    const adminResponse = await request(app).get("/api/dashboard/summary");
    expect(adminResponse.status).toBe(200);

    const adminBody = adminResponse.body as Record<string, unknown>;
    const adminExpected = calculateLegacyPaymentTotals(
      fixture.payments,
      fixture.startOfMonth,
      fixture.startOfToday,
      fixture.next3Days,
      new Date(),
    );
    const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
    expect(Number(adminBody.totalRevenue)).toBe(money(adminExpected.totalRevenue));
    expect(Number(adminBody.revenueThisMonth)).toBe(money(adminExpected.revenueThisMonth));
    expect(Number(adminBody.receivedToday)).toBe(money(adminExpected.receivedToday));
    expect(Number(adminBody.pendingPayments)).toBe(money(adminExpected.pendingPayments));
    expect(Number(adminBody.totalPayable)).toBe(money(adminExpected.totalPayable));
    expect(Number(adminBody.toReceiveNext3Days)).toBe(money(adminExpected.toReceiveNext3Days));
    expect(Number(adminBody.overduePayments)).toBe(money(adminExpected.overduePayments));
    expect(Number(adminBody.overduePaymentsCount)).toBe(adminExpected.overduePaymentsCount);
    expect(Number(adminBody.totalFaturamento)).toBe(money(adminExpected.totalRevenue + adminExpected.pendingReceivable));

    const activeTripIds = new Set(fixture.trips
      .filter((trip) => trip.status === TRIP_STATUS.ACTIVE)
      .map((trip) => trip.id));
    const activeReservationIds = new Set(fixture.reservations
      .filter((reservation) =>
        activeTripIds.has(reservation.tripId) && ACTIVE_RESERVATION_STATUSES.includes(reservation.status as never),
      )
      .map((reservation) => reservation.id));
    const activeTripPayments = fixture.payments.filter((payment) =>
      payment.reservationId !== null && activeReservationIds.has(payment.reservationId),
    );
    const activeReceived = activeTripPayments
      .filter((payment) => payment.type === PAYMENT_TYPE.RECEIVABLE && payment.status === PAYMENT_STATUS.PAID)
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    const activePending = activeTripPayments
      .filter((payment) => payment.type === PAYMENT_TYPE.RECEIVABLE && payment.status === PAYMENT_STATUS.PENDING)
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    expect(Number(adminBody.receivedFromActiveTrips)).toBe(money(activeReceived));
    expect(Number(adminBody.pendingFromActiveTrips)).toBe(money(activePending));

    const confirmedReservations = fixture.reservations.filter((reservation) =>
      reservation.status === RESERVATION_STATUS.CONFIRMED,
    );
    const repeatBuyerCounts = new Map<string, number>();
    for (const reservation of confirmedReservations) {
      repeatBuyerCounts.set(reservation.clientId, (repeatBuyerCounts.get(reservation.clientId) ?? 0) + 1);
    }
    const repeatBuyerCount = [...repeatBuyerCounts.values()].filter((count) => count >= 2).length;
    const payingClientCount = new Set(fixture.payments
      .filter((payment) => payment.type === PAYMENT_TYPE.RECEIVABLE && payment.status === PAYMENT_STATUS.PAID)
      .map((payment) => payment.clientId)
      .filter((clientId): clientId is string => clientId !== null)).size;
    const activeTrips = fixture.trips.filter((trip) => trip.status === TRIP_STATUS.ACTIVE);
    const totalCapacity = activeTrips.reduce((sum, trip) => sum + trip.totalCapacity, 0);
    const totalReserved = activeTrips.reduce((sum, trip) => sum + trip.reservedSeats, 0);
    const expectedAvgTicket = confirmedReservations.reduce((sum, reservation) => sum + reservation.totalValue, 0)
      / confirmedReservations.length;

    expect(Number(adminBody.totalClients)).toBe(2);
    expect(Number(adminBody.newClientsThisMonth)).toBe(1);
    expect(Number(adminBody.totalTrips)).toBe(2);
    expect(Number(adminBody.activeTrips)).toBe(activeTrips.length);
    expect(Number(adminBody.tripsThisMonth)).toBe(fixture.trips.filter((trip) => trip.createdAt >= fixture.startOfMonth).length);
    expect(Number(adminBody.occupancyRate)).toBe(Math.round((totalReserved / totalCapacity) * 1000) / 10);
    expect(Number(adminBody.totalReservations)).toBe(fixture.reservations.length);
    expect(Number(adminBody.confirmedReservations)).toBe(confirmedReservations.length);
    expect(Number(adminBody.cancelledReservations)).toBe(fixture.reservations.filter((r) => r.status === RESERVATION_STATUS.CANCELLED).length);
    expect(Number(adminBody.reservationsToday)).toBe(fixture.reservations.filter((r) => r.createdAt >= fixture.startOfToday).length);
    expect(Number(adminBody.salesThisMonth)).toBe(confirmedReservations.filter((r) => r.createdAt >= fixture.startOfMonth).length);
    expect(Number(adminBody.pendingReservations)).toBe(fixture.reservations.filter((r) => r.status === RESERVATION_STATUS.PENDING).length);
    expect(Number(adminBody.avgTicket)).toBe(money(expectedAvgTicket));
    expect(Number(adminBody.activeClientsCount)).toBe(new Set(confirmedReservations.map((r) => r.clientId)).size);
    expect(Number(adminBody.avgReservationsPerTrip)).toBe(confirmedReservations.length / activeTrips.length);
    expect(Number(adminBody.retentionRate)).toBe(Math.round((repeatBuyerCount / 2) * 1000) / 10);
    expect(Number(adminBody.conversionRate)).toBe(Math.round((payingClientCount / 2) * 1000) / 10);
    expect(Number(adminBody.averageNps)).toBe(Math.round((fixture.npsScores.reduce((sum, score) => sum + score, 0) / fixture.npsScores.length) * 10) / 10);

    const adminCalls = selectSpy.mock.calls.slice(adminStart);
    assertNoHistoryRowsWereSelected(adminCalls);

    requireAuthMock.mockResolvedValue({
      id: fixture.adminId,
      tenantId: fixture.otherTenantId,
      role: "agency_admin",
    } as never);
    const emptyTenantStart = selectSpy.mock.calls.length;
    const emptyTenantResponse = await request(app).get("/api/dashboard/summary");
    expect(emptyTenantResponse.status).toBe(200);
    const emptyTenantBody = emptyTenantResponse.body as Record<string, unknown>;
    expect(Number(emptyTenantBody.totalClients)).toBe(0);
    expect(Number(emptyTenantBody.totalRevenue)).toBe(999999);
    expect(emptyTenantBody.averageNps).toBeNull();
    expect(emptyTenantBody.avgNps).toBeNull();
    expect(Number(emptyTenantBody.occupancyRate)).toBe(0);
    expect(Number(emptyTenantBody.avgReservationsPerTrip)).toBe(0);
    expect(Number(emptyTenantBody.retentionRate)).toBe(0);
    expect(Number(emptyTenantBody.conversionRate)).toBe(0);
    assertNoHistoryRowsWereSelected(selectSpy.mock.calls.slice(emptyTenantStart));

    requireAuthMock.mockResolvedValue({
      id: fixture.sellerId,
      tenantId: fixture.tenantId,
      role: ROLES.SALES,
    } as never);
    const sellerStart = selectSpy.mock.calls.length;
    const sellerResponse = await request(app).get("/api/dashboard/summary");
    expect(sellerResponse.status).toBe(200);

    const sellerBody = sellerResponse.body as Record<string, unknown>;
    const sellerPayments = fixture.payments.filter((payment) => payment.clientId === fixture.clientAId);
    const sellerExpected = calculateLegacyPaymentTotals(
      sellerPayments,
      fixture.startOfMonth,
      fixture.startOfToday,
      fixture.next3Days,
      new Date(),
    );
    expect(Number(sellerBody.totalClients)).toBe(1);
    expect(Number(sellerBody.newClientsThisMonth)).toBe(1);
    expect(Number(sellerBody.totalRevenue)).toBe(money(sellerExpected.totalRevenue));
    expect(Number(sellerBody.revenueThisMonth)).toBe(money(sellerExpected.revenueThisMonth));
    expect(Number(sellerBody.receivedToday)).toBe(money(sellerExpected.receivedToday));
    expect(Number(sellerBody.pendingPayments)).toBe(money(sellerExpected.pendingPayments));
    expect(Number(sellerBody.totalReservations)).toBe(2);
    expect(Number(sellerBody.confirmedReservations)).toBe(2);
    assertNoHistoryRowsWereSelected(selectSpy.mock.calls.slice(sellerStart));
  });
});