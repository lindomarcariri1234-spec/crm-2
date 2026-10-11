import {
  Bell,
  Building2,
  CreditCard,
  Crown,
  GitBranch,
  Key,
  Palette,
  Puzzle,
  ToggleLeft,
  Users,
  Wrench,
} from "lucide-react";
import { ROLES } from "@workspace/permissions";
import type { SettingsNavigationGroup } from "./SettingsNavigation";

const SETTINGS_TAB_OPTIONS = [
  { value: "agency", label: "Agência", icon: Building2 },
  { value: "plan", label: "Plano", icon: CreditCard },
  { value: "team", label: "Equipe", icon: Users },
  { value: "apikeys", label: "Chaves API", icon: Key },
  { value: "integrations", label: "Integrações", icon: Puzzle },
  { value: "notifications", label: "Notificações", icon: Bell },
  { value: "features", label: "Funcionalidades", icon: ToggleLeft },
  { value: "pipelines", label: "Pipelines", icon: GitBranch },
  { value: "customization", label: "Personalização", icon: Palette },
  { value: "clube", label: "Clube", icon: Crown },
  { value: "integrity", label: "Integridade", icon: Wrench, adminOnly: true },
] as const;

const SETTINGS_NAVIGATION_GROUPS = [
  { label: "Agência", values: ["agency", "customization"] },
  { label: "Conta", values: ["plan", "team", "apikeys"] },
  { label: "Operação", values: ["integrations", "notifications", "features", "pipelines"] },
  { label: "Relacionamento e dados", values: ["clube", "integrity"] },
] as const;

export function buildAgencySettingsTabUrl(currentHref: string, tab: string): string {
  const url = new URL(currentHref);
  url.searchParams.set("tab", tab);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function getAgencySettingsAccess(role: string | undefined, requestedTab: string | null) {
  const isAgencyAdmin = role === ROLES.AGENCY_ADMIN;
  const visibleTabOptions = SETTINGS_TAB_OPTIONS.filter(
    (tab) => !("adminOnly" in tab && tab.adminOnly) || isAgencyAdmin,
  );
  const availableTabs = new Set<string>(visibleTabOptions.map((tab) => tab.value));
  const initialTab = requestedTab && availableTabs.has(requestedTab) ? requestedTab : "agency";
  const navigationGroups: readonly SettingsNavigationGroup[] = SETTINGS_NAVIGATION_GROUPS.map((group) => ({
    label: group.label,
    items: visibleTabOptions.filter((tab) => group.values.some((value) => value === tab.value)),
  }));

  return { isAgencyAdmin, initialTab, navigationGroups };
}

/** Legacy deep link: full backup now lives in Downloads and is agency-admin-only. */
export function getLegacyBackupRedirect(role: string | undefined): string | null {
  return role === ROLES.AGENCY_ADMIN ? "/downloads?section=backup" : null;
}
