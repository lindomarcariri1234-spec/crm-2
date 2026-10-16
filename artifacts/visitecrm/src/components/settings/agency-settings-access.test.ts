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

  it("exposes the requested settings to agency roles and reserves integrity for admins", () => {
    const admin = getAgencySettingsAccess(ROLES.AGENCY_ADMIN, null);
    const manager = getAgencySettingsAccess(ROLES.AGENCY_MANAGER, null);
    const values = (groups: typeof admin.navigationGroups) =>
      groups.flatMap((group) => group.items.map((item) => item.value));

    const expectedManagerTabs = [
      "agency",
      "customization",
      "plan",
      "team",
      "apikeys",
      "integrations",
      "notifications",
      "features",
      "pipelines",
      "clube",
    ];
    expect(values(admin.navigationGroups)).toEqual([...expectedManagerTabs, "integrity"]);
    expect(values(manager.navigationGroups)).toEqual(expectedManagerTabs);
    expect([...admin.availableTabs]).toEqual([
      "agency",
      "plan",
      "team",
      "apikeys",
      "integrations",
      "notifications",
      "features",
      "pipelines",
      "customization",
      "clube",
      "integrity",
    ]);
    expect([...manager.availableTabs]).toEqual([
      "agency",
      "plan",
      "team",
      "apikeys",
      "integrations",
      "notifications",
      "features",
      "pipelines",
      "customization",
      "clube",
    ]);
  });

  it.each([
    "plan",
    "team",
    "apikeys",
    "integrations",
    "notifications",
    "features",
    "pipelines",
    "customization",
    "clube",
    "integrity",
  ])("opens %s for a direct link when authorized", (tab) => {
    const access = getAgencySettingsAccess(ROLES.AGENCY_ADMIN, tab);
    expect(access.initialTab).toBe(tab);
    expect(access.availableTabs.has(tab)).toBe(true);
  });

  it.each(["backup", "integrity", "unknown"])(
    "keeps unauthorized or removed %s links on the agency profile",
    (requestedTab) => {
      const access = getAgencySettingsAccess(ROLES.AGENCY_MANAGER, requestedTab);

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
