import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreOrder } from "@/lib/storeApi";
import { cleanupRoots, renderComponent } from "../../__tests__/eventSourceHarness";
import { OrderDetail, StripeTestModeBadge } from "./pedidos";

const mocks = vi.hoisted(() => ({
  getOrder: vi.fn(),
  recordManualPixDeposit: vi.fn(),
  updateOrderStatus: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/storeApi", () => ({
  storeApi: {
    getOrder: mocks.getOrder,
    recordManualPixDeposit: mocks.recordManualPixDeposit,
    updateOrderStatus: mocks.updateOrderStatus,
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

afterEach(cleanupRoots);

beforeEach(() => {
  mocks.getOrder.mockReset();
  mocks.recordManualPixDeposit.mockReset();
  mocks.updateOrderStatus.mockReset();
  mocks.toast.mockReset();
  sessionStorage.clear();
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
  it("clearly labels Stripe test-mode orders and leaves live or unknown mode unmarked", async () => {
    const view = await renderComponent(createElement(StripeTestModeBadge, {
      paymentProvider: "stripe",
      stripeLivemode: false,
    }));
    expect(view.container.textContent).toContain("Stripe · TESTE");

    await view.rerender(createElement(StripeTestModeBadge, {
      paymentProvider: "stripe",
      stripeLivemode: true,
    }));
    expect(view.container.textContent).toBe("");

    await view.rerender(createElement(StripeTestModeBadge, {
      paymentProvider: "stripe",
      stripeLivemode: null,
    }));
    expect(view.container.textContent).toBe("");
  });

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

  it("shows bank-verification guidance for unpaid manual Pix orders", async () => {
    const order = {
      ...makeOrder("order-pix", "Cliente Pix"),
      paymentMethod: "pix",
      paymentProvider: "manual",
      paymentStatus: "pending",
      financialSummary: {
        subtotal: 200,
        discountAmount: 0,
        totalAmount: 200,
        depositRequested: 0,
        paidAmount: 0,
        amountRemaining: 200,
        states: { payment: "pending" },
        diagnostics: { hasLegacyDivergence: false },
      },
    } as StoreOrder;
    mocks.getOrder.mockResolvedValue(order);

    const view = await renderComponent(createElement(KeyedOrderDetail, { orderId: order.id }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(view.container.textContent).toContain("Pix Manual exige conferência bancária");
    expect(view.container.textContent).toContain("Confira o crédito no extrato");
  });

  it("records only the entered Pix amount and refreshes the outstanding balance", async () => {
    const order = {
      ...makeOrder("order-pix-deposit", "Cliente Pix"),
      storeId: "store-001",
      tenantId: "tenant-001",
      orderNumber: "ORD-PIX-1",
      subtotal: "200.00",
      discountAmount: "0.00",
      totalAmount: "200.00",
      depositAmount: "50.00",
      paymentMethod: "pix",
      paymentProvider: "manual",
      paymentStatus: "pending",
      financialSummary: {
        subtotal: 200,
        discountAmount: 0,
        totalAmount: 200,
        depositRequested: 50,
        paidAmount: 0,
        amountRemaining: 200,
        minimumRequired: 50,
        reservationValid: true,
        states: {
          order: "pending",
          reservation: "pending",
          payment: "pending",
        },
        diagnostics: {
          hasLegacyDivergence: false,
          issues: [],
          legacy: null,
        },
      },
    } as StoreOrder;
    const refreshedOrder = {
      ...order,
      paidAmount: 25,
      amountRemaining: "175.00",
      financialSummary: {
        ...order.financialSummary,
        paidAmount: 25,
        amountRemaining: 175,
        states: {
          ...order.financialSummary.states,
          payment: "partially_paid",
        },
      },
    };
    mocks.getOrder
      .mockResolvedValueOnce(order)
      .mockResolvedValueOnce(refreshedOrder);
    mocks.recordManualPixDeposit.mockResolvedValue({
      success: true,
      replayed: false,
      status: "pending",
      paymentStatus: "pending",
      paidAmount: "25.00",
      amountRemaining: "175.00",
    });

    const view = await renderComponent(createElement(KeyedOrderDetail, { orderId: order.id }));
    const input = view.container.querySelector("#manual-pix-deposit-amount") as HTMLInputElement;
    expect(input).not.toBeNull();

    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(input, "25");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const button = Array.from(view.container.querySelectorAll("button"))
      .find((candidate) => candidate.textContent?.includes("Registrar entrada"));
    expect(button).toBeDefined();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.recordManualPixDeposit).toHaveBeenCalledWith(
      order.id,
      25,
      expect.stringMatching(/^[0-9a-f-]{36}$/i),
    );
    expect(mocks.getOrder).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toContain("R$ 25.00");
    expect(view.container.textContent).toContain("R$ 175.00");
    expect(view.container.textContent).toContain("Parcialmente pago");
  });
});