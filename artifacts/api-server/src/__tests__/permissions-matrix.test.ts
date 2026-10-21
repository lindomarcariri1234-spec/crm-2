import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACTIONS,
  hasPermission,
  RESOURCES,
  ROLES,
} from "@workspace/permissions";

const tenantRoutes = readFileSync(
  new URL("../routes/tenants.ts", import.meta.url),
  "utf8",
);

describe("central permission matrix", () => {
  it("fails closed for unknown roles, resources, and actions", () => {
    expect(hasPermission("unrecognized-role", RESOURCES.FINANCIAL, ACTIONS.VIEW)).toBe(false);
    expect(hasPermission(ROLES.AGENCY_ADMIN, "unrecognized-resource" as never, ACTIONS.VIEW)).toBe(false);
    expect(hasPermission(ROLES.AGENCY_ADMIN, RESOURCES.FINANCIAL, "unrecognized-action" as never)).toBe(false);
  });

  it("keeps manager financial edits and reservation deletion restricted", () => {
    expect(hasPermission(ROLES.AGENCY_MANAGER, RESOURCES.FINANCIAL, ACTIONS.VIEW)).toBe(true);
    expect(hasPermission(ROLES.AGENCY_MANAGER, RESOURCES.FINANCIAL, ACTIONS.EDIT)).toBe(false);
    expect(hasPermission(ROLES.AGENCY_MANAGER, RESOURCES.RESERVATIONS, ACTIONS.DELETE)).toBe(false);
  });

  it("preserves intended staff capabilities without granting them to clients", () => {
    expect(hasPermission(ROLES.SALES, RESOURCES.RESERVATIONS, ACTIONS.CREATE)).toBe(true);
    expect(hasPermission(ROLES.SUPPORT, RESOURCES.CLIENTS, ACTIONS.EDIT)).toBe(true);
    expect(hasPermission(ROLES.CLIENT, RESOURCES.FINANCIAL, ACTIONS.VIEW)).toBe(false);
    expect(hasPermission(ROLES.CLIENT, RESOURCES.TEAM, ACTIONS.VIEW)).toBe(false);
  });

  it("requires settings-view permission and own-tenant scope for tenant details", () => {
    expect(tenantRoutes).toContain(
      "if (!hasPermission(me.role, RESOURCES.SETTINGS, ACTIONS.VIEW))",
    );
    expect(tenantRoutes).toContain(
      "if (me.role !== ROLES.SUPER_ADMIN && me.tenantId !== req.params.id)",
    );
    expect(hasPermission(ROLES.SALES, RESOURCES.SETTINGS, ACTIONS.VIEW)).toBe(false);
    expect(hasPermission(ROLES.SUPPORT, RESOURCES.SETTINGS, ACTIONS.VIEW)).toBe(false);
    expect(hasPermission(ROLES.AGENCY_MANAGER, RESOURCES.SETTINGS, ACTIONS.VIEW)).toBe(true);
  });
});
