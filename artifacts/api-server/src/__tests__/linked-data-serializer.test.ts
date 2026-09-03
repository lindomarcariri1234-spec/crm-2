import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  dealsTable: {}, referralsTable: {}, reservationsTable: {}, storeOrdersTable: {},
}));

import { calculateReceivedAmount, linkedOrder } from "../lib/linked-data.js";

describe("linked checkout serializers", () => {
  it("keeps requested deposit separate from confirmed payments", () => {
    const result = linkedOrder({
      id: "order-1", orderNumber: "SO-1", status: "confirmed", paymentStatus: "partial",
      subtotal: "100.00", discountAmount: "10.00", totalAmount: "90.00",
      depositAmount: "30.00", amountRemaining: "60.00", paymentMethod: "pix", installments: 3,
    });
    expect(result).toMatchObject({ depositAmount: 30, paidAmount: 0, amountRemaining: 90, totalAmount: 90 });
  });

  it("uses the canonical received amount for a partially paid discounted order", () => {
    const result = linkedOrder({
      id: "order-2", orderNumber: "SO-2", status: "pending", paymentStatus: "partial",
      subtotal: "199.00", discountAmount: "9.95", totalAmount: "189.05",
      depositAmount: "30.00", amountRemaining: "159.05", paymentMethod: "pix", installments: 1,
    }, { paidAmount: 30 });
    expect(result).toMatchObject({ totalAmount: 189.05, paidAmount: 30, amountRemaining: 159.05 });
  });

  it("counts only paid receivables from the order and its reservations", () => {
    const received = calculateReceivedAmount("order-3", ["reservation-3"], [
      { orderId: "order-3", reservationId: null, amount: "20.00", status: "paid", type: "receivable" },
      { orderId: null, reservationId: "reservation-3", amount: "10.00", status: "paid", type: "receivable" },
      { orderId: "order-3", reservationId: null, amount: "99.00", status: "pending", type: "receivable" },
      { orderId: "order-3", reservationId: null, amount: "5.00", status: "paid", type: "refund" },
    ]);
    expect(received).toBe(30);
  });
});