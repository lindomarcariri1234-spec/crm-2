import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRoots, renderComponent } from "./eventSourceHarness.js";
import { getAgencySettingsAccess } from "../components/settings/agency-settings-access.js";
import { ROLES } from "@workspace/permissions";

const mockGetMe = vi.hoisted(() => vi.fn());

vi.mock("wouter", () => ({
  useLocation: () => [window.location.pathname, vi.fn()],
  useSearch: () => window.location.search,
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return { ...actual, useGetMe: mockGetMe };
});

vi.mock("@/components/settings/SettingsNavigation", async () => {
  const React = await import("react");
  return {
    SettingsNavigation: ({ groups, onValueChange }: {
      groups: Array<{ items: Array<{ value: string; label: string }> }>;
      onValueChange: (value: string) => void;
    }) => React.createElement(
      "nav",
      null,
      groups.flatMap((group) => group.items.map((item) =>
        React.createElement(
          "button",
          {
            key: item.value,
            type: "button",
            "data-testid": `settings-link-${item.value}`,
            onClick: () => onValueChange(item.value),
          },
          item.label,
        ),
      )),
    ),
  };
});

vi.mock("@/components/ui/tabs", async () => {
  const React = await import("react");
  const TabsContext = React.createContext({ value: "agency" });
  return {
    Tabs: ({ value, children }: { value: string; children: React.ReactNode }) =>
      React.createElement(TabsContext.Provider, { value: { value } }, children),
    TabsContent: ({ value }: { value: string }) => {
      const tabs = React.useContext(TabsContext);
      return React.createElement("section", {
        "data-testid": `settings-tab-panel-${value}`,
        "aria-hidden": tabs.value !== value,
        hidden: tabs.value !== value,
      });
    },
  };
});

import Configuracoes from "../pages/configuracoes.js";

const adminTabs = getAgencySettingsAccess(ROLES.AGENCY_ADMIN, null).navigationGroups
  .flatMap((group) => group.items.map((item) => item.value));

beforeEach(() => {
  mockGetMe.mockReturnValue({ data: { role: ROLES.AGENCY_ADMIN } });
});

afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
});

describe("agency settings shared section links", () => {
  it.each(adminTabs)(
    "opens the %s section from a copied link and preserves other URL values",
    async (tab) => {
      const search = new URLSearchParams({
        source: "share",
        campaign: "summer",
        tab,
      });
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}?${search.toString()}#agency-settings`,
      );

      const { container } = await renderComponent(createElement(Configuracoes));

      await act(async () => {
        await Promise.resolve();
      });

      const activePanel = container.querySelector(
        `[data-testid="settings-tab-panel-${tab}"]`,
      );
      expect(activePanel).not.toBeNull();
      expect(activePanel?.hasAttribute("hidden")).toBe(false);
      expect(window.location.search).toContain("source=share");
      expect(window.location.search).toContain("campaign=summer");
      expect(window.location.search).toContain(`tab=${tab}`);
      expect(window.location.hash).toBe("#agency-settings");

      const nextTab = tab === "agency" ? "plan" : "agency";
      const nextLink = container.querySelector<HTMLButtonElement>(
        `[data-testid="settings-link-${nextTab}"]`,
      );
      expect(nextLink).not.toBeNull();
      await act(async () => {
        nextLink!.click();
      });

      expect(container.querySelector(
        `[data-testid="settings-tab-panel-${nextTab}"]`,
      )?.hasAttribute("hidden")).toBe(false);
      const updatedSearch = new URLSearchParams(window.location.search);
      expect(updatedSearch.get("source")).toBe("share");
      expect(updatedSearch.get("campaign")).toBe("summer");
      expect(updatedSearch.get("tab")).toBe(nextTab);
      expect(window.location.hash).toBe("#agency-settings");
    },
  );
});
