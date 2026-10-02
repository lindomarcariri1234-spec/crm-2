import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MANAGEMENT_ROLES, ROLES } from "@workspace/permissions";

const mocks = vi.hoisted(() => ({
  signedIn: true,
  redirect: vi.fn(),
  useGetMe: vi.fn(),
}));

vi.mock("@clerk/react", () => ({
  Show: ({
    when,
    children,
  }: {
    when: "signed-in" | "signed-out";
    children?: ReactNode;
  }) => (mocks.signedIn === (when === "signed-in") ? children : null),
  useClerk: () => ({ signOut: () => undefined }),
}));

vi.mock("wouter", () => ({
  Redirect: ({ to }: { to: string }) => {
    mocks.redirect(to);
    return null;
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetMe: mocks.useGetMe,
}));

vi.mock("@/hooks/useApiTimeout", () => ({
  useApiTimeout: () => ({ timedOut: false, reset: () => undefined }),
}));

vi.mock("@/components/api-timeout-fallback", () => ({
  ApiTimeoutFallback: () => null,
}));

vi.mock("@/components/access-blocked-wall", () => ({
  AccessBlockedWall: () => null,
  extractBlockedCode: () => null,
}));

import { RoleGate } from "@/components/role-gate";

const Dashboard = () => <span>dashboard-page</span>;
const StaffPage = () => <span>staff-page</span>;
const Layout = ({ children }: { children: ReactNode }) => <main>{children}</main>;

function renderForRole(
  role: string,
  options: {
    allowedRoles: readonly string[] | "*";
    fallbackPath?: string;
    vendedorFallback?: string;
    requireTenant?: boolean;
    tenantId?: string | null;
  },
) {
  mocks.useGetMe.mockReturnValue({
    data: { role, tenantId: options.tenantId === undefined ? "tenant-test" : options.tenantId },
    error: undefined,
    isLoading: false,
    refetch: () => undefined,
  });

  return renderToStaticMarkup(
    <RoleGate
      component={role === ROLES.SALES ? Dashboard : StaffPage}
      layout={Layout}
      {...options}
    />,
  );
}

describe("RoleGate authenticated role behavior", () => {
  beforeEach(() => {
    mocks.signedIn = true;
    mocks.redirect.mockReset();
    mocks.useGetMe.mockReset();
  });

  it("redirects a signed-in client away from a staff-only route", () => {
    const markup = renderForRole(ROLES.CLIENT, { allowedRoles: "*" });

    expect(mocks.redirect).toHaveBeenCalledWith("/perfil");
    expect(markup).not.toContain("staff-page");
  });

  it("allows a signed-in salesperson on the salesperson dashboard", () => {
    const markup = renderForRole(ROLES.SALES, {
      allowedRoles: [ROLES.SALES],
      fallbackPath: "/dashboard",
      requireTenant: false,
      tenantId: null,
    });

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(markup).toContain("dashboard-page");
  });

  it("redirects a salesperson from a management-only route to its seller fallback", () => {
    const markup = renderForRole(ROLES.SALES, {
      allowedRoles: MANAGEMENT_ROLES,
      fallbackPath: "/dashboard",
      vendedorFallback: "/trips",
    });

    expect(mocks.redirect).toHaveBeenCalledWith("/trips");
    expect(markup).not.toContain("dashboard-page");
  });

  it("allows an authorized agency manager on an agency route", () => {
    const agencyRoles = [
      ROLES.AGENCY_ADMIN,
      ROLES.AGENCY_MANAGER,
      ROLES.SUPPORT,
      ROLES.SUPER_ADMIN,
    ];
    const markup = renderForRole(ROLES.AGENCY_MANAGER, {
      allowedRoles: agencyRoles,
      fallbackPath: "/meu-painel",
    });

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(markup).toContain("staff-page");
  });
});