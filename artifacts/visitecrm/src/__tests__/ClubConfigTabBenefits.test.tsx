import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRoots, renderComponent } from "./eventSourceHarness.js";

const mockToast = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const TabsContext = React.createContext<{ value: string; onValueChange: (value: string) => void }>({
    value: "bronze",
    onValueChange: () => {},
  });

  return {
    Tabs: ({ value, onValueChange, children }: {
      value: string;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) => React.createElement(
      TabsContext.Provider,
      { value: { value, onValueChange } },
      children,
    ),
    TabsList: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
      React.createElement("div", props, children),
    TabsTrigger: ({ value, children, ...props }: {
      value: string;
      children: React.ReactNode;
    } & React.ButtonHTMLAttributes<HTMLButtonElement>) => {
      const tabs = React.useContext(TabsContext);
      return React.createElement(
        "button",
        {
          ...props,
          type: "button",
          role: "tab",
          "aria-selected": tabs.value === value,
          "data-state": tabs.value === value ? "active" : "inactive",
          onClick: () => tabs.onValueChange(value),
        },
        children,
      );
    },
    TabsContent: ({ value, children, ...props }: {
      value: string;
      children: React.ReactNode;
    } & React.HTMLAttributes<HTMLDivElement>) => {
      const tabs = React.useContext(TabsContext);
      return tabs.value === value
        ? React.createElement("div", { ...props, role: "tabpanel" }, children)
        : null;
    },
  };
});

import { ClubConfigTab } from "../pages/configuracoes.js";

const tiers = ["bronze", "silver", "gold", "diamond"] as const;

function makeResponse(ok: boolean, body: unknown = {}) {
  return { ok, json: async () => body };
}

function getTab(container: HTMLElement, tier: string): HTMLButtonElement {
  const tab = container.querySelector<HTMLButtonElement>(`[data-testid="club-tier-tab-${tier}"]`);
  if (!tab) throw new Error(`Missing tab for ${tier}`);
  return tab;
}

function expectTierCount(container: HTMLElement, tier: string, count: number): void {
  expect(container.querySelector(`[data-testid="club-tier-count-${tier}"]`)?.textContent)
    .toBe(String(count));
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockToast.mockReset();
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/api/club/config")) {
      return makeResponse(true, { clubName: "Clube de teste", description: null });
    }
    if (url.endsWith("/api/club/benefits") && method === "GET") {
      return makeResponse(true, { data: [] });
    }
    if (url.endsWith("/api/club/benefits") && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { tier: string };
      return makeResponse(true, { id: `benefit-${body.tier}` });
    }
    if (url.includes("/api/club/benefits/") && method === "DELETE") {
      return makeResponse(true);
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  await cleanupRoots();
  vi.unstubAllGlobals();
});

describe("ClubConfigTab benefit tiers", () => {
  it("keeps each tier's list and count isolated while adding and removing benefits", async () => {
    const { container } = await renderComponent(createElement(ClubConfigTab));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    for (const tier of tiers) {
      expectTierCount(container, tier, 0);
    }
    expect(container.querySelector('[data-testid="club-empty-tier-bronze"]')).not.toBeNull();

    for (const [index, tier] of tiers.entries()) {
      await act(async () => {
        getTab(container, tier).click();
      });

      expect(container.querySelector(`[data-testid="club-empty-tier-${tier}"]`)).not.toBeNull();
      const input = container.querySelector<HTMLInputElement>('[data-testid="club-benefit-label-input"]');
      const addButton = container.querySelector<HTMLButtonElement>('[data-testid="club-add-benefit"]');
      expect(input).not.toBeNull();
      expect(addButton).not.toBeNull();

      await act(async () => {
        setInputValue(input!, `Vantagem ${index + 1}`);
      });
      await act(async () => {
        addButton!.click();
      });

      expect(container.querySelector(`[data-testid="club-benefit-benefit-${tier}"]`)?.textContent)
        .toContain(`Vantagem ${index + 1}`);
      expectTierCount(container, tier, 1);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/club/benefits"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining(`"tier":"${tier}"`),
        }),
      );
    }

    for (const tier of tiers) {
      await act(async () => {
        getTab(container, tier).click();
      });

      expect(container.querySelector(`[data-testid="club-benefit-benefit-${tier}"]`)).not.toBeNull();
      expectTierCount(container, tier, 1);
      for (const otherTier of tiers.filter((candidate) => candidate !== tier)) {
        expect(container.querySelector(`[data-testid="club-benefit-benefit-${otherTier}"]`)).toBeNull();
      }
    }

    for (const tier of tiers) {
      await act(async () => {
        getTab(container, tier).click();
      });
      const removeButton = container.querySelector<HTMLButtonElement>(
        `[data-testid="club-delete-benefit-benefit-${tier}"]`,
      );
      expect(removeButton).not.toBeNull();

      await act(async () => {
        removeButton!.click();
      });

      expect(container.querySelector(`[data-testid="club-benefit-benefit-${tier}"]`)).toBeNull();
      expectTierCount(container, tier, 0);
      expect(container.querySelector(`[data-testid="club-empty-tier-${tier}"]`)).not.toBeNull();
    }

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(4);
  });
});
