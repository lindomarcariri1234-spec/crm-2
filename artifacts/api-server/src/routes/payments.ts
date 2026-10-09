import { Router, type NextFunction } from "express";
import { db } from "@workspace/db";
import { paymentsTable, expensesTable, tripCostsTable, reservationsTable, storeOrdersTable, clientsTable, commissionRulesTable, commissionsTable, tripsTable, usersTable, salesGoalsTable, tenantsTable } from "@workspace/db";
import { eq, and, sql, asc, desc, inArray, isNull, gte, lt, notExists } from "drizzle-orm";
import { formatBRL, localToday } from "@workspace/shared";
import { generateId } from "../lib/id";
import { requireAuth, getTenantUser } from "../lib/tenant";
import { CreatePaymentBody, UpdatePaymentBody, CreateExpenseBody, UpdateExpenseBody, LinkExpenseToTripCostBody, CreateOperationalCostPayableBody } from "@workspace/api-zod";
import { writeClientActivity } from "../lib/activities";
import { loyaltyAwardPoints, loyaltyAwardPointsForReservation, loyaltyReverseEarnedPoints } from "../lib/loyalty-helpers";
import { roundMoney } from "../lib/pricing";
import { CalendarSyncService } from "../lib/google-calendar/sync-service";
import { ALL_STAFF_ROLES } from '../lib/tenant';
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { sumPaidReservationPayments, syncReservationPaymentStatus } from "../lib/reservation-payments";
import { createReservationsForOrder } from "../services/checkout/create-reservations";
import { enqueueNewBookingNotificationEmail, dispatchReferralReversedEmail } from "../queues/email-helpers";
import { dispatchWhatsAppPaymentReceived } from "../queues/whatsapp-helpers";
import { ROLES, RESERVATION_STATUS, COMMISSION_STATUS, EXPENSE_STATUS, PAYMENT_STATUS, PAYMENT_TYPE, hasPermission, RESOURCES, ACTIONS, type PaymentStatus, type PaymentType, type ExpenseStatus } from "@workspace/permissions";
import { parsePaymentStatus, parsePaymentType, parseExpenseStatus } from "../lib/status-validators";
import { moveDealToStage } from "../services/pipeline-automation";
import { sendPushNotification } from "../lib/push-notifications";
import { logger } from "../lib/logger";
import {
  convertPaidReservationReferral,
  reverseReservationReferralIfNoEligiblePaymentInTransaction,
  type ReservationReferralReversalReason,
} from "../services/reservation-referral-conversion";
import {
  syncStoreOrderFromOrderPayment,
  syncStoreOrderFromReservationPayment,
} from "../services/reservation-order-payment-sync";
import { recalculateClientFinancials as recalculateClientFinancialsFromPayments } from "../services/client-financials";
import { areExpenseAndTripCostLinkable } from "../services/expense-trip-cost-link";
import {
  assertPayableMatchesOperationalCost,
  operationalCostAmountsMatch,
  toOperationalCostStatus,
  toPayableStatus,
} from "../services/operational-cost-payables";
import {
  calculateRuleCommission,
  calculateSellerCommission,
  getCommissionTravelScope,
  selectApplicableCommissionRule,
} from "../lib/commission-calculation.js";

const router = Router();
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function paymentReferralReversalReason(status: string): ReservationReferralReversalReason | null {
  switch (status) {
    case PAYMENT_STATUS.CANCELLED:
      return "payment_cancelled";
    case PAYMENT_STATUS.REFUNDED:
      return "payment_refunded";
    case PAYMENT_STATUS.CHARGED_BACK:
      return "payment_charged_back";
    case PAYMENT_STATUS.FAILED:
      return "payment_failed";
    default:
      return null;
  }
}

