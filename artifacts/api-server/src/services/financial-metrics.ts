import { and, eq, gte, inArray, isNotNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import {
  db, commissionsTable, expensesTable, financialLedgerEntriesTable, paymentsTable,
  referralCommissionsTable, referralsTable, reservationsTable, tripCostsTable, usersTable,
} from "@workspace/db";

/**
 * Canonical, read-only financial reporting calculation.
 *
 * Amounts are summed as integer centavos.  Source tables deliberately remain
 * separate: a reservation is a booking, a payment is cash/a receivable, and a
 * cost is never inferred from a payable payment.
 */
export const FINANCIAL_TIMEZONE = "America/Sao_Paulo";

export const FINANCIAL_METRIC_CONTRACTS = {
  grossBookedRevenue: "Eligible reservations created in the period; totalValue plus discountTotal, before discounts.",
  bookedRevenue: "Eligible reservations created in the period; totalValue (net booked value).",
  receivedRevenue: "Eligible receivable payments paid in the period; each payment id is counted once.",
  receivable: "Open receivable payments due in the period (pending, overdue, or approved); cancelled/refunded/failed payments are excluded.",
  overdueReceivable: "Open receivable payments whose due date is before the report generation time.",
  payable: "Open payable payments due in the period (pending, overdue, or approved).",
  overduePayable: "Open payable payments whose due date is before the report generation time.",
  discounts: "discountTotal attributed from eligible reservations created in the period.",
  clientReferralBonuses: "Non-reversed referral bonusAmount whose bonusPaidAt is in the period.",
  clientReferralCredits: "Non-reversed referral bonusCreditUsedAmount whose bonusCreditUsedAt is in the period.",
  sellerCommissions: "Accrued, non-cancelled seller commissions created in the period; reservation commission fields are not added.",
  sellerCommissionsPaid: "Seller commissions paid in the period, dated by paidAt.",
  referralCommissions: "Accrued, non-cancelled referral commissions created in the period.",
  referralCommissionsPaid: "Referral commissions paid in the period, dated by paidAt.",
  expenses: "Incurred, non-cancelled general expenses due or created in the period.",
  expensesPaid: "General expenses paid in the period, dated by paymentDate.",
  tripCosts: "Incurred, non-cancelled trip costs due or created in the period.",
  tripCostsPaid: "Trip costs paid in the period, dated by paidAt.",
  userReferralBalance: "Current tenant user referral-balance snapshot; it is not filtered by period and is not revenue.",
  userDebt: "Current agency liability to users: referral balances plus unpaid seller and referral commissions.",
  operatingCostsPaid: "Paid general expenses plus paid trip costs. Both sources remain separate and cross-source similarities are diagnostic only.",
  profit: "Cash profit: receivedRevenue minus operatingCostsPaid, paid seller/referral commissions, and client referral bonuses paid.",
  margin: "profit / receivedRevenue * 100 (zero when no received revenue).",
  deduplication: "Rows are de-duplicated only by their immutable id within their own source. Expenses and trip costs are source-distinct and both count; no unsafe amount/date heuristic is used. Ledger entries are disclosed but not folded into totals to avoid double counting their originating referral/commission rows.",
} as const;

export type FinancialPeriod = { start: Date; end: Date; label: string; asOf?: Date };
type Money = number;
type AnyRow = Record<string, unknown>;

const cancelledReservationStatuses = new Set(["cancelled", "refunded", "failed"]);
const excludedStatuses = new Set(["cancelled", "refunded", "failed", "charged_back"]);
const openReceivableStatuses = new Set(["pending", "overdue", "approved"]);
const paidStatus = "paid";

function cents(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.round((numeric + Number.EPSILON) * 100) : 0;
}
function moneyFromCents(value: number): Money { return Number((value / 100).toFixed(2)); }
function inPeriod(value: unknown, period: FinancialPeriod): boolean {
  return value instanceof Date && value >= period.start && value < period.end;
}
function sourceDate(row: AnyRow, fields: string[]): unknown {
  return fields.map(field => row[field]).find(value => value instanceof Date);
}
function eligibleReservation(row: AnyRow): boolean {
  return !cancelledReservationStatuses.has(String(row.status ?? "").toLowerCase());
}
function eligibleRow(row: AnyRow): boolean {
  return !excludedStatuses.has(String(row.status ?? row.settlementStatus ?? "").toLowerCase());
}
function add(target: Record<string, number>, key: string | null | undefined, value: number): void {
  if (key) target[key] = (target[key] ?? 0) + value;
}
function financialZeroes() {
  return {
    grossBookedRevenue: 0, bookedRevenue: 0, receivedRevenue: 0, receivable: 0,
    overdueReceivable: 0, payable: 0, overduePayable: 0,
    discounts: 0, clientReferralBonuses: 0, clientReferralCredits: 0,
    sellerCommissions: 0, sellerCommissionsPaid: 0,
    referralCommissions: 0, referralCommissionsPaid: 0,
    expenses: 0, expensesPaid: 0, tripCosts: 0, tripCostsPaid: 0,
    userReferralBalance: 0, userDebt: 0, operatingCostsPaid: 0,
    profit: 0, margin: 0,
  };
}

/** Returns BRT calendar-month boundaries. Brazil is UTC-03:00 (no DST). */
export function saoPauloMonthPeriod(month: string): FinancialPeriod {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("month must be YYYY-MM");
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year!, monthNumber! - 1, 1, 3));
  const end = new Date(Date.UTC(year!, monthNumber!, 1, 3));
  return { start, end, label: month };
}

