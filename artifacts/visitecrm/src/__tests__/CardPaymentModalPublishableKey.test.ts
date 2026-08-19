import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement } from "react";

import { renderComponent, cleanupRoots } from "./eventSourceHarness.js";

// Regression guard for the live/test Stripe key mismatch bug: the settings
// page (configuracoes.tsx) used to load Stripe Elements from a hardcoded
// module-level VITE_STRIPE_PUBLIC_KEY (always the live key) while the
// backend created the PaymentIntent's clientSecret using whatever mode key
// is active server-side (test key in dev). Mixing a live publishable key
// with a test-mode clientSecret breaks card entry in development.
//
// The fix made CardPaymentModal build its Stripe instance from a
// server-provided `publishableKey` prop instead. This test locks that
// contract in place: loadStripe must always be called with the prop value,
// never with a fixed/hardcoded key, and must respond correctly if the prop
// changes (e.g. a fresh checkout call in a different environment).

const loadStripeMock = vi.fn((key: string) => Promise.resolve({ __fakeStripe: key }));
vi.mock("@stripe/stripe-js", () => ({
  loadStripe: (key: string) => loadStripeMock(key),
}));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: unknown }) => children,
  PaymentElement: () => null,
  useStripe: () => null,
  useElements: () => null,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { CardPaymentModal } from "../pages/configuracoes.js";

const INVOICE = {
  id: "invoice-1",
  amount: "99",
  description: "Assinatura VisiteCRM — Pro",
  status: "pending",
} as unknown as import("@workspace/api-client-react").SubscriptionInvoice;

beforeEach(() => {
  loadStripeMock.mockClear();
});

afterEach(async () => {
  await cleanupRoots();
});

describe("CardPaymentModal — publishableKey wiring", () => {
  it("loads Stripe using the server-provided publishableKey prop, never a hardcoded value", async () => {
    await renderComponent(
      createElement(CardPaymentModal, {
        invoice: INVOICE,
        clientSecret: "pi_test_123_secret_abc",
        publishableKey: "pk_test_from_backend_dev",
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }),
    );

    expect(loadStripeMock).toHaveBeenCalledTimes(1);
    expect(loadStripeMock).toHaveBeenCalledWith("pk_test_from_backend_dev");
  });

  it("re-initializes Stripe when a different publishableKey is supplied (e.g. dev vs. prod)", async () => {
    const handle = await renderComponent(
      createElement(CardPaymentModal, {
        invoice: INVOICE,
        clientSecret: "pi_test_123_secret_abc",
        publishableKey: "pk_test_from_backend_dev",
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }),
    );

    expect(loadStripeMock).toHaveBeenLastCalledWith("pk_test_from_backend_dev");

    await handle.rerender(
      createElement(CardPaymentModal, {
        invoice: INVOICE,
        clientSecret: "pi_live_456_secret_def",
        publishableKey: "pk_live_from_backend_prod",
        onClose: vi.fn(),
        onSuccess: vi.fn(),
      }),
    );

    expect(loadStripeMock).toHaveBeenLastCalledWith("pk_live_from_backend_prod");
  });
});