export async function recalculateClientFinancials(clientId: string, tenantId: string): Promise<void> {
  await recalculateClientFinancialsFromPayments(clientId, tenantId);
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
    commissionAmount = roundMoney(parseFloat(directAmount!));
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
    let travelScope = null;
    const hasTravelScopedRules = rules.some(
      (rule) => rule.appliesTo === "national" || rule.appliesTo === "international",
    );
    if (reservation.tripId && hasTravelScopedRules) {
      const [trip] = await db.select({ destinationCountry: tripsTable.destinationCountry }).from(tripsTable)
        .where(and(eq(tripsTable.id, reservation.tripId), eq(tripsTable.tenantId, tenantId)))
        .limit(1);
      travelScope = getCommissionTravelScope(trip?.destinationCountry);
    }
    const rule = selectApplicableCommissionRule(rules, reservation.tripId, travelScope);
    if (rule) {
      ruleId = rule.id;
      const calculation = calculateRuleCommission(baseAmount, rule);
      commissionType = calculation.commissionType;
      commissionRate = calculation.commissionRate;
      commissionAmount = calculation.commissionAmount;
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
        const calculation = calculateSellerCommission(baseAmount, sellerConfig);
        commissionType = calculation.commissionType;
        commissionRate = calculation.commissionRate;
        commissionAmount = calculation.commissionAmount;
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
      .where(and(
        eq(reservationsTable.tenantId, me.tenantId),
        eq(reservationsTable.tripId, tripId),
        notExists(db.select({ id: storeOrdersTable.id })
          .from(storeOrdersTable)
          .where(and(
            eq(storeOrdersTable.tenantId, me.tenantId),
            eq(storeOrdersTable.orderNumber, reservationsTable.storeOrderId),
            eq(storeOrdersTable.stripeLivemode, false),
          ))),
      ));

    const reservationIds = tripReservations.map(r => r.id);

    let tripPayments: typeof paymentsTable.$inferSelect[] = [];
    if (reservationIds.length > 0) {
      tripPayments = await db.select().from(paymentsTable)
        .where(and(eq(paymentsTable.tenantId, me.tenantId), inArray(paymentsTable.reservationId, reservationIds)));
    }

    const tripExpenses = await db.select().from(expensesTable)
      .where(and(eq(expensesTable.tenantId, me.tenantId), eq(expensesTable.tripId, tripId)));

    const unverifiedPaidByReservation = new Map<string, number>();
    for (const payment of tripPayments) {
      const unverifiedStripeMode = payment.gateway === "stripe" && payment.isTestMode == null;
      if (payment.status === PAYMENT_STATUS.PAID && (payment.isTestMode === true || unverifiedStripeMode) && payment.reservationId) {
        unverifiedPaidByReservation.set(
          payment.reservationId,
          (unverifiedPaidByReservation.get(payment.reservationId) ?? 0) + Number(payment.amount),
        );
      }
    }
    const totalRevenue = tripReservations.reduce((s, r) => s + Number(r.totalValue), 0);
    const totalPaid = tripReservations.reduce(
      (s, r) => s + Math.max(0, Number(r.paidValue) - (unverifiedPaidByReservation.get(r.id) ?? 0)),
      0,
    );
    const totalPending = tripReservations.reduce(
      (s, r) => s + Math.max(0, Number(r.balance) + (unverifiedPaidByReservation.get(r.id) ?? 0)),
      0,
    );
    const totalExpenses = tripExpenses.reduce((s, e) => s + Number(e.amount), 0);
    const netProfit = totalPaid - totalExpenses;

    const confirmedCount = tripReservations.filter(r => r.status === RESERVATION_STATUS.CONFIRMED).length;
    const pendingCount = tripReservations.filter(r => r.status === RESERVATION_STATUS.PENDING).length;
    const cancelledCount = tripReservations.filter(r => r.status === RESERVATION_STATUS.CANCELLED).length;

    const revenueByMethod: Record<string, number> = {};
    for (const p of tripPayments.filter(p => p.status === PAYMENT_STATUS.PAID && p.isTestMode === false)) {
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
    sourceExpenseId: p.sourceExpenseId ?? null,
    sourceTripCostId: p.sourceTripCostId ?? null,
    createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
  };
}

function formatExpense(
  e: typeof expensesTable.$inferSelect,
  payable: { id: string; status: string } | null = null,
) {
  return {
    id: e.id, tripId: e.tripId, linkedTripCostId: e.linkedTripCostId ?? null,
    category: e.category, description: e.description,
    amount: Number(e.amount), supplierId: e.supplierId, paymentMethod: e.paymentMethod,
    paymentDate: e.paymentDate?.toISOString() ?? null, dueDate: e.dueDate.toISOString(),
    status: e.status, payablePaymentId: payable?.id ?? null, payableStatus: payable?.status ?? null,
    payableDueDateRequired: false,
    notes: e.notes, createdAt: e.createdAt.toISOString(),
    source: "agency" as const, supplierName: null,
  };
}

type OperationalCostSourceType = "expense" | "trip_cost";
type LockedOperationalCost =
  | {
    sourceType: "expense";
    row: typeof expensesTable.$inferSelect;
    linkedCost: typeof tripCostsTable.$inferSelect | null;
  }
  | {
    sourceType: "trip_cost";
    row: typeof tripCostsTable.$inferSelect;
    linkedExpense: typeof expensesTable.$inferSelect | null;
  };

async function lockOperationalCostSource(
  tx: DbTransaction,
  sourceType: OperationalCostSourceType,
  sourceId: string,
  tenantId: string,
): Promise<LockedOperationalCost | null> {
  if (sourceType === "expense") {
    const [expense] = await tx.select().from(expensesTable)
      .where(and(eq(expensesTable.id, sourceId), eq(expensesTable.tenantId, tenantId)))
      .for("update").limit(1);
    if (!expense) return null;

    let linkedCost: typeof tripCostsTable.$inferSelect | null = null;
    if (expense.linkedTripCostId) {
      const [cost] = await tx.select().from(tripCostsTable)
        .where(and(
          eq(tripCostsTable.id, expense.linkedTripCostId),
          eq(tripCostsTable.tenantId, tenantId),
        ))
        .for("update").limit(1);
      if (!cost || !areExpenseAndTripCostLinkable(expense, cost)) {
        throw new ConflictError("O vínculo com o custo da viagem está inconsistente.", "EXPENSE_LINK_CHANGED");
      }
      linkedCost = cost;
    }
    return { sourceType, row: expense, linkedCost };
  }

  const [costSnapshot] = await tx.select({ id: tripCostsTable.id }).from(tripCostsTable)
    .where(and(
      eq(tripCostsTable.id, sourceId),
      eq(tripCostsTable.tenantId, tenantId),
    ))
    .limit(1);
  if (!costSnapshot) return null;

  const [linkedExpenseSnapshot] = await tx.select({ id: expensesTable.id })
    .from(expensesTable)
    .where(and(
      eq(expensesTable.linkedTripCostId, costSnapshot.id),
      eq(expensesTable.tenantId, tenantId),
    ))
    .limit(1);
  let linkedExpense: typeof expensesTable.$inferSelect | null = null;
  if (linkedExpenseSnapshot) {
    const [lockedExpense] = await tx.select().from(expensesTable)
      .where(and(
        eq(expensesTable.id, linkedExpenseSnapshot.id),
        eq(expensesTable.tenantId, tenantId),
      ))
      .for("update").limit(1);
    linkedExpense = lockedExpense ?? null;
  }

  const [cost] = await tx.select().from(tripCostsTable)
    .where(and(
      eq(tripCostsTable.id, sourceId),
      eq(tripCostsTable.tenantId, tenantId),
    ))
    .for("update").limit(1);
  if (!cost) return null;

  const [currentLinkedExpense] = await tx.select({ id: expensesTable.id })
    .from(expensesTable)
    .where(and(
      eq(expensesTable.linkedTripCostId, cost.id),
      eq(expensesTable.tenantId, tenantId),
    ))
    .limit(1);
  if ((linkedExpense?.id ?? null) !== (currentLinkedExpense?.id ?? null)) {
    throw new ConflictError("O vínculo mudou durante a operação. Tente novamente.", "EXPENSE_LINK_CHANGED");
  }
  return { sourceType, row: cost, linkedExpense };
}

async function syncOperationalCostPaidAt(
  tx: DbTransaction,
  source: LockedOperationalCost,
  tenantId: string,
  paidAt: Date | null,
): Promise<void> {
  if (source.sourceType === "expense") {
    await tx.update(expensesTable).set({ paymentDate: paidAt })
      .where(and(eq(expensesTable.id, source.row.id), eq(expensesTable.tenantId, tenantId)));
    if (source.linkedCost) {
      await tx.update(tripCostsTable).set({ paidAt })
        .where(and(eq(tripCostsTable.id, source.linkedCost.id), eq(tripCostsTable.tenantId, tenantId)));
    }
    return;
  }
  await tx.update(tripCostsTable).set({ paidAt })
    .where(and(eq(tripCostsTable.id, source.row.id), eq(tripCostsTable.tenantId, tenantId)));
}

async function syncOperationalCostFromPayment(
  tx: DbTransaction,
  payment: typeof paymentsTable.$inferSelect,
  tenantId: string,
): Promise<void> {
  if (!payment.sourceExpenseId && !payment.sourceTripCostId) return;
  if (payment.type !== PAYMENT_TYPE.PAYABLE) {
    throw new ConflictError("Somente contas a pagar podem ser vinculadas a custos.", "PAYMENT_NOT_PAYABLE");
  }
  const status = toOperationalCostStatus(payment.status);
  const paidAt = status === EXPENSE_STATUS.PAID ? payment.paidAt ?? null : null;

  if (payment.sourceExpenseId) {
    const source = await lockOperationalCostSource(tx, "expense", payment.sourceExpenseId, tenantId);
    if (!source || source.sourceType !== "expense") {
      throw new ConflictError("A despesa vinculada não está mais disponível.", "OPERATIONAL_COST_SOURCE_MISSING");
    }
    if (!operationalCostAmountsMatch(source.row.amount, payment.amount)) {
      throw new ConflictError("O valor da despesa e da conta a pagar divergiu.", "OPERATIONAL_COST_PAYABLE_MISMATCH");
    }
    await tx.update(expensesTable).set({ status, paymentDate: paidAt })
      .where(and(eq(expensesTable.id, source.row.id), eq(expensesTable.tenantId, tenantId)));
    if (source.linkedCost) {
      await tx.update(tripCostsTable).set({ status, paidAt })
        .where(and(eq(tripCostsTable.id, source.linkedCost.id), eq(tripCostsTable.tenantId, tenantId)));
    }
    return;
  }

  const source = await lockOperationalCostSource(tx, "trip_cost", payment.sourceTripCostId!, tenantId);
  if (!source || source.sourceType !== "trip_cost") {
    throw new ConflictError("O custo vinculado não está mais disponível.", "OPERATIONAL_COST_SOURCE_MISSING");
  }
  if (source.linkedExpense) {
    throw new ConflictError("Use a despesa da agência vinculada para atualizar esta conta.", "OPERATIONAL_COST_SOURCE_LINKED");
  }
  if (!operationalCostAmountsMatch(source.row.amount, payment.amount)) {
    throw new ConflictError("O custo e a conta a pagar divergiram.", "OPERATIONAL_COST_PAYABLE_MISMATCH");
  }
  await tx.update(tripCostsTable).set({ status, paidAt })
    .where(and(eq(tripCostsTable.id, source.row.id), eq(tripCostsTable.tenantId, tenantId)));
}

function brazilCalendarDateAnchor(value: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? "";
  return new Date(Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day"))));
}

type ConsolidatedExpenseRow = {
  id: string;
  tripId: string | null;
  linkedTripCostId: string | null;
  category: string;
  description: string;
  amount: string | number;
  supplierId: string | null;
  supplierName: string | null;
  paymentMethod: string | null;
  paymentDate: Date | string | null;
  dueDate: Date | string | null;
  sortDueDate: Date | string;
  status: string;
  notes: string | null;
  createdAt: Date | string;
  source: "agency" | "trip";
  payablePaymentId: string | null;
  payableStatus: string | null;
  payableDueDateRequired: boolean;
};

function dateValueToIso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function formatConsolidatedExpense(row: ConsolidatedExpenseRow) {
  const dueDate = row.dueDate ?? brazilCalendarDateAnchor(
    row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
  );
  return {
    id: row.id,
    tripId: row.tripId,
    linkedTripCostId: row.linkedTripCostId,
    category: row.category,
    description: row.description,
    amount: Number(row.amount),
    supplierId: row.supplierId,
    supplierName: row.supplierName,
    paymentMethod: row.paymentMethod,
    paymentDate: row.paymentDate ? dateValueToIso(row.paymentDate) : null,
    dueDate: dateValueToIso(dueDate),
    status: row.status,
    notes: row.notes,
    payablePaymentId: row.payablePaymentId,
    payableStatus: row.payableStatus,
    payableDueDateRequired: row.source === "trip" && row.dueDate === null,
    createdAt: dateValueToIso(row.createdAt),
    source: row.source,
  };
}

type ExpenseSummaryAggregate = {
  category: string;
  status: string;
  total: string | number;
  paid: string | number;
  pending: string | number;
  overdue: string | number;
  paidThisMonth: string | number;
};

function parseUtcDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

function addUtcMonthsClamped(date: Date, months: number): Date {
  const monthIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

function getExpenseSummaryWindow(period: string, today = localToday()): { start: Date; end: Date } | null {
  if (period === "all") return null;
  const todayDate = parseUtcDateOnly(today);
  if (!todayDate) return null;

  if (period === "month") {
    return {
      start: new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 1)),
      end: new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + 1, 1)),
    };
  }

  const start = period === "quarter"
    ? addUtcMonthsClamped(todayDate, -3)
    : period === "year"
      ? addUtcMonthsClamped(todayDate, -12)
      : null;
  if (!start) return null;
  const end = new Date(todayDate);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function getBrazilCurrentMonthWindow(today = localToday()): { start: Date; end: Date } {
  const todayDate = parseUtcDateOnly(today) ?? new Date();
  const year = todayDate.getUTCFullYear();
  const month = todayDate.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1, 3)),
    end: new Date(Date.UTC(year, month + 1, 1, 3)),
  };
}

