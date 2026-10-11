import { Building2 } from "lucide-react";
import { ROLES } from "@workspace/permissions";
import type { SettingsNavigationGroup } from "./SettingsNavigation";

const SETTINGS_TAB_OPTIONS = [
  { value: "agency", label: "Agência", icon: Building2 },
] as const;

const SETTINGS_NAVIGATION_GROUPS = [
  { label: "Configuração geral", values: ["agency"] },
] as const;

export function buildAgencySettingsTabUrl(currentHref: string, tab: string): string {
  const url = new URL(currentHref);
  url.searchParams.set("tab", tab);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function normalizeAgencySettingsTabUrl(currentHref: string): string {
  const url = new URL(currentHref);
  url.searchParams.delete("tab");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function getAgencySettingsAccess(role: string | undefined, _requestedTab: string | null) {
  const isAgencyAdmin = role === ROLES.AGENCY_ADMIN;
  const visibleTabOptions = SETTINGS_TAB_OPTIONS;
  const availableTabs = new Set<string>(visibleTabOptions.map((tab) => tab.value));
  const initialTab = "agency";
  const navigationGroups: readonly SettingsNavigationGroup[] = SETTINGS_NAVIGATION_GROUPS
    .map((group) => ({
      label: group.label,
      items: visibleTabOptions.filter((tab) => group.values.some((value) => value === tab.value)),
    }))
    .filter((group) => group.items.length > 0);

  return { isAgencyAdmin, initialTab, navigationGroups, availableTabs };
}

/** Legacy deep link: full backup now lives in Downloads and is agency-admin-only. */
export function getLegacyBackupRedirect(role: string | undefined): string | null {
  return role === ROLES.AGENCY_ADMIN ? "/downloads?section=backup" : null;
}
