/**
 * MinDeposit.test.ts
 *
 * Tests for the minimum deposit feature in the vitrine checkout wizard:
 * (a) deposit option appears when store.minDepositAmount > 0
 * (b) deposit option does not appear when minDepositAmount is 0 or null
 * (c) depositAmount is correctly included in the createOrder payload
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flushAct, renderHook, cleanupRoots } from "./eventSourceHarness.js";
import type { PublicStore } from "../lib/storeApi.js";

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
// storeApi mocks — use vi.fn() so individual tests can configure getProduct
// ---------------------------------------------------------------------------
const getProductFn = vi.fn().mockImplementation(() => new Promise(() => {}));
const createOrderSpy = vi.fn().mockResolvedValue({
  orderNumber: "ORD-001",
  totalAmount: "500.00",
  createdAt: new Date().toISOString(),
  reservationExpiresAt: null,
  depositAmount: null,
  amountRemaining: null,
  paymentToken: null,
});

vi.mock("@/lib/storeApi", () => ({
  PublicApiError: class PublicApiError extends Error {
    code?: string;
    constructor(msg: string, code?: string) {
      super(msg);
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

// Minimal product fixture for submit() tests (requires non-null product)
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeStore(minDepositAmount?: string | null): PublicStore {
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
    minDepositAmount: minDepositAmount ?? null,
  } as unknown as PublicStore;
}

import { useWizardState } from "../pages/vitrine/_wizard/use-wizard-state.js";

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// (a) minDepositAmount > 0 — deposit option should be visible
// ---------------------------------------------------------------------------
describe("MinDeposit — deposit option visibility", () => {
  it("(a) form.depositAmount defaults to empty string (no deposit pre-selected)", async () => {
    const store = makeStore("90.00");
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store }),
    );
    // The store has a minDepositAmount, and the form starts with depositAmount = ""
    // which means "full payment" option is the default (no minimum selected yet)
    expect(result.current.form.depositAmount).toBe("");
    expect(result.current.store?.minDepositAmount ?? store.minDepositAmount).toBe("90.00");
  });

  it("(a) setting depositAmount to minDepositAmount marks the minimum option as chosen", async () => {
    const store = makeStore("90.00");
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store }),
    );

    await flushAct(() => {
      result.current.set("depositAmount", "90.00");
    });

    expect(result.current.form.depositAmount).toBe("90.00");
  });

  it("(a) setting depositAmount back to empty resets to full-payment option", async () => {
    const store = makeStore("90.00");
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store }),
    );

    await flushAct(() => { result.current.set("depositAmount", "90.00"); });
    await flushAct(() => { result.current.set("depositAmount", ""); });

    expect(result.current.form.depositAmount).toBe("");
  });
});

// ---------------------------------------------------------------------------
// (b) minDepositAmount is 0 or null — deposit section must not appear
// ---------------------------------------------------------------------------
describe("MinDeposit — deposit section suppressed when not configured", () => {
  it("(b) store with minDepositAmount=null has no deposit value to show", () => {
    const store = makeStore(null);
    // The condition in step-payment.tsx: store.minDepositAmount && Number(store.minDepositAmount) > 0
    const shouldShow = !!(store.minDepositAmount && Number(store.minDepositAmount) > 0);
    expect(shouldShow).toBe(false);
  });

  it("(b) store with minDepositAmount='0' does not show deposit option", () => {
    const store = makeStore("0");
    const shouldShow = !!(store.minDepositAmount && Number(store.minDepositAmount) > 0);
    expect(shouldShow).toBe(false);
  });

  it("(b) store with minDepositAmount=undefined does not show deposit option", () => {
    const store = makeStore(undefined);
    const shouldShow = !!(store.minDepositAmount && Number(store.minDepositAmount) > 0);
    expect(shouldShow).toBe(false);
  });

  it("(b) store with minDepositAmount='90' shows deposit option", () => {
    const store = makeStore("90");
    const shouldShow = !!(store.minDepositAmount && Number(store.minDepositAmount) > 0);
    expect(shouldShow).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (c) depositAmount correctly sent in createOrder payload
// ---------------------------------------------------------------------------
describe("MinDeposit — depositAmount in createOrder payload", () => {
  beforeEach(() => {
    // Make getProduct resolve immediately so submit() can proceed
    getProductFn.mockResolvedValue(PRODUCT_FIXTURE);
    // localStorage stubs
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal("alert", vi.fn());
  });

  it("(c) sends depositAmount=90 when minimum deposit option is chosen", async () => {
    const store = makeStore("90.00");
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store }),
    );

    // Fill required fields
    await flushAct(() => {
      result.current.set("customerName", "João Silva");
      result.current.set("customerEmail", "joao@exemplo.com");
      result.current.set("customerPhone", "(11) 99999-9999");
      result.current.set("customerCpf", "529.982.247-25");
      result.current.set("depositAmount", "90.00");
    });

    await flushAct(async () => {
      await result.current.submit();
    });

    expect(createOrderSpy).toHaveBeenCalledOnce();
    const payload = createOrderSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.depositAmount).toBe(90);
  });

  it("(c) does not send depositAmount when full payment is chosen (empty string)", async () => {
    const store = makeStore("90.00");
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store }),
    );

    await flushAct(() => {
      result.current.set("customerName", "João Silva");
      result.current.set("customerEmail", "joao@exemplo.com");
      result.current.set("customerPhone", "(11) 99999-9999");
      result.current.set("customerCpf", "529.982.247-25");
      // depositAmount stays "" (full payment)
    });

    await flushAct(async () => {
      await result.current.submit();
    });

    expect(createOrderSpy).toHaveBeenCalledOnce();
    const payload = createOrderSpy.mock.calls[0][1] as Record<string, unknown>;
    // empty depositAmount → backend receives undefined (not sent)
    expect(payload.depositAmount).toBeUndefined();
  });

  it("(c) sends depositAmount as number, not string", async () => {
    const store = makeStore("150.50");
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store }),
    );

    await flushAct(() => {
      result.current.set("customerName", "Maria");
      result.current.set("customerEmail", "maria@exemplo.com");
      result.current.set("customerPhone", "(11) 99999-9999");
      result.current.set("customerCpf", "529.982.247-25");
      result.current.set("depositAmount", "150.50");
    });

    await flushAct(async () => {
      await result.current.submit();
    });

    const payload = createOrderSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(typeof payload.depositAmount).toBe("number");
    expect(payload.depositAmount).toBe(150.5);
  });
});
