/**
 * MinDepositConfirmation.test.tsx
 *
 * Component-level rendering tests for StepConfirmation's financial summary
 * under three deposit scenarios:
 *   - partial deposit (deposit < total)
 *   - full-total deposit (deposit === total)
 *   - no deposit (deposit is null / zero)
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderComponent, cleanupRoots } from "./eventSourceHarness.js";

// ---------------------------------------------------------------------------
// Mock heavy sub-components that would pull in canvas / animation APIs
// ---------------------------------------------------------------------------
vi.mock("../pages/vitrine/_wizard/confetti.js", () => ({
  ConfettiAnimation: () => null,
}));

vi.mock("../pages/vitrine/_wizard/voucher.js", () => ({
  Voucher: () => null,
}));

vi.mock("../pages/vitrine/_wizard/step-indicator.js", () => ({
  StepIndicator: () => null,
}));

vi.mock("@/lib/tripDuration", () => ({
  calculateTripDuration: () => null,
}));

vi.mock("wouter", () => ({
  useLocation: () => ["", vi.fn()],
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return { ...actual };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
import type { PublicStore } from "../lib/storeApi.js";
import type { WizardState } from "../pages/vitrine/_wizard/use-wizard-state.js";
import type { CompletedOrder } from "../pages/vitrine/_wizard/use-wizard-state.js";

function makeStore(): PublicStore {
  return {
    id: "store-1",
    name: "Loja Teste",
    slug: "loja-teste",
    primaryColor: "#3b82f6",
    secondaryColor: "#10b981",
    accentColor: "#f59e0b",
    paymentMethods: ["pix"],
    stripeEnabled: false,
    maintenanceMode: false,
  } as unknown as PublicStore;
}

const BASE_PRODUCT = {
  id: "prod-1",
  name: "Viagem Teste",
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
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  boardingPoints: [],
};

function makeOrder(overrides: Partial<CompletedOrder>): CompletedOrder {
  return {
    orderNumber: "ORD-001",
    totalAmount: "500.00",
    createdAt: new Date().toISOString(),
    reservationExpiresAt: null,
    depositAmount: null,
    amountRemaining: null,
    pixQrCode: null,
    pixQrCodeUrl: null,
    pixCopyPaste: null,
    ...overrides,
  };
}

function makeState(completedOrder: CompletedOrder): WizardState {
  return {
    product: BASE_PRODUCT as WizardState["product"],
    completedOrder,
    showConfetti: false,
    expiryCountdown: null,
    qty: 1,
    effectiveSeats: [] as string[],
    form: {
      customerName: "João Silva",
      customerEmail: "joao@exemplo.com",
      customerPhone: "(11) 99999-9999",
      customerCpf: "529.982.247-25",
      customerBirthdate: "",
      notes: "",
      paymentMethod: "pix",
      couponCode: "",
      cardNumber: "",
      cardName: "",
      cardExpiry: "",
      cardCvv: "",
      installments: "1",
      depositAmount: "",
      partnerSelectedDate: "",
      partnerSelectedTime: "",
      partnerTransferOrigin: "",
      partnerTransferDestination: "",
    },
    navigate: vi.fn(),
    referralDiscount: 0,
    referralApplied: false,
    referralDiscountType: "percentage" as const,
    referralDiscountPct: 5,
    couponDiscount: 0,
    couponResult: null,
    selectedBoardingPointId: "",
    // Required by WizardState but not exercised by these tests
    finalTotal: 500,
    subtotal: 500,
    unitPrice: 500,
    referralCode: "",
    referralDiscountValue: 0,
    referralCreditBalance: 0,
    referralCreditApplied: 0,
    useReferralCredit: false,
    setUseReferralCredit: vi.fn(),
    submitError: null,
    setSubmitError: vi.fn(),
  } as unknown as WizardState;
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------
async function renderConfirmation(completedOrder: CompletedOrder) {
  // Import lazily so mocks are applied first
  const { StepConfirmation } = await import(
    "../pages/vitrine/_wizard/step-confirmation.js"
  );
  const store = makeStore();
  const state = makeState(completedOrder);
  const el = createElement(StepConfirmation, { state, store, slug: "loja-teste" });
  return renderComponent(el);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
afterEach(async () => {
  await cleanupRoots();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("StepConfirmation — financial summary with minimum deposit", () => {
  it("no deposit: shows R$ 0,00 paid and full total as pending", async () => {
    const order = makeOrder({ depositAmount: null, amountRemaining: null });
    const { container } = await renderConfirmation(order);
    const text = container.textContent ?? "";

    // "Valor Pago" card should show 0
    expect(text).toContain("0.00");
    // Saldo Pendente should show full 500
    expect(text).toContain("500.00");
  });

  it("partial payment: shows confirmed payment and remaining balance", async () => {
    const order = makeOrder({
      totalAmount: "500.00",
      depositAmount: "90.00",
      paidAmount: 90,
      amountRemaining: "410.00",
    });
    const { container } = await renderConfirmation(order);
    const text = container.textContent ?? "";

    // Deposit paid
    expect(text).toContain("90.00");
    // Remaining pending
    expect(text).toContain("410.00");
    expect(text).toContain("Pagamento Recebido");
  });

  it("full payment: shows total as paid and zero as pending", async () => {
    const order = makeOrder({
      totalAmount: "500.00",
      depositAmount: "500.00",
      paidAmount: 500,
      amountRemaining: "0.00",
    });
    const { container } = await renderConfirmation(order);
    const text = container.textContent ?? "";

    expect(text).toContain("Pagamento Recebido");
    // Paid amount shows full total
    expect(text).toMatch(/500\.00/);
    // Remaining is 0
    expect(text).toContain("0.00");
  });

  it("heading shows 'Reserva Confirmada!' for partial deposit orders", async () => {
    const order = makeOrder({
      totalAmount: "500.00",
      depositAmount: "90.00",
      paidAmount: 90,
      amountRemaining: "410.00",
    });
    const { container } = await renderConfirmation(order);
    expect(container.textContent).toContain("Reserva Confirmada!");
  });

  it("uses the net total and confirmed payment to calculate the real balance", async () => {
    const order = makeOrder({
      totalAmount: "189.05",
      depositAmount: "30.00",
      paidAmount: 30,
      amountRemaining: "159.05",
    });
    const { container } = await renderConfirmation(order);
    const text = container.textContent ?? "";
    expect(text).toContain("189.05");
    expect(text).toContain("30.00");
    expect(text).toContain("159.05");
  });
});
