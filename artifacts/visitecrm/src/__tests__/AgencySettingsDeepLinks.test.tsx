import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupRoots, renderComponent } from "./eventSourceHarness.js";
import { getAgencySettingsAccess } from "../components/settings/agency-settings-access.js";
import { ROLES } from "@workspace/permissions";

const mockGetMe = vi.hoisted(() => vi.fn());
const mockSetLocation = vi.hoisted(() => vi.fn());

vi.mock("wouter", async () => {
  const React = await import("react");
  return {
    useLocation: () => [window.location.pathname, mockSetLocation],
    useSearch: () => {
      const [, setRevision] = React.useState(0);
      React.useEffect(() => {
        const refresh = () => setRevision((revision) => revision + 1);
        window.addEventListener("popstate", refresh);
        return () => window.removeEventListener("popstate", refresh);
      }, []);
      return window.location.search;
    },
  };
});

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

async function traverseHistory(direction: "back" | "forward"): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener("popstate", onPopState);
        resolve();
      }, 100);
      function onPopState() {
        window.clearTimeout(timeout);
        resolve();
      }
      window.addEventListener("popstate", onPopState, { once: true });
      window.history[direction]();
    });
  });
}

function expectActivePanel(container: HTMLElement, tab: string): void {
  expect(container.querySelector(
    `[data-testid="settings-tab-panel-${tab}"]`,
  )?.hasAttribute("hidden")).toBe(false);
}

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

      const nextTab = tab === "agency" ? "clube" : "agency";
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

describe("agency settings browser history", () => {
  beforeEach(() => {
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?source=history-test&tab=agency#settings`,
    );
  });

  it("restores the selected section and URL when moving backward and forward", async () => {
    const { container } = await renderComponent(createElement(Configuracoes));
    expectActivePanel(container, "agency");

    for (const tab of ["clube"]) {
      const link = container.querySelector<HTMLButtonElement>(`[data-testid="settings-link-${tab}"]`);
      expect(link).not.toBeNull();
      await act(async () => {
        link!.click();
      });
      expectActivePanel(container, tab);
      expect(new URLSearchParams(window.location.search).get("tab")).toBe(tab);
      expect(new URLSearchParams(window.location.search).get("source")).toBe("history-test");
    }

    await traverseHistory("back");
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("agency");
    expectActivePanel(container, "agency");

    await traverseHistory("forward");
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("clube");
    expectActivePanel(container, "clube");
  });

  it.each(["backup", "integrity"])(
    "keeps an unauthorized direct link to %s on the agency section",
    async (tab) => {
      mockGetMe.mockReturnValue({ data: { role: ROLES.AGENCY_MANAGER } });
      window.history.replaceState({}, "", `${window.location.pathname}?tab=${tab}`);

      const { container } = await renderComponent(createElement(Configuracoes));
      expectActivePanel(container, "agency");
      expect(container.querySelector(`[data-testid="settings-link-${tab}"]`)).toBeNull();
      expect(container.querySelector(`[data-testid="settings-tab-panel-${tab}"]`)).toBeNull();
    },
  );

  it("routes an authorized legacy backup link to the Downloads backup area", async () => {
    window.history.replaceState({}, "", `${window.location.pathname}?campaign=summer&tab=backup#settings`);
    const { container } = await renderComponent(createElement(Configuracoes));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockSetLocation).toHaveBeenCalledWith("/downloads?section=backup");
    expect(container.querySelector('[data-testid="settings-tab-panel-backup"]')).toBeNull();
  });

  it.each(["backup", "integrity"])(
    "does not restore an unauthorized %s section from browser history",
    async (tab) => {
      mockGetMe.mockReturnValue({ data: { role: ROLES.AGENCY_MANAGER } });
      const { container } = await renderComponent(createElement(Configuracoes));
      expectActivePanel(container, "agency");
      expect(container.querySelector(`[data-testid="settings-link-${tab}"]`)).toBeNull();

      window.history.pushState(
        {},
        "",
        `${window.location.pathname}?source=history-test&tab=${tab}`,
      );

      await traverseHistory("back");
      expect(new URLSearchParams(window.location.search).get("tab")).toBe("agency");
      expectActivePanel(container, "agency");

      await traverseHistory("forward");
      expect(new URLSearchParams(window.location.search).get("tab")).toBe(tab);
      expectActivePanel(container, "agency");
      expect(container.querySelector(`[data-testid="settings-tab-panel-${tab}"]`)).toBeNull();
    },
  );
});
