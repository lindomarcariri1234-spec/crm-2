/**
 * CartCheckoutDuplicateReservation.test.ts
 *
 * Confirms that a DUPLICATE_RESERVATION 409 response surfaces correctly in the
 * cart-based checkout flow (checkout.tsx):
 *   (1) submit() sets submitError; alert() is never called
 *   (2) The amber warning banner renders when submitError is set
 *   (3) The close button on the banner clears submitError
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { flushAct, renderComponent, cleanupRoots } from "./eventSourceHarness.js";
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

vi.mock("@/lib/clientPortalApi", () => ({
  clientPortalApi: {
    getProfile: () => Promise.resolve({ referral: { creditBalance: "0" } }),
  },
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return { ...actual };
});

// Cart mock: one product in the cart so the component renders normally
vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({
    items: [
      {
        productId: "prod-cart-1",
        productName: "Viagem Teste",
        quantity: 1,
        unitPrice: 500,
        variantLabel: null,
        image: null,
      },
    ],
    total: 500,
    clearCart: vi.fn(),
  }),
}));

// storeApi mock: createOrder is controlled per-test; other calls never resolve
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
    validateReferral: () => new Promise(() => {}),
    trackReferral: () => Promise.resolve({ cookieId: null }),
    createOrder: (...args: unknown[]) => createOrderSpy(...args),
    createPaymentIntent: () => new Promise(() => {}),
  },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeStore(): PublicStore {
  return {
    id: "store-1",
    name: "Loja Teste",
    slug: "loja-teste",
    primaryColor: "#000000",
    secondaryColor: "#ffffff",
    accentColor: "#ff0000",
    paymentMethods: ["pix"],
    stripeEnabled: false,
    stripePublicKey: null,
    maintenanceMode: false,
    minDepositAmount: null,
    couponsEnabled: false,
    referralsEnabled: false,
    contactEmail: null,
    contactWhatsapp: null,
  } as unknown as PublicStore;
}

// ---------------------------------------------------------------------------
// DOM helpers that call React props directly, bypassing disabled + event system
// ---------------------------------------------------------------------------

/** Read the React internal props from a DOM element via the fiber key. */
function getReactProps(el: Element): Record<string, unknown> {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps"));
  return key ? (el as Record<string, unknown>)[key] as Record<string, unknown> : {};
}

/**
 * Simulate a controlled-input change by calling the React onChange prop directly.
 * This works even when the native-event approach fails to trigger React 19's
 * root-level event delegation.
 */
function simulateChange(input: HTMLInputElement, value: string): void {
  const props = getReactProps(input);
  if (typeof props.onChange === "function") {
    (props.onChange as (e: { target: { value: string } }) => void)({
      target: { value },
    });
  }
}

/**
 * Call a button's React onClick prop directly, bypassing the disabled guard.
 * Needed when we want to force a step transition regardless of form state.
 */
function callOnClick(el: HTMLElement): void {
  const props = getReactProps(el);
  if (typeof props.onClick === "function") {
    (props.onClick as () => void)();
  }
}

/**
 * Return the first button whose trimmed, collapsed textContent matches `text`
 * exactly (SVGs contribute empty strings, so collapsed whitespace is fine).
 * Falls back to includes() when no exact match exists so partial labels like
 * "Ir para Pagamento" still work when the icon adds trailing whitespace.
 */
function findButton(
  container: HTMLElement,
  text: string,
): HTMLButtonElement | null {
  const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
  const buttons = Array.from(container.querySelectorAll("button")) as HTMLButtonElement[];
  // Prefer an exact collapsed match
  const exact = buttons.find((b) => collapse(b.textContent ?? "") === text);
  if (exact) return exact;
  // Fall back to starts-with so icon text after the label still matches
  return buttons.find((b) => collapse(b.textContent ?? "").startsWith(text)) ?? null;
}

/**
 * Drive the checkout from "dados" → "revisao" → "pagamento" and click submit.
 * Uses the React-props approach so disabled state and event delegation are not
 * a factor.
 */
