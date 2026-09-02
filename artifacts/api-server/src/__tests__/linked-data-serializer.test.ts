import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  dealsTable: {}, referralsTable: {}, reservationsTable: {}, storeOrdersTable: {},
}));

import { linkedOrder } from "../lib/linked-data.js";

describe("linked checkout serializers", () => {
  it("uses persisted deposit and remaining amounts rather than payment timestamps", () => {
    const result = linkedOrder({
      id: "order-1", orderNumber: "SO-1", status: "confirmed", paymentStatus: "partial",
      subtotal: "100.00", discountAmount: "10.00", totalAmount: "90.00",
      depositAmount: "30.00", amountRemaining: "60.00", paymentMethod: "pix", installments: 3,
    });
    expect(result).toMatchObject({ depositAmount: 30, amountRemaining: 60, totalAmount: 90 });
  });
});