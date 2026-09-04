import type { Reservation } from "@workspace/api-client-react";
import type { LinkedData } from "@/lib/linked-data";

export type ReservationWithFinancialLinks = Reservation & LinkedData;

export interface ReservationFinancialSummary {
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  paymentMethod: string | null;
  installments: number | null;
  usesOrderTotals: boolean;
}

function toCents(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function fromCents(cents: number): number {
  return cents / 100;
}

/**
 * Returns the single financial presentation used by reservation list/detail
 * surfaces. A one-reservation order is authoritative; mixed orders keep each
 * reservation's allocated value so the full order is not duplicated per row.
 */
export function getReservationFinancialSummary(
  reservation: ReservationWithFinancialLinks,
): ReservationFinancialSummary {
  const order = reservation.linkedOrder;
  const canonical = reservation.financialSummary;
  if (canonical) {
    return {
      subtotal: canonical.subtotal,
      discount: canonical.discountAmount,
      total: canonical.totalAmount,
      paid: canonical.paidAmount,
      balance: canonical.amountRemaining,
      paymentMethod: canonical.source === "order" ? order?.paymentMethod ?? null : reservation.paymentMethod ?? null,
      installments: canonical.source === "order" ? order?.installments ?? null : reservation.installments,
      usesOrderTotals: canonical.source === "order",
    };
  }

  // Keep this fallback for cached/legacy API responses that predate the
  // canonical summary. It follows the same cent-based arithmetic as the
  // server and prevents the list from crashing while those responses expire.
  const linkedReservations = reservation.linkedReservations ?? [];
  if (order && linkedReservations.length <= 1) {
    const total = fromCents(toCents(order.totalAmount));
    const discount = fromCents(toCents(order.discountAmount));
    const paid = fromCents(toCents(order.paidAmount));
    const balance = order.amountRemaining == null
      ? fromCents(Math.max(0, toCents(order.totalAmount) - toCents(order.paidAmount)))
      : fromCents(toCents(order.amountRemaining));
    return {
      subtotal: fromCents(toCents(order.subtotal)),
      discount,
      total,
      paid,
      balance,
      paymentMethod: order.paymentMethod ?? null,
      installments: order.installments ?? null,
      usesOrderTotals: true,
    };
  }

  const linkedReservation = linkedReservations.find((item) => item.id === reservation.id);
  const total = fromCents(toCents(linkedReservation?.totalValue ?? reservation.totalValue));
  const discount = fromCents(toCents(reservation.discountTotal ?? 0));
  const paid = fromCents(toCents(linkedReservation?.paidValue ?? reservation.paidValue));
  const balance = fromCents(toCents(linkedReservation?.balance ?? reservation.balance));
  return {
    subtotal: fromCents(toCents(total + discount)),
    discount,
    total,
    paid,
    balance,
    paymentMethod: reservation.paymentMethod ?? null,
    installments: reservation.installments,
    usesOrderTotals: false,
  };
}