function buildExpenseSummary(rows: ExpenseSummaryAggregate[]) {
  const categoryTotals = new Map<string, { total: number; paid: number; open: number }>();
  for (const row of rows) {
    const total = Number(row.total) || 0;
    const paid = Number(row.paid) || 0;
    if (total === 0 && paid === 0) continue;
    const category = categoryTotals.get(row.category) ?? { total: 0, paid: 0, open: 0 };
    category.total += total;
    category.paid += paid;
    category.open += total - paid;
    categoryTotals.set(row.category, category);
  }
  const sum = (key: keyof Pick<ExpenseSummaryAggregate, "total" | "paid" | "pending" | "overdue" | "paidThisMonth">) =>
    roundMoney(rows.reduce((total, row) => total + (Number(row[key]) || 0), 0));

  return {
    total: sum("total"),
    paid: sum("paid"),
    pending: sum("pending"),
    overdue: sum("overdue"),
    paidThisMonth: sum("paidThisMonth"),
    categoryBreakdown: [...categoryTotals.entries()]
      .map(([category, totals]) => ({
        category,
        total: roundMoney(totals.total),
        paid: roundMoney(totals.paid),
        open: roundMoney(totals.open),
      }))
      .sort((a, b) => b.total - a.total),
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
      if (p.isTestMode !== false) continue;
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

    const {
      reservationId,
      clientId: clientIdParam,
      status,
      type,
      page = "1",
      limit = "20",
      dateFrom,
      dateTo,
      dueDateFrom,
      dueDateTo,
      unlinkedOnly,
    } = req.query as Record<string, string>;
    const parsedPage = Number.parseInt(page, 10);
    const parsedLimit = Number.parseInt(limit, 10);
    const pageNum = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limitNum = Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20, 500);
    const offset = (pageNum - 1) * limitNum;

    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    const isValidIsoDate = (value?: string) => {
      if (!value || !ISO_DATE.test(value)) return false;
      const [year, month, day] = value.split("-").map(Number);
      const parsed = new Date(Date.UTC(year, month - 1, day));
      return parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day;
    };
    for (const [name, value] of Object.entries({ dateFrom, dateTo, dueDateFrom, dueDateTo })) {
      if (value && !isValidIsoDate(value)) {
        next(new ValidationError(`${name} must be a valid ISO date (YYYY-MM-DD)`, "VALIDATION_ERROR"));
        return;
      }
    }
    if (unlinkedOnly && unlinkedOnly !== "true" && unlinkedOnly !== "false") {
      next(new ValidationError("unlinkedOnly must be true or false", "VALIDATION_ERROR"));
      return;
    }
    if ((dateFrom && dateTo && dateFrom > dateTo) || (dueDateFrom && dueDateTo && dueDateFrom > dueDateTo)) {
      next(new ValidationError("The start date must not be after the end date", "VALIDATION_ERROR"));
      return;
    }

    const conditions: ReturnType<typeof eq>[] = [eq(paymentsTable.tenantId, me.tenantId)];
    conditions.push(eq(paymentsTable.isTestMode, false));
    if (reservationId) conditions.push(eq(paymentsTable.reservationId, reservationId));
    if (status) conditions.push(eq(paymentsTable.status, parsePaymentStatus(status)));
    if (type) conditions.push(eq(paymentsTable.type, parsePaymentType(type)));
    if (unlinkedOnly === "true") {
      conditions.push(isNull(paymentsTable.sourceExpenseId));
      conditions.push(isNull(paymentsTable.sourceTripCostId));
    }
    if (dateFrom) conditions.push(sql`${paymentsTable.createdAt} >= ${dateFrom}::timestamptz` as ReturnType<typeof eq>);
    if (dateTo) conditions.push(sql`${paymentsTable.createdAt} <= (${dateTo}::date + interval '1 day - 1 millisecond')` as ReturnType<typeof eq>);
    // Treat due-date filter values as Brazil calendar days and include the full
    // final day by using an exclusive boundary at the next BRT midnight.
    if (dueDateFrom) {
      conditions.push(gte(paymentsTable.dueDate, new Date(`${dueDateFrom}T03:00:00.000Z`)));
    }
    if (dueDateTo) {
      const endExclusive = new Date(`${dueDateTo}T03:00:00.000Z`);
      endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
      conditions.push(lt(paymentsTable.dueDate, endExclusive));
    }

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
      .where(and(...conditions)).orderBy(asc(paymentsTable.dueDate), asc(paymentsTable.id))
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
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.CREATE)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = CreatePaymentBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message))); return; }

    let reservationClientId: string | null = null;
    let reservationTotalValue: string | null = null;
    let reservationStoreOrderId: string | null = null;
    if (parsed.data.reservationId) {
      const [reservation] = await db.select({
        storeOrderId: reservationsTable.storeOrderId,
      }).from(reservationsTable)
        .where(and(eq(reservationsTable.id, parsed.data.reservationId), eq(reservationsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!reservation) { next(new NotFoundError("Reservation not found or not in tenant", "RESERVATION_NOT_FOUND")); return; }
      reservationStoreOrderId = reservation.storeOrderId;
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
    const canSetPaymentStatus = hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.EDIT);
    const explicitStatus = canSetPaymentStatus && parsed.data.status != null ? parsePaymentStatus(parsed.data.status) : undefined;
    const explicitPaidAt = canSetPaymentStatus && parsed.data.paidAt ? new Date(parsed.data.paidAt) : undefined;
    const isReceivedPayment = explicitStatus === PAYMENT_STATUS.PAID || explicitStatus === PAYMENT_STATUS.APPROVED;
    const totalCents = Math.round(parsed.data.amount * 100);
    const installmentBaseCents = Math.floor(totalCents / installments);
    const installmentRemainderCents = totalCents - installmentBaseCents * installments;
    // Keep all installment rows in one transaction. In particular, a failure
    // inserting a later installment must roll back rows already inserted.
    // Events are returned only after the transaction commits so post-commit
    // reconciliation cannot observe a partially-created payment.
    const createdPaymentEvents = await db.transaction(async (tx) => {
      const events: Array<{ id: string; amount: number }> = [];

      // A payment for a storefront reservation must share the order lock with
      // expiry and gateway confirmation. Otherwise the insert could happen after
      // the expiry transaction cancelled the reservation, leaving a paid row on a
      // released seat. The reservation re-check also rejects a late manual
      // payment that reaches this endpoint after the hold has already elapsed.
      if (parsed.data.reservationId) {
        // Match the expiry/gateway lock order: store order first, reservation
        // second. The initial read is only used to locate the order; all
        // mutable state is re-read under these locks below.
        if (reservationStoreOrderId) {
          const [lockedOrder] = await tx
            .select({
              status: storeOrdersTable.status,
              paymentStatus: storeOrdersTable.paymentStatus,
            })
            .from(storeOrdersTable)
            .where(and(
              eq(storeOrdersTable.tenantId, me.tenantId),
              eq(storeOrdersTable.orderNumber, reservationStoreOrderId),
            ))
            .for("update")
            .limit(1);
          if (
            !lockedOrder
            || lockedOrder.status === "cancelled"
            || lockedOrder.paymentStatus === "refunded"
          ) {
            throw new ConflictError("Não é possível receber pagamento de um pedido encerrado", "ORDER_CLOSED");
          }
        }

        const [lockedReservation] = await tx
          .select({
            id: reservationsTable.id,
            clientId: reservationsTable.clientId,
            totalValue: reservationsTable.totalValue,
            status: reservationsTable.status,
            storeOrderId: reservationsTable.storeOrderId,
            expiresAt: reservationsTable.expiresAt,
            isGratuidade: reservationsTable.isGratuidade,
          })
          .from(reservationsTable)
          .where(and(
            eq(reservationsTable.id, parsed.data.reservationId),
            eq(reservationsTable.tenantId, me.tenantId),
          ))
          .for("update")
          .limit(1);
        if (!lockedReservation) {
          throw new NotFoundError("Reservation not found or not in tenant", "RESERVATION_NOT_FOUND");
        }
        if (lockedReservation.isGratuidade) {
          throw new ConflictError(
            "Não é possível registrar um pagamento em uma reserva com gratuidade.",
            "GRATUITY_PAYMENT_FORBIDDEN",
          );
        }
        reservationClientId = lockedReservation.clientId;
        reservationTotalValue = lockedReservation.totalValue;
        if (
          lockedReservation.status === "cancelled"
          || lockedReservation.status === "failed"
          || lockedReservation.status === "refunded"
        ) {
          throw new ConflictError("Não é possível receber pagamento de uma reserva encerrada", "RESERVATION_CLOSED");
        }
        if (
          lockedReservation.status === "pending"
          && lockedReservation.expiresAt
          && lockedReservation.expiresAt <= new Date()
        ) {
          throw new ConflictError("O prazo para pagamento desta reserva expirou", "RESERVATION_EXPIRED");
        }
        if (parsed.data.clientId && parsed.data.clientId !== lockedReservation.clientId) {
          throw new ValidationError(
            "O cliente do pagamento deve corresponder ao cliente da reserva.",
            "PAYMENT_CLIENT_RESERVATION_MISMATCH",
          );
        }
        if (isReceivedPayment) {
          const paidValue = await sumPaidReservationPayments(
            tx,
            parsed.data.reservationId,
            me.tenantId,
          );
          const currentBalance = roundMoney(Math.max(
            0,
            roundMoney(Number(lockedReservation.totalValue)) - paidValue,
          ));
          if (roundMoney(parsed.data.amount) > currentBalance) {
            throw new ValidationError(
              "O valor do pagamento não pode ser maior do que o saldo devedor da reserva.",
              "PAYMENT_EXCEEDS_BALANCE",
            );
          }
        }
      }

      for (let i = 1; i <= installments; i++) {
        const dueDate = new Date(parsed.data.dueDate);
        dueDate.setMonth(dueDate.getMonth() + (i - 1));
        const installmentCents = installmentBaseCents + (i <= installmentRemainderCents ? 1 : 0);
        const paymentId = i === 1 ? id : generateId();
        events.push({ id: paymentId, amount: installmentCents / 100 });
        await tx.insert(paymentsTable).values({
          id: paymentId,
          tenantId: me.tenantId,
          reservationId: parsed.data.reservationId ?? null,
          clientId: parsed.data.clientId ?? reservationClientId,
          type: parsePaymentType(parsed.data.type),
          category: parsed.data.category,
          amount: (installmentCents / 100).toFixed(2),
          paymentMethod: parsed.data.paymentMethod,
          installmentNumber: i,
          totalInstallments: installments,
          dueDate,
          description: parsed.data.description ?? null,
          notes: parsed.data.notes ?? null,
          receiptUrl,
          ...(explicitStatus ? { status: explicitStatus } : {}),
          ...(explicitPaidAt ? { paidAt: explicitPaidAt } : {}),
          ...(parsed.data.reservationId && parsed.data.type === PAYMENT_TYPE.RECEIVABLE
            ? { gateway: "manual-reservation", transactionId: paymentId }
            : {}),
        });
      }
      return events;
    });

    const [payment] = await db.select().from(paymentsTable)
      .where(and(eq(paymentsTable.id, id), eq(paymentsTable.tenantId, me.tenantId)))
      .limit(1);
    if (!payment) { next(new AppError("Failed to create payment", 500, "PAYMENT_CREATE_FAILED")); return; }
    const effectiveClientId = parsed.data.clientId ?? reservationClientId;
    if (effectiveClientId) {
      try {
        await recalculateClientFinancials(effectiveClientId, me.tenantId);
      } catch (err) {
        req.log.error({ err }, "Error recalculating client financials after payment creation — non-fatal");
      }
    }
    if (parsed.data.reservationId) {
      await syncReservationPaymentStatus(parsed.data.reservationId, me.tenantId);
      if (payment.status === PAYMENT_STATUS.PAID && payment.type === PAYMENT_TYPE.RECEIVABLE) {
        for (const event of createdPaymentEvents) {
          await syncStoreOrderFromReservationPayment(parsed.data.reservationId, me.tenantId, {
            received: {
              gateway: "manual-reservation",
              transactionId: event.id,
              amount: event.amount,
              occurredAt: payment.paidAt ?? new Date(),
            },
          });
        }
        await convertPaidReservationReferral(parsed.data.reservationId, me.tenantId);
      }
      await syncReservationCommission(parsed.data.reservationId, me.tenantId);
    }
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
    if (effectiveClientId && parsed.data.reservationId && explicitStatus === PAYMENT_STATUS.PAID && parsed.data.type === PAYMENT_TYPE.RECEIVABLE) {
      await moveDealToStage({
        tenantId: me.tenantId,
        clientId: effectiveClientId,
        reservationId: parsed.data.reservationId ?? null,
        targetStageName: "Pagamento Confirmado",
        forwardOnly: true,
      });
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

router.post("/operational-cost-payables", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    const parsed = CreateOperationalCostPayableBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos", "VALIDATION_ERROR"));
      return;
    }

    const requestedPaymentId = parsed.data.paymentId?.trim() || null;
    const paymentMethod = parsed.data.paymentMethod?.trim() || "";
    const providedDueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
    if (parsed.data.dueDate && (!providedDueDate || Number.isNaN(providedDueDate.getTime()))) {
      next(new ValidationError("Informe uma data de vencimento válida.", "VALIDATION_ERROR"));
      return;
    }
    if (requestedPaymentId) {
      if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.EDIT)) {
        next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
      }
    } else {
      if (!paymentMethod) {
        next(new ValidationError("Informe a forma de pagamento da nova conta.", "VALIDATION_ERROR"));
        return;
      }
      if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.CREATE)) {
        next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
      }
    }

    const result = await db.transaction(async (tx) => {
      const sourceColumn = parsed.data.sourceType === "expense"
        ? paymentsTable.sourceExpenseId
        : paymentsTable.sourceTripCostId;
      const [linkSnapshot] = await tx.select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(and(
          eq(sourceColumn, parsed.data.sourceId),
          eq(paymentsTable.tenantId, me.tenantId),
          eq(paymentsTable.type, PAYMENT_TYPE.PAYABLE),
        ))
        .limit(1);

      let lockedPayment: typeof paymentsTable.$inferSelect | null = null;
      if (linkSnapshot) {
        const [payment] = await tx.select().from(paymentsTable)
          .where(and(
            eq(paymentsTable.id, linkSnapshot.id),
            eq(paymentsTable.tenantId, me.tenantId),
          ))
          .for("update").limit(1);
        lockedPayment = payment ?? null;
      } else if (requestedPaymentId) {
        const [payment] = await tx.select().from(paymentsTable)
          .where(and(
            eq(paymentsTable.id, requestedPaymentId),
            eq(paymentsTable.tenantId, me.tenantId),
          ))
          .for("update").limit(1);
        if (!payment) throw new NotFoundError("Conta a pagar não encontrada.", "NOT_FOUND");
        lockedPayment = payment;
      }

      const source = await lockOperationalCostSource(
        tx,
        parsed.data.sourceType,
        parsed.data.sourceId,
        me.tenantId,
      );
      if (!source) throw new NotFoundError("Custo operacional não encontrado.", "NOT_FOUND");
      if (source.sourceType === "trip_cost" && source.linkedExpense) {
        throw new ConflictError(
          "Vincule a conta à despesa da agência, que já representa este custo.",
          "OPERATIONAL_COST_SOURCE_LINKED",
        );
      }

      const sourceAmount = source.row.amount;
      const sourceStatus = toPayableStatus(source.row.status);
      const [currentLink] = await tx.select().from(paymentsTable)
        .where(and(
          eq(sourceColumn, parsed.data.sourceId),
          eq(paymentsTable.tenantId, me.tenantId),
          eq(paymentsTable.type, PAYMENT_TYPE.PAYABLE),
        ))
        .limit(1);
      if (currentLink && currentLink.id !== lockedPayment?.id) {
        throw new ConflictError("O vínculo mudou durante a operação. Tente novamente.", "OPERATIONAL_COST_LINK_CHANGED");
      }

      if (currentLink) {
        if (requestedPaymentId && currentLink.id !== requestedPaymentId) {
          throw new ConflictError("Este custo já está vinculado a outra conta a pagar.", "OPERATIONAL_COST_PAYABLE_EXISTS");
        }
        assertPayableMatchesOperationalCost({
          costAmount: sourceAmount,
          costStatus: sourceStatus,
          payable: currentLink,
        });
        const sourcePaidAt = source.sourceType === "expense" ? source.row.paymentDate : source.row.paidAt;
        const paidAt = sourceStatus === PAYMENT_STATUS.PAID
          ? currentLink.paidAt ?? sourcePaidAt ?? new Date()
          : null;
        await tx.update(paymentsTable).set({ paidAt, updatedAt: new Date() })
          .where(and(eq(paymentsTable.id, currentLink.id), eq(paymentsTable.tenantId, me.tenantId)));
        await syncOperationalCostPaidAt(tx, source, me.tenantId, paidAt);
        const [refreshedPayment] = await tx.select().from(paymentsTable)
          .where(and(eq(paymentsTable.id, currentLink.id), eq(paymentsTable.tenantId, me.tenantId)))
          .limit(1);
        if (!refreshedPayment) throw new AppError("Não foi possível atualizar a conta a pagar.", 500, "PAYMENT_UPDATE_FAILED");
        return { payment: refreshedPayment, created: false };
      }

      if (requestedPaymentId) {
        if (!lockedPayment || lockedPayment.id !== requestedPaymentId) {
          throw new ConflictError("A conta a pagar mudou durante a operação. Tente novamente.", "OPERATIONAL_COST_LINK_CHANGED");
        }
        if (
          lockedPayment.reservationId
          || lockedPayment.orderId
          || lockedPayment.clientId
          || lockedPayment.sourceExpenseId
          || lockedPayment.sourceTripCostId
        ) {
          throw new ConflictError("Este lançamento já pertence a outro registro financeiro.", "PAYMENT_ALREADY_ASSOCIATED");
        }
        assertPayableMatchesOperationalCost({
          costAmount: sourceAmount,
          costStatus: sourceStatus,
          payable: lockedPayment,
        });
        const sourcePaidAt = source.sourceType === "expense" ? source.row.paymentDate : source.row.paidAt;
        const paidAt = sourceStatus === PAYMENT_STATUS.PAID
          ? lockedPayment.paidAt ?? sourcePaidAt ?? new Date()
          : null;
        await tx.update(paymentsTable).set({
          sourceExpenseId: parsed.data.sourceType === "expense" ? parsed.data.sourceId : null,
          sourceTripCostId: parsed.data.sourceType === "trip_cost" ? parsed.data.sourceId : null,
          paidAt,
          updatedAt: new Date(),
        }).where(and(
          eq(paymentsTable.id, lockedPayment.id),
          eq(paymentsTable.tenantId, me.tenantId),
          isNull(paymentsTable.sourceExpenseId),
          isNull(paymentsTable.sourceTripCostId),
        ));
        await syncOperationalCostPaidAt(tx, source, me.tenantId, paidAt);
        const [linkedPayment] = await tx.select().from(paymentsTable)
          .where(and(eq(paymentsTable.id, lockedPayment.id), eq(paymentsTable.tenantId, me.tenantId)))
          .limit(1);
        if (!linkedPayment) throw new ConflictError("Não foi possível vincular a conta a pagar.", "PAYMENT_LINK_FAILED");
        return { payment: linkedPayment, created: false };
      }

      const dueDate = source.row.dueDate ?? providedDueDate;
      if (!dueDate) {
        throw new ValidationError("Informe o vencimento para este custo operacional.", "VALIDATION_ERROR");
      }
      const sourcePaidAt = source.sourceType === "expense" ? source.row.paymentDate : source.row.paidAt;
      const paidAt = sourceStatus === PAYMENT_STATUS.PAID ? sourcePaidAt ?? new Date() : null;
      await syncOperationalCostPaidAt(tx, source, me.tenantId, paidAt);
      const paymentId = generateId();
      await tx.insert(paymentsTable).values({
        id: paymentId,
        tenantId: me.tenantId,
        reservationId: null,
        clientId: null,
        orderId: null,
        type: PAYMENT_TYPE.PAYABLE,
        category: source.row.category,
        amount: String(sourceAmount),
        paymentMethod,
        installmentNumber: 1,
        totalInstallments: 1,
        dueDate,
        paidAt,
        status: sourceStatus,
        description: source.row.description,
        notes: source.row.notes ?? null,
        sourceExpenseId: parsed.data.sourceType === "expense" ? parsed.data.sourceId : null,
        sourceTripCostId: parsed.data.sourceType === "trip_cost" ? parsed.data.sourceId : null,
      });
      const [createdPayment] = await tx.select().from(paymentsTable)
        .where(and(eq(paymentsTable.id, paymentId), eq(paymentsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!createdPayment) throw new AppError("Não foi possível criar a conta a pagar.", 500, "PAYMENT_CREATE_FAILED");
      return { payment: createdPayment, created: true };
    });
    res.status(result.created ? 201 : 200).json(formatPayment(result.payment));
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
      next(new ConflictError("Este custo já está vinculado a uma conta a pagar.", "OPERATIONAL_COST_PAYABLE_EXISTS"));
      return;
    }
    next(err);
  }
});

