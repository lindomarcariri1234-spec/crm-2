import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { BookOpen, Map } from "lucide-react";
import { cleanupRoots, flushAct, renderComponent } from "./eventSourceHarness.js";

vi.mock("wouter", () => ({
  Link: ({
    href,
    children,
    onClick,
    ...props
  }: {
    href: string;
    children: unknown;
    onClick?: (event: MouseEvent) => void;
    [key: string]: unknown;
  }) =>
    createElement(
      "a",
      {
        href,
        ...props,
        onClick: (event: MouseEvent) => {
          event.preventDefault();
          onClick?.(event);
        },
      },
      children as never,
    ),
  useLocation: () => ["/dashboard", vi.fn()],
  useSearch: () => "",
}));

vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: null }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({ data: null }),
  useGetCalendarStatus: () => ({ data: null }),
  getGetCalendarStatusQueryKey: () => ["calendar-status"],
}));

import { getNavigationContext, NavigationMenu } from "../components/layout.js";

afterEach(async () => {
  await cleanupRoots();
  vi.clearAllMocks();
});

describe("NavigationMenu", () => {
  const items = [
    {
      name: "Cadastros",
      href: "/cadastros",
      icon: BookOpen,
      children: [
        { name: "Visão geral", href: "/cadastros", icon: BookOpen },
        { name: "Veículos", href: "/cadastros/veiculos", icon: Map },
      ],
    },
  ];

  it("opens the active route section and uses a button instead of a parent link", async () => {
    const { container } = await renderComponent(
      createElement(NavigationMenu, {
        items,
        location: "/cadastros/veiculos",
        userRole: "agency_admin",
      }),
    );

    const trigger = container.querySelector("button");
    expect(trigger?.textContent).toContain("Cadastros");
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    expect(trigger?.querySelector("a")).toBeNull();

    const activeLink = container.querySelector('a[href="/cadastros/veiculos"]');
    expect(activeLink?.getAttribute("aria-current")).toBe("page");

    await flushAct(() => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('a[href="/cadastros/veiculos"]')).toBeNull();
  });

  it("filters restricted entries and closes a mobile menu after route navigation", async () => {
    const onNavigate = vi.fn();
    const { container } = await renderComponent(
      createElement(NavigationMenu, {
        items: [
          { name: "Início", href: "/dashboard", icon: BookOpen },
          { name: "Financeiro", href: "/financeiro", icon: Map, roles: ["agency_admin"] },
        ],
        location: "/dashboard",
        userRole: "support",
        onNavigate,
      }),
    );

    expect(container.querySelector('a[href="/financeiro"]')).toBeNull();
    const dashboardLink = container.querySelector('a[href="/dashboard"]');

    await flushAct(() => {
      dashboardLink?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("marks the club menu item active for its settings deep link", async () => {
    const { container } = await renderComponent(
      createElement(NavigationMenu, {
        items: [
          { name: "Configurações", href: "/configuracoes", icon: BookOpen },
          {
            name: "Relacionamento",
            href: "/marketing",
            icon: BookOpen,
            children: [
              { name: "Marketing", href: "/marketing", icon: BookOpen },
              { name: "Clube", href: "/configuracoes?tab=clube", icon: Map },
            ],
          },
        ],
        location: "/configuracoes?tab=clube",
        userRole: "agency_admin",
      }),
    );

    expect(container.querySelector('button[aria-controls="submenu--marketing"]')?.getAttribute("aria-expanded"))
      .toBe("true");
    expect(container.querySelector('a[href="/configuracoes?tab=clube"]')?.getAttribute("aria-current"))
      .toBe("page");
    expect(container.querySelector('a[href="/configuracoes"]')?.getAttribute("aria-current"))
      .toBeNull();
  });
});

describe("getNavigationContext", () => {
  const items = [
    {
      name: "Viagens",
      href: "/trips",
      icon: Map,
      children: [
        { name: "Todas as viagens", href: "/trips", icon: Map },
        { name: "Calendário", href: "/trips/calendar", icon: Map },
      ],
    },
  ];

  it("keeps the most specific child visible in the breadcrumb context", () => {
    const context = getNavigationContext(items, "/trips/calendar");

    expect(context.parent?.name).toBe("Viagens");
    expect(context.current?.name).toBe("Calendário");
  });

  it("keeps a parent context for a dynamic deep link", () => {
    const context = getNavigationContext(items, "/trips/trip-123/passengers");

    expect(context.parent).toBeUndefined();
    expect(context.current?.name).toBe("Viagens");
  });

  it("prefers a query-specific menu item over the general settings link", () => {
    const context = getNavigationContext(
      [
        { name: "Configurações", href: "/configuracoes", icon: BookOpen },
        { name: "Clube", href: "/configuracoes?tab=clube", icon: Map },
      ],
      "/configuracoes?tab=clube",
    );

    expect(context.current?.name).toBe("Clube");
  });
});
