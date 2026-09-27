import { describe, expect, it, vi } from "vitest";
import { renderHook, flushAct, cleanupRoots } from "./eventSourceHarness.js";
import type { PublicStore, StoreProduct } from "../lib/storeApi.js";
import { useWizardState } from "../pages/vitrine/_wizard/use-wizard-state.js";

const { getProduct } = vi.hoisted(() => ({ getProduct: vi.fn() }));

vi.mock("wouter", () => ({ useLocation: () => ["", vi.fn()] }));
vi.mock("@clerk/react", () => ({ useUser: () => ({ isLoaded: true, isSignedIn: false }) }));
vi.mock("@/hooks/useSeatStream", () => ({
  useSeatStream: () => ({ occupiedSeats: {}, eventCount: 0, connected: false }),
}));
vi.mock("@/lib/clientPortalApi", () => ({
  clientPortalApi: { getProfile: vi.fn() },
}));
vi.mock("@/lib/storeApi", () => ({
  PublicApiError: class PublicApiError extends Error {},
  publicStoreApi: {
    getProduct,
    getPartnerInfo: vi.fn(() => Promise.resolve(null)),
    getTripSeatMap: vi.fn(() => Promise.resolve(null)),
    validateReferral: vi.fn(),
    validateCoupon: vi.fn(),
    createOrder: vi.fn(),
  },
}));

const store = {
  slug: "loja-teste",
  paymentMethods: ["pix"],
  seatMapEnabled: false,
} as unknown as PublicStore;

function product(id: string): StoreProduct {
  return {
    id,
    name: id,
    slug: id,
    price: "100",
    salePrice: null,
    hasVariants: false,
    variants: [],
  } as unknown as StoreProduct;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useWizardState product request race", () => {
  it("ignores a slower prior response, including its loading and not-found result", async () => {
    const responseA = deferred<StoreProduct>();
    const responseB = deferred<StoreProduct>();
    getProduct.mockImplementation((_slug: string, slug: string) =>
      slug === "a" ? responseA.promise : responseB.promise,
    );

    let productSlug = "a";
    const { result, rerender } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug, store }),
    );
    expect(result.current.loadingProduct).toBe(true);

    productSlug = "b";
    await rerender();
    expect(result.current.product).toBeNull();
    expect(result.current.loadingProduct).toBe(true);
    expect(result.current.notFound).toBe(false);

    await flushAct(() => responseB.resolve(product("b")));
    expect(result.current.product?.id).toBe("b");
    expect(result.current.loadingProduct).toBe(false);
    expect(result.current.notFound).toBe(false);

    await flushAct(() => responseA.reject(new Error("old product was not found")));
    expect(result.current.product?.id).toBe("b");
    expect(result.current.loadingProduct).toBe(false);
    expect(result.current.notFound).toBe(false);

    await cleanupRoots();
  });
});