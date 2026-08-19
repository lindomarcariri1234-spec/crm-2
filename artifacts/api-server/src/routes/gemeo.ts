import { Router, type NextFunction } from "express";
import { logger } from "../lib/logger";
import { localToday } from "@workspace/shared";
import { db } from "@workspace/db";
import {
  paymentsTable,
  reservationsTable,
  tripsTable,
  clientsTable,
  dealsTable,
  clientScoresTable,
  clientNpsResponsesTable,
  expensesTable,
  gemeoAlertsTable,
  gemeoOpportunitiesTable,
} from "@workspace/db";
import { eq, and, gte, lt, lte, isNull, sql, inArray, ne, desc, asc } from "drizzle-orm";
import { requireAuth } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import {
  ADMIN_ROLES,
  PAYMENT_STATUS,
  PAYMENT_TYPE,
  TRIP_STATUS,
  RESERVATION_STATUS,
  DEAL_STATUS,
} from "@workspace/permissions";
import { generateId } from "../lib/id";

const router = Router();

// ─── In-memory 60s cache ──────────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const metricsCache = new Map<string, CacheEntry<GemeoMetricsPayload>>();
const CACHE_TTL_MS = 60_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface GemeoFutureTrip {
  id: string;
  name: string;
  destination: string;
  departureDate: string;
  capacity: number;
  occupied: number;
  fillRate: number;
  daysUntil: number;
  atRisk: boolean;
}

interface GemeoMetricsPayload {
  kpis: {
    revenueMTD: number;
    revenueMTDPrev: number;
    revenueMTDChangePct: number | null;
    reservationsToday: number;
    reservationsThisWeek: number;
    npsAvg30d: number | null;
    npsCount30d: number;
    opportunitySignals: number;
  };
  growth: {
    newLeadsThisMonth: number;
    conversionRate: number;
    conversionRatePrev: number;
    pipelineValue: number;
  };
  revenue: {
    mtd: number;
    mtdPrev: number;
    netProfit: number;
    receivablePending: number;
  };
  operation: {
    activeTrips: number;
    avgOccupancy: number;
    tripsAtRisk: number;
    futureTrips: GemeoFutureTrip[];
  };
  retention: {
    npsAvg30d: number | null;
    churnSignals: number;
    opportunitySignals: number;
  };
  cachedAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function revenueInRange(tenantId: string, from: Date, to: Date): Promise<number> {
  const [r] = await db
    .select({ total: sql<number>`coalesce(sum(cast(${paymentsTable.amount} as numeric)), 0)` })
    .from(paymentsTable)
    .where(
      and(
        eq(paymentsTable.tenantId, tenantId),
        eq(paymentsTable.type, PAYMENT_TYPE.RECEIVABLE),
        eq(paymentsTable.status, PAYMENT_STATUS.PAID),
        gte(paymentsTable.paidAt, from),
        lt(paymentsTable.paidAt, to),
      ),
    );
  return Number(r?.total ?? 0);
}

async function buildMetrics(tenantId: string): Promise<GemeoMetricsPayload> {
  const now = new Date();
  // Use Brazil calendar date (UTC-3) for all "today/this month" boundaries
  const _todayBR = localToday(); // "YYYY-MM-DD" in America/Sao_Paulo
  const [_brY, _brM1, _brD] = _todayBR.split("-").map(Number);
  // Brazil midnight = UTC 03:00 (permanently UTC-3, no DST since 2019)
  const _brMid = (y: number, m1: number, d: number) => new Date(Date.UTC(y, m1 - 1, d, 3, 0, 0, 0));
  const startOfToday = _brMid(_brY, _brM1, _brD);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);
  const thirtyDaysAhead = new Date(now.getTime() + 30 * 86400000);

  const startOfMonth = _brMid(_brY, _brM1, 1);
  const startOfPrevMonth = _brMid(_brY, _brM1 - 1, 1); // JS handles month underflow
  const sameDay = _brD;
  const endOfPrevMonthSameDay = _brMid(_brY, _brM1 - 1, sameDay + 1); // exclusive

