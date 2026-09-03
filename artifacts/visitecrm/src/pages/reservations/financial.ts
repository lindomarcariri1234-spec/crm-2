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
  const usesOrderTotals = order != null && reservation.linkedReservations?.length === 1;

  const total = usesOrderTotals
    ? toCents(order.totalAmount)
    : toCents(reservation.totalValue);
  const discount = usesOrderTotals
    ? toCents(order.discountAmount)
    : toCents(reservation.discountTotal);
  const subtotal = usesOrderTotals
    ? toCents(order.subtotal)
    : total + discount;
  const paid = usesOrderTotals
    ? toCents(order.paidAmount)
    : toCents(reservation.paidValue);
  const balance = Math.max(0, total - paid);

  return {
    subtotal: fromCents(subtotal),
    discount: fromCents(discount),
    total: fromCents(total),
    paid: fromCents(paid),
    balance: fromCents(balance),
    paymentMethod: usesOrderTotals ? order.paymentMethod : reservation.paymentMethod ?? null,
    installments: usesOrderTotals ? order.installments : reservation.installments,
    usesOrderTotals,
  };
}