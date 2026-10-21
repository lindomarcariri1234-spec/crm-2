import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRoots, renderComponent } from "../../../__tests__/eventSourceHarness.js";
import type { PublicStore } from "@/lib/storeApi";
import { useWizardState, type CompletedOrder } from "./use-wizard-state";
import { StepConfirmation } from "./step-confirmation";

const mocks = vi.hoisted(() => ({
  getProduct: vi.fn(),
  getOrder: vi.fn(),
  createPaymentIntent: vi.fn(),
}));

vi.mock("@/lib/storeApi", () => ({
  publicStoreApi: {
    getProduct: mocks.getProduct,
    getOrder: mocks.getOrder,
    createPaymentIntent: mocks.createPaymentIntent,
  },
}));
vi.mock("@clerk/react", () => ({ useUser: () => ({ isLoaded: true, isSignedIn: false }) }));
vi.mock("@/lib/clientPortalApi", () => ({ clientPortalApi: { getProfile: vi.fn() } }));
vi.mock("@/hooks/useSeatStream", () => ({ useSeatStream: () => ({ occupiedSeats: {}, eventCount: 0 }) }));
vi.mock("wouter", () => ({ useLocation: () => ["/", vi.fn()] }));
vi.mock("@/lib/analytics", () => ({ trackReferralCreditReduction: () => false }));
vi.mock("./confetti", () => ({ ConfettiAnimation: () => null }));
vi.mock("./voucher", () => ({ Voucher: () => null }));
vi.mock("./step-indicator", () => ({ StepIndicator: () => null }));
vi.mock("./stripe-card-payment", () => ({ StripeCardPayment: () => createElement("div", { "data-testid": "stripe-charge-action" }) }));
vi.mock("@/lib/tripDuration", () => ({ calculateTripDuration: () => null }));

const store = {
  id: "store-1",
  name: "Loja de teste",
  slug: "loja-teste",
  primaryColor: "#123456",
  accentColor: "#456789",
  paymentMethods: ["credit_card"],
  stripeEnabled: true,
  maintenanceMode: false,
} as unknown as PublicStore;

const product = {
  id: "product-1",
  name: "Viagem teste",
  slug: "viagem-teste",
  price: "500.00",
  salePrice: null,
  onSale: false,
  type: "trip",
  images: [],
  gallery: [],
  features: [],
  includes: [],
  excludes: [],
  requirements: [],
  hasDates: false,
  hasVariants: false,
  variants: [],
  trackInventory: false,
  allowBackorder: false,
  isFeatured: false,
  order: 0,
  ratingCount: 0,
  status: "active",
  viewsCount: 0,
  salesCount: 0,
  boardingPoints: [],
};

function makeOrder(overrides: Partial<CompletedOrder> = {}) {
  const paidAmount = Number(overrides.paidAmount ?? 0);
  const payment = paidAmount >= 500 ? "paid" : paidAmount > 0 ? "partially_paid" : "pending";
  return {
    orderNumber: "ORD-PENDING-1",
    totalAmount: "500.00",
    createdAt: "2026-10-11T12:00:00.000Z",
    customerName: "Cliente",
    customerEmail: "cliente@example.com",
    customerPhone: "11999999999",
    paymentMethod: "credit_card",
    paymentStatus: "pending",
    status: "pending",
    reservationExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    depositAmount: null,
    paidAmount,
    amountRemaining: 500 - paidAmount,
    items: [{ quantity: 1 }],
    reservations: [],
    financialSummary: {
      source: "order",
      subtotal: 500,
      discountAmount: 0,
      totalAmount: 500,
      depositRequested: 0,
      paidAmount,
      amountRemaining: 500 - paidAmount,
      minimumRequired: 500,
      reservationValid: paidAmount >= 500,
      states: { order: paidAmount >= 500 ? "confirmed" : "pending", reservation: paidAmount >= 500 ? "confirmed" : "pending", payment },
      diagnostics: { hasLegacyDivergence: false, issues: [], legacy: null },
    },
    ...overrides,
  } as unknown as CompletedOrder & { items: Array<{ quantity: number }> };
}

function ConfirmationHarness() {
  const state = useWizardState({ slug: store.slug, productSlug: product.slug, store });
  return state.completedOrder
    ? createElement(StepConfirmation, { state, store, slug: store.slug })
    : null;
}

function seedPendingCheckout() {
  sessionStorage.setItem("vitrine_reservation_stripe:loja-teste:viagem-teste", JSON.stringify({
    storeSlug: "loja-teste",
    productSlug: "viagem-teste",
    orderNumber: "ORD-PENDING-1",
    paymentToken: "one-time-lookup-token",
    paymentIntentId: "pi_pending_123",
    referralCreditRequested: null,
    referralCreditApplied: null,
    referralCreditBalanceAfter: null,
    returnHandled: true,
    redirectStatus: "processing",
    createdAt: Date.now(),
  }));
}

beforeEach(() => {
  mocks.getProduct.mockReset().mockResolvedValue(product);
  mocks.getOrder.mockReset();
  mocks.createPaymentIntent.mockReset();
  sessionStorage.clear();
  seedPendingCheckout();
});

afterEach(async () => {
  await cleanupRoots();
  vi.restoreAllMocks();
});

describe("pending Stripe confirmation", () => {
  it("applies a manual status check only after the server returns paid and keeps automatic polling", async () => {
    mocks.getOrder
      .mockResolvedValueOnce(makeOrder())
      .mockResolvedValueOnce(makeOrder({
        paymentStatus: "paid",
        status: "confirmed",
        paidAmount: 500,
        financialSummary: makeOrder({ paidAmount: 500 }).financialSummary,
      }));
    const intervalSpy = vi.spyOn(window, "setInterval");
    const view = await renderComponent(createElement(ConfirmationHarness));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(view.container.querySelector('[data-testid="button-refresh-stripe-payment-status"]')).not.toBeNull();
    expect(view.container.textContent).toContain("não tente pagar novamente");
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 15_000);

    await act(async () => {
      view.container.querySelector<HTMLButtonElement>('[data-testid="button-refresh-stripe-payment-status"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.getOrder).toHaveBeenCalledTimes(2);
    expect(mocks.createPaymentIntent).not.toHaveBeenCalled();
    expect(view.container.textContent).toContain("Reserva Confirmada");
    expect(view.container.querySelector('[data-testid="stripe-charge-action"]')).toBeNull();
  });

  it("keeps the order pending and tells the shopper not to pay again when a manual check fails", async () => {
    mocks.getOrder.mockResolvedValueOnce(makeOrder()).mockRejectedValueOnce(new Error("temporary"));
    const view = await renderComponent(createElement(ConfirmationHarness));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => {
      view.container.querySelector<HTMLButtonElement>('[data-testid="button-refresh-stripe-payment-status"]')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(view.container.textContent).toContain("Pagamento em confirmação");
    expect(view.container.textContent).toContain("não faça outro pagamento");
    expect(view.container.querySelector('[data-testid="status-stripe-check-unavailable"]')).not.toBeNull();
    expect(mocks.createPaymentIntent).not.toHaveBeenCalled();
  });
});