  const [
    revenueMTD,
    revenueMTDPrev,
    reservationsTodayRes,
    reservationsWeekRes,
    npsRes,
    futureTripsRaw,
    churnRes,
    opportunityCountRes,
    pipelineRes,
    expensesRes,
    receivableRes,
    newLeadsRes,
    newLeadsPrevRes,
    convertedLeadsRes,
    convertedLeadsPrevRes,
  ] = await Promise.all([
    // Revenue MTD
    revenueInRange(tenantId, startOfMonth, new Date(now.getTime() + 1)),
    // Revenue prev month same period
    revenueInRange(tenantId, startOfPrevMonth, endOfPrevMonthSameDay),
    // Reservations today
    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(reservationsTable)
      .where(
        and(
          eq(reservationsTable.tenantId, tenantId),
          gte(reservationsTable.createdAt, startOfToday),
          ne(reservationsTable.status, RESERVATION_STATUS.CANCELLED),
        ),
      ),
    // Reservations this week
    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(reservationsTable)
      .where(
        and(
          eq(reservationsTable.tenantId, tenantId),
          gte(reservationsTable.createdAt, sevenDaysAgo),
          ne(reservationsTable.status, RESERVATION_STATUS.CANCELLED),
        ),
      ),
    // NPS avg 30d
    db
      .select({
        avg: sql<number>`round(avg(${clientNpsResponsesTable.score})::numeric, 1)`,
        cnt: sql<number>`count(*)::int`,
      })
      .from(clientNpsResponsesTable)
      .where(
        and(
          eq(clientNpsResponsesTable.tenantId, tenantId),
          gte(clientNpsResponsesTable.createdAt, thirtyDaysAgo),
        ),
      ),
    // Future trips with capacity
    db
      .select({
        id: tripsTable.id,
        name: tripsTable.name,
        destination: tripsTable.destination,
        departureDate: tripsTable.departureDate,
        totalCapacity: tripsTable.totalCapacity,
        availableSeats: tripsTable.availableSeats,
      })
      .from(tripsTable)
      .where(
        and(
          eq(tripsTable.tenantId, tenantId),
          gte(tripsTable.departureDate, now),
          inArray(tripsTable.status, [TRIP_STATUS.PUBLISHED, TRIP_STATUS.CONFIRMED, TRIP_STATUS.ACTIVE]),
        ),
      )
      .orderBy(asc(tripsTable.departureDate))
      .limit(20),
    // Churn signals
    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(clientScoresTable)
      .where(
        and(
          eq(clientScoresTable.tenantId, tenantId),
          sql`${clientScoresTable.churnScore} > 70`,
        ),
      ),
    // Clients with high purchase score
    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(clientScoresTable)
      .where(
        and(
          eq(clientScoresTable.tenantId, tenantId),
          sql`${clientScoresTable.purchaseScore} > 70`,
        ),
      ),
    // Pipeline value (open deals)
    db
      .select({ total: sql<number>`coalesce(sum(cast(${dealsTable.value} as numeric)), 0)` })
      .from(dealsTable)
      .where(
        and(
          eq(dealsTable.tenantId, tenantId),
          eq(dealsTable.status, DEAL_STATUS.OPEN),
        ),
      ),
    // Net profit (expenses MTD)
    db
      .select({ total: sql<number>`coalesce(sum(cast(${expensesTable.amount} as numeric)), 0)` })
      .from(expensesTable)
      .where(
        and(
          eq(expensesTable.tenantId, tenantId),
          gte(expensesTable.createdAt, startOfMonth),
        ),
      ),
    // Pending receivables
    db
      .select({ total: sql<number>`coalesce(sum(cast(${paymentsTable.amount} as numeric)), 0)` })
      .from(paymentsTable)
      .where(
        and(
          eq(paymentsTable.tenantId, tenantId),
          eq(paymentsTable.type, PAYMENT_TYPE.RECEIVABLE),
          eq(paymentsTable.status, PAYMENT_STATUS.PENDING),
        ),
      ),
    // New leads (reservations) this month
    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(reservationsTable)
      .where(
        and(
          eq(reservationsTable.tenantId, tenantId),
          gte(reservationsTable.createdAt, startOfMonth),
        ),
      ),
    // New leads prev month
    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(reservationsTable)
      .where(
        and(
          eq(reservationsTable.tenantId, tenantId),
          gte(reservationsTable.createdAt, startOfPrevMonth),
          lt(reservationsTable.createdAt, startOfMonth),
        ),
      ),
    // Converted leads (confirmed) this month
    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(reservationsTable)
      .where(
        and(
          eq(reservationsTable.tenantId, tenantId),
          gte(reservationsTable.createdAt, startOfMonth),
          eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED),
        ),
      ),
    // Converted leads prev month
    db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(reservationsTable)
      .where(
        and(
          eq(reservationsTable.tenantId, tenantId),
          gte(reservationsTable.createdAt, startOfPrevMonth),
          lt(reservationsTable.createdAt, startOfMonth),
          eq(reservationsTable.status, RESERVATION_STATUS.CONFIRMED),
        ),
      ),
  ]);

  // Process future trips
  const processedTrips: GemeoFutureTrip[] = futureTripsRaw.map((t) => {
    const cap = Number(t.totalCapacity ?? 0);
    const avail = Number(t.availableSeats ?? 0);
    const occupied = Math.max(0, cap - avail);
    const fillRate = cap > 0 ? Math.round((occupied / cap) * 100) : 0;
    const depDate = t.departureDate ? new Date(t.departureDate) : now;
    const daysUntil = Math.max(0, Math.ceil((depDate.getTime() - now.getTime()) / 86400000));
    return {
      id: t.id,
      name: t.name,
      destination: t.destination ?? "",
      departureDate: depDate.toISOString(),
      capacity: cap,
      occupied,
      fillRate,
      daysUntil,
      atRisk: daysUntil <= 30 && fillRate < 50,
    };
  });

  const activeTrips = processedTrips.length;
  const totalFillRate = processedTrips.reduce((s, t) => s + t.fillRate, 0);
  const avgOccupancy = activeTrips > 0 ? Math.round(totalFillRate / activeTrips) : 0;
  const tripsAtRisk = processedTrips.filter((t) => t.atRisk).length;

  // Opportunity signals: high purchase score but no reservation in 90 days
  const totalHighPurchase = Number(opportunityCountRes[0]?.cnt ?? 0);
  let opportunitySignals = 0;
  if (totalHighPurchase > 0) {
    const highPurchaseClients = await db
      .select({ clientId: clientScoresTable.clientId })
      .from(clientScoresTable)
      .where(
        and(eq(clientScoresTable.tenantId, tenantId), sql`${clientScoresTable.purchaseScore} > 70`),
      )
      .limit(200);

    if (highPurchaseClients.length > 0) {
      const clientIds = highPurchaseClients.map((r) => r.clientId);
      const recentlyBookedRaw = await db
        .selectDistinct({ clientId: reservationsTable.clientId })
        .from(reservationsTable)
        .where(
          and(
            eq(reservationsTable.tenantId, tenantId),
            inArray(reservationsTable.clientId, clientIds.filter(Boolean) as string[]),
            gte(reservationsTable.createdAt, ninetyDaysAgo),
            ne(reservationsTable.status, RESERVATION_STATUS.CANCELLED),
          ),
        );
      const recentSet = new Set(recentlyBookedRaw.map((r) => r.clientId).filter(Boolean) as string[]);
      opportunitySignals = clientIds.filter((id) => id && !recentSet.has(id)).length;
    }
  }

  const mtd = revenueMTD;
  const mtdPrev = revenueMTDPrev;
  const changePct =
    mtdPrev > 0 ? Math.round(((mtd - mtdPrev) / mtdPrev) * 1000) / 10 : null;

  const newLeads = Number(newLeadsRes[0]?.cnt ?? 0);
  const newLeadsPrev = Number(newLeadsPrevRes[0]?.cnt ?? 0);
  const converted = Number(convertedLeadsRes[0]?.cnt ?? 0);
  const convertedPrev = Number(convertedLeadsPrevRes[0]?.cnt ?? 0);
  const conversionRate = newLeads > 0 ? Math.round((converted / newLeads) * 1000) / 10 : 0;
  const conversionRatePrev = newLeadsPrev > 0 ? Math.round((convertedPrev / newLeadsPrev) * 1000) / 10 : 0;

  const expenses = Number(expensesRes[0]?.total ?? 0);
  const netProfit = Math.round(mtd - expenses);

  const npsAvg = npsRes[0]?.avg !== null && npsRes[0]?.avg !== undefined ? Number(npsRes[0].avg) : null;
  const npsCount = Number(npsRes[0]?.cnt ?? 0);
  const churnSignals = Number(churnRes[0]?.cnt ?? 0);

  return {
    kpis: {
      revenueMTD: Math.round(mtd),
      revenueMTDPrev: Math.round(mtdPrev),
      revenueMTDChangePct: changePct,
      reservationsToday: Number(reservationsTodayRes[0]?.cnt ?? 0),
      reservationsThisWeek: Number(reservationsWeekRes[0]?.cnt ?? 0),
      npsAvg30d: npsAvg,
      npsCount30d: npsCount,
      opportunitySignals,
    },
    growth: {
      newLeadsThisMonth: newLeads,
      conversionRate,
      conversionRatePrev,
      pipelineValue: Math.round(Number(pipelineRes[0]?.total ?? 0)),
    },
    revenue: {
      mtd: Math.round(mtd),
      mtdPrev: Math.round(mtdPrev),
      netProfit,
      receivablePending: Math.round(Number(receivableRes[0]?.total ?? 0)),
    },
    operation: {
      activeTrips,
      avgOccupancy,
      tripsAtRisk,
      futureTrips: processedTrips,
    },
    retention: {
      npsAvg30d: npsAvg,
      churnSignals,
      opportunitySignals,
    },
    cachedAt: new Date().toISOString(),
  };
}