router.delete("/operational-cost-payables/:sourceType/:sourceId", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.EDIT)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    if (req.params.sourceType !== "expense" && req.params.sourceType !== "trip_cost") {
      next(new ValidationError("Origem do custo operacional inválida.", "VALIDATION_ERROR"));
      return;
    }
    const sourceType = req.params.sourceType as OperationalCostSourceType;
    await db.transaction(async (tx) => {
      const sourceColumn = sourceType === "expense" ? paymentsTable.sourceExpenseId : paymentsTable.sourceTripCostId;
      const [snapshot] = await tx.select({ id: paymentsTable.id }).from(paymentsTable)
        .where(and(
          eq(sourceColumn, req.params.sourceId),
          eq(paymentsTable.tenantId, me.tenantId),
          eq(paymentsTable.type, PAYMENT_TYPE.PAYABLE),
        ))
        .limit(1);
      if (!snapshot) return;

      const [payment] = await tx.select().from(paymentsTable)
        .where(and(eq(paymentsTable.id, snapshot.id), eq(paymentsTable.tenantId, me.tenantId)))
        .for("update").limit(1);
      if (!payment) return;
      const source = await lockOperationalCostSource(tx, sourceType, req.params.sourceId, me.tenantId);
      if (!source) return;
      const currentSourceId = sourceType === "expense" ? payment.sourceExpenseId : payment.sourceTripCostId;
      if (currentSourceId !== req.params.sourceId) {
        throw new ConflictError("O vínculo mudou durante a operação. Tente novamente.", "OPERATIONAL_COST_LINK_CHANGED");
      }
      await tx.update(paymentsTable).set({
        sourceExpenseId: null,
        sourceTripCostId: null,
        updatedAt: new Date(),
      }).where(and(
        eq(paymentsTable.id, payment.id),
        eq(paymentsTable.tenantId, me.tenantId),
      ));
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

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
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = UpdatePaymentBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message))); return; }
    const updates: Partial<typeof paymentsTable.$inferInsert> = {};
    if (parsed.data.status != null) updates.status = parsePaymentStatus(parsed.data.status);
    if (parsed.data.paidAt !== undefined) updates.paidAt = parsed.data.paidAt ? new Date(parsed.data.paidAt) : null;
    if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes ?? null;
    const isActivePaymentStatusUpdate = updates.status === PAYMENT_STATUS.PAID
      || updates.status === PAYMENT_STATUS.APPROVED;
    // A new paid receivable must serialize with storefront expiry/refunds and
    // orderless expiry before the payment is changed. The locator reads below
    // only identify rows to lock; all mutable state is checked again under lock.
    // Other updates retain payment -> reservation ordering for referral reversal.
    const result = await db.transaction(async (tx) => {
      const [locator] = isActivePaymentStatusUpdate
        ? await tx.select({
          type: paymentsTable.type,
          reservationId: paymentsTable.reservationId,
          orderId: paymentsTable.orderId,
        }).from(paymentsTable)
          .where(and(eq(paymentsTable.id, req.params.id), eq(paymentsTable.tenantId, me.tenantId)))
          .limit(1)
        : [];
      let locatedStoreOrderId: string | null = null;
      let lockedOrder: Pick<typeof storeOrdersTable.$inferSelect, "id" | "orderNumber" | "status" | "paymentStatus"> | undefined;
      if (locator?.type === PAYMENT_TYPE.RECEIVABLE) {
        if (locator.reservationId) {
          const [reservationLocator] = await tx.select({ storeOrderId: reservationsTable.storeOrderId })
            .from(reservationsTable)
            .where(and(eq(reservationsTable.id, locator.reservationId), eq(reservationsTable.tenantId, me.tenantId)))
            .limit(1);
          if (!reservationLocator) throw new NotFoundError("Reservation not found or not in tenant", "RESERVATION_NOT_FOUND");
          locatedStoreOrderId = reservationLocator.storeOrderId;
        }
        if (locator.orderId || locatedStoreOrderId) {
          const [order] = await tx.select({
            id: storeOrdersTable.id,
            orderNumber: storeOrdersTable.orderNumber,
            status: storeOrdersTable.status,
            paymentStatus: storeOrdersTable.paymentStatus,
          }).from(storeOrdersTable)
            .where(and(
              eq(storeOrdersTable.tenantId, me.tenantId),
              locator.orderId
                ? eq(storeOrdersTable.id, locator.orderId)
                : eq(storeOrdersTable.orderNumber, locatedStoreOrderId!),
            ))
            .for("update")
            .limit(1);
          if (!order || (locatedStoreOrderId && order.orderNumber !== locatedStoreOrderId)) {
            throw new ConflictError("O pedido associado ao pagamento mudou ou não existe", "PAYMENT_ORDER_CHANGED");
          }
          lockedOrder = order;
        }
      }

      const [existingPayment] = await tx.select().from(paymentsTable)
        .where(and(eq(paymentsTable.id, req.params.id), eq(paymentsTable.tenantId, me.tenantId)))
        .for("update")
        .limit(1);
      if (!existingPayment) return { payment: null, reversal: null, previousStatus: null };

      const hasOperationalCostLink = Boolean(existingPayment.sourceExpenseId || existingPayment.sourceTripCostId);
      if (hasOperationalCostLink && (updates.status !== undefined || updates.paidAt !== undefined)) {
        const nextStatus = updates.status ?? existingPayment.status;
        toOperationalCostStatus(nextStatus);
        if (nextStatus !== PAYMENT_STATUS.PAID) {
          if (updates.paidAt) {
            throw new ConflictError("Informe a data de pagamento somente para uma conta paga.", "OPERATIONAL_COST_PAID_AT_INVALID");
          }
          updates.paidAt = null;
        } else if (
          updates.status === PAYMENT_STATUS.PAID
          && updates.paidAt === undefined
          && !existingPayment.paidAt
        ) {
          updates.paidAt = new Date();
        }
      }

      if (isActivePaymentStatusUpdate) {
        if (
          !locator
          || locator.type !== existingPayment.type
          || locator.reservationId !== existingPayment.reservationId
          || locator.orderId !== existingPayment.orderId
        ) {
          throw new ConflictError("O pagamento mudou durante a confirmação. Tente novamente.", "PAYMENT_CHANGED");
        }
        if (existingPayment.type === PAYMENT_TYPE.RECEIVABLE) {
          if (
            lockedOrder?.status === "cancelled"
            || lockedOrder?.paymentStatus === "refunded"
          ) {
            throw new ConflictError("Não é possível receber pagamento de um pedido encerrado", "ORDER_CLOSED");
          }
          // Lock only when the payment's active status is changing. In
          // particular, an unchanged PAID status only edits metadata and keeps
          // the payment -> reservation order used by referral reversals.
          if (existingPayment.status !== updates.status) {
            const assertOpen = (reservation: { status: string; expiresAt: Date | null }) => {
              if (["cancelled", "failed", "refunded"].includes(reservation.status)) {
                throw new ConflictError("Não é possível receber pagamento de uma reserva encerrada", "RESERVATION_CLOSED");
              }
              if (
                reservation.status === RESERVATION_STATUS.PENDING
                && reservation.expiresAt
                && reservation.expiresAt <= new Date()
              ) {
                throw new ConflictError("O prazo para pagamento desta reserva expirou", "RESERVATION_EXPIRED");
              }
            };
            if (existingPayment.reservationId) {
              const [reservation] = await tx.select({
                totalValue: reservationsTable.totalValue,
                status: reservationsTable.status,
                storeOrderId: reservationsTable.storeOrderId,
                expiresAt: reservationsTable.expiresAt,
                isGratuidade: reservationsTable.isGratuidade,
              }).from(reservationsTable)
                .where(and(
                  eq(reservationsTable.id, existingPayment.reservationId),
                  eq(reservationsTable.tenantId, me.tenantId),
                ))
                .for("update")
                .limit(1);
              if (!reservation) throw new NotFoundError("Reservation not found or not in tenant", "RESERVATION_NOT_FOUND");
              if (reservation.storeOrderId !== locatedStoreOrderId) {
                throw new ConflictError("O pedido da reserva mudou durante a confirmação", "PAYMENT_ORDER_CHANGED");
              }
              if (reservation.isGratuidade) {
                throw new ConflictError(
                  "Não é possível registrar um pagamento em uma reserva com gratuidade.",
                  "GRATUITY_PAYMENT_FORBIDDEN",
                );
              }
              assertOpen(reservation);
              const paidValue = await sumPaidReservationPayments(
                tx,
                existingPayment.reservationId,
                me.tenantId,
              );
              const currentBalance = roundMoney(Math.max(
                0,
                roundMoney(Number(reservation.totalValue)) - paidValue,
              ));
              if (roundMoney(Number(existingPayment.amount)) > currentBalance) {
                throw new ValidationError(
                  "O valor do pagamento não pode ser maior do que o saldo devedor da reserva.",
                  "PAYMENT_EXCEEDS_BALANCE",
                );
              }
            } else if (lockedOrder) {
              const reservations = await tx.select({
                status: reservationsTable.status,
                expiresAt: reservationsTable.expiresAt,
              }).from(reservationsTable)
                .where(and(
                  eq(reservationsTable.tenantId, me.tenantId),
                  eq(reservationsTable.storeOrderId, lockedOrder.orderNumber),
                ))
                .orderBy(reservationsTable.id)
                .for("update");
              for (const reservation of reservations) assertOpen(reservation);
            }
          }
        }
      }

      await tx.update(paymentsTable).set(updates)
        .where(and(eq(paymentsTable.id, req.params.id), eq(paymentsTable.tenantId, me.tenantId)));
      const [updatedPayment] = await tx.select().from(paymentsTable)
        .where(and(eq(paymentsTable.id, req.params.id), eq(paymentsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!updatedPayment) return { payment: null, reversal: null, previousStatus: existingPayment.status };
      if (
        (parsed.data.status != null || parsed.data.paidAt !== undefined)
        && (updatedPayment.sourceExpenseId || updatedPayment.sourceTripCostId)
      ) {
        await syncOperationalCostFromPayment(tx, updatedPayment, me.tenantId);
      }

      const reversalReason = paymentReferralReversalReason(updatedPayment.status);
      const reversal = updatedPayment.reservationId
        && updatedPayment.type === PAYMENT_TYPE.RECEIVABLE
        && reversalReason
        ? await reverseReservationReferralIfNoEligiblePaymentInTransaction(tx, {
          reservationId: updatedPayment.reservationId,
          tenantId: me.tenantId,
          reason: reversalReason,
        })
        : null;

      return { payment: updatedPayment, reversal, previousStatus: existingPayment.status };
    });
    const payment = result.payment;
    if (!payment) { next(new NotFoundError("Payment not found", "NOT_FOUND")); return; }
    const transitionedToPaid = result.previousStatus !== PAYMENT_STATUS.PAID
      && payment.status === PAYMENT_STATUS.PAID;
    if (payment.clientId) {
      try {
        await recalculateClientFinancials(payment.clientId, me.tenantId);
      } catch (err) {
        req.log.error({ err }, "Error recalculating client financials after payment update — non-fatal");
      }
    }
    if (payment.reservationId) {
      await syncReservationPaymentStatus(payment.reservationId, me.tenantId);
      await syncStoreOrderFromReservationPayment(
        payment.reservationId,
        me.tenantId,
        {
          ...(payment.status === PAYMENT_STATUS.PAID
            && payment.type === PAYMENT_TYPE.RECEIVABLE
            && result.previousStatus !== PAYMENT_STATUS.PAID
            ? {
              received: {
                gateway: payment.gateway ?? "manual-reservation",
                transactionId: payment.transactionId ?? payment.id,
                amount: Number(payment.amount),
                occurredAt: result.previousStatus !== PAYMENT_STATUS.PENDING
                  ? new Date()
                  : payment.paidAt ?? new Date(),
                reactivated: result.previousStatus !== PAYMENT_STATUS.PENDING,
              },
            }
            : {}),
          ...(result.previousStatus === PAYMENT_STATUS.PAID
            && payment.status !== PAYMENT_STATUS.PAID
            && payment.type === PAYMENT_TYPE.RECEIVABLE
            ? {
              reversed: {
                gateway: payment.gateway ?? "manual-reservation",
                transactionId: payment.transactionId ?? payment.id,
                paymentId: payment.id,
                amount: Number(payment.amount),
                occurredAt: new Date(),
              },
            }
            : {}),
        },
      );
      if (payment.status === PAYMENT_STATUS.PAID && payment.type === PAYMENT_TYPE.RECEIVABLE) {
        await convertPaidReservationReferral(payment.reservationId, me.tenantId);
      }
      if (result.reversal) {
        dispatchReferralReversedEmail({
          referrerId: result.reversal.referrerId,
          referredId: result.reversal.referredId,
          bonusAmount: result.reversal.bonusAmount,
          tenantId: me.tenantId,
          reason: result.reversal.reason,
          referralId: result.reversal.referralId,
          reservationId: result.reversal.reservationId,
        }).catch((err) => req.log.error({ err }, "Error enqueueing referral payment reversal notification"));
      }
      await syncReservationCommission(payment.reservationId, me.tenantId);
    } else if (payment.orderId && payment.type === PAYMENT_TYPE.RECEIVABLE) {
      await syncStoreOrderFromOrderPayment(payment.orderId, me.tenantId, {
        ...(payment.status === PAYMENT_STATUS.PAID && result.previousStatus !== PAYMENT_STATUS.PAID
          ? {
            received: {
              gateway: payment.gateway ?? "manual-reservation",
              transactionId: payment.transactionId ?? payment.id,
              amount: Number(payment.amount),
              occurredAt: result.previousStatus !== PAYMENT_STATUS.PENDING
                ? new Date()
                : payment.paidAt ?? new Date(),
              reactivated: result.previousStatus !== PAYMENT_STATUS.PENDING,
            },
          }
          : {}),
        ...(result.previousStatus === PAYMENT_STATUS.PAID && payment.status !== PAYMENT_STATUS.PAID
          ? {
            reversed: {
              gateway: payment.gateway ?? "manual-reservation",
              transactionId: payment.transactionId ?? payment.id,
              paymentId: payment.id,
              amount: Number(payment.amount),
              occurredAt: new Date(),
            },
          }
          : {}),
      });
    }
    if (payment.reservationId && payment.status === PAYMENT_STATUS.PAID && payment.type === PAYMENT_TYPE.RECEIVABLE) {
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
    if (payment.reservationId && payment.status === PAYMENT_STATUS.PAID && payment.type === PAYMENT_TYPE.RECEIVABLE) {
      await moveDealToStage({
        tenantId: me.tenantId,
        clientId: payment.clientId ?? null,
        reservationId: payment.reservationId ?? null,
        targetStageName: "Pagamento Confirmado",
        forwardOnly: true,
      });
    }
    res.json(formatPayment(payment));
    CalendarSyncService.syncPayment(req.params.id)
      .catch((err) => req.log.warn({ err, context: "payment.update", paymentId: req.params.id }, "Calendar sync falhou — continuando"));
    if (transitionedToPaid && payment.reservationId && payment.type === PAYMENT_TYPE.RECEIVABLE) {
      enqueueNewBookingNotificationEmail(payment.reservationId, me.tenantId)
        .catch((err) => req.log.error({ err }, "Error enqueueing agency new-booking notification on payment update"));
    }
    if (transitionedToPaid && payment.type === PAYMENT_TYPE.RECEIVABLE && payment.clientId) {
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
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.DELETE)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }

    // Use the same payment-first lock order as PATCH /payments/:id. The
    // payment remains locked while the referral reversal checks for other
    // eligible payments, closing the refund-vs-delete race.
    const result = await db.transaction(async (tx) => {
      const [payment] = await tx.select().from(paymentsTable)
        .where(and(eq(paymentsTable.id, req.params.id), eq(paymentsTable.tenantId, me.tenantId)))
        .for("update")
        .limit(1);
      if (!payment) return { payment: null, reversal: null };
      if (payment.sourceExpenseId || payment.sourceTripCostId) {
        throw new ConflictError("Desvincule a conta a pagar do custo operacional antes de excluí-la.", "PAYMENT_LINKED_TO_OPERATIONAL_COST");
      }

      await tx.delete(paymentsTable)
        .where(and(eq(paymentsTable.id, req.params.id), eq(paymentsTable.tenantId, me.tenantId)));

      const wasReferralEligiblePayment = (payment.status === PAYMENT_STATUS.PAID || payment.status === PAYMENT_STATUS.APPROVED)
        && payment.type === PAYMENT_TYPE.RECEIVABLE;
      const reversal = payment.reservationId && wasReferralEligiblePayment
        ? await reverseReservationReferralIfNoEligiblePaymentInTransaction(tx, {
          reservationId: payment.reservationId,
          tenantId: me.tenantId,
          reason: "payment_deleted",
        })
        : null;

      return { payment, reversal };
    });
    const payment = result.payment;
    if (!payment) { next(new NotFoundError("Payment not found", "NOT_FOUND")); return; }

    // Step 2: Recalculate client aggregate financials
    if (payment.clientId) {
      try {
        await recalculateClientFinancials(payment.clientId, me.tenantId);
      } catch (err) {
        req.log.error({ err }, "Error recalculating client financials after payment deletion — non-fatal");
      }
    }

    const wasPaidReceivable = (payment.status === PAYMENT_STATUS.PAID || payment.status === PAYMENT_STATUS.APPROVED)
      && payment.type === PAYMENT_TYPE.RECEIVABLE;
    const wasReferralEligiblePayment = (payment.status === PAYMENT_STATUS.PAID || payment.status === PAYMENT_STATUS.APPROVED)
      && payment.type === PAYMENT_TYPE.RECEIVABLE;

    if (payment.reservationId) {
      // Step 3: Sync reservation paidValue/status and commission after deletion
      await syncReservationPaymentStatus(payment.reservationId, me.tenantId);
      const paymentReversalEvent = wasReferralEligiblePayment ? {
        reversed: {
          gateway: payment.gateway ?? "manual-reservation",
          transactionId: payment.transactionId ?? payment.id,
          paymentId: payment.id,
          amount: Number(payment.amount),
          occurredAt: new Date(),
        },
      } : undefined;
      await syncStoreOrderFromReservationPayment(payment.reservationId, me.tenantId, paymentReversalEvent);
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
      if (result.reversal) {
        dispatchReferralReversedEmail({
          referrerId: result.reversal.referrerId,
          referredId: result.reversal.referredId,
          bonusAmount: result.reversal.bonusAmount,
          tenantId: me.tenantId,
          reason: result.reversal.reason,
          referralId: result.reversal.referralId,
          reservationId: result.reversal.reservationId,
        }).catch((err) => req.log.error({ err }, "Error enqueueing referral payment deletion reversal notification"));
      }
    } else if (wasPaidReceivable) {
      if (payment.orderId) {
        await syncStoreOrderFromOrderPayment(payment.orderId, me.tenantId, {
          reversed: {
            gateway: payment.gateway ?? "manual-reservation",
            transactionId: payment.transactionId ?? payment.id,
            paymentId: payment.id,
            amount: Number(payment.amount),
            occurredAt: new Date(),
          },
        });
      }
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

    const {
      tripId, status, category, supplierId, dateFrom, dateTo,
      page = "1", limit = "20", includeTripCosts, summaryPeriod = "all",
    } = req.query as Record<string, string>;
    const parsedPage = Number.parseInt(page, 10);
    const parsedLimit = Number.parseInt(limit, 10);
    const pageNum = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limitNum = Number.isSafeInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 20;
    const offset = (pageNum - 1) * limitNum;
    if (!Number.isSafeInteger(offset)) {
      next(new ValidationError("O deslocamento da paginação é muito grande"));
      return;
    }
    const shouldIncludeTripCosts = includeTripCosts === "true";

    const conditions: ReturnType<typeof eq>[] = [eq(expensesTable.tenantId, me.tenantId)];
    if (tripId) conditions.push(eq(expensesTable.tripId, tripId));
    if (status) conditions.push(eq(expensesTable.status, parseExpenseStatus(status)));
    if (category) conditions.push(eq(expensesTable.category, category));
    if (supplierId) conditions.push(eq(expensesTable.supplierId, supplierId));
    const fromDate = dateFrom ? new Date(`${dateFrom}T00:00:00.000Z`) : null;
    const toDate = dateTo ? new Date(`${dateTo}T00:00:00.000Z`) : null;
    if (fromDate && !Number.isNaN(fromDate.getTime())) conditions.push(gte(expensesTable.dueDate, fromDate));
    if (toDate && !Number.isNaN(toDate.getTime())) {
      toDate.setUTCDate(toDate.getUTCDate() + 1);
      conditions.push(lt(expensesTable.dueDate, toDate));
    }

    if (shouldIncludeTripCosts) {
      const tripCostConditions: ReturnType<typeof eq>[] = [eq(tripCostsTable.tenantId, me.tenantId)];
      const tripCostDueDate = sql`COALESCE(
        ${tripCostsTable.dueDate},
        date_trunc('day', ${tripCostsTable.createdAt} AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'UTC'
      )`;
      if (tripId) tripCostConditions.push(eq(tripCostsTable.tripId, tripId));
      if (status) tripCostConditions.push(eq(tripCostsTable.status, parseExpenseStatus(status)));
      if (category) tripCostConditions.push(eq(tripCostsTable.category, category));
      if (supplierId) tripCostConditions.push(eq(tripCostsTable.supplierId, supplierId));
      if (fromDate && !Number.isNaN(fromDate.getTime())) tripCostConditions.push(gte(tripCostDueDate, fromDate));
      if (toDate && !Number.isNaN(toDate.getTime())) tripCostConditions.push(lt(tripCostDueDate, toDate));

      const unlinkedTripCostCondition = sql`NOT EXISTS (
        SELECT 1
        FROM ${expensesTable}
        WHERE ${expensesTable.linkedTripCostId} = ${tripCostsTable.id}
          AND ${expensesTable.tenantId} = ${me.tenantId}
      )`;
      const tripCostWhere = and(...tripCostConditions, unlinkedTripCostCondition);
      const validatedSummaryPeriod = ["all", "month", "quarter", "year"].includes(summaryPeriod)
        ? summaryPeriod
        : "all";
      const summaryWindow = getExpenseSummaryWindow(validatedSummaryPeriod);
      const paidThisMonthWindow = getBrazilCurrentMonthWindow();
      const expenseInSummaryPeriod = summaryWindow
        ? sql`${expensesTable.dueDate} >= ${summaryWindow.start} AND ${expensesTable.dueDate} < ${summaryWindow.end}`
        : sql`TRUE`;
      const tripCostInSummaryPeriod = summaryWindow
        ? sql`${tripCostDueDate} >= ${summaryWindow.start} AND ${tripCostDueDate} < ${summaryWindow.end}`
        : sql`TRUE`;
      const [
        consolidatedRowsResult,
        [expenseCountResult],
        [tripCostCountResult],
        expenseSummaryRows,
        tripCostSummaryRows,
      ] = await Promise.all([
        db.execute(sql`
          SELECT *
          FROM (
            SELECT
              ${expensesTable.id} AS "id",
              ${expensesTable.tripId} AS "tripId",
              ${expensesTable.linkedTripCostId} AS "linkedTripCostId",
              ${expensesTable.category} AS "category",
              ${expensesTable.description} AS "description",
              ${expensesTable.amount} AS "amount",
              ${expensesTable.supplierId} AS "supplierId",
              NULL::text AS "supplierName",
              ${expensesTable.paymentMethod} AS "paymentMethod",
              ${expensesTable.paymentDate} AS "paymentDate",
              ${expensesTable.dueDate} AS "dueDate",
              ${expensesTable.dueDate} AS "sortDueDate",
              ${expensesTable.status} AS "status",
              ${expensesTable.notes} AS "notes",
              (
                SELECT ${paymentsTable.id}
                FROM ${paymentsTable}
                WHERE ${paymentsTable.sourceExpenseId} = ${expensesTable.id}
                  AND ${paymentsTable.tenantId} = ${me.tenantId}
                  AND ${paymentsTable.type} = ${PAYMENT_TYPE.PAYABLE}
                LIMIT 1
              ) AS "payablePaymentId",
              (
                SELECT ${paymentsTable.status}
                FROM ${paymentsTable}
                WHERE ${paymentsTable.sourceExpenseId} = ${expensesTable.id}
                  AND ${paymentsTable.tenantId} = ${me.tenantId}
                  AND ${paymentsTable.type} = ${PAYMENT_TYPE.PAYABLE}
                LIMIT 1
              ) AS "payableStatus",
              FALSE AS "payableDueDateRequired",
              ${expensesTable.createdAt} AS "createdAt",
              'agency'::text AS "source"
            FROM ${expensesTable}
            WHERE ${and(...conditions)}

            UNION ALL

            SELECT
              ${tripCostsTable.id} AS "id",
              ${tripCostsTable.tripId} AS "tripId",
              NULL::text AS "linkedTripCostId",
              ${tripCostsTable.category} AS "category",
              ${tripCostsTable.description} AS "description",
              ${tripCostsTable.amount} AS "amount",
              ${tripCostsTable.supplierId} AS "supplierId",
              ${tripCostsTable.supplierName} AS "supplierName",
              NULL::text AS "paymentMethod",
              ${tripCostsTable.paidAt} AS "paymentDate",
              ${tripCostsTable.dueDate} AS "dueDate",
              ${tripCostDueDate} AS "sortDueDate",
              ${tripCostsTable.status} AS "status",
              ${tripCostsTable.notes} AS "notes",
              (
                SELECT ${paymentsTable.id}
                FROM ${paymentsTable}
                WHERE ${paymentsTable.sourceTripCostId} = ${tripCostsTable.id}
                  AND ${paymentsTable.tenantId} = ${me.tenantId}
                  AND ${paymentsTable.type} = ${PAYMENT_TYPE.PAYABLE}
                LIMIT 1
              ) AS "payablePaymentId",
              (
                SELECT ${paymentsTable.status}
                FROM ${paymentsTable}
                WHERE ${paymentsTable.sourceTripCostId} = ${tripCostsTable.id}
                  AND ${paymentsTable.tenantId} = ${me.tenantId}
                  AND ${paymentsTable.type} = ${PAYMENT_TYPE.PAYABLE}
                LIMIT 1
              ) AS "payableStatus",
              (${tripCostsTable.dueDate} IS NULL) AS "payableDueDateRequired",
              ${tripCostsTable.createdAt} AS "createdAt",
              'trip'::text AS "source"
            FROM ${tripCostsTable}
            WHERE ${tripCostWhere}
          ) AS consolidated_expenses
          ORDER BY "sortDueDate" DESC, "createdAt" DESC, "id" DESC, "source" DESC
          LIMIT ${limitNum} OFFSET ${offset}
        `),
        db.select({ count: sql<number>`count(*)` })
          .from(expensesTable).where(and(...conditions)),
        db.select({ count: sql<number>`count(*)` })
          .from(tripCostsTable).where(tripCostWhere),
        db.select({
          category: expensesTable.category,
          status: expensesTable.status,
          total: sql<string>`coalesce(sum(case when ${expensesTable.status} <> 'cancelled' and ${expenseInSummaryPeriod} then ${expensesTable.amount} else 0 end), 0)`,
          paid: sql<string>`coalesce(sum(case when ${expensesTable.status} = 'paid' and ${expenseInSummaryPeriod} then ${expensesTable.amount} else 0 end), 0)`,
          pending: sql<string>`coalesce(sum(case when ${expensesTable.status} = 'pending' and ${expenseInSummaryPeriod} then ${expensesTable.amount} else 0 end), 0)`,
          overdue: sql<string>`coalesce(sum(case when ${expensesTable.status} = 'overdue' and ${expenseInSummaryPeriod} then ${expensesTable.amount} else 0 end), 0)`,
          paidThisMonth: sql<string>`coalesce(sum(case when ${expensesTable.status} = 'paid' and ${expensesTable.paymentDate} >= ${paidThisMonthWindow.start} and ${expensesTable.paymentDate} < ${paidThisMonthWindow.end} then ${expensesTable.amount} else 0 end), 0)`,
        }).from(expensesTable).where(and(...conditions)).groupBy(expensesTable.category, expensesTable.status),
        db.select({
          category: tripCostsTable.category,
          status: tripCostsTable.status,
          total: sql<string>`coalesce(sum(case when ${tripCostsTable.status} <> 'cancelled' and ${tripCostInSummaryPeriod} then ${tripCostsTable.amount} else 0 end), 0)`,
          paid: sql<string>`coalesce(sum(case when ${tripCostsTable.status} = 'paid' and ${tripCostInSummaryPeriod} then ${tripCostsTable.amount} else 0 end), 0)`,
          pending: sql<string>`coalesce(sum(case when ${tripCostsTable.status} = 'pending' and ${tripCostInSummaryPeriod} then ${tripCostsTable.amount} else 0 end), 0)`,
          overdue: sql<string>`coalesce(sum(case when ${tripCostsTable.status} = 'overdue' and ${tripCostInSummaryPeriod} then ${tripCostsTable.amount} else 0 end), 0)`,
          paidThisMonth: sql<string>`coalesce(sum(case when ${tripCostsTable.status} = 'paid' and ${tripCostsTable.paidAt} >= ${paidThisMonthWindow.start} and ${tripCostsTable.paidAt} < ${paidThisMonthWindow.end} then ${tripCostsTable.amount} else 0 end), 0)`,
        }).from(tripCostsTable).where(tripCostWhere).groupBy(tripCostsTable.category, tripCostsTable.status),
      ]);
      const total = Number(expenseCountResult?.count ?? 0) + Number(tripCostCountResult?.count ?? 0);

      res.json({
        data: (consolidatedRowsResult.rows as ConsolidatedExpenseRow[]).map(formatConsolidatedExpense),
        total,
        page: pageNum,
        limit: limitNum,
        summary: buildExpenseSummary([...expenseSummaryRows, ...tripCostSummaryRows] as ExpenseSummaryAggregate[]),
      });
      return;
    }

    const expenses = await db.select({
      expense: expensesTable,
      payablePaymentId: paymentsTable.id,
      payableStatus: paymentsTable.status,
    }).from(expensesTable)
      .leftJoin(paymentsTable, and(
        eq(paymentsTable.sourceExpenseId, expensesTable.id),
        eq(paymentsTable.tenantId, me.tenantId),
        eq(paymentsTable.type, PAYMENT_TYPE.PAYABLE),
      ))
      .where(and(...conditions)).orderBy(desc(expensesTable.dueDate))
      .limit(limitNum).offset(offset);

    const [countResult] = await db.select({ count: sql<number>`count(*)` })
      .from(expensesTable).where(and(...conditions));

    res.json({
      data: expenses.map(row => formatExpense(
        row.expense,
        row.payablePaymentId ? { id: row.payablePaymentId, status: row.payableStatus ?? "" } : null,
      )),
      total: Number(countResult?.count ?? 0),
      page: pageNum,
      limit: limitNum,
    });
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
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.EDIT)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = UpdateExpenseBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message))); return; }
    const result = await db.transaction(async (tx) => {
      const [payableSnapshot] = await tx.select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(and(
          eq(paymentsTable.sourceExpenseId, req.params.id),
          eq(paymentsTable.tenantId, me.tenantId),
          eq(paymentsTable.type, PAYMENT_TYPE.PAYABLE),
        ))
        .limit(1);
      let linkedPayment: typeof paymentsTable.$inferSelect | null = null;
      if (payableSnapshot) {
        const [lockedPayment] = await tx.select().from(paymentsTable)
          .where(and(
            eq(paymentsTable.id, payableSnapshot.id),
            eq(paymentsTable.tenantId, me.tenantId),
          ))
          .for("update").limit(1);
        linkedPayment = lockedPayment ?? null;
      }

      const [existing] = await tx.select().from(expensesTable)
        .where(and(eq(expensesTable.id, req.params.id), eq(expensesTable.tenantId, me.tenantId)))
        .for("update").limit(1);
      if (!existing) throw new NotFoundError("Expense not found", "NOT_FOUND");
      const [currentPayable] = await tx.select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(and(
          eq(paymentsTable.sourceExpenseId, existing.id),
          eq(paymentsTable.tenantId, me.tenantId),
          eq(paymentsTable.type, PAYMENT_TYPE.PAYABLE),
        ))
        .limit(1);
      if ((payableSnapshot?.id ?? null) !== (currentPayable?.id ?? null)) {
        throw new ConflictError("O vínculo com a conta a pagar mudou. Tente novamente.", "OPERATIONAL_COST_LINK_CHANGED");
      }

      const updates: Partial<typeof expensesTable.$inferInsert> = {};
      if (parsed.data.status != null) updates.status = parseExpenseStatus(parsed.data.status);
      if (parsed.data.paymentDate !== undefined) updates.paymentDate = parsed.data.paymentDate ? new Date(parsed.data.paymentDate) : null;
      if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes ?? null;
      if (parsed.data.amount != null) updates.amount = String(parsed.data.amount);

      if (existing.linkedTripCostId) {
        const [linkedCost] = await tx.select().from(tripCostsTable)
          .where(and(
            eq(tripCostsTable.id, existing.linkedTripCostId),
            eq(tripCostsTable.tenantId, me.tenantId),
          ))
          .for("update").limit(1);
        if (!linkedCost || !areExpenseAndTripCostLinkable({
          tripId: existing.tripId,
          amount: updates.amount ?? existing.amount,
          status: updates.status ?? existing.status,
        }, linkedCost)) {
          throw new AppError("Desvincule os registros antes de alterar valor ou status.", 409, "LINKED_EXPENSE_MISMATCH");
        }
      }

      let payableStatus: string | null = linkedPayment?.status ?? null;
      if (linkedPayment && (updates.status !== undefined || updates.paymentDate !== undefined || updates.amount !== undefined)) {
        const nextCostStatus = updates.status ?? existing.status;
        const nextPayableStatus = toPayableStatus(nextCostStatus);
        if (nextPayableStatus !== PAYMENT_STATUS.PAID) {
          if (updates.paymentDate) {
            throw new ConflictError("Informe a data de pagamento somente para uma despesa paga.", "OPERATIONAL_COST_PAID_AT_INVALID");
          }
          updates.paymentDate = null;
        } else if (
          updates.paymentDate === undefined
          &&
          updates.status === PAYMENT_STATUS.PAID
        ) {
          updates.paymentDate = new Date();
        } else if (nextPayableStatus === PAYMENT_STATUS.PAID && updates.paymentDate === undefined) {
          updates.paymentDate = existing.paymentDate ?? linkedPayment.paidAt ?? null;
        }
        const paymentDate = updates.paymentDate ?? null;
        await tx.update(paymentsTable).set({
          amount: updates.amount ?? linkedPayment.amount,
          status: nextPayableStatus,
          paidAt: nextPayableStatus === PAYMENT_STATUS.PAID ? paymentDate ?? null : null,
          updatedAt: new Date(),
        }).where(and(
          eq(paymentsTable.id, linkedPayment.id),
          eq(paymentsTable.tenantId, me.tenantId),
        ));
        payableStatus = nextPayableStatus;
      }

      await tx.update(expensesTable).set(updates)
        .where(and(eq(expensesTable.id, req.params.id), eq(expensesTable.tenantId, me.tenantId)));
      const [updated] = await tx.select().from(expensesTable)
        .where(and(eq(expensesTable.id, req.params.id), eq(expensesTable.tenantId, me.tenantId)))
        .limit(1);
      if (!updated) throw new NotFoundError("Expense not found", "NOT_FOUND");
      return {
        expense: updated,
        payable: linkedPayment ? { id: linkedPayment.id, status: payableStatus ?? linkedPayment.status } : null,
      };
    });
    res.json(formatExpense(result.expense, result.payable));
  } catch (err) {
    req.log.error({ err }, "Error updating expense");
    next(err);
  }
});

