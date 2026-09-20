import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";
import { FIRST_PURCHASE_REFERRAL_MESSAGE } from "../pages/vitrine/referral-messages.js";

const mocks = vi.hoisted(() => ({
  getReferralInfo: vi.fn(),
  setStorefrontReferralCode: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/lib/storeApi", () => ({
  publicStoreApi: {
    getReferralInfo: (...args: unknown[]) => mocks.getReferralInfo(...args),
  },
  PublicApiError: class PublicApiError extends Error {
    code?: string;
  },
}));

vi.mock("@/lib/storefrontAttribution", () => ({
  setStorefrontReferralCode: (...args: unknown[]) => mocks.setStorefrontReferralCode(...args),
}));

vi.mock("@clerk/react", () => ({
  useUser: () => ({ isSignedIn: false, isLoaded: true }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({ data: undefined }),
}));

vi.mock("@workspace/permissions", () => ({
  ROLES: { CLIENT: "cliente" },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["", mocks.navigate],
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => createElement("button", props, children),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...props }: any) => createElement("span", props, children),
}));

vi.mock("lucide-react", () => {
  const Icon = (props: any) => createElement("svg", props);
  return {
    Loader2: Icon,
    Gift: Icon,
    Tag: Icon,
    Users: Icon,
    ArrowRight: Icon,
    CheckCircle: Icon,
    AlertTriangle: Icon,
  };
});

import ReferralLanding from "../pages/vitrine/referral-landing.js";

const store = {
  name: "Agência Cariri",
  primaryColor: "#2563eb",
  secondaryColor: "#1d4ed8",
  logoUrl: null,
  referralsEnabled: true,
} as any;

beforeEach(() => {
  window.history.replaceState({}, "", "/indicacao?code=INDICA10");
  mocks.getReferralInfo.mockReset();
  mocks.setStorefrontReferralCode.mockReset();
  mocks.navigate.mockReset();
});

afterEach(async () => {
  await cleanupRoots();
});

describe("landing pública de indicação", () => {
  it("mostra a regra de primeira compra somente quando ela está ativa", async () => {
    mocks.getReferralInfo.mockResolvedValue({
      valid: true,
      code: "INDICA10",
      referrerName: "Maria",
      discountPercent: 10,
      firstPurchaseOnly: true,
    });

    const { container } = await renderComponent(
      createElement(ReferralLanding, { slug: "loja-teste", store }),
    );
    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const note = container.querySelector('[role="note"]');
    expect(note?.textContent).toBe(FIRST_PURCHASE_REFERRAL_MESSAGE);
    expect(container.textContent).toContain("10%");
    expect(mocks.getReferralInfo).toHaveBeenCalledWith("loja-teste", "INDICA10");
    expect(mocks.getReferralInfo.mock.calls[0]).toHaveLength(2);
  });

  it("não cria a expectativa de uso único quando a política está desligada", async () => {
    mocks.getReferralInfo.mockResolvedValue({
      valid: true,
      code: "INDICA10",
      referrerName: "Maria",
      discountPercent: 10,
      firstPurchaseOnly: false,
    });

    const { container } = await renderComponent(
      createElement(ReferralLanding, { slug: "loja-teste", store }),
    );
    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="note"]')).toBeNull();
    expect(container.textContent).not.toContain(FIRST_PURCHASE_REFERRAL_MESSAGE);
    expect(mocks.getReferralInfo.mock.calls[0]).toHaveLength(2);
  });

  it("preserva a indicação ao seguir para os produtos sem consultar o histórico do visitante", async () => {
    mocks.getReferralInfo.mockResolvedValue({
      valid: true,
      code: "INDICA10",
      referrerName: "Maria",
      discountPercent: 10,
      firstPurchaseOnly: true,
    });

    const { container } = await renderComponent(
      createElement(ReferralLanding, { slug: "loja-teste", store }),
    );
    await flushAct(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="note"]')?.textContent).toBe(
      FIRST_PURCHASE_REFERRAL_MESSAGE,
    );
    expect(mocks.setStorefrontReferralCode).toHaveBeenCalledWith(
      "loja-teste",
      "INDICA10",
    );

    const productsButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Ver produtos com desconto"),
    );
    expect(productsButton).toBeDefined();
    await flushAct(() => productsButton?.click());

    expect(mocks.navigate).toHaveBeenCalledWith("/loja/loja-teste/produtos");
    expect(mocks.getReferralInfo).toHaveBeenCalledTimes(1);
  });
});