import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";
import { flushAct, renderComponent, cleanupRoots } from "./eventSourceHarness.js";
import type { PublicStore } from "../lib/storeApi.js";

const {
  createOrderSpy,
  createPaymentIntentSpy,
  getOrderSpy,
  getProfileSpy,
  confirmPaymentSpy,
  trackReferralCreditReductionSpy,
  emptyCart,
} = vi.hoisted(() => ({
  createOrderSpy: vi.fn(),
  createPaymentIntentSpy: vi.fn(),
  getOrderSpy: vi.fn(),
  getProfileSpy: vi.fn(),
  confirmPaymentSpy: vi.fn(),
  trackReferralCreditReductionSpy: vi.fn(),
  emptyCart: { value: false },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["", vi.fn()],
}));

vi.mock("@clerk/react", () => ({
  useUser: () => ({ isSignedIn: true }),
}));

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: () => Promise.resolve({}),
}));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: unknown }) => children,
  PaymentElement: () => null,
  useStripe: () => ({ confirmPayment: (...args: unknown[]) => confirmPaymentSpy(...args) }),
  useElements: () => ({}),
}));

vi.mock("@/lib/clientPortalApi", () => ({
  clientPortalApi: {
    getProfile: (...args: unknown[]) => getProfileSpy(...args),
  },
}));