async function advanceThroughStepsAndSubmit(
  container: HTMLElement,
  name: string,
  email: string,
): Promise<void> {
  // Fill required dados fields via React onChange props directly
  const nameInput = container.querySelector(
    'input[placeholder="Seu nome completo"]',
  ) as HTMLInputElement;
  const emailInput = container.querySelector(
    'input[placeholder="seu@email.com"]',
  ) as HTMLInputElement;

  await flushAct(() => {
    simulateChange(nameInput, name);
    simulateChange(emailInput, email);
  });

  // dados → revisao: call the Continuar button's onClick directly
  const continuarBtn = findButton(container, "Continuar");
  expect(continuarBtn).not.toBeNull();
  await flushAct(() => {
    callOnClick(continuarBtn!);
  });

  // revisao → pagamento
  const pagamentoBtn = findButton(container, "Ir para Pagamento");
  expect(pagamentoBtn).not.toBeNull();
  await flushAct(() => {
    callOnClick(pagamentoBtn!);
  });

  // trigger submit()
  const confirmarBtn = findButton(container, "Confirmar Pedido");
  expect(confirmarBtn).not.toBeNull();
  await flushAct(async () => {
    callOnClick(confirmarBtn!);
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("VitrineCheckout — DUPLICATE_RESERVATION handling", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: vi.fn(),
    });
    vi.stubGlobal("alert", vi.fn());
    vi.stubGlobal("crypto", {
      randomUUID: () => "test-idempotency-key-cart",
    });
  });

  it("shows the amber banner when createOrder returns DUPLICATE_RESERVATION", async () => {
    const { PublicApiError } = await import("../lib/storeApi.js");
    createOrderSpy.mockRejectedValue(
      new PublicApiError("Duplicate reservation", "DUPLICATE_RESERVATION"),
    );

    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const store = makeStore();
    const { container } = await renderComponent(
      createElement(VitrineCheckout, { slug: "loja-teste", store }),
    );

    await advanceThroughStepsAndSubmit(
      container,
      "João Silva",
      "joao@exemplo.com",
    );

    const text = container.textContent ?? "";
    expect(text).toContain("Reserva não concluída");
    expect(text).toContain(
      "Este cliente já possui uma reserva ativa para esta viagem.",
    );
  });

  it("does NOT call alert() when createOrder returns DUPLICATE_RESERVATION", async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);

    const { PublicApiError } = await import("../lib/storeApi.js");
    createOrderSpy.mockRejectedValue(
      new PublicApiError("Duplicate reservation", "DUPLICATE_RESERVATION"),
    );

    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const store = makeStore();
    const { container } = await renderComponent(
      createElement(VitrineCheckout, { slug: "loja-teste", store }),
    );

    await advanceThroughStepsAndSubmit(
      container,
      "Ana Costa",
      "ana@exemplo.com",
    );

    expect(alertSpy).not.toHaveBeenCalled();
  });

  it("the banner close button clears submitError and hides the banner", async () => {
    const { PublicApiError } = await import("../lib/storeApi.js");
    createOrderSpy.mockRejectedValue(
      new PublicApiError("Duplicate reservation", "DUPLICATE_RESERVATION"),
    );

    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const store = makeStore();
    const { container } = await renderComponent(
      createElement(VitrineCheckout, { slug: "loja-teste", store }),
    );

    await advanceThroughStepsAndSubmit(
      container,
      "Carlos Lima",
      "carlos@exemplo.com",
    );

    // Banner is visible after submit
    expect(container.textContent).toContain("Reserva não concluída");

    // Click the close button
    const closeBtn = container.querySelector(
      'button[aria-label="Fechar"]',
    ) as HTMLButtonElement | null;
    expect(closeBtn).not.toBeNull();
    await flushAct(() => {
      callOnClick(closeBtn!);
    });

    // Banner is gone
    expect(container.textContent).not.toContain("Reserva não concluída");
  });

  it("submitError is absent before any submit attempt", async () => {
    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const store = makeStore();
    const { container } = await renderComponent(
      createElement(VitrineCheckout, { slug: "loja-teste", store }),
    );

    // No submit — banner must not be present on initial render
    expect(container.textContent).not.toContain("Reserva não concluída");
  });
});