export function currentSaoPauloMonth(now = new Date()): FinancialPeriod {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: FINANCIAL_TIMEZONE, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = parts.find(p => p.type === "year")!.value;
  const month = parts.find(p => p.type === "month")!.value;
  return saoPauloMonthPeriod(`${year}-${month}`);
}

export type FinancialMetricSources = {
  reservations: AnyRow[]; payments: AnyRow[]; expenses: AnyRow[]; tripCosts: AnyRow[];
  commissions: AnyRow[]; referralCommissions: AnyRow[]; referrals: AnyRow[]; ledgerEntries: AnyRow[];
  users: AnyRow[];
};

type FinancialMetricSnapshot = {
  overdueReceivable: unknown;
  overduePayable: unknown;
  userReferralBalance: unknown;
  unpaidSellerCommissions: unknown;
  unpaidReferralCommissions: unknown;
};

export function buildFinancialMetricFilters(tenantId: string, period: FinancialPeriod, asOf: Date) {
  const paidReservationsInPeriod = db
    .select({ reservationId: paymentsTable.reservationId })
    .from(paymentsTable)
    .where(and(
      eq(paymentsTable.tenantId, tenantId),
      eq(paymentsTable.type, "receivable"),
      eq(paymentsTable.status, "paid"),
      gte(paymentsTable.paidAt, period.start),
      lt(paymentsTable.paidAt, period.end),
      isNotNull(paymentsTable.reservationId),
    ));
  const periodExpenseRows = <T extends typeof expensesTable | typeof tripCostsTable>(table: T) => or(
    and(gte(table.dueDate, period.start), lt(table.dueDate, period.end)),
    and(gte(table.createdAt, period.start), lt(table.createdAt, period.end)),
  );
  const periodExpenseOrPaidRows = <T extends typeof expensesTable | typeof tripCostsTable>(table: T, paidAt: T extends typeof expensesTable ? typeof expensesTable.paymentDate : typeof tripCostsTable.paidAt) => or(
    periodExpenseRows(table),
    and(eq(table.status, "paid"), gte(paidAt, period.start), lt(paidAt, period.end)),
  );
  const periodCommissionRows = <T extends typeof commissionsTable | typeof referralCommissionsTable>(
    table: T,
    amountDate: T extends typeof commissionsTable ? typeof commissionsTable.createdAt : typeof referralCommissionsTable.createdAt,
    paidAt: T extends typeof commissionsTable ? typeof commissionsTable.paidAt : typeof referralCommissionsTable.paidAt,
  ) => or(
    and(gte(amountDate, period.start), lt(amountDate, period.end)),
    and(eq(table.status, "paid"), gte(paidAt, period.start), lt(paidAt, period.end)),
  );

  return {
    reservations: and(
      eq(reservationsTable.tenantId, tenantId),
      notInArray(reservationsTable.status, ["cancelled", "refunded", "failed"]),
      or(
        and(gte(reservationsTable.createdAt, period.start), lt(reservationsTable.createdAt, period.end)),
        inArray(reservationsTable.id, paidReservationsInPeriod),
      ),
    ),
    payments: and(
      eq(paymentsTable.tenantId, tenantId),
      and(
        ne(paymentsTable.status, "cancelled"),
        ne(paymentsTable.status, "refunded"),
        ne(paymentsTable.status, "failed"),
        ne(paymentsTable.status, "charged_back"),
      ),
      or(
        and(
          eq(paymentsTable.type, "receivable"),
          eq(paymentsTable.status, "paid"),
          gte(paymentsTable.paidAt, period.start),
          lt(paymentsTable.paidAt, period.end),
        ),
        and(
          inArray(paymentsTable.type, ["receivable", "payable"]),
          inArray(paymentsTable.status, ["pending", "overdue", "approved"]),
          gte(paymentsTable.dueDate, period.start),
          lt(paymentsTable.dueDate, period.end),
        ),
      ),
    ),
    expenses: and(
      eq(expensesTable.tenantId, tenantId),
      sql`${expensesTable.status} not in ('cancelled', 'refunded', 'failed', 'charged_back')`,
      periodExpenseOrPaidRows(expensesTable, expensesTable.paymentDate),
    ),
    tripCosts: and(
      eq(tripCostsTable.tenantId, tenantId),
      sql`${tripCostsTable.status} not in ('cancelled', 'refunded', 'failed', 'charged_back')`,
      periodExpenseOrPaidRows(tripCostsTable, tripCostsTable.paidAt),
    ),
    commissions: and(
      eq(commissionsTable.tenantId, tenantId),
      sql`${commissionsTable.status} not in ('cancelled', 'refunded', 'failed', 'charged_back')`,
      periodCommissionRows(commissionsTable, commissionsTable.createdAt, commissionsTable.paidAt),
    ),
    referralCommissions: and(
      eq(referralCommissionsTable.tenantId, tenantId),
      sql`${referralCommissionsTable.status} not in ('cancelled', 'refunded', 'failed', 'charged_back')`,
      periodCommissionRows(referralCommissionsTable, referralCommissionsTable.createdAt, referralCommissionsTable.paidAt),
    ),
    referrals: and(
      eq(referralsTable.tenantId, tenantId),
      and(
        ne(referralsTable.status, "reversed"),
        ne(referralsTable.status, "cancelled"),
        ne(referralsTable.status, "fraud"),
      ),
      or(
        and(gte(referralsTable.bonusPaidAt, period.start), lt(referralsTable.bonusPaidAt, period.end)),
        and(gte(referralsTable.bonusCreditUsedAt, period.start), lt(referralsTable.bonusCreditUsedAt, period.end)),
      ),
    ),
    ledgerEntries: and(
      eq(financialLedgerEntriesTable.tenantId, tenantId),
      gte(financialLedgerEntriesTable.occurredAt, period.start),
      lt(financialLedgerEntriesTable.occurredAt, period.end),
    ),
    users: eq(usersTable.tenantId, tenantId),
    overduePayments: and(
      eq(paymentsTable.tenantId, tenantId),
      inArray(paymentsTable.type, ["receivable", "payable"]),
      inArray(paymentsTable.status, ["pending", "overdue", "approved"]),
      lt(paymentsTable.dueDate, asOf),
    ),
    unpaidSellerCommissions: and(
      eq(commissionsTable.tenantId, tenantId),
      sql`${commissionsTable.status} not in ('paid', 'cancelled', 'refunded', 'failed', 'charged_back')`,
    ),
    unpaidReferralCommissions: and(
      eq(referralCommissionsTable.tenantId, tenantId),
      sql`${referralCommissionsTable.status} not in ('paid', 'cancelled', 'refunded', 'failed', 'charged_back')`,
    ),
  };
}

