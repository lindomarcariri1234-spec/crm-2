import { Router, type NextFunction } from "express";
import { localToday } from "@workspace/shared";

// Brazil is permanently UTC-3 (no DST since 2019).
// Returns the UTC Date for midnight on the given Brazil calendar date.
function brazilUTC(year: number, month1Based: number, day: number): Date {
  return new Date(Date.UTC(year, month1Based - 1, day, 3, 0, 0, 0));
}
import { db } from "@workspace/db";
import { clientsTable, tripsTable, reservationsTable, paymentsTable, dealsTable, npsResponsesTable, expensesTable, passengersTable, loyaltyMembersTable } from "@workspace/db";
import { eq, and, asc, gte, lte, lt, desc, sql, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/tenant";
import { roundMoney } from "../lib/pricing";
import { ForbiddenError, ValidationError } from "../lib/errors";
import { ROLES, RESERVATION_STATUS, ACTIVE_RESERVATION_STATUSES, PAYMENT_STATUS, PAYMENT_TYPE, DEAL_STATUS, TRIP_STATUS } from "@workspace/permissions";
import { z } from "zod";
import { clientSellerScopeCondition, reservationSellerScopeCondition } from "../lib/seller-scope";
import { rankingMetadata } from "../lib/ranking-contract";

const RevenueChartQuery = z.object({
  period: z.enum(["7d", "30d", "90d", "12m"]).default("30d"),
});

const ChartsQuery = z.object({
  period: z.enum(["3m", "6m", "12m"]).default("12m"),
});

const router = Router();

router.get("/dashboard/summary", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const tenantId = me.tenantId;
    const now = new Date();
    const todayBR = localToday();
    const [brYear, brMonth1, brDay] = todayBR.split("-").map(Number);
    const startOfMonth = brazilUTC(brYear, brMonth1, 1);
    const startOfToday = brazilUTC(brYear, brMonth1, brDay);
    const next3Days = new Date(startOfToday.getTime() + 3 * 86400000);

    if (me.role === ROLES.CLIENT) {
      const [clientRecord] = await db.select({ id: clientsTable.id, totalSpent: clientsTable.totalSpent, outstandingBalance: clientsTable.outstandingBalance, npsScore: clientsTable.npsScore })
        .from(clientsTable)
        .where(and(eq(clientsTable.tenantId, tenantId), eq(clientsTable.userId, me.id)))
        .limit(1);

      const clientId = clientRecord?.id;
      let totalReservations = 0, confirmedReservations = 0;
      if (clientId) {
        const [rc] = await db.select({ count: sql<number>`count(*)` })
          .from(reservationsTable).where(and(eq(reservationsTable.tenantId, tenantId), eq(reservationsTable.clientId, clientId)));
        const [cc] = await db.select({ count: sql<number>`count(*)` })
          .from(reservationsTable).where(and(eq(reservationsTable.tenantId, tenantId), eq(reservationsTable.clientId, clientId), eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED)));
        totalReservations = Number(rc?.count ?? 0);
        confirmedReservations = Number(cc?.count ?? 0);
      }

      res.json({
        totalClients: 1, newClientsThisMonth: 0, totalTrips: 0, activeTrips: 0,
        totalRevenue: Number(clientRecord?.totalSpent ?? 0),
        revenueThisMonth: 0,
        pendingPayments: Number(clientRecord?.outstandingBalance ?? 0),
        totalReservations, confirmedReservations, occupancyRate: 0,
        averageNps: clientRecord?.npsScore ?? null,
        openDeals: 0, dealsPipelineValue: 0,
        receivedToday: 0, toReceiveNext3Days: 0, reservationsToday: 0,
        avgTicket: 0, activeClientsCount: 0, totalExpenses: 0, cancelledReservations: 0,
        receivedFromActiveTrips: 0, pendingFromActiveTrips: 0,
        totalPayable: 0, avgReservationsPerTrip: 0, totalFaturamento: 0,
      });
      return;
    }

    if (me.role === ROLES.SALES) {
      const [clientCount] = await db.select({ count: sql<number>`count(*)` })
        .from(clientsTable).where(and(eq(clientsTable.tenantId, tenantId), clientSellerScopeCondition(me)));
      const [newClientCount] = await db.select({ count: sql<number>`count(*)` })
        .from(clientsTable).where(and(eq(clientsTable.tenantId, tenantId), clientSellerScopeCondition(me), gte(clientsTable.createdAt, startOfMonth)));

      const myClients = await db.select({ id: clientsTable.id }).from(clientsTable)
        .where(and(eq(clientsTable.tenantId, tenantId), clientSellerScopeCondition(me)));
      const myClientIds = myClients.map(c => c.id);

      let totalRevenue = 0, revenueThisMonth = 0, pendingAmount = 0, receivedToday = 0;
      if (myClientIds.length > 0) {
        const payments = await db.select().from(paymentsTable)
          .where(and(eq(paymentsTable.tenantId, tenantId), inArray(paymentsTable.clientId, myClientIds)));
        for (const p of payments) {
          if (p.type === PAYMENT_TYPE.RECEIVABLE && p.status === PAYMENT_STATUS.PAID) {
            totalRevenue += Number(p.amount);
            if (p.paidAt && p.paidAt >= startOfMonth) revenueThisMonth += Number(p.amount);
            if (p.paidAt && p.paidAt >= startOfToday) receivedToday += Number(p.amount);
          }
          if (p.status === PAYMENT_STATUS.PENDING) pendingAmount += Number(p.amount);
        }
      }

      let totalReservations = 0, confirmedReservations = 0, cancelledReservations = 0, reservationsToday = 0;
      let avgTicket = 0, activeClientsCount = 0;
      if (myClientIds.length > 0) {
        const [rc] = await db.select({ count: sql<number>`count(*)` })
          .from(reservationsTable).where(and(eq(reservationsTable.tenantId, tenantId), reservationSellerScopeCondition(me)));
        const [cc] = await db.select({ count: sql<number>`count(*)` })
          .from(reservationsTable).where(and(eq(reservationsTable.tenantId, tenantId), reservationSellerScopeCondition(me), eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED)));
        totalReservations = Number(rc?.count ?? 0);
        confirmedReservations = Number(cc?.count ?? 0);
      }

      const [dealCount] = await db.select({ count: sql<number>`count(*)` })
        .from(dealsTable).where(and(eq(dealsTable.tenantId, tenantId), eq(dealsTable.status, DEAL_STATUS.OPEN), eq(dealsTable.ownerId, me.id)));
      const [dealValue] = await db.select({ total: sql<number>`sum(cast(value as numeric))` })
        .from(dealsTable).where(and(eq(dealsTable.tenantId, tenantId), eq(dealsTable.status, DEAL_STATUS.OPEN), eq(dealsTable.ownerId, me.id)));

      res.json({
        totalClients: Number(clientCount?.count ?? 0),
        newClientsThisMonth: Number(newClientCount?.count ?? 0),
        totalTrips: 0, activeTrips: 0,
        totalRevenue: roundMoney(totalRevenue),
        revenueThisMonth: roundMoney(revenueThisMonth),
        pendingPayments: roundMoney(pendingAmount),
        totalReservations, confirmedReservations, occupancyRate: 0,
        averageNps: null,
        openDeals: Number(dealCount?.count ?? 0),
        dealsPipelineValue: Number(dealValue?.total ?? 0),
        receivedToday, toReceiveNext3Days: 0, reservationsToday, avgTicket,
        activeClientsCount, totalExpenses: 0, cancelledReservations,
        receivedFromActiveTrips: 0, pendingFromActiveTrips: 0,
        totalPayable: 0, avgReservationsPerTrip: 0, totalFaturamento: 0,
      });
      return;
    }

    // Admin / owner role
    const [clientCount] = await db.select({ count: sql<number>`count(*)` })
      .from(clientsTable).where(eq(clientsTable.tenantId, tenantId));
    const [newClientCount] = await db.select({ count: sql<number>`count(*)` })
      .from(clientsTable).where(and(eq(clientsTable.tenantId, tenantId), gte(clientsTable.createdAt, startOfMonth)));

    const [tripCount] = await db.select({ count: sql<number>`count(*)` })
      .from(tripsTable).where(eq(tripsTable.tenantId, tenantId));
    const [activeTripCount] = await db.select({ count: sql<number>`count(*)` })
      .from(tripsTable).where(and(eq(tripsTable.tenantId, tenantId), eq(tripsTable.status, TRIP_STATUS.ACTIVE)));

    const [reservationCount] = await db.select({ count: sql<number>`count(*)` })
      .from(reservationsTable).where(eq(reservationsTable.tenantId, tenantId));
    const [confirmedReservationCount] = await db.select({ count: sql<number>`count(*)` })
      .from(reservationsTable).where(and(eq(reservationsTable.tenantId, tenantId), eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED)));
    const [cancelledReservationCount] = await db.select({ count: sql<number>`count(*)` })
      .from(reservationsTable).where(and(eq(reservationsTable.tenantId, tenantId), eq(reservationsTable.status, RESERVATION_STATUS.CANCELLED)));
    const [todayReservationCount] = await db.select({ count: sql<number>`count(*)` })
      .from(reservationsTable).where(and(eq(reservationsTable.tenantId, tenantId), gte(reservationsTable.createdAt, startOfToday)));

    const [avgTicketRow] = await db.select({ avg: sql<number>`avg(cast(total_value as numeric))` })
      .from(reservationsTable).where(and(eq(reservationsTable.tenantId, tenantId), eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED)));
    const [activeClientsRow] = await db.select({ count: sql<number>`count(distinct client_id)` })
      .from(reservationsTable).where(and(eq(reservationsTable.tenantId, tenantId), eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED)));

    const payments = await db.select().from(paymentsTable).where(eq(paymentsTable.tenantId, tenantId));
    let totalRevenue = 0, revenueThisMonth = 0, pendingPaymentsAmt = 0, receivedToday = 0, toReceiveNext3Days = 0, totalPayable = 0, pendingReceivableAmt = 0;
    for (const p of payments) {
      if (p.type === PAYMENT_TYPE.RECEIVABLE && p.status === PAYMENT_STATUS.PAID) {
        totalRevenue += Number(p.amount);
        if (p.paidAt && p.paidAt >= startOfMonth) revenueThisMonth += Number(p.amount);
        if (p.paidAt && p.paidAt >= startOfToday) receivedToday += Number(p.amount);
      }
      if (p.type === PAYMENT_TYPE.RECEIVABLE && p.status === PAYMENT_STATUS.PENDING) {
        pendingReceivableAmt += Number(p.amount);
        if (p.dueDate && p.dueDate >= startOfToday && p.dueDate <= next3Days) {
          toReceiveNext3Days += Number(p.amount);
        }
      }
      if (p.type === PAYMENT_TYPE.PAYABLE && p.status === PAYMENT_STATUS.PENDING) totalPayable += Number(p.amount);
      if (p.status === PAYMENT_STATUS.PENDING) pendingPaymentsAmt += Number(p.amount);
    }
    const totalFaturamento = totalRevenue + pendingReceivableAmt;

    const [totalExpensesRow] = await db.select({ total: sql<number>`sum(cast(amount as numeric))` })
      .from(expensesTable).where(eq(expensesTable.tenantId, tenantId));

    // receivedFromActiveTrips and pendingFromActiveTrips
    const activeTrips = await db.select({ id: tripsTable.id })
      .from(tripsTable).where(and(eq(tripsTable.tenantId, tenantId), eq(tripsTable.status, TRIP_STATUS.ACTIVE)));
    const activeTripIds = activeTrips.map(t => t.id);
    let receivedFromActiveTrips = 0, pendingFromActiveTrips = 0;
    if (activeTripIds.length > 0) {
      const activeResIds = (await db.select({ id: reservationsTable.id })
        .from(reservationsTable)
        .where(and(
          eq(reservationsTable.tenantId, tenantId),
          inArray(reservationsTable.tripId, activeTripIds),
          inArray(reservationsTable.status, ACTIVE_RESERVATION_STATUSES),
        )))
        .map(r => r.id);
      if (activeResIds.length > 0) {
        const activePayments = await db.select({ amount: paymentsTable.amount, type: paymentsTable.type, status: paymentsTable.status })
          .from(paymentsTable)
          .where(and(eq(paymentsTable.tenantId, tenantId), inArray(paymentsTable.reservationId, activeResIds)));
        for (const p of activePayments) {
          if (p.type === PAYMENT_TYPE.RECEIVABLE && p.status === PAYMENT_STATUS.PAID) receivedFromActiveTrips += Number(p.amount);
          if (p.type === PAYMENT_TYPE.RECEIVABLE && p.status === PAYMENT_STATUS.PENDING) pendingFromActiveTrips += Number(p.amount);
        }
      }
    }

    const trips = await db.select({ totalCapacity: tripsTable.totalCapacity, reservedSeats: tripsTable.reservedSeats })
      .from(tripsTable).where(and(eq(tripsTable.tenantId, tenantId), eq(tripsTable.status, TRIP_STATUS.ACTIVE)));
    const totalCapacity = trips.reduce((a, t) => a + t.totalCapacity, 0);
    const totalReserved = trips.reduce((a, t) => a + t.reservedSeats, 0);
    const occupancyRate = totalCapacity > 0 ? (totalReserved / totalCapacity) * 100 : 0;

    const npsResponses = await db.select({ score: npsResponsesTable.score })
      .from(npsResponsesTable).where(eq(npsResponsesTable.tenantId, tenantId));
    const averageNps = npsResponses.length > 0 ? npsResponses.reduce((a, r) => a + r.score, 0) / npsResponses.length : null;

    const [dealCount] = await db.select({ count: sql<number>`count(*)` })
      .from(dealsTable).where(and(eq(dealsTable.tenantId, tenantId), eq(dealsTable.status, DEAL_STATUS.OPEN)));
    const [dealValue] = await db.select({ total: sql<number>`sum(cast(value as numeric))` })
      .from(dealsTable).where(and(eq(dealsTable.tenantId, tenantId), eq(dealsTable.status, DEAL_STATUS.OPEN)));

    // New KPIs
    const [salesThisMonthRow] = await db.select({ count: sql<number>`count(*)` })
      .from(reservationsTable).where(and(eq(reservationsTable.tenantId, tenantId), eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED), gte(reservationsTable.createdAt, startOfMonth)));
    const [pendingReservationsRow] = await db.select({ count: sql<number>`count(*)` })
      .from(reservationsTable).where(and(eq(reservationsTable.tenantId, tenantId), eq(reservationsTable.status, RESERVATION_STATUS.PENDING)));
    const [overduePaymentsRow] = await db.select({
      count: sql<number>`count(*)`,
      amount: sql<number>`coalesce(sum(cast(${paymentsTable.amount} as numeric)), 0)`,
    }).from(paymentsTable).where(and(eq(paymentsTable.tenantId, tenantId), eq(paymentsTable.type, PAYMENT_TYPE.RECEIVABLE), eq(paymentsTable.status, PAYMENT_STATUS.PENDING), lt(paymentsTable.dueDate, now)));
    const [loyaltyPointsRow] = await db.select({ total: sql<number>`sum(total_points)` })
      .from(loyaltyMembersTable).where(eq(loyaltyMembersTable.tenantId, tenantId));

    // Retention rate: clients with 2+ confirmed reservations / total clients
    const repeatBuyersRaw = await db.select({ clientId: reservationsTable.clientId, count: sql<number>`count(*)` })
      .from(reservationsTable)
      .where(and(eq(reservationsTable.tenantId, tenantId), eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED)))
      .groupBy(reservationsTable.clientId)
      .having(sql`count(*) >= 2`);
    const totalClientsForRetention = Number(clientCount?.count ?? 0);
    const retentionRate = totalClientsForRetention > 0 ? Math.round((repeatBuyersRaw.length / totalClientsForRetention) * 1000) / 10 : 0;

    // Trips this month
    const [tripsThisMonthRow] = await db.select({ count: sql<number>`count(*)` })
      .from(tripsTable).where(and(eq(tripsTable.tenantId, tenantId), gte(tripsTable.createdAt, startOfMonth)));

    // Conversion rate: paying clients / total clients
    const payingClientsRaw = await db.select({ clientId: paymentsTable.clientId })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.tenantId, tenantId), eq(paymentsTable.type, PAYMENT_TYPE.RECEIVABLE), eq(paymentsTable.status, PAYMENT_STATUS.PAID)));
    const payingClientCount = new Set(payingClientsRaw.map(p => p.clientId).filter(Boolean)).size;
    const conversionRate = totalClientsForRetention > 0 ? Math.round((payingClientCount / totalClientsForRetention) * 1000) / 10 : 0;

    // Computed summary values
    const profit = totalRevenue - Number(totalExpensesRow?.total ?? 0);
    const profitMargin = totalRevenue > 0 ? Math.round((profit / totalRevenue) * 1000) / 10 : 0;

    res.json({
      totalClients: Number(clientCount?.count ?? 0),
      newClientsThisMonth: Number(newClientCount?.count ?? 0),
      totalTrips: Number(tripCount?.count ?? 0),
      activeTrips: Number(activeTripCount?.count ?? 0),
      totalRevenue: roundMoney(totalRevenue),
      revenueThisMonth: roundMoney(revenueThisMonth),
      pendingPayments: roundMoney(pendingPaymentsAmt),
      totalReservations: Number(reservationCount?.count ?? 0),
      confirmedReservations: Number(confirmedReservationCount?.count ?? 0),
      occupancyRate: Math.round(occupancyRate * 10) / 10,
      averageNps: averageNps !== null ? Math.round(averageNps * 10) / 10 : null,
      avgNps: averageNps !== null ? Math.round(averageNps * 10) / 10 : null,
      openDeals: Number(dealCount?.count ?? 0),
      dealsPipelineValue: Number(dealValue?.total ?? 0),
      pipelineLeads: Number(dealCount?.count ?? 0),
      receivedToday: roundMoney(receivedToday),
      toReceiveNext3Days: roundMoney(toReceiveNext3Days),
      reservationsToday: Number(todayReservationCount?.count ?? 0),
      avgTicket: roundMoney(Number(avgTicketRow?.avg ?? 0)),
      activeClientsCount: Number(activeClientsRow?.count ?? 0),
      totalExpenses: roundMoney(Number(totalExpensesRow?.total ?? 0)),
      cancelledReservations: Number(cancelledReservationCount?.count ?? 0),
      receivedFromActiveTrips: roundMoney(receivedFromActiveTrips),
      pendingFromActiveTrips: roundMoney(pendingFromActiveTrips),
      totalPayable: roundMoney(totalPayable),
      avgReservationsPerTrip: Number(activeTripCount?.count ?? 0) > 0
        ? Math.round((Number(confirmedReservationCount?.count ?? 0) / Number(activeTripCount?.count ?? 1)) * 10) / 10
        : 0,
      totalFaturamento: roundMoney(totalFaturamento),
      salesThisMonth: Number(salesThisMonthRow?.count ?? 0),
      pendingReservations: Number(pendingReservationsRow?.count ?? 0),
      overduePaymentsCount: Number(overduePaymentsRow?.count ?? 0),
      overduePayments: roundMoney(Number(overduePaymentsRow?.amount ?? 0)),
      loyaltyPointsIssued: Number(loyaltyPointsRow?.total ?? 0),
      retentionRate,
      tripsThisMonth: Number(tripsThisMonthRow?.count ?? 0),
      conversionRate,
      profit: roundMoney(profit),
      profitMargin,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/revenue-chart", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (me.role === ROLES.CLIENT) {
      next(new ForbiddenError("Access denied", "FORBIDDEN_ROLE"));
      return;
    }

    const queryResult = RevenueChartQuery.safeParse(req.query);
    if (!queryResult.success) {
      next(new ValidationError(queryResult.error.errors[0]?.message ?? "Invalid query params", "VALIDATION_ERROR"));
      return;
    }
    const { period } = queryResult.data;
    const now = new Date();
    const points: Array<{ label: string; revenue: number; expenses: number; reservations: number }> = [];

    let daysBack = 30;
    if (period === "7d") daysBack = 7;
    else if (period === "90d") daysBack = 90;
    else if (period === "12m") daysBack = 365;

    const since = new Date(now.getTime() - daysBack * 86400000);

    let paymentConditions = and(eq(paymentsTable.tenantId, me.tenantId), gte(paymentsTable.createdAt, since))!;
    let reservationConditions = and(eq(reservationsTable.tenantId, me.tenantId), gte(reservationsTable.createdAt, since))!;

    if (me.role === ROLES.SALES) {
      const scopedClients = await db.select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(eq(clientsTable.tenantId, me.tenantId), clientSellerScopeCondition(me)));
      const scopedClientIds = scopedClients.map(client => client.id);
      paymentConditions = scopedClientIds.length > 0
        ? and(eq(paymentsTable.tenantId, me.tenantId), gte(paymentsTable.createdAt, since), inArray(paymentsTable.clientId, scopedClientIds))!
        : and(eq(paymentsTable.tenantId, me.tenantId), sql`false`)!;
      reservationConditions = and(
        eq(reservationsTable.tenantId, me.tenantId),
        gte(reservationsTable.createdAt, since),
        reservationSellerScopeCondition(me),
      )!;
    }

    const payments = await db.select().from(paymentsTable).where(paymentConditions);
    const reservations = await db.select().from(reservationsTable).where(reservationConditions);

    const numPoints = period === "12m" ? 12 : Math.min(daysBack, 12);

    for (let i = numPoints - 1; i >= 0; i--) {
      let label: string;
      let startDate: Date;
      let endDate: Date;

      if (period === "12m") {
        // Use Brazil calendar month so chart never shows the wrong month at 21h-midnight BRT
        const _todayBRChart = localToday();
        const [_cy, _cm1] = _todayBRChart.split("-").map(Number);
        const d = new Date(_cy, _cm1 - 1 - i, 1); // JS handles month underflow
        startDate = brazilUTC(d.getFullYear(), d.getMonth() + 1, 1);
        endDate = new Date(brazilUTC(d.getFullYear(), d.getMonth() + 2, 1).getTime() - 1);
        label = d.toLocaleString("pt-BR", { month: "short" });
      } else {
        const dayAgo = Math.floor(i * daysBack / numPoints);
        startDate = new Date(now.getTime() - (dayAgo + Math.floor(daysBack / numPoints)) * 86400000);
        endDate = new Date(now.getTime() - dayAgo * 86400000);
        label = startDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
      }

      const revenue = payments
        .filter(p => p.type === PAYMENT_TYPE.RECEIVABLE && p.status === PAYMENT_STATUS.PAID && p.paidAt && p.paidAt >= startDate && p.paidAt <= endDate)
        .reduce((a, p) => a + Number(p.amount), 0);

      const expenses = payments
        .filter(p => p.type === PAYMENT_TYPE.PAYABLE && p.status === PAYMENT_STATUS.PAID && p.paidAt && p.paidAt >= startDate && p.paidAt <= endDate)
        .reduce((a, p) => a + Number(p.amount), 0);

      const res_count = reservations
        .filter(r => r.createdAt >= startDate && r.createdAt <= endDate).length;

      points.push({ label, revenue: roundMoney(revenue), expenses: roundMoney(expenses), reservations: res_count });
    }

    res.json(points);
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/charts", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (me.role === ROLES.CLIENT || me.role === ROLES.SALES) {
      next(new ForbiddenError("Access denied", "FORBIDDEN_ROLE"));
      return;
    }

    const tenantId = me.tenantId;
    const now = new Date();

    // Period filter support (default 12m)
    const chartsQueryResult = ChartsQuery.safeParse(req.query);
    if (!chartsQueryResult.success) {
      next(new ValidationError(chartsQueryResult.error.errors[0]?.message ?? "Invalid query params", "VALIDATION_ERROR"));
      return;
    }
    const { period } = chartsQueryResult.data;
    const monthCount = period === "3m" ? 3 : period === "6m" ? 6 : 12;
    const _todayBRCharts = localToday();
    const [_chartsYear, _chartsMonth1] = _todayBRCharts.split("-").map(Number);
    const since = brazilUTC(_chartsYear, _chartsMonth1 - (monthCount - 1), 1);

    // Helper: build YYYY-MM key from a Date
    const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    // Helper: build label array for selected period using Brazil calendar month
    const months12 = Array.from({ length: monthCount }, (_, i) => {
      const d = new Date(_chartsYear, _chartsMonth1 - 1 - (monthCount - 1 - i), 1);
      return { d, key: monthKey(d), label: d.toLocaleString("pt-BR", { month: "short" }) };
    });

    // 1. TOP DESTINATIONS — SQL JOIN + GROUP BY (confirmed only, top 10)
    const topDestinationsRaw = await db.select({
      name: sql<string>`COALESCE(${tripsTable.destinationCity}, ${tripsTable.destination})`,
      count: sql<number>`count(${reservationsTable.id})::int`,
    }).from(tripsTable)
      .innerJoin(reservationsTable, and(
        eq(reservationsTable.tripId, tripsTable.id),
        eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED),
        eq(reservationsTable.tenantId, tenantId),
      ))
      .where(eq(tripsTable.tenantId, tenantId))
      .groupBy(sql`COALESCE(${tripsTable.destinationCity}, ${tripsTable.destination})`)
      .orderBy(desc(sql`count(${reservationsTable.id})`))
      .limit(10);
    const topDestinations = topDestinationsRaw.map(r => ({ name: r.name, count: Number(r.count) }));

    // 2. TRIPS BY MONTH — SQL GROUP BY
    const tripsByMonthRaw = await db.select({
      monthStart: sql<string>`to_char(${tripsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
    }).from(tripsTable)
      .where(and(eq(tripsTable.tenantId, tenantId), gte(tripsTable.createdAt, since)))
      .groupBy(sql`to_char(${tripsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`)
      .orderBy(sql`to_char(${tripsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`);
    const tripsByMonthMap = new Map(tripsByMonthRaw.map(r => [r.monthStart, Number(r.count)]));
    const tripsByMonth = months12.map(({ key, label }) => ({ label, count: tripsByMonthMap.get(key) ?? 0 }));

    // 3. RESERVATIONS BY MONTH — SQL GROUP BY
    const resByMonthRaw = await db.select({
      monthStart: sql<string>`to_char(${reservationsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
      cancelled: sql<number>`sum(case when ${reservationsTable.status} = ${RESERVATION_STATUS.CANCELLED} then 1 else 0 end)::int`,
    }).from(reservationsTable)
      .where(and(eq(reservationsTable.tenantId, tenantId), gte(reservationsTable.createdAt, since)))
      .groupBy(sql`to_char(${reservationsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`)
      .orderBy(sql`to_char(${reservationsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`);
    const resByMonthMap = new Map(resByMonthRaw.map(r => [
      r.monthStart.substring(0, 7), { count: Number(r.count), cancelled: Number(r.cancelled) },
    ]));
    const reservationsByMonth = months12.map(({ key, label }) => {
      const v = resByMonthMap.get(key) ?? { count: 0, cancelled: 0 };
      return { label, count: v.count, cancelled: v.cancelled };
    });

    // 4. RESERVATIONS BY STATUS — SQL GROUP BY
    const resByStatusRaw = await db.select({
      status: reservationsTable.status,
      count: sql<number>`count(*)::int`,
    }).from(reservationsTable)
      .where(eq(reservationsTable.tenantId, tenantId))
      .groupBy(reservationsTable.status);
    const reservationsByStatus = resByStatusRaw.map(r => ({ status: r.status, count: Number(r.count) }));

    // 5. CANCELLATION RATES (computed from SQL aggregates)
    const totalRes = reservationsByStatus.reduce((a, r) => a + r.count, 0);
    const cancelledRes = reservationsByStatus.find(r => r.status === RESERVATION_STATUS.CANCELLED)?.count ?? 0;
    const cancellationRate = totalRes > 0 ? Math.round((cancelledRes / totalRes) * 1000) / 10 : 0;

    const tripsByStatusRaw = await db.select({
      status: tripsTable.status,
      count: sql<number>`count(*)::int`,
    }).from(tripsTable)
      .where(eq(tripsTable.tenantId, tenantId))
      .groupBy(tripsTable.status);
    const totalTripsAll = tripsByStatusRaw.reduce((a, r) => a + Number(r.count), 0);
    const cancelledTripsCount = Number(tripsByStatusRaw.find(r => r.status === TRIP_STATUS.CANCELLED)?.count ?? 0);
    const tripCancellationRate = totalTripsAll > 0 ? Math.round((cancelledTripsCount / totalTripsAll) * 1000) / 10 : 0;

    // 6. AVG RESERVATIONS PER ACTIVE TRIP
    const [activeTripsCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(tripsTable).where(and(eq(tripsTable.tenantId, tenantId), eq(tripsTable.status, TRIP_STATUS.ACTIVE)));
    const confirmedResCount = reservationsByStatus.find(r => r.status === RESERVATION_STATUS.CONFIRMED)?.count ?? 0;
    const activeCount = Number(activeTripsCount?.count ?? 0);
    const avgReservationsPerTrip = activeCount > 0 ? Math.round((confirmedResCount / activeCount) * 10) / 10 : 0;

    // 7. ORIGIN BREAKDOWN — SQL GROUP BY
    const originBreakdownRaw = await db.select({
      name: sql<string>`COALESCE(${clientsTable.origin}, 'Outros')`,
      count: sql<number>`count(*)::int`,
    }).from(clientsTable)
      .where(eq(clientsTable.tenantId, tenantId))
      .groupBy(sql`COALESCE(${clientsTable.origin}, 'Outros')`)
      .orderBy(desc(sql`count(*)`))
      .limit(8);
    const originBreakdown = originBreakdownRaw.map(r => ({ name: r.name, count: Number(r.count) }));

    // 8. REVENUE & EXPENSES BY MONTH — SQL GROUP BY (Brazil timezone to avoid wrong-month at 21h-midnight BRT)
    const revenueExpRaw = await db.select({
      monthStart: sql<string>`to_char(${paymentsTable.paidAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`,
      revenue: sql<string>`sum(case when ${paymentsTable.type} = ${PAYMENT_TYPE.RECEIVABLE} and ${paymentsTable.status} = ${PAYMENT_STATUS.PAID} then cast(${paymentsTable.amount} as numeric) else 0 end)`,
      expenses: sql<string>`sum(case when ${paymentsTable.type} = ${PAYMENT_TYPE.PAYABLE} and ${paymentsTable.status} = ${PAYMENT_STATUS.PAID} then cast(${paymentsTable.amount} as numeric) else 0 end)`,
    }).from(paymentsTable)
      .where(and(
        eq(paymentsTable.tenantId, tenantId),
        sql`${paymentsTable.paidAt} IS NOT NULL`,
        gte(paymentsTable.paidAt, since),
      ))
      .groupBy(sql`to_char(${paymentsTable.paidAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`)
      .orderBy(sql`to_char(${paymentsTable.paidAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`);
    const revenueExpMap = new Map(revenueExpRaw.map(r => [
      r.monthStart,
      { revenue: roundMoney(Number(r.revenue ?? 0)), expenses: roundMoney(Number(r.expenses ?? 0)) },
    ]));
    const revenueByMonth = months12.map(({ key, label }) => ({ label, value: revenueExpMap.get(key)?.revenue ?? 0 }));
    const expensesByMonth = months12.map(({ key, label }) => ({ label, value: revenueExpMap.get(key)?.expenses ?? 0 }));

    // 9. PASSENGERS BY MONTH — SQL GROUP BY
    const passByMonthRaw = await db.select({
      monthStart: sql<string>`to_char(${passengersTable.checkedInAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
    }).from(passengersTable)
      .innerJoin(reservationsTable, eq(passengersTable.reservationId, reservationsTable.id))
      .where(and(
        eq(reservationsTable.tenantId, tenantId),
        sql`${passengersTable.checkedInAt} IS NOT NULL`,
        gte(passengersTable.checkedInAt, since),
      ))
      .groupBy(sql`to_char(${passengersTable.checkedInAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`)
      .orderBy(sql`to_char(${passengersTable.checkedInAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`);
    const passByMonthMap = new Map(passByMonthRaw.map(r => [r.monthStart, Number(r.count)]));
    const passengersByMonth = months12.map(({ key, label }) => ({ label, count: passByMonthMap.get(key) ?? 0 }));

    // 10. TOP BOARDING POINTS — SQL GROUP BY + name resolution from JSON
    const boardingCountRaw = await db.execute(sql`
      SELECT p.boarding_location_id, count(*)::int as count
      FROM passengers p
      JOIN reservations r ON p.reservation_id = r.id
      WHERE r.tenant_id = ${tenantId} AND p.boarding_location_id IS NOT NULL
      GROUP BY p.boarding_location_id
      ORDER BY count DESC
      LIMIT 10
    `);
    const tripsWithBoarding = await db.select({ boardingPoints: tripsTable.boardingPoints })
      .from(tripsTable).where(eq(tripsTable.tenantId, tenantId));
    const boardingNameMap: Record<string, string> = {};
    for (const t of tripsWithBoarding) {
      for (const bp of (t.boardingPoints ?? [])) {
        if (bp.id && bp.name) boardingNameMap[bp.id] = bp.name;
      }
    }
    const topBoardingPoints = (boardingCountRaw.rows as Array<{ boarding_location_id: string; count: number }>)
      .map(r => ({ name: boardingNameMap[r.boarding_location_id] ?? r.boarding_location_id, count: Number(r.count) }));

    // 11. AVG TICKET BY MONTH — SQL GROUP BY
    const avgTicketRaw = await db.select({
      monthStart: sql<string>`to_char(${reservationsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`,
      value: sql<string>`avg(cast(${reservationsTable.totalValue} as numeric))`,
    }).from(reservationsTable)
      .where(and(
        eq(reservationsTable.tenantId, tenantId),
        eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED),
        gte(reservationsTable.createdAt, since),
      ))
      .groupBy(sql`to_char(${reservationsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`)
      .orderBy(sql`to_char(${reservationsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`);
    const avgTicketMap = new Map(avgTicketRaw.map(r => [r.monthStart, Math.round(Number(r.value ?? 0))]));
    const avgTicketByMonth = months12.map(({ key, label }) => ({ label, value: avgTicketMap.get(key) ?? 0 }));

    res.json({
      topDestinations,
      tripsByMonth,
      reservationsByMonth,
      reservationsByStatus,
      cancellationRate,
      tripCancellationRate,
      avgReservationsPerTrip,
      passengersByMonth,
      topBoardingPoints,
      avgTicketByMonth,
      originBreakdown,
      revenueByMonth,
      expensesByMonth,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/funnel", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (me.role === ROLES.CLIENT || me.role === ROLES.SALES) {
      next(new ForbiddenError("Access denied", "FORBIDDEN_ROLE"));
      return;
    }

    const tenantId = me.tenantId;

    const allClients = await db.select({ id: clientsTable.id, origin: clientsTable.origin })
      .from(clientsTable).where(eq(clientsTable.tenantId, tenantId));

    const allReservations = await db.select({ clientId: reservationsTable.clientId, status: reservationsTable.status })
      .from(reservationsTable).where(eq(reservationsTable.tenantId, tenantId));

    const clientPaidPayments = await db.select({ clientId: paymentsTable.clientId, amount: paymentsTable.amount })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.tenantId, tenantId), eq(paymentsTable.status, PAYMENT_STATUS.PAID), eq(paymentsTable.type, PAYMENT_TYPE.RECEIVABLE)));

    const paidClientIds = new Set(clientPaidPayments.map(p => p.clientId).filter(Boolean) as string[]);
    const clientPaidAmount: Record<string, number> = {};
    for (const p of clientPaidPayments) {
      if (p.clientId) clientPaidAmount[p.clientId] = (clientPaidAmount[p.clientId] ?? 0) + Number(p.amount);
    }

    const clientsWithReservation = new Set(allReservations.map(r => r.clientId));
    const clientsWithConfirmed = new Set(allReservations.filter(r => r.status === RESERVATION_STATUS.CONFIRMED).map(r => r.clientId));

    const totalLeads = allClients.length;
    const withReservation = allClients.filter(c => clientsWithReservation.has(c.id)).length;
    const withConfirmed = allClients.filter(c => clientsWithConfirmed.has(c.id)).length;
    const withPayment = allClients.filter(c => paidClientIds.has(c.id)).length;
    const conversionRate = totalLeads > 0 ? Math.round((withPayment / totalLeads) * 1000) / 10 : 0;

    // By origin with conversion percentages and avg ticket
    const originMap: Record<string, { totalLeads: number; withReservation: number; withConfirmed: number; withPayment: number }> = {};
    for (const c of allClients) {
      const origin = c.origin ?? "Outros";
      if (!originMap[origin]) originMap[origin] = { totalLeads: 0, withReservation: 0, withConfirmed: 0, withPayment: 0 };
      originMap[origin].totalLeads++;
      if (clientsWithReservation.has(c.id)) originMap[origin].withReservation++;
      if (clientsWithConfirmed.has(c.id)) originMap[origin].withConfirmed++;
      if (paidClientIds.has(c.id)) originMap[origin].withPayment++;
    }

    const byOrigin = Object.entries(originMap)
      .sort((a, b) => b[1].totalLeads - a[1].totalLeads)
      .slice(0, 8)
      .map(([origin, data]) => {
        const originClients = allClients.filter(c => (c.origin ?? "Outros") === origin);
        const payersForOrigin = originClients.filter(c => paidClientIds.has(c.id));
        const totalPaid = payersForOrigin.reduce((a, c) => a + (clientPaidAmount[c.id] ?? 0), 0);
        const avgTicket = payersForOrigin.length > 0 ? roundMoney(totalPaid / payersForOrigin.length) : 0;
        const conversionPct = data.totalLeads > 0 ? Math.round((data.withPayment / data.totalLeads) * 1000) / 10 : 0;
        return { origin, ...data, avgTicket, conversionPct };
      });

    res.json({ totalLeads, withReservation, withConfirmed, withPayment, conversionRate, byOrigin });
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/upcoming-trips", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const now = new Date();

    let trips;

    if (me.role === ROLES.CLIENT) {
      const [clientRecord] = await db.select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(eq(clientsTable.tenantId, me.tenantId), eq(clientsTable.userId, me.id)))
        .limit(1);

      if (!clientRecord) {
        res.json([]);
        return;
      }

      const reservations = await db.select({ tripId: reservationsTable.tripId })
        .from(reservationsTable)
        .where(and(
          eq(reservationsTable.tenantId, me.tenantId),
          eq(reservationsTable.clientId, clientRecord.id),
        ));

      const tripIds = reservations.map(r => r.tripId).filter(Boolean) as string[];
      if (tripIds.length === 0) {
        res.json([]);
        return;
      }

      trips = await db.select().from(tripsTable)
        .where(and(
          eq(tripsTable.tenantId, me.tenantId),
          gte(tripsTable.departureDate, now),
          inArray(tripsTable.id, tripIds),
        ))
        .orderBy(tripsTable.departureDate).limit(5);
    } else {
      trips = await db.select().from(tripsTable)
        .where(and(eq(tripsTable.tenantId, me.tenantId), gte(tripsTable.departureDate, now)))
        .orderBy(tripsTable.departureDate).limit(5);
    }

    res.json(trips.map(t => ({
      id: t.id, name: t.name, destination: t.destination,
      departureDate: t.departureDate.toISOString(),
      availableSeats: t.availableSeats, totalCapacity: t.totalCapacity,
      status: t.status, coverImage: t.coverImage,
    })));
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/recent-activity", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    if (me.role === ROLES.CLIENT) {
      next(new ForbiddenError("Access denied", "FORBIDDEN_ROLE"));
      return;
    }

    let clientCondition = eq(clientsTable.tenantId, me.tenantId);
    let reservationCondition = eq(reservationsTable.tenantId, me.tenantId);

    if (me.role === ROLES.SALES) {
      clientCondition = and(eq(clientsTable.tenantId, me.tenantId), clientSellerScopeCondition(me))!;
      reservationCondition = and(eq(reservationsTable.tenantId, me.tenantId), reservationSellerScopeCondition(me))!;
    }

    const recentClients = await db.select().from(clientsTable)
      .where(clientCondition).orderBy(desc(clientsTable.createdAt)).limit(3);
    const recentReservations = await db.select().from(reservationsTable)
      .where(reservationCondition).orderBy(desc(reservationsTable.createdAt)).limit(3);
    const recentTrips = me.role === ROLES.SALES ? [] : await db.select().from(tripsTable)
      .where(eq(tripsTable.tenantId, me.tenantId)).orderBy(desc(tripsTable.createdAt)).limit(2);

    const activities = [
      ...recentClients.map(c => ({
        id: `client-${c.id}`, type: "client_created",
        description: `Novo cliente cadastrado: ${c.name}`,
        createdAt: c.createdAt.toISOString(), entityId: c.id, entityType: "client",
      })),
      ...recentReservations.map(r => ({
        id: `reservation-${r.id}`, type: "reservation_created",
        description: `Nova reserva criada (${r.voucherCode})`,
        createdAt: r.createdAt.toISOString(), entityId: r.id, entityType: "reservation",
      })),
      ...recentTrips.map(t => ({
        id: `trip-${t.id}`, type: "trip_created",
        description: `Viagem criada: ${t.name}`,
        createdAt: t.createdAt.toISOString(), entityId: t.id, entityType: "trip",
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8);

    res.json(activities);
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/comparative", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role === ROLES.CLIENT || me.role === ROLES.SALES) {
      next(new ForbiddenError("Access denied", "FORBIDDEN_ROLE"));
      return;
    }

    const tenantId = me.tenantId;
    const now = new Date();
    const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    const _todayBRLoyalty = localToday();
    const [_loyaltyYear, _loyaltyMonth1] = _todayBRLoyalty.split("-").map(Number);
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(_loyaltyYear, _loyaltyMonth1 - 1 - (11 - i), 1);
      return { d, key: monthKey(d), label: d.toLocaleString("pt-BR", { month: "short", year: "2-digit" }) };
    });

    const since = brazilUTC(months[0].d.getFullYear(), months[0].d.getMonth() + 1, 1);

    const revenueExpRaw = await db.select({
      monthStart: sql<string>`to_char(${paymentsTable.paidAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`,
      revenue: sql<string>`sum(case when ${paymentsTable.type} = ${PAYMENT_TYPE.RECEIVABLE} and ${paymentsTable.status} = ${PAYMENT_STATUS.PAID} then cast(${paymentsTable.amount} as numeric) else 0 end)`,
      expenses: sql<string>`sum(case when ${paymentsTable.type} = ${PAYMENT_TYPE.PAYABLE} and ${paymentsTable.status} = ${PAYMENT_STATUS.PAID} then cast(${paymentsTable.amount} as numeric) else 0 end)`,
    }).from(paymentsTable)
      .where(and(eq(paymentsTable.tenantId, tenantId), sql`${paymentsTable.paidAt} IS NOT NULL`, gte(paymentsTable.paidAt, since)))
      .groupBy(sql`to_char(${paymentsTable.paidAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`);

    const resByMonthRaw = await db.select({
      monthStart: sql<string>`to_char(${reservationsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`,
      count: sql<number>`count(*)::int`,
    }).from(reservationsTable)
      .where(and(eq(reservationsTable.tenantId, tenantId), gte(reservationsTable.createdAt, since)))
      .groupBy(sql`to_char(${reservationsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM')`);

    const revMap = new Map(revenueExpRaw.map(r => [r.monthStart, { revenue: Number(r.revenue ?? 0), expenses: Number(r.expenses ?? 0) }]));
    const resMap = new Map(resByMonthRaw.map(r => [r.monthStart, Number(r.count)]));

    const result = months.map(({ key, label }, i) => {
      const { revenue = 0, expenses = 0 } = revMap.get(key) ?? {};
      const reservations = resMap.get(key) ?? 0;
      const profit = revenue - expenses;
      let revenueGrowth: number | null = null;
      let expensesGrowth: number | null = null;
      let profitGrowth: number | null = null;
      let reservationsGrowth: number | null = null;
      if (i > 0) {
        const prevKey = months[i - 1].key;
        const prev = revMap.get(prevKey) ?? { revenue: 0, expenses: 0 };
        const prevProfit = prev.revenue - prev.expenses;
        const prevRes = resMap.get(prevKey) ?? 0;
        revenueGrowth = prev.revenue > 0 ? Math.round(((revenue - prev.revenue) / prev.revenue) * 1000) / 10 : null;
        expensesGrowth = prev.expenses > 0 ? Math.round(((expenses - prev.expenses) / prev.expenses) * 1000) / 10 : null;
        profitGrowth = prevProfit !== 0 ? Math.round(((profit - prevProfit) / Math.abs(prevProfit)) * 1000) / 10 : null;
        reservationsGrowth = prevRes > 0 ? Math.round(((reservations - prevRes) / prevRes) * 1000) / 10 : null;
      }
      return { month: label, key, revenue: roundMoney(revenue), expenses: roundMoney(expenses), profit: roundMoney(profit), reservations, revenueGrowth, expensesGrowth, profitGrowth, reservationsGrowth };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/top-customers", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (me.role === ROLES.CLIENT || me.role === ROLES.SALES) {
      next(new ForbiddenError("Access denied", "FORBIDDEN_ROLE"));
      return;
    }

    const tenantId = me.tenantId;

    const topClients = await db.select({
      id: clientsTable.id,
      name: clientsTable.name,
      email: clientsTable.email,
      totalSpent: clientsTable.totalSpent,
      photoUrl: clientsTable.photoUrl,
    }).from(clientsTable)
      .where(eq(clientsTable.tenantId, tenantId))
       .orderBy(desc(sql`cast(${clientsTable.totalSpent} as numeric)`), asc(clientsTable.name), asc(clientsTable.id))
      .limit(5);

    const clientIds = topClients.map(c => c.id);
    let reservationCounts: Record<string, number> = {};
    if (clientIds.length > 0) {
      const counts = await db.select({
        clientId: reservationsTable.clientId,
        count: sql<number>`count(*)::int`,
      }).from(reservationsTable)
        .where(and(eq(reservationsTable.tenantId, tenantId), inArray(reservationsTable.clientId, clientIds)))
        .groupBy(reservationsTable.clientId);
      reservationCounts = Object.fromEntries(counts.map(c => [c.clientId, Number(c.count)]));
    }

    const result = topClients.map(c => ({
      id: c.id,
      name: c.name,
      email: c.email,
      photoUrl: c.photoUrl,
      totalSpent: Number(c.totalSpent ?? 0),
      reservationCount: reservationCounts[c.id] ?? 0,
    }));

    // Keep this long-standing endpoint's array body for existing dashboard
    // consumers. The same common contract is available without changing the
    // payload shape for callers that opt into ranking metadata.
    res.setHeader("X-Ranking-Metadata", JSON.stringify(rankingMetadata("client", "admin", "all-time")));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
