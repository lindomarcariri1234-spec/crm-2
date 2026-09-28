import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreOrder } from "@/lib/storeApi";
import { cleanupRoots, renderComponent } from "../../__tests__/eventSourceHarness";
import { OrderDetail } from "./pedidos";

const mocks = vi.hoisted(() => ({
  getOrder: vi.fn(),
  updateOrderStatus: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/storeApi", () => ({
  storeApi: {
    getOrder: mocks.getOrder,
    updateOrderStatus: mocks.updateOrderStatus,
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

afterEach(cleanupRoots);

beforeEach(() => {
  mocks.getOrder.mockReset();
  mocks.updateOrderStatus.mockReset();
  mocks.toast.mockReset();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeOrder(id: string, customerName: string): StoreOrder {
  return {
    id,
    status: "pending",
    paymentStatus: "pending",
    fulfillmentStatus: "unfulfilled",
    customerName,
    customerEmail: `${id}@example.com`,
    customerPhone: null,
    customerCpf: null,
    customerAddress: null,
    customerNotes: null,
    internalNotes: null,
    financialSummary: {
      subtotal: 0,
      discountAmount: 0,
      totalAmount: 0,
      depositRequested: 0,
      paidAmount: 0,
      amountRemaining: 0,
      states: { payment: "pending" },
      diagnostics: { hasLegacyDivergence: false },
    },
    taxAmount: null,
    couponCode: null,
    paymentMethod: null,
    installments: null,
    installmentAmount: null,
    linkedReservations: [],
    linkedReferral: null,
    linkedDeals: [],
    items: [],
    createdAt: "2026-01-01T12:00:00.000Z",
    confirmedAt: "2026-01-01T12:00:00.000Z",
    paidAt: "2026-01-01T12:00:00.000Z",
    completedAt: "2026-01-01T12:00:00.000Z",
    cancelledAt: "2026-01-01T12:00:00.000Z",
    refundedAt: "2026-01-01T12:00:00.000Z",
  } as StoreOrder;
}

function KeyedOrderDetail({ orderId }: { orderId: string }) {
  return createElement(OrderDetail, {
    key: orderId,
    orderId,
    onClose: vi.fn(),
    onUpdated: vi.fn(),
  });
}

describe("OrderDetail", () => {
  it("keeps a late response from a previously selected order out of the current details", async () => {
    const oldOrderRequest = deferred<StoreOrder>();
    const currentOrderRequest = deferred<StoreOrder>();
    mocks.getOrder.mockImplementation((orderId: string) =>
      orderId === "order-a" ? oldOrderRequest.promise : currentOrderRequest.promise,
    );

    const view = await renderComponent(createElement(KeyedOrderDetail, { orderId: "order-a" }));
    await view.rerender(createElement(KeyedOrderDetail, { orderId: "order-b" }));

    await act(async () => {
      currentOrderRequest.resolve(makeOrder("order-b", "Cliente B"));
      await currentOrderRequest.promise;
    });
    expect(view.container.textContent).toContain("Cliente B");

    await act(async () => {
      oldOrderRequest.resolve(makeOrder("order-a", "Cliente A"));
      await oldOrderRequest.promise;
    });
    expect(view.container.textContent).toContain("Cliente B");
    expect(view.container.textContent).not.toContain("Cliente A");
  });
});