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

// publicStoreApi.getProduct never resolves so `product` stays null.
// This lets us test step-navigation without needing real product data.
vi.mock("@/lib/storeApi", () => ({
  publicStoreApi: {
    getProduct: () => new Promise(() => {}),
    validateReferral: () => new Promise(() => {}),
    getPartnerInfo: () => new Promise(() => {}),
    getTripSeatMap: () => new Promise(() => {}),
  },
}));

vi.mock("@/lib/clientPortalApi", () => ({
  clientPortalApi: {
    getProfile: () => Promise.resolve({ referral: { creditBalance: "0" } }),
  },
}));

// lucide-react: use importOriginal so any new icon added to the wizard
// passes through automatically without needing a manual stub update.
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return { ...actual };
});

import { useWizardState } from "../pages/vitrine/_wizard/use-wizard-state.js";

// ---------------------------------------------------------------------------
// Test store fixtures
// ---------------------------------------------------------------------------
function makeStore(seatMapEnabled?: boolean): PublicStore {
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
    seatMapEnabled,
  } as unknown as PublicStore;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
afterEach(async () => {
  await cleanupRoots();
});

// ---------------------------------------------------------------------------
// canProceedFromAssento
// ---------------------------------------------------------------------------
describe("useWizardState — canProceedFromAssento", () => {
  it("returns true immediately when store.seatMapEnabled is false (no seat required)", async () => {
    const store = makeStore(false);
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store }),
    );

    expect(result.current.canProceedFromAssento()).toBe(true);
  });

  it("returns true when store.seatMapEnabled is true but product is null (no layout loaded)", async () => {
    const store = makeStore(true);
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store }),
    );

    // product is null (never loaded) and no layout → falls through to `return true`
    expect(result.current.canProceedFromAssento()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// goNext — step skipping
// ---------------------------------------------------------------------------
describe("useWizardState — goNext skips assento when seatMapEnabled is false", () => {
  it("advances normally from dados → revisao regardless of seatMapEnabled", async () => {
    const store = makeStore(false);
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store }),
    );

    expect(result.current.step).toBe("dados");
    await flushAct(() => { result.current.goNext(); });
    expect(result.current.step).toBe("revisao");
  });

  it("skips from revisao → pagamento (bypassing assento) when seatMapEnabled is false", async () => {
    const store = makeStore(false);
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store }),
    );

    // Advance to revisao first
    await flushAct(() => { result.current.goNext(); });
    expect(result.current.step).toBe("revisao");

    // Next step would be assento — should be skipped
    await flushAct(() => { result.current.goNext(); });
    expect(result.current.step).toBe("pagamento");
  });

  it("goes from revisao → assento normally when seatMapEnabled is true", async () => {
    const store = makeStore(true);
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store }),
    );

    await flushAct(() => { result.current.goNext(); }); // dados → revisao
    await flushAct(() => { result.current.goNext(); }); // revisao → assento (normal)
    expect(result.current.step).toBe("assento");
  });

  it("goes from revisao → assento normally when seatMapEnabled is undefined (default true)", async () => {
    const store = makeStore(undefined);
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store }),
    );

    await flushAct(() => { result.current.goNext(); });
    await flushAct(() => { result.current.goNext(); });
    expect(result.current.step).toBe("assento");
  });
});

// ---------------------------------------------------------------------------
// goBack — step skipping
// ---------------------------------------------------------------------------
describe("useWizardState — goBack skips assento when seatMapEnabled is false", () => {
  it("goes back from pagamento → revisao (bypassing assento) when seatMapEnabled is false", async () => {
    const store = makeStore(false);
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store }),
    );

    // Navigate forward to pagamento: dados → revisao → pagamento (skipping assento)
    await flushAct(() => { result.current.goNext(); }); // → revisao
    await flushAct(() => { result.current.goNext(); }); // → pagamento (skip assento)
    expect(result.current.step).toBe("pagamento");

    // Go back — should skip assento and land on revisao
    await flushAct(() => { result.current.goBack(); });
    expect(result.current.step).toBe("revisao");
  });

  it("goes back from assento → revisao normally when seatMapEnabled is true", async () => {
    const store = makeStore(true);
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store }),
    );

    // Navigate to assento
    await flushAct(() => { result.current.goNext(); }); // → revisao
    await flushAct(() => { result.current.goNext(); }); // → assento
    expect(result.current.step).toBe("assento");

    await flushAct(() => { result.current.goBack(); });
    expect(result.current.step).toBe("revisao");
  });
});

// ---------------------------------------------------------------------------
// visibleSteps invariant: store.seatMapEnabled drives the assento exclusion
// ---------------------------------------------------------------------------
describe("useWizardState — step sequence with seatMapEnabled", () => {
  it("never lands on assento during a full forward traversal when seatMapEnabled is false", async () => {
    const store = makeStore(false);
    const { result } = await renderHook(() =>
      useWizardState({ slug: "loja-teste", productSlug: "produto-1", store }),
    );

    const visitedSteps: string[] = [result.current.step];
    // Traverse forward until we can no longer advance (or reach confirmado)
    for (let i = 0; i < 10; i++) {
      const prev = result.current.step;
      await flushAct(() => { result.current.goNext(); });
      if (result.current.step === prev) break; // no more steps
      visitedSteps.push(result.current.step);
      if (result.current.step === "confirmado") break;
    }

    expect(visitedSteps).not.toContain("assento");
  });
});
