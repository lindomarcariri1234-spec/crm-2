import {
  db, clientsTable, dealsTable, passengersTable, paymentsTable, referralsTable,
  reservationsTable, storeOrdersTable, tripsTable, usersTable, linkedDataReconciliationRunsTable,
} from "@workspace/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { PAYMENT_STATUS, PAYMENT_TYPE, REFERRAL_STATUS, RESERVATION_STATUS, ROLES } from "@workspace/permissions";
import { generateId } from "../lib/id";
import { syncClientDeal } from "./pipeline-deal-sync";
import { syncStoreOrderFromReservationPayment } from "./reservation-order-payment-sync";
import { convertPaidReservationReferral } from "./reservation-referral-conversion";

export interface LinkReconciliationIssue { type: string; id: string; reason: string }

/**
 * `repaired` and `issues` are retained for callers of the original maintenance
 * endpoint. The remaining fields make an execution independently auditable,
 * without persisting checkout or payment data in an admin response.
 */
export interface LinkReconciliationResult {
  repaired: string[];
  issues: LinkReconciliationIssue[];
  mode: "dry-run" | "repair";
  tenantId: string;
  generatedAt: string;
  checked: number;
  repairedCount: number;
  issueCount: number;
  summary: {
    checked: Record<string, number>;
    repaired: Record<string, number>;
    issues: Record<string, number>;
  };
  /** Per-category detail remains arrays; no one-to-many relation is flattened. */
  categories: Record<string, {
    checked: number;
    repaired: string[];
    issues: LinkReconciliationIssue[];
  }>;
}

export interface LinkedDataReconciliationHistoryEntry {
  id: string;
  mode: "dry-run" | "repair";
  executedAt: string;
  checkedCount: number;
  repairedCount: number;
  issueCount: number;
  summary: Record<string, {
    checked: number;
    repaired: number;
    issues: number;
    reasons: Record<string, number>;
  }>;
}

function buildHistorySummary(result: LinkReconciliationResult) {
  const reasonsByCategory: Record<string, Record<string, number>> = {};
  for (const detail of result.issues) {
    const reasons = reasonsByCategory[detail.type] ??= {};
    reasons[detail.reason] = (reasons[detail.reason] ?? 0) + 1;
  }

  return Object.fromEntries(Object.entries(result.categories).map(([type, category]) => [
    type,
    {
      checked: category.checked,
      repaired: category.repaired.length,
      issues: category.issues.length,
      reasons: reasonsByCategory[type] ?? {},
    },
  ]));
}

async function recordReconciliationRun(result: LinkReconciliationResult): Promise<void> {
  await db.insert(linkedDataReconciliationRunsTable).values({
    id: generateId(),
    tenantId: result.tenantId,
    mode: result.mode,
    executedAt: new Date(result.generatedAt),
    checkedCount: result.checked,
    repairedCount: result.repairedCount,
    issueCount: result.issueCount,
    summary: buildHistorySummary(result),
  });
}

function normalizedEmail(email: string | null): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

