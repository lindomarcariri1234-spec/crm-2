import { describe, expect, it } from "vitest";
import { ROLES } from "@workspace/permissions";
import {
  buildAgencySettingsTabUrl,
  getAgencySettingsAccess,
  getLegacyBackupRedirect,
  normalizeAgencySettingsTabUrl,
} from "./agency-settings-access";

describe("agency settings access", () => {
  it("updates only the section query parameter and keeps the current route", () => {
    expect(buildAgencySettingsTabUrl(
      "https://crm.example.com/configuracoes?campaign=summer#team",
      "integrations",
    )).toBe("/configuracoes?campaign=summer&tab=integrations#team");
  });

  it("removes legacy section links while preserving other query parameters and the hash", () => {
    expect(normalizeAgencySettingsTabUrl(
      "https://crm.example.com/configuracoes?campaign=summer&tab=integrations#contact",
    )).toBe("/configuracoes?campaign=summer#contact");
  });

  it("exposes only the agency profile for every agency role", () => {
    const admin = getAgencySettingsAccess(ROLES.AGENCY_ADMIN, null);
    const manager = getAgencySettingsAccess(ROLES.AGENCY_MANAGER, null);
    const values = (groups: typeof admin.navigationGroups) =>
      groups.flatMap((group) => group.items.map((item) => item.value));

    expect(values(admin.navigationGroups)).toEqual(["agency"]);
    expect(values(manager.navigationGroups)).toEqual(["agency"]);
    expect([...admin.availableTabs]).toEqual(["agency"]);
    expect([...manager.availableTabs]).toEqual(["agency"]);
  });

  it.each(["backup", "integrity", "clube", "integrations", "plan"])(
    "sends the legacy %s section to the agency profile",
    (requestedTab) => {
      const access = getAgencySettingsAccess(ROLES.AGENCY_ADMIN, requestedTab);

      expect(access.initialTab).toBe("agency");
      expect(access.availableTabs.has(requestedTab)).toBe(false);
    },
  );

  it("redirects only the agency admin's legacy backup link to Downloads", () => {
    expect(getLegacyBackupRedirect(ROLES.AGENCY_ADMIN)).toBe("/downloads?section=backup");
    expect(getLegacyBackupRedirect(ROLES.AGENCY_MANAGER)).toBeNull();
    expect(getLegacyBackupRedirect(ROLES.SUPER_ADMIN)).toBeNull();
  });
});