router.post("/expenses/:id/trip-cost-link", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.EDIT)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }
    const parsed = LinkExpenseToTripCostBody.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError(parsed.error.issues[0]?.message ?? "Dados inválidos", "VALIDATION_ERROR")); return;
    }

    await db.transaction(async (tx) => {
      const [expense] = await tx.select().from(expensesTable)
        .where(and(eq(expensesTable.id, req.params.id), eq(expensesTable.tenantId, me.tenantId)))
        .for("update").limit(1);
      if (!expense) throw new NotFoundError("Expense not found", "NOT_FOUND");

      const [cost] = await tx.select().from(tripCostsTable)
        .where(and(
          eq(tripCostsTable.id, parsed.data.tripCostId),
          eq(tripCostsTable.tenantId, me.tenantId),
        ))
        .for("update").limit(1);
      if (!cost) throw new NotFoundError("Custo da viagem não encontrado", "NOT_FOUND");

      if (expense.linkedTripCostId === cost.id) return;
      if (expense.linkedTripCostId) {
        throw new AppError("Esta despesa já está vinculada a outro custo.", 409, "EXPENSE_ALREADY_LINKED");
      }
      const [expensePayable] = await tx.select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(and(
          eq(paymentsTable.sourceExpenseId, expense.id),
          eq(paymentsTable.tenantId, me.tenantId),
          eq(paymentsTable.type, PAYMENT_TYPE.PAYABLE),
        ))
        .limit(1);
      const [costPayable] = await tx.select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(and(
          eq(paymentsTable.sourceTripCostId, cost.id),
          eq(paymentsTable.tenantId, me.tenantId),
          eq(paymentsTable.type, PAYMENT_TYPE.PAYABLE),
        ))
        .limit(1);
      if (expensePayable || costPayable) {
        throw new ConflictError(
          "Desvincule as contas a pagar antes de unir a despesa e o custo da viagem.",
          "OPERATIONAL_COST_PAYABLE_LINKED",
        );
      }
      if (!areExpenseAndTripCostLinkable(expense, cost)) {
        throw new AppError("Só é possível vincular registros da mesma viagem com valor e status iguais.", 409, "EXPENSE_TRIP_COST_MISMATCH");
      }

      const [existingLink] = await tx.select({ id: expensesTable.id })
        .from(expensesTable)
        .where(and(
          eq(expensesTable.tenantId, me.tenantId),
          eq(expensesTable.linkedTripCostId, cost.id),
        ))
        .limit(1);
      if (existingLink) {
        throw new AppError("Este custo já está vinculado a outra despesa.", 409, "TRIP_COST_ALREADY_LINKED");
      }

      const [updated] = await tx.update(expensesTable)
        .set({ linkedTripCostId: cost.id })
        .where(and(
          eq(expensesTable.id, expense.id),
          eq(expensesTable.tenantId, me.tenantId),
          isNull(expensesTable.linkedTripCostId),
        ))
        .returning({ id: expensesTable.id });
      if (!updated) throw new AppError("Não foi possível vincular os registros.", 409, "EXPENSE_LINK_CONFLICT");
    });

    res.json({ success: true });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
      next(new AppError("Este custo já está vinculado a outra despesa.", 409, "TRIP_COST_ALREADY_LINKED"));
      return;
    }
    next(err);
  }
});

