import { Router, type NextFunction } from "express";
import { db } from "@workspace/db";
import { paymentsTable, expensesTable, reservationsTable, clientsTable, commissionRulesTable, commissionsTable, usersTable, salesGoalsTable, tenantsTable } from "@workspace/db";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { formatBRL, localToday } from "@workspace/shared";
import { generateId } from "../lib/id";
import { requireAuth, getTenantUser } from "../lib/tenant";
import { CreatePaymentBody, UpdatePaymentBody, CreateExpenseBody, UpdateExpenseBody } from "@workspace/api-zod";
import { writeClientActivity } from "../lib/activities";
import { loyaltyAwardPoints, loyaltyAwardPointsForReservation, loyaltyReverseEarnedPoints } from "../lib/loyalty-helpers";
import { roundMoney } from "../lib/pricing";
import { CalendarSyncService } from "../lib/google-calendar/sync-service";
import { ADMIN_ROLES, MANAGEMENT_ROLES, ALL_STAFF_ROLES } from '../lib/tenant';
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { syncReservationPaymentStatus } from "../lib/reservation-payments";
import { createReservationsForOrder } from "../services/checkout/create-reservations";
import { enqueueNewBookingNotificationEmail } from "../queues/email-helpers";
import { dispatchWhatsAppPaymentReceived } from "../queues/whatsapp-helpers";
import { ROLES, RESERVATION_STATUS, COMMISSION_STATUS, PAYMENT_STATUS, PAYMENT_TYPE, hasPermission, RESOURCES, ACTIONS, type PaymentStatus, type PaymentType, type ExpenseStatus } from "@workspace/permissions";
import { parsePaymentStatus, parsePaymentType, parseExpenseStatus } from "../lib/status-validators";
import { moveDealToStage } from "../services/pipeline-automation";
import { sendPushNotification } from "../lib/push-notifications";
import { logger } from "../lib/logger";

const router = Router();