export async function loadFinancialMetrics(tenantId: string, period: FinancialPeriod) {
  // Keep the same instant for the snapshot predicates and the response.  The
  // period end is exclusive everywhere in this loader, which is important for
  // adjacent BRT calendar periods.
  const asOf = period.asOf ?? new Date();
  const reportPeriod = { ...period, asOf };
  const filters = buildFinancialMetricFilters(tenantId, period, asOf);

  const [
    reservations, payments, expenses, tripCosts, commissions, referralCommissions,
    referrals, ledgerEntries, userBalances, overdueBalances, unpaidSellerRows, unpaidReferralRows,
  ] = await Promise.all([
    // A reservation outside the period is still needed when a payment inside
    // the period must be allocated to its trip.
    db.select().from(reservationsTable).where(filters.reservations),
    db.select().from(paymentsTable).where(filters.payments),
    db.select().from(expensesTable).where(filters.expenses),
    db.select().from(tripCostsTable).where(filters.tripCosts),
    db.select().from(commissionsTable).where(filters.commissions),
    db.select().from(referralCommissionsTable).where(filters.referralCommissions),
    db.select().from(referralsTable).where(filters.referrals),
    db.select().from(financialLedgerEntriesTable).where(filters.ledgerEntries),
    db.select({ total: sql<string>`coalesce(sum(${usersTable.referralBalance}), 0)` })
      .from(usersTable).where(filters.users),
    db.select({
      type: paymentsTable.type,
      total: sql<string>`coalesce(sum(${paymentsTable.amount}), 0)`,
    }).from(paymentsTable).where(filters.overduePayments).groupBy(paymentsTable.type),
    db.select({ total: sql<string>`coalesce(sum(${commissionsTable.commissionAmount}), 0)` })
      .from(commissionsTable).where(filters.unpaidSellerCommissions),
    db.select({ total: sql<string>`coalesce(sum(${referralCommissionsTable.amount}), 0)` })
      .from(referralCommissionsTable).where(filters.unpaidReferralCommissions),
  ]);
  const overdueByType = new Map(overdueBalances.map(row => [row.type, row.total]));
  const snapshot: FinancialMetricSnapshot = {
    overdueReceivable: overdueByType.get("receivable") ?? 0,
    overduePayable: overdueByType.get("payable") ?? 0,
    userReferralBalance: userBalances[0]?.total ?? 0,
    unpaidSellerCommissions: unpaidSellerRows[0]?.total ?? 0,
    unpaidReferralCommissions: unpaidReferralRows[0]?.total ?? 0,
  };
  return calculateFinancialMetrics({
    reservations, payments, expenses, tripCosts, commissions, referralCommissions,
    referrals, ledgerEntries, users: [],
  }, reportPeriod, snapshot);
}