// ─── GET /dashboard/gemeo ─────────────────────────────────────────────────────

router.get("/dashboard/gemeo", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!(ADMIN_ROLES as string[]).includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const tenantId = me.tenantId;
    const cached = metricsCache.get(tenantId);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.data);
      return;
    }

    const data = await buildMetrics(tenantId);
    metricsCache.set(tenantId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    res.json(data);
  } catch (err) {
    logger.error({ err }, "[gemeo/metrics]");
    next(err);
  }
});

// ─── GET /dashboard/gemeo/alerts ─────────────────────────────────────────────

router.get("/dashboard/gemeo/alerts", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!(ADMIN_ROLES as string[]).includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const alerts = await db
      .select()
      .from(gemeoAlertsTable)
      .where(
        and(
          eq(gemeoAlertsTable.tenantId, me.tenantId),
          isNull(gemeoAlertsTable.dismissedAt),
        ),
      )
      .orderBy(desc(gemeoAlertsTable.generatedAt))
      .limit(10);

    res.json({ alerts });
  } catch (err) {
    logger.error({ err }, "[gemeo/alerts]");
    next(err);
  }
});

// ─── PATCH /dashboard/gemeo/alerts/:id/dismiss ───────────────────────────────

router.patch("/dashboard/gemeo/alerts/:id/dismiss", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!(ADMIN_ROLES as string[]).includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const { id } = req.params;

    const [updated] = await db
      .update(gemeoAlertsTable)
      .set({ dismissedAt: new Date() })
      .where(and(eq(gemeoAlertsTable.id, id), eq(gemeoAlertsTable.tenantId, me.tenantId)))
      .returning({ id: gemeoAlertsTable.id });

    if (!updated) {
      next(new NotFoundError("Alerta não encontrado", "NOT_FOUND"));
      return;
    }

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[gemeo/alerts/dismiss]");
    next(err);
  }
});

