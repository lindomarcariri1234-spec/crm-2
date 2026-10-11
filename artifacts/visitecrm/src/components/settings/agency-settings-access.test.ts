import { describe, expect, it } from "vitest";
import { ROLES } from "@workspace/permissions";
import { buildAgencySettingsTabUrl, getAgencySettingsAccess, getLegacyBackupRedirect } from "./agency-settings-access";

describe("agency settings access", () => {
  it("updates only the section query parameter and keeps the current route", () => {
    expect(buildAgencySettingsTabUrl(
      "https://crm.example.com/configuracoes?campaign=summer#team",
      "integrations",
    )).toBe("/configuracoes?campaign=summer&tab=integrations#team");
  });

  it("keeps only integrity in settings navigation for agency administrators", () => {
    const admin = getAgencySettingsAccess(ROLES.AGENCY_ADMIN, null);
    const manager = getAgencySettingsAccess(ROLES.AGENCY_MANAGER, null);
    const values = (groups: typeof admin.navigationGroups) =>
      groups.flatMap((group) => group.items.map((item) => item.value));

    expect(values(admin.navigationGroups)).not.toContain("backup");
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

  it("keeps authorized integrity direct links within settings", () => {
    const requestedTab = "integrity";
    const access = getAgencySettingsAccess(ROLES.AGENCY_ADMIN, requestedTab);

    expect(access.initialTab).toBe(requestedTab);
    expect(access.isAgencyAdmin).toBe(true);
  });

  it("redirects only the agency admin's legacy backup link to Downloads", () => {
    expect(getLegacyBackupRedirect(ROLES.AGENCY_ADMIN)).toBe("/downloads?section=backup");
    expect(getLegacyBackupRedirect(ROLES.AGENCY_MANAGER)).toBeNull();
    expect(getLegacyBackupRedirect(ROLES.SUPER_ADMIN)).toBeNull();
  });
});
