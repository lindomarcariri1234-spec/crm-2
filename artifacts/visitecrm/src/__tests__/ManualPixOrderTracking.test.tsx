import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  cleanupRoots,
  flushAct,
  renderComponent,
} from "./eventSourceHarness.js";
import { VitrineThemeProvider } from "../contexts/VitrineThemeContext.js";
import type { PublicStore } from "../lib/storeApi.js";

const { getOrderSpy } = vi.hoisted(() => ({
  getOrderSpy: vi.fn(),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["", vi.fn()],
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({ data: null }),
}));

vi.mock("@/lib/storeApi", () => ({
  PublicApiError: class PublicApiError extends Error {},
  publicStoreApi: {
    getOrder: (...args: unknown[]) => getOrderSpy(...args),
  },
}));

function makeStore(): PublicStore {
  return {
    id: "store-1",
    name: "Loja Teste",
    slug: "loja-teste",
    primaryColor: "#0f766e",
    secondaryColor: "#14b8a6",
    accentColor: "#f59e0b",
    paymentMethods: ["pix"],
    stripeEnabled: false,
    maintenanceMode: false,
  } as unknown as PublicStore;
}

function getReactProps(el: Element): Record<string, unknown> {
  const key = Object.keys(el).find((candidate) =>
    candidate.startsWith("__reactProps"),
  );
  return key
    ? (el as unknown as Record<string, unknown>)[key] as Record<string, unknown>
    : {};
}

function simulateChange(input: HTMLInputElement, value: string): void {
  const onChange = getReactProps(input).onChange;
  if (typeof onChange === "function") {
    (onChange as (event: { target: { value: string } }) => void)({
      target: { value },
    });
  }
}

const PIX_COPY_PASTE = "000201010212540575.005802BR5911MINHA LOJA6304ABCD";
const PIX_QR_URL = "https://pix.example.test/qr/order-001.png";

const TRACKED_PENDING_ORDER = {
  orderNumber: "#2026-00001",
  customerName: "Maria Souza",
  createdAt: "2026-10-08T12:00:00-03:00",
  status: "pending",
  paymentMethod: "pix",
  paymentProvider: "manual",
  paymentStatus: "pending",
  subtotal: "150.00",
  discountAmount: "0.00",
  totalAmount: "150.00",
  depositAmount: "75.00",
  paidAmount: 0,
  amountRemaining: "150.00",
  pixQrCode: PIX_COPY_PASTE,
  pixQrCodeUrl: PIX_QR_URL,
  pixCopyPaste: PIX_COPY_PASTE,
  items: [],
  reservations: [],
  financialSummary: {
    source: "order",
    subtotal: 150,
    discountAmount: 0,
    totalAmount: 150,
    depositRequested: 75,
    paidAmount: 0,
    amountRemaining: 150,
    minimumRequired: 75,
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

afterEach(async () => {
  await cleanupRoots();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Manual Pix order tracking", () => {
  it("shows the token-authorized order QR, copy code, and requested amount without confirming payment", async () => {
    getOrderSpy.mockResolvedValue(TRACKED_PENDING_ORDER);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    const { default: VitrineOrderTracking } = await import(
      "../pages/vitrine/order-tracking.js"
    );
    const store = makeStore();
    const { container } = await renderComponent(
      createElement(
        VitrineThemeProvider,
        {
          store,
          children: createElement(VitrineOrderTracking, {
            slug: "loja-teste",
            store,
            initialOrderNumber: TRACKED_PENDING_ORDER.orderNumber,
          }),
        },
      ),
    );

    const tokenInput = container.querySelector("#token") as HTMLInputElement;
    await flushAct(() => simulateChange(tokenInput, "manual-pix-access-token"));
    const form = container.querySelector("form")!;
    const onSubmit = getReactProps(form).onSubmit as (
      event: { preventDefault: () => void },
    ) => void;
    await flushAct(async () => {
      onSubmit({ preventDefault: vi.fn() });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = container.textContent ?? "";
    const qrImage = container.querySelector(
      'img[alt="QR Code PIX"]',
    ) as HTMLImageElement | null;
    expect(getOrderSpy).toHaveBeenCalledOnce();
    expect(getOrderSpy).toHaveBeenCalledWith(
      "loja-teste",
      TRACKED_PENDING_ORDER.orderNumber,
      "manual-pix-access-token",
    );
    expect(text).toContain("Pix Manual — aguardando conferência");
    expect(text).toContain("Valor deste Pix: R$ 75.00");
    expect(text).toContain(PIX_COPY_PASTE);
    expect(text).toContain("Aguardando conferência");
    expect(text).toContain("R$ 0.00");
    expect(text).toContain("R$ 150.00");
    expect(text).toContain(
      "O QR Code ou um comprovante enviado não confirma o pagamento automaticamente.",
    );
    expect(qrImage?.getAttribute("src")).toBe(PIX_QR_URL);
  });
});