export function calculateFinancialMetrics(
  sources: FinancialMetricSources,
  period: FinancialPeriod,
  snapshot?: FinancialMetricSnapshot,
) {
  const total = financialZeroes();
  const tripReceived: Record<string, number> = {};
  const userSellerCommissions: Record<string, number> = {};
  const reservationTrip = new Map<string, string>();
  const diagnostics = {
    sourceRows: Object.fromEntries(Object.entries(sources).map(([name, rows]) => [name, rows.length])),
    excluded: { reservations: 0, payments: 0, expenses: 0, tripCosts: 0, commissions: 0, referralCommissions: 0, referrals: 0 },
    duplicateIdsIgnored: 0, unallocatedPaymentIds: [] as string[], ledgerEntriesNotIncludedInTotals: 0,
    potentialCrossSourceDuplicates: [] as Array<{ expenseId: string; tripCostId: string }>,
  };
  const asOf = period.asOf ?? new Date();
  const seen = new Set<string>();
  const unique = (source: string, row: AnyRow) => {
    const key = `${source}:${String(row.id ?? "")}`;
    if (!row.id || seen.has(key)) { diagnostics.duplicateIdsIgnored++; return false; }
    seen.add(key); return true;
  };

  for (const row of sources.reservations) {
    if (!unique("reservation", row)) continue;
    if (!eligibleReservation(row)) { diagnostics.excluded.reservations++; continue; }
    reservationTrip.set(String(row.id), String(row.tripId ?? ""));
    if (!inPeriod(row.createdAt, period)) continue;
    total.bookedRevenue += cents(row.totalValue);
    total.discounts += cents(row.discountTotal);
    total.grossBookedRevenue += cents(row.totalValue) + cents(row.discountTotal);
  }
  for (const row of sources.payments) {
    if (!unique("payment", row)) continue;
    if (!eligibleRow(row)) { diagnostics.excluded.payments++; continue; }
    const type = String(row.type).toLowerCase();
    const status = String(row.status).toLowerCase();
    const amount = cents(row.amount);
    if (type === "receivable" && status === paidStatus && inPeriod(row.paidAt, period)) {
      total.receivedRevenue += amount;
      const tripId = reservationTrip.get(String(row.reservationId));
      if (tripId) add(tripReceived, tripId, amount);
      else diagnostics.unallocatedPaymentIds.push(String(row.id));
    } else if (type === "receivable" && openReceivableStatuses.has(status)) {
      if (inPeriod(row.dueDate, period)) total.receivable += amount;
      if (row.dueDate instanceof Date && row.dueDate < asOf) total.overdueReceivable += amount;
    } else if (type === "payable" && openReceivableStatuses.has(status)) {
      if (inPeriod(row.dueDate, period)) total.payable += amount;
      if (row.dueDate instanceof Date && row.dueDate < asOf) total.overduePayable += amount;
    }
  }
  const accumulate = (rows: AnyRow[], source: string, metric: keyof typeof total, dates: string[], tripMap?: Record<string, number>, userMap?: Record<string, number>) => {
    for (const row of rows) {
      if (!unique(source, row)) continue;
      if (!eligibleRow(row)) { (diagnostics.excluded as Record<string, number>)[source]++; continue; }
      if (!inPeriod(sourceDate(row, dates), period)) continue;
      const amount = cents(row.amount ?? row.commissionAmount);
      total[metric] += amount;
      if (tripMap) add(tripMap, String(row.tripId ?? ""), amount);
      if (userMap) add(userMap, String(row.userId ?? ""), amount);
    }
  };
  const tripExpenses: Record<string, number> = {}, tripCosts: Record<string, number> = {};
  accumulate(sources.expenses, "expenses", "expenses", ["dueDate", "createdAt"], tripExpenses);
  accumulate(sources.tripCosts, "tripCosts", "tripCosts", ["dueDate", "createdAt"], tripCosts);
  accumulate(sources.commissions, "commissions", "sellerCommissions", ["createdAt"], undefined, userSellerCommissions);
  accumulate(sources.referralCommissions, "referralCommissions", "referralCommissions", ["createdAt"]);
  for (const row of sources.expenses) {
    if (String(row.status).toLowerCase() === paidStatus && inPeriod(row.paymentDate, period)) total.expensesPaid += cents(row.amount);
  }
  for (const row of sources.tripCosts) {
    if (String(row.status).toLowerCase() === paidStatus && inPeriod(row.paidAt, period)) total.tripCostsPaid += cents(row.amount);
  }
  for (const row of sources.commissions) {
    if (String(row.status).toLowerCase() === paidStatus && inPeriod(row.paidAt, period)) total.sellerCommissionsPaid += cents(row.commissionAmount);
  }
  for (const row of sources.referralCommissions) {
    if (String(row.status).toLowerCase() === paidStatus && inPeriod(row.paidAt, period)) total.referralCommissionsPaid += cents(row.amount);
  }
  for (const row of sources.referrals) {
    if (!unique("referral", row)) continue;
    if (["reversed", "cancelled", "fraud"].includes(String(row.status).toLowerCase())) { diagnostics.excluded.referrals++; continue; }
    if (inPeriod(row.bonusPaidAt, period)) total.clientReferralBonuses += cents(row.bonusAmount);
    if (inPeriod(row.bonusCreditUsedAt, period)) total.clientReferralCredits += cents(row.bonusCreditUsedAmount);
  }
  for (const row of sources.ledgerEntries) {
    if (unique("ledger", row) && inPeriod(row.occurredAt, period)) diagnostics.ledgerEntriesNotIncludedInTotals++;
  }
  for (const user of sources.users) total.userReferralBalance += cents(user.referralBalance);
  let unpaidSeller = sources.commissions
    .filter(row => eligibleRow(row) && String(row.status).toLowerCase() !== paidStatus)
    .reduce((sum, row) => sum + cents(row.commissionAmount), 0);
  let unpaidReferral = sources.referralCommissions
    .filter(row => eligibleRow(row) && String(row.status).toLowerCase() !== paidStatus)
    .reduce((sum, row) => sum + cents(row.amount), 0);
  if (snapshot) {
    total.overdueReceivable = cents(snapshot.overdueReceivable);
    total.overduePayable = cents(snapshot.overduePayable);
    total.userReferralBalance = cents(snapshot.userReferralBalance);
    unpaidSeller = cents(snapshot.unpaidSellerCommissions);
    unpaidReferral = cents(snapshot.unpaidReferralCommissions);
  }
  total.userDebt = total.userReferralBalance + unpaidSeller + unpaidReferral;
  total.operatingCostsPaid = total.expensesPaid + total.tripCostsPaid;
  total.profit = total.receivedRevenue - total.operatingCostsPaid - total.sellerCommissionsPaid - total.referralCommissionsPaid - total.clientReferralBonuses;
  total.margin = total.receivedRevenue ? Number(((total.profit / total.receivedRevenue) * 100).toFixed(2)) : 0;
  // Diagnostics are intentionally independent from totals, but must not turn
  // into an O(expenses * tripCosts) scan as the history grows.  Index trip
  // costs by the exact trip/amount pair and binary-search their date range.
  const day = 86_400_000;
  const costIndex = new Map<string, Array<{ id: string; time: number; index: number }>>();
  for (const [index, cost] of sources.tripCosts.entries()) {
    const tripId = String(cost.tripId ?? "");
    const costDate = sourceDate(cost, ["paidAt", "dueDate", "createdAt"]);
    if (!tripId || !(costDate instanceof Date)) continue;
    const key = `${tripId}:${cents(cost.amount)}`;
    const entries = costIndex.get(key) ?? [];
    entries.push({ id: String(cost.id), time: costDate.getTime(), index });
    costIndex.set(key, entries);
  }
  for (const entries of costIndex.values()) {
    entries.sort((a, b) => a.time - b.time || a.index - b.index);
  }
  const lowerBound = (entries: Array<{ time: number }>, target: number) => {
    let low = 0;
    let high = entries.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (entries[middle]!.time < target) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const upperBound = (entries: Array<{ time: number }>, target: number) => {
    let low = 0;
    let high = entries.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (entries[middle]!.time <= target) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  for (const expense of sources.expenses) {
    const tripId = String(expense.tripId ?? "");
    const expenseDate = sourceDate(expense, ["paymentDate", "dueDate", "createdAt"]);
    if (!tripId || !(expenseDate instanceof Date)) continue;
    const entries = costIndex.get(`${tripId}:${cents(expense.amount)}`);
    if (!entries) continue;
    const expenseTime = expenseDate.getTime();
    const matches = entries.slice(
      lowerBound(entries, expenseTime - day + 1),
      upperBound(entries, expenseTime + day - 1),
    );
    matches.sort((a, b) => a.index - b.index);
    for (const match of matches) {
      diagnostics.potentialCrossSourceDuplicates.push({
        expenseId: String(expense.id),
        tripCostId: match.id,
      });
    }
  }
  const totals = Object.fromEntries(Object.entries(total).map(([key, value]) => [key, key === "margin" ? value : moneyFromCents(value)]));
  const byTripIds = new Set([...Object.keys(tripReceived), ...Object.keys(tripExpenses), ...Object.keys(tripCosts)]);
  const byTrip = [...byTripIds].sort().map(tripId => ({
    tripId, ...financialZeroes(), receivedRevenue: moneyFromCents(tripReceived[tripId] ?? 0),
    expenses: moneyFromCents(tripExpenses[tripId] ?? 0), tripCosts: moneyFromCents(tripCosts[tripId] ?? 0),
  }));
  const byUser = Object.entries(userSellerCommissions).sort(([a], [b]) => a.localeCompare(b)).map(([userId, sellerCommissions]) => ({
    userId, ...financialZeroes(), sellerCommissions: moneyFromCents(sellerCommissions),
  }));
  return { period: { start: period.start.toISOString(), end: period.end.toISOString(), label: period.label, asOf: asOf.toISOString() }, timezone: FINANCIAL_TIMEZONE, contracts: FINANCIAL_METRIC_CONTRACTS, totals, byTrip, byUser, diagnostics };
}