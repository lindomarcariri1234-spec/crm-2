import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { renderComponent, cleanupRoots } from "./eventSourceHarness.js";

// ---------------------------------------------------------------------------
// Controllable hook return values — set per-test in beforeEach.
// vi.hoisted ensures these exist before the vi.mock factories run.
// ---------------------------------------------------------------------------
const mockGetMe = vi.hoisted(() => vi.fn());
const mockGetTenant = vi.hoisted(() => vi.fn());
const mockGetCurrentSubscription = vi.hoisted(() => vi.fn());
const mockMutateAsync = vi.hoisted(() => vi.fn());
const mockInvalidateQueries = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: mockGetMe,
  useGetTenant: mockGetTenant,
  getGetTenantQueryKey: (id: string) => ["tenant", id],
  useGetCurrentSubscription: mockGetCurrentSubscription,
  useUpdateTenant: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

vi.mock("@/lib/apiError", () => ({
  extractApiError: (_err: unknown, fallback: string) => fallback,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    "data-testid": testId,
  }: {
    checked: boolean;
    onCheckedChange?: (v: boolean) => void;
    disabled?: boolean;
    "data-testid"?: string;
  }) =>
    createElement("button", {
      role: "switch",
      "aria-checked": String(checked),
      "data-testid": testId,
      disabled: disabled ?? false,
      onClick: () => onCheckedChange?.(!checked),
    }),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: unknown }) =>
    createElement("span", { "data-testid": "badge" }, children as never),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick }: { children: unknown; onClick?: () => void }) =>
    createElement("button", { onClick }, children as never),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogContent: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogHeader: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogTitle: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
  DialogFooter: ({ children }: { children: unknown }) =>
    createElement("div", null, children as never),
}));

vi.mock("@/components/ui/toast", () => ({
  ToastAction: ({ children }: { children: unknown }) =>
    createElement("button", null, children as never),
}));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return { ...actual };
});

import { FeaturesTab } from "../pages/FeaturesTab.js";
import { makeTenantData } from "./tenantFixtures.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function planWithAll() {
  return { data: { plan: { supportedFeatures: ["referrals", "coupons", "seatMap"] } } };
}

function planWithNone() {
  return { data: { plan: { supportedFeatures: [] } } };
}

beforeEach(() => {
  mockGetMe.mockReturnValue({ data: { tenantId: "tenant-1", role: "admin" } });
  mockGetCurrentSubscription.mockReturnValue(planWithAll());
  mockMutateAsync.mockResolvedValue(undefined);
  mockInvalidateQueries.mockResolvedValue(undefined);
  mockToast.mockReturnValue(undefined);
});

afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("FeaturesTab — seatMapEnabled toggle", () => {
  it("switch is checked when seatMapEnabled is true", async () => {
    mockGetTenant.mockReturnValue(makeTenantData(true));

    const { container } = await renderComponent(createElement(FeaturesTab, null));

    expect(container.querySelectorAll('[role="switch"]')).toHaveLength(3);
    const seatMapSwitch = container.querySelector(
      '[data-testid="feature-switch-seatMapEnabled"]',
    ) as HTMLElement;
    expect(seatMapSwitch.getAttribute("aria-checked")).toBe("true");
  });

  it("switch is unchecked when seatMapEnabled is false", async () => {
    mockGetTenant.mockReturnValue(makeTenantData(false));

    const { container } = await renderComponent(createElement(FeaturesTab, null));

    const seatMapSwitch = container.querySelector(
      '[data-testid="feature-switch-seatMapEnabled"]',
    ) as HTMLElement;
    expect(seatMapSwitch.getAttribute("aria-checked")).toBe("false");
  });

  it("switch defaults to checked when seatMapEnabled is absent from settings", async () => {
    mockGetTenant.mockReturnValue(makeTenantData(undefined));

    const { container } = await renderComponent(createElement(FeaturesTab, null));

    const seatMapSwitch = container.querySelector(
      '[data-testid="feature-switch-seatMapEnabled"]',
    ) as HTMLElement;
    expect(seatMapSwitch.getAttribute("aria-checked")).toBe("true");
  });

  it("calls updateTenant with seatMapEnabled=false when toggling off", async () => {
    mockGetTenant.mockReturnValue(makeTenantData(true));

    const { container } = await renderComponent(createElement(FeaturesTab, null));

    const seatMapSwitch = container.querySelector(
      '[data-testid="feature-switch-seatMapEnabled"]',
    ) as HTMLElement;
    await act(async () => {
      seatMapSwitch.click();
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      id: "tenant-1",
      data: { seatMapEnabled: false },
    });
  });

  it("calls updateTenant with seatMapEnabled=true when toggling on", async () => {
    mockGetTenant.mockReturnValue(makeTenantData(false));

    const { container } = await renderComponent(createElement(FeaturesTab, null));

    const seatMapSwitch = container.querySelector(
      '[data-testid="feature-switch-seatMapEnabled"]',
    ) as HTMLElement;
    await act(async () => {
      seatMapSwitch.click();
    });

    expect(mockMutateAsync).toHaveBeenCalledWith({
      id: "tenant-1",
      data: { seatMapEnabled: true },
    });
  });

  it("invalidates the tenant query after a successful toggle", async () => {
    mockGetTenant.mockReturnValue(makeTenantData(true));

    const { container } = await renderComponent(createElement(FeaturesTab, null));

    const seatMapSwitch = container.querySelector(
      '[data-testid="feature-switch-seatMapEnabled"]',
    ) as HTMLElement;
    await act(async () => {
      seatMapSwitch.click();
    });

    expect(mockInvalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["tenant", "tenant-1"] }),
    );
  });
});