// ─── GET /dashboard/gemeo/opportunities ──────────────────────────────────────

router.get("/dashboard/gemeo/opportunities", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!(ADMIN_ROLES as string[]).includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const opportunities = await db
      .select()
      .from(gemeoOpportunitiesTable)
      .where(
        and(
          eq(gemeoOpportunitiesTable.tenantId, me.tenantId),
          isNull(gemeoOpportunitiesTable.dismissedAt),
        ),
      )
      .orderBy(desc(gemeoOpportunitiesTable.generatedAt))
      .limit(5);

    res.json({ opportunities });
  } catch (err) {
    logger.error({ err }, "[gemeo/opportunities]");
    next(err);
  }
});

// ─── PATCH /dashboard/gemeo/opportunities/:id/dismiss ────────────────────────

router.patch("/dashboard/gemeo/opportunities/:id/dismiss", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!(ADMIN_ROLES as string[]).includes(me.role)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const { id } = req.params;

    const [updated] = await db
      .update(gemeoOpportunitiesTable)
      .set({ dismissedAt: new Date() })
      .where(
        and(
          eq(gemeoOpportunitiesTable.id, id),
          eq(gemeoOpportunitiesTable.tenantId, me.tenantId),
        ),
      )
      .returning({ id: gemeoOpportunitiesTable.id });

    if (!updated) {
      next(new NotFoundError("Oportunidade não encontrada", "NOT_FOUND"));
      return;
    }

    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[gemeo/opportunities/dismiss]");
    next(err);
  }
});

export default router;
export { buildMetrics };
