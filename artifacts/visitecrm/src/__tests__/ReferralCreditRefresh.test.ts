import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { flushAct, renderComponent, renderHook, cleanupRoots } from "./eventSourceHarness.js";
import type { PublicStore } from "../lib/storeApi.js";

const { getProductFn, createOrderSpy, getProfileSpy } = vi.hoisted(() => ({
  getProductFn: vi.fn(),
  createOrderSpy: vi.fn(),
  getProfileSpy: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["", vi.fn()],
}));

vi.mock("@clerk/react", () => ({
  useUser: () => ({ isSignedIn: true }),
}));

vi.mock("@/hooks/useSeatStream", () => ({
  useSeatStream: () => ({ occupiedSeats: {}, eventCount: 0, connected: false }),
}));

vi.mock("@/lib/clientPortalApi", () => ({
  clientPortalApi: {
    getProfile: (...args: unknown[]) => getProfileSpy(...args),
  },
}));

vi.mock("@/lib/storeApi", () => ({
  PublicApiError: class PublicApiError extends Error {
    code?: string;
    constructor(message: string, code?: string) {
      super(message);
      this.code = code;
    }
  },
  publicStoreApi: {
    get getProduct() {
      return getProductFn;
    },
    validateReferral: vi.fn(),
    getPartnerInfo: vi.fn(),
    getTripSeatMap: vi.fn(),
    createOrder: (...args: unknown[]) => createOrderSpy(...args),
  },
}));

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

const STORE = {
  id: "store-1",
  name: "Loja Teste",
  slug: "loja-teste",
  primaryColor: "#000000",
  secondaryColor: "#ffffff",
  accentColor: "#f00",
  paymentMethods: ["pix"],
  stripeEnabled: false,
  maintenanceMode: false,
} as unknown as PublicStore;

const ORDER_RESPONSE = {
  orderNumber: "ORD-001",
  totalAmount: "460.00",
  createdAt: new Date().toISOString(),
  paymentStatus: "pending",
  status: "pending",
  reservationExpiresAt: null,
  depositAmount: null,
  amountRemaining: "460.00",
  pixQrCode: null,
  pixQrCodeUrl: null,
  pixCopyPaste: null,
  paymentToken: null,
  referralCreditApplied: 40,
  financialSummary: {
    source: "order",
    subtotal: 500,
    discountAmount: 40,
    totalAmount: 460,
    depositRequested: 0,
    paidAmount: 0,
    amountRemaining: 460,
    minimumRequired: 460,
    reservationValid: false,
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
};

function makeStore(): PublicStore {
  return STORE;
}

function callOnClick(el: HTMLElement): void {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps"));
  const props = key
    ? (el as Record<string, unknown>)[key] as Record<string, unknown>
    : {};
  if (typeof props.onClick === "function") {
    (props.onClick as () => void)();
  }
}

beforeEach(() => {
  getProductFn.mockResolvedValue(PRODUCT_FIXTURE);
  getProfileSpy
    .mockReset()
    .mockResolvedValueOnce({ referral: { creditBalance: "100.00" } })
    .mockResolvedValueOnce({ referral: { creditBalance: "60.00" } });
  createOrderSpy.mockReset().mockResolvedValue(ORDER_RESPONSE);
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  vi.stubGlobal("sessionStorage", {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});

afterEach(async () => {
  await cleanupRoots();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Referral credit refresh after checkout", () => {
  it("stores the server-applied amount and refreshes the portal balance", async () => {
    const { useWizardState } = await import(
      "../pages/vitrine/_wizard/use-wizard-state.js"
    );
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store: makeStore() }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.referralCreditBalance).toBe(100);

    await flushAct(() => {
      result.current.set("customerName", "Maria Souza");
      result.current.set("customerEmail", "maria@example.com");
      result.current.set("customerPhone", "(11) 99999-9999");
      result.current.set("customerCpf", "529.982.247-25");
      result.current.setUseReferralCredit(true);
    });

    expect(result.current.referralCreditApplied).toBe(100);

    await flushAct(async () => {
      await result.current.submit();
    });

    expect(createOrderSpy).toHaveBeenCalledOnce();
    const payload = createOrderSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.referralCreditUsed).toBe(100);
    expect(getProfileSpy).toHaveBeenCalledTimes(2);
    expect(result.current.referralCreditBalance).toBe(60);
    expect(result.current.completedOrder?.referralCreditRequested).toBe(100);
    expect(result.current.completedOrder?.referralCreditApplied).toBe(40);
    expect(result.current.completedOrder?.referralCreditBalanceAfter).toBe(60);
    expect(result.current.completedOrder?.totalAmount).toBe("460.00");
  });

  it("keeps the order summary when the refreshed cashback balance is unavailable", async () => {
    getProfileSpy
      .mockReset()
      .mockResolvedValueOnce({ referral: { creditBalance: "100.00" } })
      .mockRejectedValueOnce(new Error("Perfil indisponível"));

    const { useWizardState } = await import(
      "../pages/vitrine/_wizard/use-wizard-state.js"
    );
    const { StepConfirmation } = await import(
      "../pages/vitrine/_wizard/step-confirmation.js"
    );
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store: makeStore() }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAct(() => {
      result.current.set("customerName", "João Souza");
      result.current.set("customerEmail", "joao@example.com");
      result.current.set("customerPhone", "(11) 99999-9999");
      result.current.set("customerCpf", "529.982.247-25");
      result.current.setUseReferralCredit(true);
    });

    await flushAct(async () => {
      await result.current.submit();
    });

    expect(result.current.completedOrder?.referralCreditApplied).toBe(40);
    expect(result.current.completedOrder?.totalAmount).toBe("460.00");
    expect(result.current.completedOrder?.referralCreditBalanceAfter).toBeNull();
    expect(result.current.completedOrder?.referralCreditBalanceRefreshFailed).toBe(true);

    const { container } = await renderComponent(
      createElement(StepConfirmation, {
        state: result.current,
        store: makeStore(),
        slug: "loja-teste",
      }),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Aplicamos R$ 40.00 de cashback");
    expect(text).toContain("o novo total é R$ 460.00");
    expect(text).toContain("Não foi possível atualizar seu saldo agora");
    expect(text).not.toContain("Saldo atual de cashback: R$ 100.00");

    getProfileSpy.mockResolvedValueOnce({ referral: { creditBalance: "60.00" } });
    const refreshButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.replace(/\s+/g, " ").trim() === "Atualizar saldo",
    );
    expect(refreshButton).not.toBeUndefined();
    await flushAct(() => callOnClick(refreshButton!));

    expect(createOrderSpy).toHaveBeenCalledOnce();
    expect(getProfileSpy).toHaveBeenCalledTimes(3);
    expect(result.current.completedOrder?.totalAmount).toBe("460.00");
    expect(result.current.completedOrder?.referralCreditBalanceAfter).toBe(60);
    expect(result.current.completedOrder?.referralCreditBalanceRefreshFailed).toBe(false);

    await (async () => {
      const updatedConfirmation = await renderComponent(
        createElement(StepConfirmation, {
          state: result.current,
          store: makeStore(),
          slug: "loja-teste",
        }),
      );
      const updatedText = updatedConfirmation.container.textContent ?? "";
      expect(updatedText).toContain("Saldo atual de cashback: R$ 60.00.");
      expect(updatedText).not.toContain("Não foi possível atualizar seu saldo agora");
    })();
  });
});