vi.mock("@/contexts/CartContext", () => ({
  useCart: () => ({
    items: emptyCart.value
      ? []
      : [
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

vi.mock("@/lib/storeApi", () => ({
  PublicApiError: class PublicApiError extends Error {
    code?: string;
    constructor(message: string, code?: string) {
      super(message);
      this.name = "PublicApiError";
      this.code = code;
    }
  },
  publicStoreApi: {
    validateReferral: () => new Promise(() => {}),
    createOrder: (...args: unknown[]) => createOrderSpy(...args),
    createPaymentIntent: (...args: unknown[]) => createPaymentIntentSpy(...args),
    getOrder: (...args: unknown[]) => getOrderSpy(...args),
  },
}));

vi.mock("@/lib/analytics", () => ({
  trackReferralCreditReduction: (...args: unknown[]) =>
    trackReferralCreditReductionSpy(...args),
}));

function makeStore(overrides: Partial<PublicStore> = {}): PublicStore {
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
    couponsEnabled: false,
    referralsEnabled: true,
    ...overrides,
  } as unknown as PublicStore;
}

function makeOrder(totalAmount: string, referralCreditApplied: number) {
  return {
    orderNumber: "ORD-001",
    totalAmount,
    createdAt: new Date().toISOString(),
    reservationExpiresAt: null,
    depositAmount: null,
    amountRemaining: totalAmount,
    paymentStatus: "pending",
    status: "pending",
    paymentToken: null,
    referralCreditApplied,
  };
}

function getReactProps(el: Element): Record<string, unknown> {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps"));
  return key
    ? (el as Record<string, unknown>)[key] as Record<string, unknown>
    : {};
}

function simulateChange(input: HTMLInputElement, value: string): void {
  const props = getReactProps(input);
  if (typeof props.onChange === "function") {
    (props.onChange as (event: { target: { value: string } }) => void)({
      target: { value },
    });
  }
}

function callOnClick(el: HTMLElement): void {
  const props = getReactProps(el);
  if (typeof props.onClick === "function") {
    (props.onClick as () => void)();
  }
}

function findButton(container: HTMLElement, text: string): HTMLButtonElement | null {
  const collapse = (value: string) => value.replace(/\s+/g, " ").trim();
  const buttons = Array.from(container.querySelectorAll("button")) as HTMLButtonElement[];
  return buttons.find((button) => collapse(button.textContent ?? "") === text) ??
    buttons.find((button) => collapse(button.textContent ?? "").startsWith(text)) ??
    null;
}

async function submitWithCashback(
  container: HTMLElement,
  name: string,
  email: string,
  cardPayment = false,
): Promise<void> {
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
  await flushAct(() => callOnClick(findButton(container, "Continuar")!));
  const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement | null;
  expect(toggle).not.toBeNull();
  await flushAct(() => callOnClick(toggle!));
  await flushAct(() => callOnClick(findButton(container, "Ir para Pagamento")!));
  await flushAct(() =>
    callOnClick(findButton(
      container,
      cardPayment ? "Continuar para Pagamento" : "Confirmar Pedido",
    )!),
  );
}

beforeEach(() => {
  emptyCart.value = false;
  getProfileSpy.mockReset().mockResolvedValueOnce({
    referral: { creditBalance: "100.00" },
  }).mockResolvedValueOnce({
    referral: { creditBalance: "60.00" },
  });
  createOrderSpy.mockReset();
  createPaymentIntentSpy.mockReset();
  getOrderSpy.mockReset();
  confirmPaymentSpy.mockReset().mockResolvedValue({ error: null });
  trackReferralCreditReductionSpy
    .mockReset()
    .mockImplementation((_source: string, requested: number, applied: number) => requested - applied > 0.005);
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
  vi.stubGlobal("crypto", {
    randomUUID: () => "cart-referral-credit-key",
  });
});


afterEach(async () => {
  await cleanupRoots();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("VitrineCheckout — referral credit confirmation", () => {
  it("explains a server-side cashback reduction and shows the refreshed balance", async () => {
    createOrderSpy.mockResolvedValue(makeOrder("460.00", 40));
    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const { container } = await renderComponent(
      createElement(VitrineCheckout, { slug: "loja-teste", store: makeStore() }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await submitWithCashback(container, "João Silva", "joao@example.com");

    const text = container.textContent ?? "";
    expect(createOrderSpy).toHaveBeenCalledOnce();
    expect((createOrderSpy.mock.calls[0][1] as Record<string, unknown>).referralCreditUsed).toBe(100);
    expect(getProfileSpy).toHaveBeenCalledTimes(2);
    expect(text).toContain("Seu saldo de cashback mudou durante o checkout.");
    expect(text).toContain("Aplicamos R$ 40.00 de cashback.");
    expect(text).toContain("O novo total do pedido é R$ 460.00.");
    expect(text).toContain("Saldo atual de cashback: R$ 60.00.");
    expect(trackReferralCreditReductionSpy).toHaveBeenCalledOnce();
    expect(trackReferralCreditReductionSpy).toHaveBeenCalledWith("cart_checkout", 100, 40);
  });

  it("does not show a reduction warning when the server applies the full amount", async () => {
    createOrderSpy.mockResolvedValue(makeOrder("400.00", 100));
    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const { container } = await renderComponent(
      createElement(VitrineCheckout, { slug: "loja-teste", store: makeStore() }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await submitWithCashback(container, "Ana Costa", "ana@example.com");

    expect(getProfileSpy).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain(
      "Seu saldo de cashback mudou durante o checkout.",
    );
    expect(container.textContent).toContain("Pedido Confirmado!");
    expect(trackReferralCreditReductionSpy).toHaveBeenCalledOnce();
    expect(trackReferralCreditReductionSpy).toHaveBeenCalledWith("cart_checkout", 100, 100);
  });

  it("keeps the reduced cashback warning after a card payment confirmation", async () => {
    createOrderSpy.mockResolvedValue(makeOrder("460.00", 40));
    createPaymentIntentSpy.mockResolvedValue({
      clientSecret: "test-client-secret",
      publishableKey: "pk_test_card",
    });
    getOrderSpy.mockResolvedValue({ paymentStatus: "paid" });
    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const { container } = await renderComponent(
      createElement(VitrineCheckout, {
        slug: "loja-teste",
        store: makeStore({
          paymentMethods: ["credit_card"],
          stripeEnabled: true,
          stripePublicKey: "pk_test_store",
        }),
      }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await submitWithCashback(container, "Carlos Lima", "carlos@example.com", true);

    expect(createPaymentIntentSpy).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Pagar agora");
    await flushAct(() => callOnClick(findButton(container, "Pagar agora")!));

    const text = container.textContent ?? "";
    expect(confirmPaymentSpy).toHaveBeenCalledOnce();
    expect(text).toContain("Seu saldo de cashback mudou durante o checkout.");
    expect(text).toContain("Aplicamos R$ 40.00 de cashback.");
    expect(text).toContain("O novo total do pedido é R$ 460.00.");
  });

  it("keeps the reduced cashback warning while card payment is pending", async () => {
    vi.useFakeTimers();
    createOrderSpy.mockResolvedValue({
      ...makeOrder("460.00", 40),
      paymentToken: "test-payment-token",
    });
    createPaymentIntentSpy.mockResolvedValue({
      clientSecret: "test-client-secret",
      publishableKey: "pk_test_card",
    });
    getOrderSpy.mockResolvedValue({ paymentStatus: "pending" });
    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const { container } = await renderComponent(
      createElement(VitrineCheckout, {
        slug: "loja-teste",
        store: makeStore({
          paymentMethods: ["credit_card"],
          stripeEnabled: true,
          stripePublicKey: "pk_test_store",
        }),
      }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await submitWithCashback(container, "Marina Lima", "marina@example.com", true);
    await flushAct(async () => {
      callOnClick(findButton(container, "Pagar agora")!);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container.textContent ?? "";
    expect(getOrderSpy).toHaveBeenCalledOnce();
    expect(text).toContain("Processando pagamento...");
    expect(text).toContain("Seu saldo de cashback mudou durante o checkout.");
    expect(text).toContain("Aplicamos R$ 40.00 de cashback.");
    expect(text).toContain("O novo total do pedido é R$ 460.00.");
  });

  it("shows processing after a 3DS return until the webhook marks the order paid", async () => {
    vi.useFakeTimers();
    emptyCart.value = true;
    window.history.pushState(
      {},
      "",
      "/loja/loja-teste/checkout?payment_intent=pi_3ds_pending&payment_intent_client_secret=cs_3ds_pending&redirect_status=succeeded",
    );
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "pending_order_lookup"
          ? JSON.stringify({
              version: 1,
              entries: [
                {
                  orderNumber: "ORD-3DS-PENDING",
                  token: "pending-payment-token",
                  storeSlug: "loja-teste",
                  paymentIntentId: "pi_3ds_pending",
                  referralCreditRequested: 100,
                  referralCreditApplied: 40,
                  referralCreditBalanceAfter: 60,
                },
              ],
            })
          : null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    getOrderSpy
      .mockResolvedValueOnce({
        ...makeOrder("460.00", 40),
        orderNumber: "ORD-3DS-PENDING",
        customerName: "Marina Lima",
        customerEmail: "marina@example.com",
        paymentStatus: "pending",
        paymentToken: "pending-payment-token",
        referralCreditApplied: undefined,
      })
      .mockResolvedValueOnce({ paymentStatus: "pending" })
      .mockResolvedValueOnce({ paymentStatus: "paid" });

    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const { container } = await renderComponent(
      createElement(VitrineCheckout, {
        slug: "loja-teste",
        store: makeStore({
          paymentMethods: ["credit_card"],
          stripeEnabled: true,
          stripePublicKey: "pk_test_store",
        }),
      }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getOrderSpy).toHaveBeenCalledTimes(2);
    expect(getOrderSpy).toHaveBeenNthCalledWith(
      1,
      "loja-teste",
      "ORD-3DS-PENDING",
      "pending-payment-token",
    );
    expect(getOrderSpy).toHaveBeenNthCalledWith(
      2,
      "loja-teste",
      "ORD-3DS-PENDING",
      "pending-payment-token",
    );
    expect(container.textContent).toContain("Processando pagamento...");
    expect(container.textContent).toContain("Aplicamos R$ 40.00 de cashback.");
    expect(container.textContent).toContain("O novo total do pedido é R$ 460.00.");
    expect(container.textContent).toContain("Saldo atual de cashback: R$ 60.00.");
    expect(createOrderSpy).not.toHaveBeenCalled();

    await flushAct(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });

    expect(getOrderSpy).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("Pagamento confirmado!");
    expect(container.textContent).not.toContain("Processando pagamento...");
    expect(container.textContent).toContain("Aplicamos R$ 40.00 de cashback.");
    expect(container.textContent).toContain("O novo total do pedido é R$ 460.00.");
    expect(createOrderSpy).not.toHaveBeenCalled();
  });

  it("keeps the order and cashback summary available when card confirmation fails", async () => {
    createOrderSpy.mockResolvedValue(makeOrder("460.00", 40));
    createPaymentIntentSpy.mockResolvedValue({
      clientSecret: "test-client-secret",
      publishableKey: "pk_test_card",
    });
    confirmPaymentSpy.mockResolvedValue({
      error: { message: "Seu cartão foi recusado." },
    });
    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const { container } = await renderComponent(
      createElement(VitrineCheckout, {
        slug: "loja-teste",
        store: makeStore({
          paymentMethods: ["credit_card"],
          stripeEnabled: true,
          stripePublicKey: "pk_test_store",
        }),
      }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await submitWithCashback(container, "Pedro Alves", "pedro@example.com", true);
    await flushAct(async () => {
      callOnClick(findButton(container, "Pagar agora")!);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container.textContent ?? "";
    expect(createOrderSpy).toHaveBeenCalledOnce();
    expect((createOrderSpy.mock.calls[0][1] as Record<string, unknown>).referralCreditUsed).toBe(100);
    expect(text).toContain("Seu cartão foi recusado.");
    expect(text).toContain("Cashback de indicação");
    expect(text).toContain("− R$ 40.00");
    expect(text).toContain("R$ 460.00");
    expect(findButton(container, "Pagar agora")).not.toBeNull();
    expect(confirmPaymentSpy).toHaveBeenCalledOnce();

    confirmPaymentSpy.mockResolvedValue({ error: null });
    await flushAct(async () => {
      callOnClick(findButton(container, "Pagar agora")!);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(confirmPaymentSpy).toHaveBeenCalledTimes(2);
    expect(createOrderSpy).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Pedido Confirmado!");
  });

  it("reuses the same order when PaymentIntent creation fails and is retried", async () => {
    const order = {
      ...makeOrder("460.00", 40),
      paymentToken: "test-payment-token",
    };
    createOrderSpy.mockResolvedValue(order);
    createPaymentIntentSpy
      .mockRejectedValueOnce(new Error("Stripe indisponível temporariamente."))
      .mockResolvedValueOnce({
        clientSecret: "test-client-secret",
        publishableKey: "pk_test_card",
      });
    getProfileSpy.mockReset().mockResolvedValue({
      referral: { creditBalance: "100.00" },
    });

    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const { container } = await renderComponent(
      createElement(VitrineCheckout, {
        slug: "loja-teste",
        store: makeStore({
          paymentMethods: ["credit_card"],
          stripeEnabled: true,
          stripePublicKey: "pk_test_store",
        }),
      }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await submitWithCashback(container, "Rafael Lima", "rafael@example.com", true);

    expect(createOrderSpy).toHaveBeenCalledOnce();
    expect(createPaymentIntentSpy).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Stripe indisponível temporariamente.");
    expect(findButton(container, "Continuar para Pagamento")).not.toBeNull();

    await flushAct(() =>
      callOnClick(findButton(container, "Continuar para Pagamento")!),
    );

    expect(createOrderSpy).toHaveBeenCalledTimes(2);
    expect(createPaymentIntentSpy).toHaveBeenCalledTimes(2);
    const firstOrderRequest = createOrderSpy.mock.calls[0][1] as Record<string, unknown>;
    const retryOrderRequest = createOrderSpy.mock.calls[1][1] as Record<string, unknown>;
    expect(retryOrderRequest.idempotencyKey).toBe(firstOrderRequest.idempotencyKey);
    expect(retryOrderRequest.referralCreditUsed).toBe(100);
    expect(createPaymentIntentSpy.mock.calls[1]).toEqual([
      "loja-teste",
      "ORD-001",
      "test-payment-token",
    ]);
    expect(findButton(container, "Pagar agora")).not.toBeNull();
  });

  it("recovers the paid order and cashback summary after a 3DS redirect", async () => {
    emptyCart.value = true;
    window.history.pushState(
      { returnContext: "stripe-success" },
      "",
      "/loja/loja-teste/checkout?payment_intent=pi_3ds_test&utm_source=instagram&payment_intent_client_secret=cs_3ds_test&redirect_status=succeeded&utm_campaign=retorno-3ds#payment-result",
    );
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "pending_order_lookup"
          ? JSON.stringify({
              version: 1,
              entries: [
                {
                  orderNumber: "ORD-OTHER",
                  token: "other-payment-token",
                  storeSlug: "loja-teste",
                  paymentIntentId: "pi_other",
                  referralCreditRequested: 50,
                  referralCreditApplied: 50,
                  referralCreditBalanceAfter: 10,
                },
                {
                  orderNumber: "ORD-3DS",
                  token: "test-payment-token",
                  storeSlug: "loja-teste",
                  paymentIntentId: "pi_3ds_test",
                  referralCreditRequested: 100,
                  referralCreditApplied: 40,
                  referralCreditBalanceAfter: 60,
                },
              ],
            })
          : null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    getOrderSpy.mockResolvedValue({
      ...makeOrder("460.00", 40),
      orderNumber: "ORD-3DS",
      customerName: "Beatriz Souza",
      customerEmail: "beatriz@example.com",
      paymentStatus: "paid",
      paymentToken: "test-payment-token",
      referralCreditApplied: undefined,
    });

    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const { container } = await renderComponent(
      createElement(VitrineCheckout, {
        slug: "loja-teste",
        store: makeStore({
          paymentMethods: ["credit_card"],
          stripeEnabled: true,
          stripePublicKey: "pk_test_store",
        }),
      }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container.textContent ?? "";
    expect(getOrderSpy).toHaveBeenCalledOnce();
    expect(getOrderSpy).toHaveBeenCalledWith(
      "loja-teste",
      "ORD-3DS",
      "test-payment-token",
    );
    expect(createOrderSpy).not.toHaveBeenCalled();
    expect(text).toContain("Pedido Confirmado!");
    expect(text).toContain("ORD-3DS");
    expect(text).toContain("Obrigado pela sua compra, Beatriz Souza!");
    expect(text).toContain("Seu saldo de cashback mudou durante o checkout.");
    expect(text).toContain("Aplicamos R$ 40.00 de cashback.");
    expect(text).toContain("O novo total do pedido é R$ 460.00.");
    expect(text).toContain("Saldo atual de cashback: R$ 60.00.");
    expect(window.location.search).toBe(
      "?utm_source=instagram&utm_campaign=retorno-3ds",
    );
    expect(window.location.hash).toBe("#payment-result");
    expect(window.history.state).toEqual({ returnContext: "stripe-success" });
  });

  it("shows a failed 3DS return without presenting the order as confirmed", async () => {
    emptyCart.value = true;
    window.history.pushState(
      {},
      "",
      "/loja/loja-teste/checkout?payment_intent=pi_3ds_failed&payment_intent_client_secret=cs_3ds_failed&redirect_status=failed",
    );
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "pending_order_lookup"
          ? JSON.stringify({
              version: 1,
              entries: [
                {
                  orderNumber: "ORD-3DS-FAILED",
                  token: "failed-payment-token",
                  storeSlug: "loja-teste",
                  paymentIntentId: "pi_3ds_failed",
                  referralCreditRequested: 100,
                  referralCreditApplied: 40,
                  referralCreditBalanceAfter: 60,
                },
              ],
            })
          : null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    getOrderSpy.mockResolvedValue({
      ...makeOrder("460.00", 40),
      orderNumber: "ORD-3DS-FAILED",
      customerName: "Daniel Souza",
      customerEmail: "daniel@example.com",
      paymentStatus: "pending",
      paymentToken: "failed-payment-token",
      referralCreditApplied: undefined,
    });

    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const { container } = await renderComponent(
      createElement(VitrineCheckout, {
        slug: "loja-teste",
        store: makeStore({
          paymentMethods: ["credit_card"],
          stripeEnabled: true,
          stripePublicKey: "pk_test_store",
        }),
      }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container.textContent ?? "";
    expect(getOrderSpy).toHaveBeenCalledOnce();
    expect(text).toContain("Pagamento não concluído");
    expect(text).toContain("Seu pedido não foi confirmado.");
    expect(text).toContain("ORD-3DS-FAILED");
    expect(text).toContain("Cashback registrado neste pedido: R$ 40.00.");
    expect(text).not.toContain("Pedido Confirmado!");
    expect(findButton(container, "Consultar pedido")).not.toBeNull();
    expect(findButton(container, "Tentar novamente")).not.toBeNull();
    expect(window.location.search).toBe("");
  });

  it("shows a canceled 3DS return without presenting the order as confirmed", async () => {
    emptyCart.value = true;
    window.history.pushState(
      {},
      "",
      "/loja/loja-teste/checkout?payment_intent=pi_3ds_canceled&payment_intent_client_secret=cs_3ds_canceled&redirect_status=canceled",
    );
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "pending_order_lookup"
          ? JSON.stringify({
              version: 1,
              entries: [
                {
                  orderNumber: "ORD-3DS-CANCELED",
                  token: "canceled-payment-token",
                  storeSlug: "loja-teste",
                  paymentIntentId: "pi_3ds_canceled",
                  referralCreditRequested: 100,
                  referralCreditApplied: 40,
                  referralCreditBalanceAfter: 60,
                },
              ],
            })
          : null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    getOrderSpy.mockResolvedValue({
      ...makeOrder("460.00", 40),
      orderNumber: "ORD-3DS-CANCELED",
      customerName: "Fernanda Souza",
      customerEmail: "fernanda@example.com",
      paymentStatus: "pending",
      paymentToken: "canceled-payment-token",
      referralCreditApplied: undefined,
    });

    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const { container } = await renderComponent(
      createElement(VitrineCheckout, {
        slug: "loja-teste",
        store: makeStore(),
      }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container.textContent ?? "";
    expect(getOrderSpy).toHaveBeenCalledOnce();
    expect(text).toContain("Pagamento não concluído");
    expect(text).toContain("Seu pedido não foi confirmado.");
    expect(text).toContain("ORD-3DS-CANCELED");
    expect(text).toContain("Cashback registrado neste pedido: R$ 40.00.");
    expect(text).not.toContain("Pedido Confirmado!");
    expect(findButton(container, "Consultar pedido")).not.toBeNull();
    expect(findButton(container, "Tentar novamente")).not.toBeNull();
    expect(createOrderSpy).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });

  it("keeps a canceled 3DS return actionable when its lookup token is unavailable", async () => {
    emptyCart.value = true;
    window.history.pushState(
      {},
      "",
      "/loja/loja-teste/checkout?payment_intent=pi_3ds_unknown_canceled&payment_intent_client_secret=cs_3ds_unknown_canceled&redirect_status=canceled#payment-result",
    );

    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const { container } = await renderComponent(
      createElement(VitrineCheckout, { slug: "loja-teste", store: makeStore() }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container.textContent ?? "";
    expect(getOrderSpy).not.toHaveBeenCalled();
    expect(text).toContain("Pagamento não concluído");
    expect(text).toContain("Não foi possível recuperar o código do pedido nesta sessão.");
    expect(text).not.toContain("Pedido Confirmado!");
    expect(findButton(container, "Consultar pedido")).not.toBeNull();
    expect(findButton(container, "Tentar novamente")).not.toBeNull();
    expect(createOrderSpy).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#payment-result");
  });

  it("keeps a canceled 3DS return actionable when order recovery fails", async () => {
    emptyCart.value = true;
    window.history.pushState(
      { returnContext: "stripe-checkout" },
      "",
      "/loja/loja-teste/checkout?payment_intent=pi_3ds_recovery_error&utm_source=instagram&payment_intent_client_secret=cs_3ds_recovery_error&redirect_status=canceled&utm_campaign=retorno-3ds#payment-result",
    );
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "pending_order_lookup"
          ? JSON.stringify({
              version: 1,
              entries: [
                {
                  orderNumber: "ORD-3DS-RECOVERY-ERROR",
                  token: "recovery-error-payment-token",
                  storeSlug: "loja-teste",
                  paymentIntentId: "pi_3ds_recovery_error",
                  referralCreditRequested: 100,
                  referralCreditApplied: 40,
                  referralCreditBalanceAfter: 60,
                },
              ],
            })
          : null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    getOrderSpy.mockRejectedValueOnce(new Error("Falha temporária na consulta"));

    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const { container } = await renderComponent(
      createElement(VitrineCheckout, { slug: "loja-teste", store: makeStore() }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container.textContent ?? "";
    expect(getOrderSpy).toHaveBeenCalledOnce();
    expect(getOrderSpy).toHaveBeenCalledWith(
      "loja-teste",
      "ORD-3DS-RECOVERY-ERROR",
      "recovery-error-payment-token",
    );
    expect(text).toContain("Pagamento não concluído");
    expect(text).toContain("Seu pedido não foi confirmado.");
    expect(text).toContain("ORD-3DS-RECOVERY-ERROR");
    expect(text).toContain("Cashback registrado neste pedido: R$ 40.00.");
    expect(text).not.toContain("Pedido Confirmado!");
    expect(findButton(container, "Consultar pedido")).not.toBeNull();
    expect(findButton(container, "Tentar novamente")).not.toBeNull();
    expect(createOrderSpy).not.toHaveBeenCalled();
    expect(window.location.search).toBe(
      "?utm_source=instagram&utm_campaign=retorno-3ds",
    );
    expect(window.location.hash).toBe("#payment-result");
    expect(window.history.state).toEqual({ returnContext: "stripe-checkout" });
  });

  it("keeps a failed 3DS return actionable when its lookup token is unavailable", async () => {
    emptyCart.value = true;
    window.history.pushState(
      {},
      "",
      "/loja/loja-teste/checkout?payment_intent=pi_3ds_unknown&payment_intent_client_secret=cs_3ds_unknown&redirect_status=failed#payment-result",
    );

    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const { container } = await renderComponent(
      createElement(VitrineCheckout, { slug: "loja-teste", store: makeStore() }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container.textContent ?? "";
    expect(getOrderSpy).not.toHaveBeenCalled();
    expect(text).toContain("Pagamento não concluído");
    expect(text).toContain("Não foi possível recuperar o código do pedido nesta sessão.");
    expect(text).not.toContain("Pedido Confirmado!");
    expect(findButton(container, "Consultar pedido")).not.toBeNull();
    expect(findButton(container, "Tentar novamente")).not.toBeNull();
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("#payment-result");
  });

  it("keeps the recovered order usable when the cashback refresh fails", async () => {
    emptyCart.value = true;
    window.history.pushState(
      { returnContext: "stripe-balance-refresh" },
      "",
      "/loja/loja-teste/checkout?payment_intent=pi_3ds_missing_balance&utm_source=instagram&payment_intent_client_secret=cs_3ds_missing_balance&redirect_status=succeeded&utm_campaign=retorno-3ds#payment-result",
    );
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "pending_order_lookup"
          ? JSON.stringify({
              version: 1,
              entries: [
                {
                  orderNumber: "ORD-OTHER",
                  token: "other-payment-token",
                  storeSlug: "loja-teste",
                  paymentIntentId: "pi_other",
                },
                {
                  orderNumber: "ORD-3DS-MISSING-BALANCE",
                  token: "test-payment-token",
                  storeSlug: "loja-teste",
                  paymentIntentId: "pi_3ds_missing_balance",
                  referralCreditRequested: 100,
                  referralCreditApplied: 40,
                  referralCreditBalanceAfter: null,
                },
              ],
            })
          : null,
      setItem,
      removeItem: vi.fn(),
    });
    getProfileSpy
      .mockReset()
      .mockRejectedValueOnce(new Error("Falha temporária no refresh do cashback"));
    getOrderSpy.mockResolvedValue({
      ...makeOrder("460.00", 40),
      orderNumber: "ORD-3DS-MISSING-BALANCE",
      customerName: "Carlos Souza",
      customerEmail: "carlos@example.com",
      paymentStatus: "paid",
      paymentToken: "test-payment-token",
      referralCreditApplied: undefined,
    });

    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const { container } = await renderComponent(
      createElement(VitrineCheckout, {
        slug: "loja-teste",
        store: makeStore({
          paymentMethods: ["credit_card"],
          stripeEnabled: true,
          stripePublicKey: "pk_test_store",
        }),
      }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getOrderSpy).toHaveBeenCalledOnce();
    expect(getOrderSpy).toHaveBeenCalledWith(
      "loja-teste",
      "ORD-3DS-MISSING-BALANCE",
      "test-payment-token",
    );
    expect(getProfileSpy).toHaveBeenCalledOnce();
    expect(createOrderSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Pedido Confirmado!");
    expect(container.textContent).toContain("Aplicamos R$ 40.00 de cashback.");
    expect(container.textContent).toContain("O novo total do pedido é R$ 460.00.");
    expect(container.textContent).toContain(
      "O pedido foi confirmado, mas não foi possível atualizar seu saldo de cashback agora.",
    );
    expect(container.textContent).not.toContain("Atualizando seu saldo de cashback...");
    expect(container.textContent).not.toContain("Saldo atual de cashback:");
    expect(findButton(container, "Atualizar saldo")).not.toBeNull();

    expect(createOrderSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(window.location.search).toBe(
      "?utm_source=instagram&utm_campaign=retorno-3ds",
    );
    expect(window.location.hash).toBe("#payment-result");
    expect(window.history.state).toEqual({
      returnContext: "stripe-balance-refresh",
    });

    getProfileSpy.mockRejectedValueOnce(new Error("Falha temporária no segundo refresh"));
    await flushAct(() => callOnClick(findButton(container, "Atualizar saldo")!));

    expect(getProfileSpy).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Pedido Confirmado!");
    expect(container.textContent).toContain(
      "O pedido foi confirmado, mas não foi possível atualizar seu saldo de cashback agora.",
    );
    expect(container.textContent).not.toContain("Saldo atual de cashback:");
    expect(container.textContent).not.toContain(
      "Atualizando seu saldo de cashback...",
    );
    expect(findButton(container, "Atualizar saldo")).not.toBeNull();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("refreshes the cashback after the first refresh attempt fails", async () => {
    emptyCart.value = true;
    window.history.pushState(
      {},
      "",
      "/loja/loja-teste/checkout?payment_intent=pi_3ds_retry_success&payment_intent_client_secret=cs_3ds_retry_success&redirect_status=succeeded",
    );
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "pending_order_lookup"
          ? JSON.stringify({
              version: 1,
              entries: [
                {
                  orderNumber: "ORD-3DS-RETRY-SUCCESS",
                  token: "retry-success-token",
                  storeSlug: "loja-teste",
                  paymentIntentId: "pi_3ds_retry_success",
                  referralCreditRequested: 100,
                  referralCreditApplied: 40,
                  referralCreditBalanceAfter: null,
                },
              ],
            })
          : null,
      setItem,
      removeItem: vi.fn(),
    });
    getProfileSpy
      .mockReset()
      .mockRejectedValueOnce(new Error("Falha no refresh automático"))
      .mockResolvedValueOnce({ referral: { creditBalance: "60.00" } });
    getOrderSpy.mockResolvedValue({
      ...makeOrder("460.00", 40),
      orderNumber: "ORD-3DS-RETRY-SUCCESS",
      customerName: "Carlos Souza",
      customerEmail: "carlos@example.com",
      paymentStatus: "paid",
      paymentToken: "retry-success-token",
      referralCreditApplied: undefined,
    });

    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const { container } = await renderComponent(
      createElement(VitrineCheckout, {
        slug: "loja-teste",
        store: makeStore({
          paymentMethods: ["credit_card"],
          stripeEnabled: true,
          stripePublicKey: "pk_test_store",
        }),
      }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Pedido Confirmado!");
    expect(container.textContent).toContain(
      "O pedido foi confirmado, mas não foi possível atualizar seu saldo de cashback agora.",
    );
    expect(findButton(container, "Atualizar saldo")).not.toBeNull();

    await flushAct(() => callOnClick(findButton(container, "Atualizar saldo")!));

    expect(getProfileSpy).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Pedido Confirmado!");
    expect(container.textContent).toContain("Saldo atual de cashback: R$ 60.00.");
    expect(container.textContent).not.toContain(
      "não foi possível atualizar seu saldo de cashback agora",
    );
    expect(findButton(container, "Atualizar saldo")).toBeNull();
    expect(setItem).toHaveBeenCalledWith(
      "pending_order_lookup",
      expect.stringContaining('"referralCreditBalanceAfter":60'),
    );
  });

  it("does not apply a late automatic cashback refresh after checkout unmounts", async () => {
    emptyCart.value = true;
    window.history.pushState(
      {},
      "",
      "/loja/loja-teste/checkout?payment_intent=pi_3ds_unmounted_refresh&payment_intent_client_secret=cs_3ds_unmounted_refresh&redirect_status=succeeded",
    );
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "pending_order_lookup"
          ? JSON.stringify({
              version: 1,
              entries: [
                {
                  orderNumber: "ORD-3DS-UNMOUNTED-REFRESH",
                  token: "unmounted-refresh-token",
                  storeSlug: "loja-teste",
                  paymentIntentId: "pi_3ds_unmounted_refresh",
                  referralCreditRequested: 100,
                  referralCreditApplied: 40,
                  referralCreditBalanceAfter: null,
                },
              ],
            })
          : null,
      setItem,
      removeItem: vi.fn(),
    });
    let resolveRefreshProfile:
      | ((value: { referral: { creditBalance: string } }) => void)
      | undefined;
    getProfileSpy
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefreshProfile = resolve;
          }),
      );
    getOrderSpy.mockResolvedValue({
      ...makeOrder("460.00", 40),
      orderNumber: "ORD-3DS-UNMOUNTED-REFRESH",
      customerName: "Carlos Souza",
      customerEmail: "carlos@example.com",
      paymentStatus: "paid",
      paymentToken: "unmounted-refresh-token",
      referralCreditApplied: undefined,
    });

    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const renderHandle = await renderComponent(
      createElement(VitrineCheckout, {
        slug: "loja-teste",
        store: makeStore({
          paymentMethods: ["credit_card"],
          stripeEnabled: true,
          stripePublicKey: "pk_test_store",
        }),
      }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getProfileSpy).toHaveBeenCalledOnce();
    expect(renderHandle.container.textContent).toContain(
      "Atualizando seu saldo de cashback...",
    );
    expect(setItem).not.toHaveBeenCalled();

    await renderHandle.unmount();
    await flushAct(() => {
      resolveRefreshProfile?.({ referral: { creditBalance: "60.00" } });
    });

    expect(setItem).not.toHaveBeenCalled();
  });

  it("does not apply a late manual cashback refresh after checkout unmounts", async () => {
    emptyCart.value = true;
    window.history.pushState(
      {},
      "",
      "/loja/loja-teste/checkout?payment_intent=pi_3ds_manual_unmounted&payment_intent_client_secret=cs_3ds_manual_unmounted&redirect_status=succeeded",
    );
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "pending_order_lookup"
          ? JSON.stringify({
              version: 1,
              entries: [
                {
                  orderNumber: "ORD-3DS-MANUAL-UNMOUNTED",
                  token: "manual-unmounted-token",
                  storeSlug: "loja-teste",
                  paymentIntentId: "pi_3ds_manual_unmounted",
                  referralCreditRequested: 100,
                  referralCreditApplied: 40,
                  referralCreditBalanceAfter: null,
                },
              ],
            })
          : null,
      setItem,
      removeItem: vi.fn(),
    });
    let resolveManualRefresh:
      | ((value: { referral: { creditBalance: string } }) => void)
      | undefined;
    getProfileSpy
      .mockReset()
      .mockRejectedValueOnce(new Error("Falha no refresh automático"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveManualRefresh = resolve;
          }),
      );
    getOrderSpy.mockResolvedValue({
      ...makeOrder("460.00", 40),
      orderNumber: "ORD-3DS-MANUAL-UNMOUNTED",
      customerName: "Carlos Souza",
      customerEmail: "carlos@example.com",
      paymentStatus: "paid",
      paymentToken: "manual-unmounted-token",
      referralCreditApplied: undefined,
    });

    const { default: VitrineCheckout } = await import(
      "../pages/vitrine/checkout.js"
    );
    const renderHandle = await renderComponent(
      createElement(VitrineCheckout, {
        slug: "loja-teste",
        store: makeStore({
          paymentMethods: ["credit_card"],
          stripeEnabled: true,
          stripePublicKey: "pk_test_store",
        }),
      }),
    );

    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(findButton(renderHandle.container, "Atualizar saldo")).not.toBeNull();
    await flushAct(() =>
      callOnClick(findButton(renderHandle.container, "Atualizar saldo")!),
    );
    expect(getProfileSpy).toHaveBeenCalledTimes(2);
    expect(renderHandle.container.textContent).toContain(
      "Atualizando seu saldo de cashback...",
    );

    await renderHandle.unmount();
    await flushAct(() => {
      resolveManualRefresh?.({ referral: { creditBalance: "60.00" } });
    });

    expect(setItem).not.toHaveBeenCalled();
  });
});