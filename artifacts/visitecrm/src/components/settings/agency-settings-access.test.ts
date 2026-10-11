import { describe, expect, it } from "vitest";
import { ROLES } from "@workspace/permissions";
import { buildAgencySettingsTabUrl, getAgencySettingsAccess } from "./agency-settings-access";

describe("agency settings access", () => {
  it("updates only the section query parameter and keeps the current route", () => {
    expect(buildAgencySettingsTabUrl(
      "https://crm.example.com/configuracoes?campaign=summer#team",
      "integrations",
    )).toBe("/configuracoes?campaign=summer&tab=integrations#team");
  });

  it("shows backup and integrity only to agency administrators", () => {
    const admin = getAgencySettingsAccess(ROLES.AGENCY_ADMIN, null);
    const manager = getAgencySettingsAccess(ROLES.AGENCY_MANAGER, null);
    const values = (groups: typeof admin.navigationGroups) =>
      groups.flatMap((group) => group.items.map((item) => item.value));

    expect(values(admin.navigationGroups)).toContain("backup");
    expect(values(admin.navigationGroups)).toContain("integrity");
    expect(values(manager.navigationGroups)).not.toContain("backup");
    expect(values(manager.navigationGroups)).not.toContain("integrity");
  });

  it.each(["backup", "integrity"])(
    "keeps direct links to %s on the agency profile for non-admin users",
    (requestedTab) => {
      const access = getAgencySettingsAccess(ROLES.AGENCY_MANAGER, requestedTab);

      expect(access.initialTab).toBe("agency");
      expect(access.navigationGroups.flatMap((group) => group.items.map((item) => item.value)))
        .not.toContain(requestedTab);
      expect(access.isAgencyAdmin).toBe(false);
    },
  );

  it.each(["backup", "integrity"])(
    "allows agency administrators to open direct links to %s",
    (requestedTab) => {
      const access = getAgencySettingsAccess(ROLES.AGENCY_ADMIN, requestedTab);

      expect(access.initialTab).toBe(requestedTab);
      expect(access.isAgencyAdmin).toBe(true);
    },
  );
});
