import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  dealsTable: {}, referralsTable: {}, reservationsTable: {}, storeOrdersTable: {},
}));

import {
  allocateOrderReceiptToReservation,
  financialSummary,
  linkedOrder,
  orderFinancialSummary,
} from "../lib/linked-data.js";

describe("linked checkout serializers", () => {
  it("keeps requested deposit separate from confirmed payments", () => {
    const result = linkedOrder({
      id: "order-1", orderNumber: "SO-1", status: "confirmed", paymentStatus: "partial",
      subtotal: "100.00", discountAmount: "10.00", totalAmount: "90.00",
      depositAmount: "30.00", amountRemaining: "60.00", paymentMethod: "pix", installments: 3,
    });
    expect(result).toMatchObject({ depositAmount: 30, paidAmount: 0, amountRemaining: 90, totalAmount: 90 });
    expect(result?.financialSummary).toMatchObject({
      subtotal: 100,
      discountAmount: 10,
      totalAmount: 90,
      depositRequested: 30,
      paidAmount: 0,
      amountRemaining: 90,
      states: { order: "confirmed", payment: "pending" },
    });
  });

  it.each([
    { paid: 0, order: "pending", stored: "pending", reservation: "pending", expected: "pending" },
    { paid: 30, order: "confirmed", stored: "pending", reservation: "confirmed", expected: "partially_paid" },
    { paid: 90, order: "confirmed", stored: "paid", reservation: "confirmed", expected: "paid" },
    { paid: 0, order: "pending", stored: "failed", reservation: "failed", expected: "failed" },
    { paid: 0, order: "confirmed", stored: "refunded", reservation: "refunded", expected: "refunded" },
    { paid: 0, order: "cancelled", stored: "pending", reservation: "cancelled", expected: "cancelled" },
  ])("normalizes payment state $expected", ({ paid, order, stored, reservation, expected }) => {
    expect(financialSummary({
      source: "order",
      subtotal: 100,
      discountAmount: 10,
      totalAmount: 90,
      depositRequested: 30,
      paidAmount: paid,
      orderStatus: order,
      reservationStatus: reservation,
      storedPaymentStatus: stored,
    }).states.payment).toBe(expected);
  });

  it("uses the order total for a single reservation while auditing legacy divergence", () => {
    const summary = financialSummary({
      source: "order",
      subtotal: 120,
      discountAmount: 20,
      totalAmount: 100,
      depositRequested: 30,
      paidAmount: 30,
      orderStatus: "confirmed",
      reservationStatus: "confirmed",
      legacy: { totalAmount: 120, paidAmount: 100, amountRemaining: 20 },
    });
    expect(summary).toMatchObject({
      totalAmount: 100,
      paidAmount: 30,
      amountRemaining: 70,
      reservationValid: true,
      diagnostics: {
        hasLegacyDivergence: true,
        issues: ["legacy_total_differs", "legacy_paid_differs", "legacy_balance_differs"],
      },
    });
  });

  it("does not let a payment from another order contaminate the canonical state", () => {
    const summary = orderFinancialSummary({
      id: "order-1",
      status: "confirmed",
      paymentStatus: "pending",
      subtotal: "100.00",
      discountAmount: "0.00",
      totalAmount: "100.00",
      depositAmount: "30.00",
      amountRemaining: "100.00",
    }, 0, [{
      orderId: "order-2",
      reservationId: null,
      amount: "100.00",
      type: "receivable",
      status: "refunded",
    }]);
    expect(summary.states.payment).toBe("pending");
  });

  it("never validates a cancelled or refunded reservation", () => {
    const cancelled = financialSummary({
      source: "reservation",
      subtotal: 100,
      totalAmount: 100,
      depositRequested: 30,
      paidAmount: 30,
      orderStatus: "cancelled",
      reservationStatus: "confirmed",
    });
    const refunded = financialSummary({
      source: "reservation",
      subtotal: 100,
      totalAmount: 100,
      depositRequested: 30,
      paidAmount: 30,
      reservationStatus: "refunded",
    });
    expect(cancelled.reservationValid).toBe(false);
    expect(refunded.reservationValid).toBe(false);
  });

  it("allocates mixed-order receipts proportionally without inventing money", () => {
    expect(allocateOrderReceiptToReservation(60, 300, 100)).toBe(20);
    expect(allocateOrderReceiptToReservation(300, 300, 100)).toBe(100);
  });
});