router.delete("/expenses/:id/trip-cost-link", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.EDIT)) {
      next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return;
    }

    const [expense] = await db.update(expensesTable)
      .set({ linkedTripCostId: null })
      .where(and(eq(expensesTable.id, req.params.id), eq(expensesTable.tenantId, me.tenantId)))
      .returning({ id: expensesTable.id });
    if (!expense) { next(new NotFoundError("Expense not found", "NOT_FOUND")); return; }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/expenses/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!hasPermission(me.role, RESOURCES.FINANCIAL, ACTIONS.DELETE)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    await db.transaction(async (tx) => {
      const [payableSnapshot] = await tx.select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(and(
          eq(paymentsTable.sourceExpenseId, req.params.id),
          eq(paymentsTable.tenantId, me.tenantId),
          eq(paymentsTable.type, PAYMENT_TYPE.PAYABLE),
        ))
        .limit(1);
      let linkedPayment: typeof paymentsTable.$inferSelect | null = null;
      if (payableSnapshot) {
        const [payment] = await tx.select().from(paymentsTable)
          .where(and(eq(paymentsTable.id, payableSnapshot.id), eq(paymentsTable.tenantId, me.tenantId)))
          .for("update").limit(1);
        linkedPayment = payment ?? null;
      }
      const source = await lockOperationalCostSource(tx, "expense", req.params.id, me.tenantId);
      if (!source || source.sourceType !== "expense") return;
      const [currentPayable] = await tx.select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(and(
          eq(paymentsTable.sourceExpenseId, source.row.id),
          eq(paymentsTable.tenantId, me.tenantId),
          eq(paymentsTable.type, PAYMENT_TYPE.PAYABLE),
        ))
        .limit(1);
      if ((payableSnapshot?.id ?? null) !== (currentPayable?.id ?? null)) {
        throw new ConflictError("O vínculo com a conta a pagar mudou. Tente novamente.", "OPERATIONAL_COST_LINK_CHANGED");
      }
      if (linkedPayment && currentPayable) {
        throw new ConflictError("Desvincule a conta a pagar antes de excluir a despesa.", "PAYMENT_LINKED_TO_OPERATIONAL_COST");
      }
      await tx.delete(expensesTable)
        .where(and(eq(expensesTable.id, source.row.id), eq(expensesTable.tenantId, me.tenantId)));
    });
    res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, "Error deleting expense");
    next(err);
  }
});

export default router;
