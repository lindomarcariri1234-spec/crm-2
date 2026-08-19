/**
 * DuplicateReservationWarning.test.ts
 *
 * Confirms that a DUPLICATE_RESERVATION 409 response surfaces correctly in:
 *   (1) use-wizard-state — submit() sets submitError, never calls alert()
 *   (2) StepPayment     — renders the amber warning banner when submitError is set
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { flushAct, renderHook, renderComponent, cleanupRoots } from "./eventSourceHarness.js";
import type { PublicStore } from "../lib/storeApi.js";
import type { WizardState } from "../pages/vitrine/_wizard/use-wizard-state.js";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("wouter", () => ({
  useLocation: () => ["", vi.fn()],
}));

vi.mock("@clerk/react", () => ({
  useUser: () => ({ isSignedIn: false }),
}));

vi.mock("@/hooks/useSeatStream", () => ({
  useSeatStream: () => ({ occupiedSeats: {}, eventCount: 0, connected: false }),
}));

vi.mock("@/lib/clientPortalApi", () => ({
  clientPortalApi: {
    getProfile: () => Promise.resolve({ referral: { creditBalance: "0" } }),
  },
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return { ...actual };
});

// ---------------------------------------------------------------------------
// storeApi mock — getProduct resolves to a fixture; createOrder throws DUPLICATE
// ---------------------------------------------------------------------------
const getProductFn = vi.fn().mockImplementation(() => new Promise(() => {}));
const createOrderSpy = vi.fn();

vi.mock("@/lib/storeApi", () => ({
  PublicApiError: class PublicApiError extends Error {
    code?: string;
    constructor(msg: string, code?: string) {
      super(msg);
      this.name = "PublicApiError";
      this.code = code;
    }
  },
  publicStoreApi: {
    get getProduct() { return getProductFn; },
    validateReferral: () => new Promise(() => {}),
    getPartnerInfo: () => new Promise(() => {}),
    getTripSeatMap: () => new Promise(() => {}),
    createOrder: (...args: unknown[]) => createOrderSpy(...args),
  },
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const PRODUCT_FIXTURE = {
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
};

function makeStore(): PublicStore {
  return {
    id: "store-1",
    name: "Loja Teste",
    slug: "loja-teste",
    primaryColor: "#000",
    secondaryColor: "#fff",
    accentColor: "#f00",
    paymentMethods: ["pix"],
    stripeEnabled: false,
    maintenanceMode: false,
    minDepositAmount: null,
  } as unknown as PublicStore;
}

afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// (1) use-wizard-state unit tests
// ---------------------------------------------------------------------------
describe("use-wizard-state — DUPLICATE_RESERVATION handling", () => {
  beforeEach(() => {
    getProductFn.mockResolvedValue(PRODUCT_FIXTURE);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal("alert", vi.fn());
  });

  it("sets submitError with the duplicate-reservation message when API returns DUPLICATE_RESERVATION", async () => {
    // Import the class after vi.mock has been applied
    const { PublicApiError } = await import("../lib/storeApi.js");
    createOrderSpy.mockRejectedValue(
      new PublicApiError("Duplicate reservation", "DUPLICATE_RESERVATION"),
    );

    const { useWizardState } = await import(
      "../pages/vitrine/_wizard/use-wizard-state.js"
    );
    const store = makeStore();
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "viagem-teste", store }),
    );

    // Fill required fields so submit() proceeds to the API call
    await flushAct(() => {
      result.current.set("customerName", "João Silva");
      result.current.set("customerEmail", "joao@exemplo.com");
      result.current.set("customerPhone", "(11) 99999-9999");
      result.current.set("customerCpf", "529.982.247-25");
    });

    await flushAct(async () => {
      await result.current.submit();
    });

    expect(result.current.submitError).toBe(
      "Este cliente já possui uma reserva ativa para esta viagem. Por favor, entre em contato com a agência.",
    );
  });

  it("does NOT call alert() when API returns DUPLICATE_RESERVATION", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);

    const { PublicApiError } = await import("../lib/storeApi.js");
    createOrderSpy.mockRejectedValue(
      new PublicApiError("Duplicate reservation", "DUPLICATE_RESERVATION"),
    );

    const { useWizardState } = await import(
      "../pages/vitrine/_wizard/use-wizard-state.js"
    );
    const store = makeStore();
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "viagem-teste", store }),
    );

    await flushAct(() => {
      result.current.set("customerName", "Ana Costa");
      result.current.set("customerEmail", "ana@exemplo.com");
      result.current.set("customerPhone", "(21) 98888-7777");
      result.current.set("customerCpf", "529.982.247-25");
    });

    await flushAct(async () => {
      await result.current.submit();
    });

    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("submitError starts as null before any submit", async () => {
    const { useWizardState } = await import(
      "../pages/vitrine/_wizard/use-wizard-state.js"
    );
    const store = makeStore();
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "viagem-teste", store }),
    );

    expect(result.current.submitError).toBeNull();
  });

  it("clears submitError when setSubmitError(null) is called", async () => {
    const { PublicApiError } = await import("../lib/storeApi.js");
    createOrderSpy.mockRejectedValue(
      new PublicApiError("Duplicate reservation", "DUPLICATE_RESERVATION"),
    );

    const { useWizardState } = await import(
      "../pages/vitrine/_wizard/use-wizard-state.js"
    );
    const store = makeStore();
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "viagem-teste", store }),
    );

    await flushAct(() => {
      result.current.set("customerName", "Carlos Lima");
      result.current.set("customerEmail", "carlos@exemplo.com");
      result.current.set("customerPhone", "(31) 97777-6666");
      result.current.set("customerCpf", "529.982.247-25");
    });

    await flushAct(async () => {
      await result.current.submit();
    });

    // Error is set after submit
    expect(result.current.submitError).not.toBeNull();

    // Dismiss it
    await flushAct(() => {
      result.current.setSubmitError(null);
    });

    expect(result.current.submitError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (2) StepPayment component tests — amber banner visibility
// ---------------------------------------------------------------------------
describe("StepPayment — submitError amber banner", () => {
  function makeMinimalState(overrides: Partial<WizardState> = {}): WizardState {
    return {
      form: {
        customerName: "",
        customerEmail: "",
        customerPhone: "",
        customerCpf: "",
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
      set: vi.fn(),
      finalTotal: 500,
      submitError: null,
      setSubmitError: vi.fn(),
      // Remaining required WizardState fields stubbed to safe defaults
      navigate: vi.fn(),
      product: null,
      loadingProduct: false,
      notFound: false,
      step: "pagamento" as const,
      setStep: vi.fn(),
      submitting: false,
      completedOrder: null,
      showConfetti: false,
      expiryCountdown: null,
      qty: 1,
      changeQty: vi.fn(),
      incrementQty: vi.fn(),
      decrementQty: vi.fn(),
      selectedVariant: null,
      setSelectedVariant: vi.fn(),
      couponResult: null,
      validatingCoupon: false,
      validateCoupon: vi.fn(),
      removeCoupon: vi.fn(),
      selectedSeats: [],
      layoutSeats: {},
      setLayoutSeats: vi.fn(),
      layoutSeatMap: null,
      loadingLayoutMap: false,
      liveLayoutSeatMap: null,
      referralCode: "",
      setReferralCode: vi.fn(),
      referralApplied: false,
      referralDiscountPct: 0,
      referralDiscountType: null,
      referralDiscountValue: 0,
      applyReferral: vi.fn(),
      removeReferral: vi.fn(),
      basePrice: 500,
      unitPrice: 500,
      subtotal: 500,
      couponDiscount: 0,
      referralDiscount: 0,
      referralCreditBalance: 0,
      referralCreditApplied: 0,
      useReferralCredit: false,
      setUseReferralCredit: vi.fn(),
      showSeatGrid: false,
      effectiveSeats: 1,
      maxSeats: 1,
      isSoldOut: false,
      occupiedSeats: {},
      passengerOptions: [],
      canProceedFromDados: true,
      canProceedFromRevisao: true,
      canProceedFromAssento: true,
      canProceedFromPagamento: true,
      submit: vi.fn(),
      goNext: vi.fn(),
      goBack: vi.fn(),
      toggleSeat: vi.fn(),
      toggleLayoutSeat: vi.fn(),
      partnerInfo: null,
      selectedBoardingPointId: null,
      setSelectedBoardingPointId: vi.fn(),
      coPassengers: [],
      setCoPassenger: vi.fn(),
      store: null,
      ...overrides,
    } as unknown as WizardState;
  }

  it("renders the amber banner when submitError is set", async () => {
    const { StepPayment } = await import(
      "../pages/vitrine/_wizard/step-payment.js"
    );
    const store = makeStore();
    const state = makeMinimalState({
      submitError:
        "Este cliente já possui uma reserva ativa para esta viagem. Por favor, entre em contato com a agência.",
    });

    const { container } = await renderComponent(
      createElement(StepPayment, { state, store }),
    );

    // The banner must be visible
    const bannerText = container.textContent ?? "";
    expect(bannerText).toContain("Reserva não concluída");
    expect(bannerText).toContain(
      "Este cliente já possui uma reserva ativa para esta viagem.",
    );
  });

  it("does NOT render the banner when submitError is null", async () => {
    const { StepPayment } = await import(
      "../pages/vitrine/_wizard/step-payment.js"
    );
    const store = makeStore();
    const state = makeMinimalState({ submitError: null });

    const { container } = await renderComponent(
      createElement(StepPayment, { state, store }),
    );

    expect(container.textContent).not.toContain("Reserva não concluída");
  });

  it("close button calls setSubmitError(null) to dismiss the banner", async () => {
    const { StepPayment } = await import(
      "../pages/vitrine/_wizard/step-payment.js"
    );
    const store = makeStore();
    const setSubmitErrorSpy = vi.fn();
    const state = makeMinimalState({
      submitError: "Reserva duplicada.",
      setSubmitError: setSubmitErrorSpy,
    });

    const { container } = await renderComponent(
      createElement(StepPayment, { state, store }),
    );

    const closeButton = container.querySelector(
      "button[aria-label='Fechar']",
    ) as HTMLButtonElement | null;
    expect(closeButton).not.toBeNull();

    await flushAct(() => {
      closeButton!.click();
    });

    expect(setSubmitErrorSpy).toHaveBeenCalledWith(null);
  });
});
