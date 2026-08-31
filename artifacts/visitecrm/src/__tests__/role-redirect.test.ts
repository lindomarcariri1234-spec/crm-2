import { describe, expect, it } from "vitest";
import { ROLES } from "@workspace/permissions";
import { getRoleRedirectPath } from "@/lib/role-redirect";

describe("getRoleRedirectPath", () => {
  it("sends a tenantless client to the client profile", () => {
    expect(
      getRoleRedirectPath({ role: ROLES.CLIENT, tenantId: null }),
    ).toBe("/perfil");
  });

  it("keeps tenantless agency users in onboarding", () => {
    expect(
      getRoleRedirectPath({ role: ROLES.AGENCY_ADMIN, tenantId: null }),
    ).toBe("/onboarding");
  });

  it("keeps existing role destinations", () => {
    expect(
      getRoleRedirectPath({ role: ROLES.SUPER_ADMIN, tenantId: null }),
    ).toBe("/admin");
    expect(
      getRoleRedirectPath({ role: ROLES.SALES, tenantId: "tenant-1" }),
    ).toBe("/meu-painel");
    expect(
      getRoleRedirectPath({ role: ROLES.AGENCY_MANAGER, tenantId: "tenant-1" }),
    ).toBe("/dashboard");
    expect(
      getRoleRedirectPath({ role: ROLES.SUPPORT, tenantId: "tenant-1" }),
    ).toBe("/dashboard");
  });
});