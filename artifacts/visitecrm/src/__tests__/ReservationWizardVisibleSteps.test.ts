/**
 * Tests that ReservationWizard's visibleSteps correctly excludes the "assento"
 * step when store.seatMapEnabled === false. This exercises the component-level
 * filtering in reservation-wizard.tsx (which is independent of the hook-level
 * step-skipping covered in wizard-seat-step-skip.test.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { renderComponent, cleanupRoots } from "./eventSourceHarness.js";
import type { PublicStore } from "../lib/storeApi.js";

// ---------------------------------------------------------------------------
// Mock useWizardState — controlled per test via mockWizardState.mockReturnValue
// ---------------------------------------------------------------------------
const mockWizardState = vi.hoisted(() => vi.fn());

vi.mock("../pages/vitrine/_wizard/use-wizard-state.js", () => ({
  useWizardState: mockWizardState,
}));

// Stub heavy step components — the tests only care about StepIndicator text
vi.mock("../pages/vitrine/_wizard/step-passenger-form.js", () => ({
  StepPassengerForm: () => createElement("div", { "data-testid": "step-dados" }),
}));
vi.mock("../pages/vitrine/_wizard/step-review.js", () => ({
  StepReview: () => createElement("div", { "data-testid": "step-revisao" }),
}));
vi.mock("../pages/vitrine/_wizard/step-seat-selector.js", () => ({
  StepSeatSelector: () => createElement("div", { "data-testid": "step-assento" }),
}));
vi.mock("../pages/vitrine/_wizard/step-payment.js", () => ({
  StepPayment: () => createElement("div", { "data-testid": "step-pagamento" }),
}));
vi.mock("../pages/vitrine/_wizard/step-confirmation.js", () => ({
  StepConfirmation: () => createElement("div", { "data-testid": "step-confirmado" }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["", vi.fn()],
}));

// lucide-react: use importOriginal so any new icon added to the wizard
// passes through automatically without needing a manual stub update.
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return { ...actual };
});

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, style, className }: Record<string, unknown>) =>
    createElement("button", { onClick, disabled, style, className }, children as never),
}));

vi.mock("@/lib/labels", () => ({
  TRIP_TYPE_LABELS: {} as Record<string, string>,
}));

import ReservationWizard from "../pages/vitrine/reservation-wizard.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal StoreProduct that has showSeatMap: true so the product-level flag
 *  does NOT suppress the seat step; only store.seatMapEnabled should. */
function makeProduct(showSeatMap?: boolean) {
  return {
    id: "prod-1",
    type: "excursao",
    name: "Viagem Nordeste",
    slug: "viagem-nordeste",
    price: "350",
    onSale: false,
    showSeatMap: showSeatMap === undefined ? true : showSeatMap,
    paymentMethods: ["pix"],
    boardingPoints: [],
  };
}

/** Minimal useWizardState return value that gets past the loading/not-found guards. */
function makeWizardState(overrides: Record<string, unknown> = {}) {
  return {
    product: makeProduct(),
    loadingProduct: false,
    notFound: false,
    step: "dados",
    submitting: false,
    completedOrder: null,
    canProceedFromDados: () => true,
    canProceedFromRevisao: () => true,
    canProceedFromAssento: () => true,
    canProceedFromPagamento: () => true,
    submit: vi.fn(),
    goNext: vi.fn(),
    goBack: vi.fn(),
    navigate: vi.fn(),
    ...overrides,
  };
}

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

beforeEach(() => {
  mockWizardState.mockReturnValue(makeWizardState());
});

afterEach(async () => {
  await cleanupRoots();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ReservationWizard — visibleSteps when store.seatMapEnabled === false", () => {
  it('excludes the "Assento" step from the step indicator when store.seatMapEnabled is false', async () => {
    mockWizardState.mockReturnValue(makeWizardState());

    const { container } = await renderComponent(
      createElement(ReservationWizard, {
        slug: "loja-teste",
        productSlug: "viagem-nordeste",
        store: makeStore(false),
      }),
    );

    // StepIndicator renders step.label as visible text — "Assento" must be absent
    expect(container.textContent).not.toContain("Assento");
  });

  it('keeps "Dados", "Revisão", "Pagamento", and "Confirmação" when assento is excluded', async () => {
    mockWizardState.mockReturnValue(makeWizardState());

    const { container } = await renderComponent(
      createElement(ReservationWizard, {
        slug: "loja-teste",
        productSlug: "viagem-nordeste",
        store: makeStore(false),
      }),
    );

    expect(container.textContent).toContain("Dados");
    expect(container.textContent).toContain("Revisão");
    expect(container.textContent).toContain("Pagamento");
    expect(container.textContent).toContain("Confirmação");
  });

  it('includes "Assento" when store.seatMapEnabled is true', async () => {
    mockWizardState.mockReturnValue(makeWizardState());

    const { container } = await renderComponent(
      createElement(ReservationWizard, {
        slug: "loja-teste",
        productSlug: "viagem-nordeste",
        store: makeStore(true),
      }),
    );

    expect(container.textContent).toContain("Assento");
  });

  it('includes "Assento" when store.seatMapEnabled is undefined (defaults to true)', async () => {
    mockWizardState.mockReturnValue(makeWizardState());

    const { container } = await renderComponent(
      createElement(ReservationWizard, {
        slug: "loja-teste",
        productSlug: "viagem-nordeste",
        store: makeStore(undefined),
      }),
    );

    expect(container.textContent).toContain("Assento");
  });

  it('excludes "Assento" when product.showSeatMap is false (product-level flag — existing behaviour)', async () => {
    // product.showSeatMap === false is the existing per-trip flag — still works
    mockWizardState.mockReturnValue(
      makeWizardState({ product: makeProduct(false) }),
    );

    const { container } = await renderComponent(
      createElement(ReservationWizard, {
        slug: "loja-teste",
        productSlug: "viagem-nordeste",
        store: makeStore(true), // store has seatMap enabled, but trip overrides
      }),
    );

    expect(container.textContent).not.toContain("Assento");
  });
});