/** Conservative tenant-local integrity pass. It never deletes or guesses. */
export async function reconcileLinkedData(tenantId: string, repair = false): Promise<LinkReconciliationResult> {
  const checked: Record<string, number> = {};
  const repairedByCategory: Record<string, number> = {};
  const issuesByCategory: Record<string, number> = {};
  const categories: LinkReconciliationResult["categories"] = {};
  const result: LinkReconciliationResult = {
    repaired: [], issues: [], mode: repair ? "repair" : "dry-run", tenantId,
    generatedAt: new Date().toISOString(), checked: 0, repairedCount: 0, issueCount: 0,
    summary: { checked, repaired: repairedByCategory, issues: issuesByCategory }, categories,
  };
  const category = (name: string) => categories[name] ??= { checked: 0, repaired: [], issues: [] };
  const check = (name: string) => {
    checked[name] = (checked[name] ?? 0) + 1;
    category(name).checked++;
    result.checked++;
  };
  const issue = (type: string, id: string, reason: string) => {
    const detail = { type, id, reason };
    result.issues.push(detail);
    category(type).issues.push(detail);
    issuesByCategory[type] = (issuesByCategory[type] ?? 0) + 1;
    result.issueCount++;
  };
  const fixed = (category: string, id: string) => {
    const detail = `${category}:${id}`;
    result.repaired.push(detail);
    (categories[category] ??= { checked: 0, repaired: [], issues: [] }).repaired.push(detail);
    repairedByCategory[category] = (repairedByCategory[category] ?? 0) + 1;
    result.repairedCount++;
  };

  // Every source query is explicitly tenant-scoped. Passenger rows are scoped
  // through their tenant-local reservation ids below.
  const [reservations, orders, referrals, deals, clients, payments, trips, users] = await Promise.all([
    db.select().from(reservationsTable).where(eq(reservationsTable.tenantId, tenantId)),
    db.select().from(storeOrdersTable).where(eq(storeOrdersTable.tenantId, tenantId)),
    db.select().from(referralsTable).where(eq(referralsTable.tenantId, tenantId)),
    db.select().from(dealsTable).where(eq(dealsTable.tenantId, tenantId)),
    db.select().from(clientsTable).where(eq(clientsTable.tenantId, tenantId)),
    db.select().from(paymentsTable).where(eq(paymentsTable.tenantId, tenantId)),
    db.select().from(tripsTable).where(eq(tripsTable.tenantId, tenantId)),
    db.select().from(usersTable).where(eq(usersTable.tenantId, tenantId)),
  ]);
  const byReservationId = new Map(reservations.map(r => [r.id, r]));
  const clientsById = new Map(clients.map(c => [c.id, c]));
  const tripsById = new Map(trips.map(t => [t.id, t]));
  const orderByNumber = new Map(orders.map(o => [o.orderNumber, o]));
  const checkedOrderPayments = new Set<string>();

  // Canonical client financial semantics deliberately match
  // recalculateClientFinancials: all payment types are included there, while
  // this reconciliation restricts to receivables as its stated source.
  for (const client of clients) {
    check("client-financial");
    const clientPayments = payments.filter(p => p.clientId === client.id && p.type === PAYMENT_TYPE.RECEIVABLE);
    const totalSpent = clientPayments.filter(p => p.status === PAYMENT_STATUS.PAID)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const outstandingBalance = clientPayments
      .filter(p => p.status === PAYMENT_STATUS.PENDING || p.status === PAYMENT_STATUS.OVERDUE)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    if (Number(client.totalSpent) !== totalSpent || Number(client.outstandingBalance) !== outstandingBalance) {
      if (repair) {
        await db.update(clientsTable).set({ totalSpent: String(totalSpent), outstandingBalance: String(outstandingBalance) })
          .where(and(eq(clientsTable.id, client.id), eq(clientsTable.tenantId, tenantId)));
        fixed("client-financial", client.id);
      } else issue("client-financial", client.id, "receivable_totals_mismatch");
    }
  }

  for (const trip of trips) {
    check("trip-seats");
    if (trip.status === "cancelled" || trip.status === "completed") continue;
    const active = reservations.filter(r => r.tripId === trip.id &&
      (r.status === RESERVATION_STATUS.PENDING || r.status === RESERVATION_STATUS.CONFIRMED));
    const reservedSeats = active.filter(r => r.status === RESERVATION_STATUS.PENDING).reduce((n, r) => n + (r.seats ?? []).length, 0);
    const confirmedSeats = active.filter(r => r.status === RESERVATION_STATUS.CONFIRMED).reduce((n, r) => n + (r.seats ?? []).length, 0);
    const availableSeats = Math.max(0, Number(trip.totalCapacity) - reservedSeats - confirmedSeats -
      (Array.isArray(trip.freePassengers) ? trip.freePassengers.length : 0));
    if (Number(trip.reservedSeats) !== reservedSeats || Number(trip.confirmedSeats) !== confirmedSeats || Number(trip.availableSeats) !== availableSeats) {
      if (repair) {
        await db.update(tripsTable).set({ reservedSeats, confirmedSeats, availableSeats })
          .where(and(eq(tripsTable.id, trip.id), eq(tripsTable.tenantId, tenantId)));
        fixed("trip-seats", trip.id);
      } else issue("trip-seats", trip.id, "seat_counters_mismatch");
    }
  }

  const passengerRows = reservations.length
    ? await db.select().from(passengersTable).where(inArray(passengersTable.reservationId, reservations.map(r => r.id)))
    : [];
  for (const reservation of reservations) {
    check("reservation-passengers");
    const passengers = passengerRows.filter(p => p.reservationId === reservation.id);
    const seats = reservation.seats ?? [];
    if (passengers.length === seats.length) continue;
    // A missing primary is the only passenger correction that has a unique,
    // canonical value: the client and first unclaimed seat. All other count
    // drift remains diagnostic, rather than creating guessed passengers.
    const primary = passengers.filter(p => p.isPrimary);
    const client = reservation.clientId ? clientsById.get(reservation.clientId) : undefined;
    const canCreatePrimary = passengers.length === Math.max(0, seats.length - 1) && primary.length === 0 &&
      !!client && !!seats[0] && !passengers.some(p => p.seatNumber === seats[0]);
    if (canCreatePrimary && repair) {
      await db.insert(passengersTable).values({
        id: generateId(), reservationId: reservation.id, name: client.name,
        cpf: client.cpf ?? null, rg: client.rg ?? null, birthDate: client.birthDate ?? null,
        ageCategory: "adult", isPrimary: true, seatNumber: seats[0], isChildUnder7: false,
      }).onConflictDoNothing();
      fixed("reservation-passengers", reservation.id);
    } else issue("reservation-passengers", reservation.id, canCreatePrimary ? "missing_unambiguous_primary_passenger" : "passenger_count_diagnostic");
  }

  // An email group is repairable only when it maps exactly one unlinked client,
  // one active CLIENT account, and that account is not already linked elsewhere.
  const linkedUserIds = new Set(clients.map(c => c.userId).filter((id): id is string => !!id));
  const clientEmailGroups = new Map<string, typeof clients>();
  for (const client of clients.filter(c => !c.userId)) {
    const email = normalizedEmail(client.email);
    if (email) clientEmailGroups.set(email, [...(clientEmailGroups.get(email) ?? []), client]);
  }
  for (const [email, candidates] of clientEmailGroups) {
    check("client-user");
    const matchingUsers = users.filter(u => u.role === ROLES.CLIENT && u.isActive && normalizedEmail(u.email) === email);
    if (candidates.length === 1 && matchingUsers.length === 1 && !linkedUserIds.has(matchingUsers[0]!.id)) {
      const client = candidates[0]!, user = matchingUsers[0]!;
      if (repair) {
        await db.update(clientsTable).set({ userId: user.id }).where(and(
          eq(clientsTable.id, client.id), eq(clientsTable.tenantId, tenantId), isNull(clientsTable.userId),
        ));
        fixed("client-user", client.id);
      } else issue("client-user", client.id, "missing_unambiguous_email_link");
    } else if (matchingUsers.length || candidates.length > 1) {
      issue("client-user", candidates.map(c => c.id).join(","), "ambiguous_or_already_linked_email");
    }
  }

  for (const reservation of reservations) {
    if (!reservation.storeOrderId) continue;
    check("reservation-order");
    const order = orderByNumber.get(reservation.storeOrderId);
    if (!order) { issue("reservation-order", reservation.id, "order_missing_in_tenant"); continue; }
    const siblings = reservations.filter(r => r.storeOrderId === order.orderNumber);
    if (!order.clientId && reservation.clientId && siblings.length === 1) {
      if (repair) {
        await db.update(storeOrdersTable).set({ clientId: reservation.clientId }).where(and(
          eq(storeOrdersTable.id, order.id), eq(storeOrdersTable.tenantId, tenantId), isNull(storeOrdersTable.clientId),
        ));
        fixed("order-client", order.id);
      } else issue("order-client", order.id, "missing_unambiguous_client");
    } else if (order.clientId && reservation.clientId && order.clientId !== reservation.clientId) issue("reservation-order", reservation.id, "client_mismatch_or_multi_trip");
    if (!checkedOrderPayments.has(order.id)) {
      checkedOrderPayments.add(order.id);
      check("order-payment");
      const siblingsPaid = siblings.length > 0 && siblings.every(row => Number(row.balance) <= 0);
      if (siblingsPaid && order.paymentStatus !== "paid" && order.status !== "cancelled") {
        if (repair) {
          const sync = await syncStoreOrderFromReservationPayment(reservation.id, tenantId);
          if (sync.transitionedToPaid) fixed("order-payment", order.id);
        } else {
          issue("order-payment", order.id, "fully_paid_reservations_with_unpaid_order");
        }
      }
    }
  }

  for (const referral of referrals) {
    check("referral-reservation");
    if (referral.reservationId && !byReservationId.has(referral.reservationId)) issue("referral-reservation", referral.id, "reservation_missing_in_tenant");
    if (!referral.reservationId && (referral.status === REFERRAL_STATUS.PENDING || referral.status === REFERRAL_STATUS.COMPLETED)) {
      const candidateOrders = orders.filter(o => (o.pendingReferral as { referralId?: unknown } | null)?.referralId === referral.id);
      if (candidateOrders.length !== 1) { if (candidateOrders.length > 1) issue("referral-reservation", referral.id, "ambiguous_order_candidates"); continue; }
      const candidates = reservations.filter(r => r.storeOrderId === candidateOrders[0]!.orderNumber);
      if (candidates.length !== 1) { issue("referral-reservation", referral.id, candidates.length ? "ambiguous_multi_reservation_order" : "referral_order_has_no_trip_reservations"); continue; }
      if (repair) {
        const candidate = candidates[0]!;
        await db.update(referralsTable).set({ reservationId: candidate.id }).where(and(eq(referralsTable.id, referral.id), eq(referralsTable.tenantId, tenantId), isNull(referralsTable.reservationId)));
        if (
          Number(candidate.paidValue ?? 0) > 0 &&
          !([RESERVATION_STATUS.CANCELLED, RESERVATION_STATUS.REFUNDED, RESERVATION_STATUS.FAILED] as string[]).includes(candidate.status)
        ) {
          await convertPaidReservationReferral(candidate.id, tenantId);
        }
        fixed("referral-reservation", referral.id);
      } else issue("referral-reservation", referral.id, "missing_unambiguous_canonical_reservation");
    }
  }

  // Keep the original direct-deal orphan diagnostic as well as the
  // reservation-centred checks below. A deal can point at an id that is not
  // present in this tenant, in which case there is no reservation loop entry.
  for (const deal of deals) {
    if (!deal.reservationId) continue;
    check("deal-reservation");
    if (!byReservationId.has(deal.reservationId)) {
      issue("deal-reservation", deal.id, "reservation_missing_in_tenant");
    }
  }

  for (const reservation of reservations) {
    check("pipeline-deal");
    const reservationDeals = deals.filter(d => d.reservationId === reservation.id);
    if (reservationDeals.length > 1) { issue("pipeline-deal", reservation.id, "duplicate_reservation_deals"); continue; }
    if (reservationDeals.length === 1) {
      const deal = reservationDeals[0]!;
      if (deal.clientId !== reservation.clientId || deal.tripId !== reservation.tripId || Number(deal.value) !== Number(reservation.totalValue)) {
        if (repair) {
          await db.update(dealsTable).set({ clientId: reservation.clientId, tripId: reservation.tripId, value: String(reservation.totalValue) })
            .where(and(eq(dealsTable.id, deal.id), eq(dealsTable.tenantId, tenantId)));
          fixed("deal", deal.id);
        } else issue("deal-reservation", deal.id, "client_trip_or_value_mismatch");
      }
    } else if (reservation.clientId && reservation.tripId && clientsById.has(reservation.clientId) && tripsById.has(reservation.tripId)) {
      if (repair) {
        await syncClientDeal(reservation.clientId, tenantId, reservation.tripId, Number(reservation.totalValue), reservation.createdById, { reservationId: reservation.id });
        fixed("pipeline-deal", reservation.id);
      } else issue("pipeline-deal", reservation.id, "missing_valid_reservation_deal");
    } else issue("pipeline-deal", reservation.id, "missing_deal_invalid_reservation_links");
  }
  await recordReconciliationRun(result);
  return result;
}