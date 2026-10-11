import { act, createElement, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupRoots, renderComponent } from "../../__tests__/eventSourceHarness.js";

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectContext = React.createContext<{
    value: string;
    onValueChange: (value: string) => void;
  }>({ value: "", onValueChange: () => {} });

  return {
    Select: ({ value, onValueChange, children }: any) =>
      React.createElement(SelectContext.Provider, { value: { value, onValueChange } }, children),
    SelectContent: ({ children }: any) => {
      const select = React.useContext(SelectContext);
      return React.createElement(
        "select",
        {
          "aria-label": "Seção das configurações",
          "data-testid": "settings-section-select",
          value: select.value,
          onChange: (event: any) => select.onValueChange(event.currentTarget.value),
        },
        children,
      );
    },
    SelectGroup: ({ children }: any) => React.createElement(React.Fragment, null, children),
    SelectItem: ({ children, value }: any) => React.createElement("option", { value }, children),
    SelectLabel: () => null,
    SelectTrigger: () => null,
    SelectValue: () => null,
  };
});

import { SettingsNavigation } from "./SettingsNavigation";
import { STORE_SETTINGS_NAVIGATION_GROUPS } from "./store-settings-navigation";
import { Tabs, TabsContent } from "@/components/ui/tabs";

function StoreSettingsNavigationHarness() {
  const [activeTab, setActiveTab] = useState("geral");
  const sections = STORE_SETTINGS_NAVIGATION_GROUPS.flatMap((group) => group.items);

  return createElement(
    Tabs,
    { value: activeTab, onValueChange: setActiveTab },
    createElement(SettingsNavigation, {
      groups: STORE_SETTINGS_NAVIGATION_GROUPS,
      pageLabel: "Seções da loja",
      testIdPrefix: "store-settings",
      value: activeTab,
      onValueChange: setActiveTab,
    }),
    ...sections.map((section) =>
      createElement(
        TabsContent,
        { key: section.value, value: section.value },
        createElement("p", { "data-testid": "active-store-section" }, section.label),
      ),
    ),
  );
}

afterEach(cleanupRoots);

describe("store settings mobile navigation", () => {
  it("opens each of the nine sections without changing the store settings route", async () => {
    window.history.replaceState({}, "", "/loja/configuracoes?source=menu");
    const view = await renderComponent(createElement(StoreSettingsNavigationHarness));
    const select = view.container.querySelector<HTMLSelectElement>('[data-testid="settings-section-select"]');

    expect(select).not.toBeNull();
    expect(select?.options).toHaveLength(9);

    for (const section of STORE_SETTINGS_NAVIGATION_GROUPS.flatMap((group) => group.items)) {
      await act(async () => {
        select!.value = section.value;
        select!.dispatchEvent(new Event("change", { bubbles: true }));
      });

      expect(view.container.querySelector('[data-testid="active-store-section"]')?.textContent).toBe(section.label);
      expect(window.location.pathname).toBe("/loja/configuracoes");
      expect(window.location.search).toBe("?source=menu");
    }
  });
});