export async function recalculateClientFinancials(clientId: string, tenantId: string): Promise<void> {
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN status = ${PAYMENT_STATUS.PAID} THEN amount::numeric ELSE 0 END), 0) AS total_spent,
      COALESCE(SUM(CASE WHEN status IN (${PAYMENT_STATUS.PENDING}, ${PAYMENT_STATUS.OVERDUE}) THEN amount::numeric ELSE 0 END), 0) AS outstanding_balance
    FROM payments
    WHERE client_id = ${clientId} AND tenant_id = ${tenantId}
  `);
  const row = (result as unknown as { rows: Array<{ total_spent: string; outstanding_balance: string }> }).rows[0];
  if (!row) return;
  await db.update(clientsTable).set({
    totalSpent: row.total_spent,
    outstandingBalance: row.outstanding_balance,
  }).where(and(eq(clientsTable.id, clientId), eq(clientsTable.tenantId, tenantId)));
}

async function syncMonthlyGoalProgress(sellerId: string, tenantId: string): Promise<void> {
  try {
    // Use Brazil calendar month so goal progress is attributed to the correct month at night
    const month = localToday().slice(0, 7); // "YYYY-MM" in America/Sao_Paulo

    // Aggregate commission_amount + count from commissions for this seller this month (paid and approved)
    const result = await db.execute(sql`
      SELECT
        COALESCE(SUM(commission_amount::numeric), 0) AS total_commission,
        COUNT(*) AS total_count
      FROM commissions
      WHERE tenant_id = ${tenantId}
        AND user_id = ${sellerId}
        AND status IN (${COMMISSION_STATUS.PAID}, ${COMMISSION_STATUS.APPROVED})
        AND to_char(created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = ${month}
    `);
    const row = result.rows[0] as Record<string, unknown>;
    const totalCommission = parseFloat(String(row?.total_commission ?? "0"));
    const totalCount = parseInt(String(row?.total_count ?? "0"), 10);

    // Fetch active monthly goals for this seller/month to compute progressPercentage
    const goals = await db.select().from(salesGoalsTable)
      .where(and(
        eq(salesGoalsTable.tenantId, tenantId),
        eq(salesGoalsTable.userId, sellerId),
        eq(salesGoalsTable.month, month),
        eq(salesGoalsTable.status, "active"),
        eq(salesGoalsTable.periodType, "monthly"),
      ));

    for (const goal of goals) {
      const goalAmount = parseFloat(String(goal.goalAmount));
      const progressPct = goalAmount > 0 ? Math.min(100, (totalCommission / goalAmount) * 100) : 0;

      await db.update(salesGoalsTable)
        .set({
          achievedAmount: String(totalCommission.toFixed(2)),
          achievedQuantity: String(totalCount),
          progressPercentage: String(progressPct.toFixed(2)),
        })
        .where(eq(salesGoalsTable.id, goal.id));
    }
  } catch (err) {
    logger.error({ err }, "[monthly-goal-sync] Failed to sync monthly goal progress — non-fatal");
  }
}

export async function syncReservationCommission(reservationId: string, tenantId: string): Promise<void> {
  const [reservation] = await db.select().from(reservationsTable)
    .where(and(eq(reservationsTable.id, reservationId), eq(reservationsTable.tenantId, tenantId)))
    .limit(1);
  if (!reservation) return;
  if (reservation.status === RESERVATION_STATUS.CANCELLED || reservation.status === RESERVATION_STATUS.REFUNDED) return;

  const baseAmount = parseFloat(String(reservation.totalValue));
  const directAmount = reservation.commissionAmount;
  const hasDirectCommission = !!directAmount && parseFloat(directAmount) > 0;

  // Determine commission amount and seller based on whether direct commission is set
  let commissionAmount: number | null = null;
  let commissionRate: number | null = null;
  let commissionType: string | null = null;
  let ruleId: string | null = null;
  let sellerId: string | null = null;

  if (hasDirectCommission) {
    // Direct commission path: explicit amount set, validate sellerId or fall back to creator (any role)
    commissionAmount = parseFloat(directAmount!);
    commissionType = "direct";
    const explicitSellerId = reservation.sellerId ?? null;
    if (explicitSellerId) {
      // Validate sellerId belongs to the same tenant
      const [seller] = await db.select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.id, explicitSellerId), eq(usersTable.tenantId, tenantId)))
        .limit(1);
      if (!seller) return; // Invalid seller — skip silently
      sellerId = seller.id;
    } else {
      // Fall back to creator (any role) for direct commission
      const [creator] = await db.select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.id, reservation.createdById), eq(usersTable.tenantId, tenantId)))
        .limit(1);
      if (creator) sellerId = creator.id;
    }
  } else {
    // Rule-based commission path: requires fully paid reservation
    const paidValue = parseFloat(String(reservation.paidValue));
    const totalValue = parseFloat(String(reservation.totalValue));
    if (paidValue < totalValue) return;

    // Prefer explicit sellerId on reservation (set by admin), fallback to vendedor creator
    const explicitSellerId = reservation.sellerId ?? null;
    if (explicitSellerId) {
      const [seller] = await db.select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.id, explicitSellerId), eq(usersTable.tenantId, tenantId)))
        .limit(1);
      if (!seller) return;
      sellerId = seller.id;
    } else {
      const [creator] = await db.select({ id: usersTable.id, role: usersTable.role })
        .from(usersTable)
        .where(and(eq(usersTable.id, reservation.createdById), eq(usersTable.tenantId, tenantId)))
        .limit(1);
      if (!creator || creator.role !== ROLES.SALES) return;
      sellerId = creator.id;
    }

    const rules = await db.select().from(commissionRulesTable)
      .where(and(eq(commissionRulesTable.tenantId, tenantId), eq(commissionRulesTable.isActive, true)));
    const tripSpecificRule = rules.find(r => r.appliesTo === "trip" && r.tripId === reservation.tripId);
    const allRule = rules.find(r => r.appliesTo === "all");
    const rule = tripSpecificRule ?? allRule;
    if (rule) {
      ruleId = rule.id;
      commissionType = rule.type ?? "percentage";
      commissionRate = parseFloat(String(rule.value));
      commissionAmount = rule.type === "percentage"
        ? (baseAmount * commissionRate) / 100
        : commissionRate;
    } else {
      // Fallback: use per-seller commission configuration
      const [sellerConfig] = await db.select({
        commissionType: usersTable.commissionType,
        commissionRate: usersTable.commissionRate,
        commissionFixed: usersTable.commissionFixed,
      }).from(usersTable)
        .where(and(eq(usersTable.id, sellerId), eq(usersTable.tenantId, tenantId)))
        .limit(1);
      if (sellerConfig) {
        commissionType = sellerConfig.commissionType ?? "percentage";
        const rate = parseFloat(String(sellerConfig.commissionRate ?? "0"));
        const fixed = parseFloat(String(sellerConfig.commissionFixed ?? "0"));
        if (sellerConfig.commissionType === "none") {
          // Seller explicitly has no commission — commissionAmount stays null → early return below
        } else if (sellerConfig.commissionType === "fixed" && fixed > 0) {
          commissionAmount = fixed;
          commissionRate = fixed;
        } else if (sellerConfig.commissionType === "hybrid") {
          const pct = rate > 0 ? (baseAmount * rate) / 100 : 0;
          commissionAmount = pct + fixed;
          commissionRate = rate;
        } else if (rate > 0) {
          commissionAmount = (baseAmount * rate) / 100;
          commissionRate = rate;
        }
      }
    }
  }

  if (!sellerId || commissionAmount === null || commissionAmount <= 0) return;

  // Find any existing commission for this reservation (regardless of userId) to handle seller reassignments
  const existingCommissions = await db.select({ id: commissionsTable.id, status: commissionsTable.status, userId: commissionsTable.userId })
    .from(commissionsTable)
    .where(and(
      eq(commissionsTable.reservationId, reservationId),
      eq(commissionsTable.tenantId, tenantId),
    ));

  const existingForSeller = existingCommissions.find(c => c.userId === sellerId);
  const staleCommissions = existingCommissions.filter(c => c.userId !== sellerId && c.status === COMMISSION_STATUS.PENDING);

  // Remove stale pending commissions for old sellers
  for (const stale of staleCommissions) {
    await db.delete(commissionsTable).where(eq(commissionsTable.id, stale.id));
  }

  if (existingForSeller) {
    // Revive previously cancelled commissions (e.g. reservation reopened after cancellation)
    // and update pending ones with the latest amounts.
    // Approved/paid commissions are left untouched to preserve auditable state.
    if (existingForSeller.status === COMMISSION_STATUS.PENDING || existingForSeller.status === COMMISSION_STATUS.CANCELLED) {
      await db.update(commissionsTable)
        .set({
          ruleId: ruleId ?? undefined,
          baseAmount: String(baseAmount),
          commissionAmount: String(commissionAmount.toFixed(2)),
          commissionRate: commissionRate != null ? String(commissionRate) : undefined,
          commissionType: commissionType ?? undefined,
          status: COMMISSION_STATUS.PENDING,
        })
        .where(eq(commissionsTable.id, existingForSeller.id));
    }
  } else {
    await db.insert(commissionsTable).values({
      id: generateId(),
      tenantId,
      ruleId: ruleId ?? undefined,
      userId: sellerId,
      reservationId,
      baseAmount: String(baseAmount),
      commissionAmount: String(commissionAmount.toFixed(2)),
      commissionRate: commissionRate != null ? String(commissionRate) : undefined,
      commissionType: commissionType ?? undefined,
      status: COMMISSION_STATUS.PENDING,
    });
  }

  // Await monthly goal progress update; errors are swallowed inside the fn.
  await syncMonthlyGoalProgress(sellerId, tenantId);
}

router.get("/trips/:tripId/financial-report", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.VIEW)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const { tripId } = req.params;

    const tripReservations = await db.select().from(reservationsTable)
      .where(and(eq(reservationsTable.tenantId, me.tenantId), eq(reservationsTable.tripId, tripId)));

    const reservationIds = tripReservations.map(r => r.id);

    let tripPayments: typeof paymentsTable.$inferSelect[] = [];
    if (reservationIds.length > 0) {
      tripPayments = await db.select().from(paymentsTable)
        .where(and(eq(paymentsTable.tenantId, me.tenantId), inArray(paymentsTable.reservationId, reservationIds)));
    }

    const tripExpenses = await db.select().from(expensesTable)
      .where(and(eq(expensesTable.tenantId, me.tenantId), eq(expensesTable.tripId, tripId)));

    const totalRevenue = tripReservations.reduce((s, r) => s + Number(r.totalValue), 0);
    const totalPaid = tripReservations.reduce((s, r) => s + Number(r.paidValue), 0);
    const totalPending = tripReservations.reduce((s, r) => s + Math.max(Number(r.balance), 0), 0);
    const totalExpenses = tripExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const netProfit = totalPaid - totalExpenses;

    const confirmedCount = tripReservations.filter(r => r.status === RESERVATION_STATUS.CONFIRMED).length;
    const pendingCount = tripReservations.filter(r => r.status === RESERVATION_STATUS.PENDING).length;
    const cancelledCount = tripReservations.filter(r => r.status === RESERVATION_STATUS.CANCELLED).length;

    const revenueByMethod: Record<string, number> = {};
    for (const p of tripPayments.filter(p => p.status === PAYMENT_STATUS.PAID)) {
      const m = p.paymentMethod ?? "other";
      revenueByMethod[m] = (revenueByMethod[m] ?? 0) + Number(p.amount);
    }

    const expensesByCategory: Record<string, number> = {};
    for (const e of tripExpenses) {
      expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) + Number(e.amount);
    }

    res.json({
      reservationCount: tripReservations.length,
      confirmedCount,
      pendingCount,
      cancelledCount,
      totalRevenue: roundMoney(totalRevenue),
      totalPaid: roundMoney(totalPaid),
      totalPending: roundMoney(totalPending),
      totalExpenses: roundMoney(totalExpenses),
      netProfit: roundMoney(netProfit),
      revenueByMethod,
      expensesByCategory,
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching trip financial report");
    next(err);
  }
});

function formatPayment(p: typeof paymentsTable.$inferSelect) {
  return {
    id: p.id, reservationId: p.reservationId, clientId: p.clientId,
    type: p.type, category: p.category, amount: Number(p.amount),
    paymentMethod: p.paymentMethod, installmentNumber: p.installmentNumber,
    totalInstallments: p.totalInstallments, dueDate: p.dueDate.toISOString(),
    paidAt: p.paidAt?.toISOString() ?? null, status: p.status,
    receiptUrl: p.receiptUrl ?? null,
    description: p.description, notes: p.notes,
    createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
  };
}

function formatExpense(e: typeof expensesTable.$inferSelect) {
  return {
    id: e.id, tripId: e.tripId, category: e.category, description: e.description,
    amount: Number(e.amount), supplierId: e.supplierId, paymentMethod: e.paymentMethod,
    paymentDate: e.paymentDate?.toISOString() ?? null, dueDate: e.dueDate.toISOString(),
    status: e.status, notes: e.notes, createdAt: e.createdAt.toISOString(),
  };
}

router.get("/payments/summary", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.VIEW)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const now = new Date();
    // Brazil calendar start-of-month (UTC-3 midnight = UTC 03:00)
    const [_smYear, _smMonth1] = localToday().split("-").map(Number);
    const startOfMonth = new Date(Date.UTC(_smYear, _smMonth1 - 1, 1, 3, 0, 0, 0));

    const payments = await db.select().from(paymentsTable).where(eq(paymentsTable.tenantId, me.tenantId));

    let totalReceivable = 0, totalPayable = 0, overdueReceivable = 0, overduePayable = 0, collectedThisMonth = 0, paidThisMonth = 0;

    for (const p of payments) {
      const amount = Number(p.amount);
      if (p.type === PAYMENT_TYPE.RECEIVABLE) {
        if (p.status === PAYMENT_STATUS.PENDING) {
          totalReceivable += amount;
          if (p.dueDate < now) overdueReceivable += amount;
        }
        if (p.paidAt && p.paidAt >= startOfMonth) collectedThisMonth += amount;
      } else {
        if (p.status === PAYMENT_STATUS.PENDING) {
          totalPayable += amount;
          if (p.dueDate < now) overduePayable += amount;
        }
        if (p.paidAt && p.paidAt >= startOfMonth) paidThisMonth += amount;
      }
    }

    res.json({
      totalReceivable: roundMoney(totalReceivable),
      totalPayable: roundMoney(totalPayable),
      overdueReceivable: roundMoney(overdueReceivable),
      overduePayable: roundMoney(overduePayable),
      collectedThisMonth: roundMoney(collectedThisMonth),
      paidThisMonth: roundMoney(paidThisMonth),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching payments summary");
    next(err);
  }
});

router.get("/payments", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;

    const { reservationId, clientId: clientIdParam, status, type, page = "1", limit = "20", dateFrom, dateTo } = req.query as Record<string, string>;
    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 20, 500);
    const offset = (pageNum - 1) * limitNum;

    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    if (dateFrom && !ISO_DATE.test(dateFrom)) { next(new ValidationError("dateFrom must be a valid ISO date (YYYY-MM-DD)", "VALIDATION_ERROR")); return; }
    if (dateTo && !ISO_DATE.test(dateTo)) { next(new ValidationError("dateTo must be a valid ISO date (YYYY-MM-DD)", "VALIDATION_ERROR")); return; }

    const conditions: ReturnType<typeof eq>[] = [eq(paymentsTable.tenantId, me.tenantId)];
    if (reservationId) conditions.push(eq(paymentsTable.reservationId, reservationId));
    if (status) conditions.push(eq(paymentsTable.status, parsePaymentStatus(status)));
    if (type) conditions.push(eq(paymentsTable.type, parsePaymentType(type)));
    if (dateFrom) conditions.push(sql`${paymentsTable.createdAt} >= ${dateFrom}::timestamptz` as ReturnType<typeof eq>);
    if (dateTo) conditions.push(sql`${paymentsTable.createdAt} <= (${dateTo}::date + interval '1 day - 1 millisecond')` as ReturnType<typeof eq>);

    if (me.role === ROLES.CLIENT) {
      const [clientRecord] = await db.select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(eq(clientsTable.tenantId, me.tenantId), eq(clientsTable.userId, me.id)))
        .limit(1);
      if (clientRecord) {
        conditions.push(eq(paymentsTable.clientId, clientRecord.id));
      } else {
        res.json({ data: [], total: 0, page: pageNum, limit: limitNum });
        return;
      }
    } else if (me.role === ROLES.SALES) {
      const sellerClients = await db.select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(eq(clientsTable.tenantId, me.tenantId), eq(clientsTable.createdById, me.id)));
      if (!sellerClients.length) {
        res.json({ data: [], total: 0, page: pageNum, limit: limitNum });
        return;
      }
      const sellerClientIds = sellerClients.map(c => c.id);
      if (clientIdParam) {
        if (!sellerClientIds.includes(clientIdParam)) {
          res.json({ data: [], total: 0, page: pageNum, limit: limitNum });
          return;
        }
        conditions.push(eq(paymentsTable.clientId, clientIdParam));
      } else {
        conditions.push(inArray(paymentsTable.clientId, sellerClientIds));
      }
    } else {
      if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.VIEW)) {
        next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
      }
      if (clientIdParam) conditions.push(eq(paymentsTable.clientId, clientIdParam));
    }

    const payments = await db.select().from(paymentsTable)
      .where(and(...conditions)).orderBy(desc(paymentsTable.dueDate))
      .limit(limitNum).offset(offset);

    const [countResult] = await db.select({ count: sql<number>`count(*)` })
      .from(paymentsTable).where(and(...conditions));

    res.json({ data: payments.map(formatPayment), total: Number(countResult?.count ?? 0), page: pageNum, limit: limitNum });
  } catch (err) {
    req.log.error({ err }, "Error listing payments");
    next(err);
  }
});

router.post("/payments", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreatePaymentBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message))); return; }

    let reservationClientId: string | null = null;
    let reservationTotalValue: string | null = null;
    let reservationBalance: number | null = null;
    if (parsed.data.reservationId) {
      const [reservation] = await db.select().from(reservationsTable)
        .where(and(eq(reservationsTable.id, parsed.data.reservationId), eq(reservationsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!reservation) { next(new NotFoundError("Reservation not found or not in tenant", "RESERVATION_NOT_FOUND")); return; }
      reservationClientId = reservation.clientId;
      reservationTotalValue = reservation.totalValue;
      reservationBalance = Number(reservation.balance);
    }
    if (parsed.data.clientId) {
      const [client] = await db.select().from(clientsTable)
        .where(and(eq(clientsTable.id, parsed.data.clientId), eq(clientsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!client) { next(new NotFoundError("Client not found or not in tenant", "CLIENT_NOT_FOUND")); return; }
    }

    const id = generateId();
    const installments = parsed.data.installments ?? 1;
    const receiptUrl = typeof req.body.receiptUrl === "string" ? req.body.receiptUrl : null;
    const canSetPaymentStatus = MANAGEMENT_ROLES.includes(me.role);
    const explicitStatus = canSetPaymentStatus && parsed.data.status != null ? parsePaymentStatus(parsed.data.status) : undefined;
    const explicitPaidAt = canSetPaymentStatus && parsed.data.paidAt ? new Date(parsed.data.paidAt) : undefined;
    const isReceivedPayment = explicitStatus === PAYMENT_STATUS.PAID || explicitStatus === PAYMENT_STATUS.APPROVED;
    if (
      parsed.data.reservationId &&
      isReceivedPayment &&
      reservationBalance != null &&
      roundMoney(parsed.data.amount) > roundMoney(Math.max(0, reservationBalance))
    ) {
      next(new ValidationError("O valor do pagamento não pode ser maior do que o saldo devedor da reserva.", "PAYMENT_EXCEEDS_BALANCE"));
      return;
    }

    for (let i = 1; i <= installments; i++) {
      const dueDate = new Date(parsed.data.dueDate);
      dueDate.setMonth(dueDate.getMonth() + (i - 1));
      await db.insert(paymentsTable).values({
        id: i === 1 ? id : generateId(),
        tenantId: me.tenantId,
        reservationId: parsed.data.reservationId ?? null,
        clientId: parsed.data.clientId ?? null,
        type: parsePaymentType(parsed.data.type),
        category: parsed.data.category,
        amount: String(parsed.data.amount / installments),
        paymentMethod: parsed.data.paymentMethod,
        installmentNumber: i,
        totalInstallments: installments,
        dueDate,
        description: parsed.data.description ?? null,
        notes: parsed.data.notes ?? null,
        receiptUrl,
        ...(explicitStatus ? { status: explicitStatus } : {}),
        ...(explicitPaidAt ? { paidAt: explicitPaidAt } : {}),
      });
    }

    const [payment] = await db.select().from(paymentsTable)
      .where(and(eq(paymentsTable.id, id), eq(paymentsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!payment) { next(new AppError("Failed to create payment", 500, "PAYMENT_CREATE_FAILED")); return; }
    if (parsed.data.clientId) {
      try {
        await recalculateClientFinancials(parsed.data.clientId, me.tenantId);
      } catch (err) {
        req.log.error({ err }, "Error recalculating client financials after payment creation — non-fatal");
      }
    }
    if (parsed.data.reservationId) {
      await syncReservationPaymentStatus(parsed.data.reservationId, me.tenantId);
      await syncReservationCommission(parsed.data.reservationId, me.tenantId);
    }
    const effectiveClientId = parsed.data.clientId ?? reservationClientId;
    if (explicitStatus === PAYMENT_STATUS.PAID && parsed.data.type === PAYMENT_TYPE.RECEIVABLE && effectiveClientId) {
      if (parsed.data.reservationId && reservationTotalValue) {
        loyaltyAwardPointsForReservation({
          clientId: effectiveClientId,
          reservationId: parsed.data.reservationId,
          amount: reservationTotalValue,
          tenantId: me.tenantId,
        }).catch((err) => req.log.error({ err }, "Error awarding loyalty points on payment creation"));
      } else {
        loyaltyAwardPoints({
          clientId: effectiveClientId,
          paymentId: id,
          amount: parsed.data.amount / installments,
          tenantId: me.tenantId,
        }).catch((err) => req.log.error({ err }, "Error awarding loyalty points on payment creation"));
      }
    }
    res.status(201).json(formatPayment(payment));
    CalendarSyncService.syncPayment(id)
      .catch((err) => req.log.warn({ err, context: "payment.create", paymentId: id, reservationId: parsed.data.reservationId }, "Calendar sync falhou — continuando"));
    if (effectiveClientId && parsed.data.reservationId && explicitStatus === PAYMENT_STATUS.PAID) {
      const amountFormatted = formatBRL(Number(parsed.data.amount));
      writeClientActivity(effectiveClientId, "payment", `Pagamento de ${amountFormatted} recebido`, me.id, { amount: parsed.data.amount, reservationId: parsed.data.reservationId })
        .catch(() => {});
    }
    if (effectiveClientId && explicitStatus === PAYMENT_STATUS.PAID && parsed.data.type === PAYMENT_TYPE.RECEIVABLE) {
      moveDealToStage({ tenantId: me.tenantId, clientId: effectiveClientId, reservationId: parsed.data.reservationId ?? null, targetStageName: "Pagamento Confirmado", forwardOnly: true })
        .catch((err) => req.log.error({ err }, "Error moving deal to Pagamento Confirmado on payment create"));
    }
    if (parsed.data.reservationId && explicitStatus === PAYMENT_STATUS.PAID && parsed.data.type === PAYMENT_TYPE.RECEIVABLE) {
      enqueueNewBookingNotificationEmail(parsed.data.reservationId, me.tenantId)
        .catch((err) => req.log.error({ err }, "Error enqueueing agency new-booking notification on payment creation"));
    }
    if (explicitStatus === PAYMENT_STATUS.PAID && parsed.data.type === PAYMENT_TYPE.RECEIVABLE && effectiveClientId) {
      (async () => {
        try {
          const [client] = await db.select({ expoPushToken: clientsTable.expoPushToken })
            .from(clientsTable)
            .where(and(eq(clientsTable.id, effectiveClientId), eq(clientsTable.tenantId, me.tenantId)))
            .limit(1);
          if (client?.expoPushToken) {
            const amountFormatted = formatBRL(Number(parsed.data.amount));
            await sendPushNotification({
              to: client.expoPushToken,
              title: "Pagamento recebido ✅",
              body: `Seu pagamento de ${amountFormatted} foi confirmado.`,
              data: { type: "payment_received", reservationId: parsed.data.reservationId ?? undefined },
            });
          }
        } catch (err) {
          req.log.error({ err }, "Error sending push notification on payment creation");
        }
      })();
    }
  } catch (err) {
    req.log.error({ err }, "Error creating payment");
    next(err);
  }
});

async function requirePaymentAccess(
  me: { id: string; tenantId: string; role: string },
  paymentId: string,
): Promise<typeof paymentsTable.$inferSelect> {
  const [payment] = await db.select().from(paymentsTable)
    .where(and(eq(paymentsTable.id, paymentId), eq(paymentsTable.tenantId, me.tenantId)))
    .limit(1);
  if (!payment) throw new NotFoundError("Payment not found", "NOT_FOUND");
  if (me.role === ROLES.CLIENT) {
    if (!payment.clientId) throw new NotFoundError("Payment not found", "NOT_FOUND");
    const [clientRecord] = await db.select({ id: clientsTable.id }).from(clientsTable)
      .where(and(eq(clientsTable.tenantId, me.tenantId), eq(clientsTable.userId, me.id))).limit(1);
    if (!clientRecord || payment.clientId !== clientRecord.id) {
      throw new NotFoundError("Payment not found", "NOT_FOUND");
    }
  } else if (me.role === ROLES.SALES) {
    if (!payment.clientId) throw new NotFoundError("Payment not found", "NOT_FOUND");
    const [clientRecord] = await db.select({ createdById: clientsTable.createdById }).from(clientsTable)
      .where(and(eq(clientsTable.id, payment.clientId), eq(clientsTable.tenantId, me.tenantId))).limit(1);
    if (!clientRecord || clientRecord.createdById !== me.id) {
      throw new NotFoundError("Payment not found", "NOT_FOUND");
    }
  } else if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.VIEW)) {
    throw new ForbiddenError("Forbidden", "FORBIDDEN_ROLE");
  }
  return payment;
}

router.get("/payments/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const payment = await requirePaymentAccess(me, req.params.id);
    res.json(formatPayment(payment));
  } catch (err) {
    req.log.error({ err }, "Error fetching payment");
    next(err);
  }
});

router.patch("/payments/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = UpdatePaymentBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message))); return; }
    const updates: Partial<typeof paymentsTable.$inferInsert> = {};
    if (parsed.data.status != null) updates.status = parsePaymentStatus(parsed.data.status);
    if (parsed.data.paidAt !== undefined) updates.paidAt = parsed.data.paidAt ? new Date(parsed.data.paidAt) : null;
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes ?? null;
    await db.update(paymentsTable).set(updates)
      .where(and(eq(paymentsTable.id, req.params.id), eq(paymentsTable.tenantId, me.tenantId)));
    const [payment] = await db.select().from(paymentsTable)
      .where(and(eq(paymentsTable.id, req.params.id), eq(paymentsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!payment) { next(new NotFoundError("Payment not found", "NOT_FOUND")); return; }
    if (payment.clientId) {
      try {
        await recalculateClientFinancials(payment.clientId, me.tenantId);
      } catch (err) {
        req.log.error({ err }, "Error recalculating client financials after payment update — non-fatal");
      }
    }
    if (payment.reservationId) {
      await syncReservationPaymentStatus(payment.reservationId, me.tenantId);
      await syncReservationCommission(payment.reservationId, me.tenantId);
    }
    if (payment.status === PAYMENT_STATUS.PAID && payment.type === PAYMENT_TYPE.RECEIVABLE) {
      if (payment.reservationId) {
        const [reservationRow] = await db.select({ clientId: reservationsTable.clientId, totalValue: reservationsTable.totalValue })
          .from(reservationsTable)
          .where(and(eq(reservationsTable.id, payment.reservationId), eq(reservationsTable.tenantId, me.tenantId)))
          .limit(1);
        if (reservationRow) {
          await loyaltyAwardPointsForReservation({
            clientId: reservationRow.clientId!,
            reservationId: payment.reservationId,
            amount: reservationRow.totalValue,
            tenantId: me.tenantId,
          });
        }
      } else if (payment.clientId) {
        await loyaltyAwardPoints({
          clientId: payment.clientId,
          paymentId: payment.id,
          amount: payment.amount,
          tenantId: me.tenantId,
        });
      }
    }
    if (payment.status === PAYMENT_STATUS.PAID && payment.type === PAYMENT_TYPE.RECEIVABLE) {
      moveDealToStage({ tenantId: me.tenantId, clientId: payment.clientId ?? null, reservationId: payment.reservationId ?? null, targetStageName: "Pagamento Confirmado", forwardOnly: true })
        .catch((err) => req.log.error({ err }, "Error moving deal to Pagamento Confirmado on payment update"));
    }
    res.json(formatPayment(payment));
    CalendarSyncService.syncPayment(req.params.id)
      .catch((err) => req.log.warn({ err, context: "payment.update", paymentId: req.params.id }, "Calendar sync falhou — continuando"));
    if (payment.reservationId && payment.status === PAYMENT_STATUS.PAID && payment.type === PAYMENT_TYPE.RECEIVABLE) {
      enqueueNewBookingNotificationEmail(payment.reservationId, me.tenantId)
        .catch((err) => req.log.error({ err }, "Error enqueueing agency new-booking notification on payment update"));
    }
    if (updates.status === PAYMENT_STATUS.PAID && payment.type === PAYMENT_TYPE.RECEIVABLE && payment.clientId) {
      (async () => {
        try {
          const [client] = await db.select({
            expoPushToken: clientsTable.expoPushToken,
            whatsapp: clientsTable.whatsapp,
            phone: clientsTable.phone,
            name: clientsTable.name,
            whatsappOptIn: clientsTable.whatsappOptIn,
          })
            .from(clientsTable)
            .where(and(eq(clientsTable.id, payment.clientId!), eq(clientsTable.tenantId, me.tenantId)))
            .limit(1);
          if (client?.expoPushToken) {
            const amountFormatted = formatBRL(Number(payment.amount));
            await sendPushNotification({
              to: client.expoPushToken,
              title: "Pagamento recebido ✅",
              body: `Seu pagamento de ${amountFormatted} foi confirmado.`,
              data: { type: "payment_received", reservationId: payment.reservationId ?? undefined },
            });
          }
          // WhatsApp payment confirmation
          if (payment.reservationId) {
            let remainingBalance = 0;
            const [resRow] = await db.select({ balance: reservationsTable.balance })
              .from(reservationsTable)
              .where(and(eq(reservationsTable.id, payment.reservationId), eq(reservationsTable.tenantId, me.tenantId)))
              .limit(1);
            remainingBalance = Number(resRow?.balance ?? 0);
            await dispatchWhatsAppPaymentReceived({
              reservationId: payment.reservationId,
              tenantId: me.tenantId,
              amount: Number(payment.amount),
              remainingBalance,
            });
          }
        } catch (err) {
          req.log.error({ err }, "Error sending push notification on payment update");
        }
      })();
    }
  } catch (err) {
    req.log.error({ err }, "Error updating payment");
    next(err);
  }
});

router.delete("/payments/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!MANAGEMENT_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const [payment] = await db.select().from(paymentsTable)
      .where(and(eq(paymentsTable.id, req.params.id), eq(paymentsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!payment) { next(new NotFoundError("Payment not found", "NOT_FOUND")); return; }

    // Step 1: Delete the payment row
    await db.delete(paymentsTable)
      .where(and(eq(paymentsTable.id, req.params.id), eq(paymentsTable.tenantId, me.tenantId)));

    // Step 2: Recalculate client aggregate financials
    if (payment.clientId) {
      try {
        await recalculateClientFinancials(payment.clientId, me.tenantId);
      } catch (err) {
        req.log.error({ err }, "Error recalculating client financials after payment deletion — non-fatal");
      }
    }

    const wasPaidReceivable = (payment.status === PAYMENT_STATUS.PAID || payment.status === PAYMENT_STATUS.APPROVED)
      && payment.type === PAYMENT_TYPE.RECEIVABLE
      && !!payment.clientId;

    if (payment.reservationId) {
      // Step 3: Sync reservation paidValue/status and commission after deletion
      await syncReservationPaymentStatus(payment.reservationId, me.tenantId);
      await syncReservationCommission(payment.reservationId, me.tenantId);

      // Step 4: Reverse reservation-level loyalty points only if the reservation is
      // now underpaid. A fully-paid reservation retains its earned points even when
      // a duplicate/erroneous extra payment is removed.
      if (wasPaidReceivable) {
        const [updatedRes] = await db.select({ paidValue: reservationsTable.paidValue, totalValue: reservationsTable.totalValue })
          .from(reservationsTable)
          .where(and(eq(reservationsTable.id, payment.reservationId), eq(reservationsTable.tenantId, me.tenantId)))
          .limit(1);
        const isNowUnderpaid = updatedRes
          ? parseFloat(String(updatedRes.paidValue)) < parseFloat(String(updatedRes.totalValue))
          : false;
        if (isNowUnderpaid) {
          try {
            await loyaltyReverseEarnedPoints({
              clientId: payment.clientId!,
              tenantId: me.tenantId,
              paymentId: payment.id,
              reservationId: payment.reservationId,
            });
          } catch (err) {
            req.log.error({ err }, "Error reversing loyalty points on reservation payment deletion — non-fatal");
          }
        }
      }
    } else if (wasPaidReceivable) {
      // Standalone (non-reservation) payment: always reverse its payment-level points
      try {
        await loyaltyReverseEarnedPoints({
          clientId: payment.clientId!,
          tenantId: me.tenantId,
          paymentId: payment.id,
          reservationId: null,
        });
      } catch (err) {
        req.log.error({ err }, "Error reversing loyalty points on standalone payment deletion — non-fatal");
      }
    }

    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting payment");
    next(err);
  }
});

router.get("/expenses", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.VIEW)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    const { tripId, status, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = parseInt(page) || 1;
    const limitNum = Math.min(parseInt(limit) || 20, 500);
    const offset = (pageNum - 1) * limitNum;

    const conditions: ReturnType<typeof eq>[] = [eq(expensesTable.tenantId, me.tenantId)];
    if (tripId) conditions.push(eq(expensesTable.tripId, tripId));
    if (status) conditions.push(eq(expensesTable.status, parseExpenseStatus(status)));

    const expenses = await db.select().from(expensesTable)
      .where(and(...conditions)).orderBy(desc(expensesTable.dueDate))
      .limit(limitNum).offset(offset);

    const [countResult] = await db.select({ count: sql<number>`count(*)` })
      .from(expensesTable).where(and(...conditions));

    res.json({ data: expenses.map(formatExpense), total: Number(countResult?.count ?? 0), page: pageNum, limit: limitNum });
  } catch (err) {
    req.log.error({ err }, "Error listing expenses");
    next(err);
  }
});

router.post("/expenses", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.CREATE)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreateExpenseBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message))); return; }

    const id = generateId();
    await db.insert(expensesTable).values({
      id,
      tenantId: me.tenantId,
      tripId: parsed.data.tripId ?? null,
      category: parsed.data.category,
      description: parsed.data.description,
      amount: String(parsed.data.amount),
      supplierId: parsed.data.supplierId ?? null,
      paymentMethod: parsed.data.paymentMethod ?? null,
      dueDate: new Date(parsed.data.dueDate),
      notes: parsed.data.notes ?? null,
      createdById: me.id,
    });

    const [expense] = await db.select().from(expensesTable)
      .where(and(eq(expensesTable.id, id), eq(expensesTable.tenantId, me.tenantId)))
      .limit(1);
    if (!expense) { next(new AppError("Failed to create expense", 500, "EXPENSE_CREATE_FAILED")); return; }
    res.status(201).json(formatExpense(expense));
  } catch (err) {
    req.log.error({ err }, "Error creating expense");
    next(err);
  }
});

router.patch("/expenses/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = UpdateExpenseBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message))); return; }
    const updates: Partial<typeof expensesTable.$inferInsert> = {};
    if (parsed.data.status != null) updates.status = parseExpenseStatus(parsed.data.status);
    if (parsed.data.paymentDate !== undefined) updates.paymentDate = parsed.data.paymentDate ? new Date(parsed.data.paymentDate) : null;
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes ?? null;
    if (parsed.data.amount != null) updates.amount = String(parsed.data.amount);
    await db.update(expensesTable).set(updates)
      .where(and(eq(expensesTable.id, req.params.id), eq(expensesTable.tenantId, me.tenantId)));
    const [expense] = await db.select().from(expensesTable)
      .where(and(eq(expensesTable.id, req.params.id), eq(expensesTable.tenantId, me.tenantId)))
      .limit(1);
    if (!expense) { next(new NotFoundError("Expense not found", "NOT_FOUND")); return; }
    res.json(formatExpense(expense));
  } catch (err) {
    req.log.error({ err }, "Error updating expense");
    next(err);
  }
});

router.delete("/expenses/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    await db.delete(expensesTable)
      .where(and(eq(expensesTable.id, req.params.id), eq(expensesTable.tenantId, me.tenantId)));
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting expense");
    next(err);
  }
});

export default router;