describe("FeaturesTab — locked feature enforcement", () => {
  it("does not call updateTenant when clicking a locked switch", async () => {
    mockGetCurrentSubscription.mockReturnValue(planWithNone());
    mockGetTenant.mockReturnValue(makeTenantData(true));

    const { container } = await renderComponent(createElement(FeaturesTab, null));

    const seatMapSwitch = container.querySelector(
      '[data-testid="feature-switch-seatMapEnabled"]',
    ) as HTMLElement;
    await act(async () => {
      seatMapSwitch.click();
    });

    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("shows the upgrade modal when a locked switch is clicked", async () => {
    mockGetCurrentSubscription.mockReturnValue(planWithNone());
    mockGetTenant.mockReturnValue(makeTenantData(true));

    const { container } = await renderComponent(createElement(FeaturesTab, null));

    const seatMapSwitch = container.querySelector(
      '[data-testid="feature-switch-seatMapEnabled"]',
    ) as HTMLElement;
    await act(async () => {
      seatMapSwitch.click();
    });

    expect(container.textContent).toContain("Funcionalidade bloqueada");
    expect(container.textContent).toContain("Mapa de Assentos Personalizável");
  });

  it("shows the plan badge next to a locked feature", async () => {
    mockGetCurrentSubscription.mockReturnValue(planWithNone());
    mockGetTenant.mockReturnValue(makeTenantData(true));

    const { container } = await renderComponent(createElement(FeaturesTab, null));

    expect(container.textContent).toContain("Disponível no plano Pro");
  });
});

describe("FeaturesTab — toggle error handling", () => {
  it("shows a destructive toast when saving a feature toggle fails", async () => {
    mockMutateAsync.mockRejectedValue(new Error("server error"));
    mockGetTenant.mockReturnValue(makeTenantData(true));

    const { container } = await renderComponent(createElement(FeaturesTab, null));

    const seatMapSwitch = container.querySelector(
      '[data-testid="feature-switch-seatMapEnabled"]',
    ) as HTMLElement;
    await act(async () => {
      seatMapSwitch.click();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
    expect(mockToast).toHaveBeenCalledTimes(1);
  });

  it("shows a destructive toast (no modal) for a generic 403 without PLAN_UPGRADE_REQUIRED code", async () => {
    const error403 = { response: { status: 403, data: { code: "FORBIDDEN_ROLE" } } };
    mockMutateAsync.mockRejectedValue(error403);
    mockGetTenant.mockReturnValue(makeTenantData(true));

    const { container } = await renderComponent(createElement(FeaturesTab, null));

    const seatMapSwitch = container.querySelector(
      '[data-testid="feature-switch-seatMapEnabled"]',
    ) as HTMLElement;
    await act(async () => {
      seatMapSwitch.click();
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
    expect(container.textContent).not.toContain("Funcionalidade bloqueada");
  });

  it("shows the upgrade modal (not a toast) when PLAN_UPGRADE_REQUIRED is returned", async () => {
    const planUpgradeError = {
      response: {
        status: 403,
        data: {
          code: "PLAN_UPGRADE_REQUIRED",
          error:
            'O plano atual não inclui "Mapa de Assentos". Faça upgrade para o plano Business ou superior para ativar esta funcionalidade.',
        },
      },
    };
    mockMutateAsync.mockRejectedValue(planUpgradeError);
    mockGetTenant.mockReturnValue(makeTenantData(false));

    const { container } = await renderComponent(createElement(FeaturesTab, null));

    const seatMapSwitch = container.querySelector(
      '[data-testid="feature-switch-seatMapEnabled"]',
    ) as HTMLElement;
    await act(async () => {
      seatMapSwitch.click();
    });

    expect(mockToast).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Funcionalidade bloqueada");
    expect(container.textContent).toContain("Mapa de Assentos Personalizável");
    // Plan name must come from the API error message, not hardcoded "Pro"
    expect(container.textContent).toContain("Business");
  });

  it("falls back to the static plan label when the error message has no plan name", async () => {
    const planUpgradeError = {
      response: {
        status: 403,
        data: { code: "PLAN_UPGRADE_REQUIRED", error: "Upgrade necessário." },
      },
    };
    mockMutateAsync.mockRejectedValue(planUpgradeError);
    mockGetTenant.mockReturnValue(makeTenantData(false));

    const { container } = await renderComponent(createElement(FeaturesTab, null));

    const seatMapSwitch = container.querySelector(
      '[data-testid="feature-switch-seatMapEnabled"]',
    ) as HTMLElement;
    await act(async () => {
      seatMapSwitch.click();
    });

    expect(mockToast).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Funcionalidade bloqueada");
    // Falls back to the static label from FEATURES config
    expect(container.textContent).toContain("Pro");
  });

  it("reverts the toggle to its server state after a PLAN_UPGRADE_REQUIRED error", async () => {
    const planUpgradeError = {
      response: { status: 403, data: { code: "PLAN_UPGRADE_REQUIRED" } },
    };
    mockMutateAsync.mockRejectedValue(planUpgradeError);
    mockGetTenant.mockReturnValue(makeTenantData(false));

    const { container } = await renderComponent(createElement(FeaturesTab, null));

    const seatMapSwitch = container.querySelector(
      '[data-testid="feature-switch-seatMapEnabled"]',
    ) as HTMLElement;
    expect(seatMapSwitch.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      seatMapSwitch.click();
    });

    // Switch stays at its server-controlled value (false) — mutation failed,
    // no cache invalidation, so the controlled value is unchanged.
    expect(seatMapSwitch.getAttribute("aria-checked")).toBe("false");
  });
});
