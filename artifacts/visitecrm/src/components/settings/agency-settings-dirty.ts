import { createContext, useContext, useEffect } from "react";

export type ReportAgencySettingsDirty = (
  section: string,
  source: string,
  isDirty: boolean,
) => void;

export type AgencySettingsDirtySources = Record<string, string>;

export function updateAgencySettingsDirtySources(
  current: AgencySettingsDirtySources,
  section: string,
  source: string,
  isDirty: boolean,
): AgencySettingsDirtySources {
  if (isDirty) {
    if (current[source] === section) return current;
    return { ...current, [source]: section };
  }
  if (!(source in current)) return current;
  const next = { ...current };
  delete next[source];
  return next;
}

export function hasUnsavedAgencySettings(
  dirtySources: AgencySettingsDirtySources,
  section?: string,
): boolean {
  return section
    ? Object.values(dirtySources).includes(section)
    : Object.keys(dirtySources).length > 0;
}

export const AgencySettingsDirtyContext = createContext<ReportAgencySettingsDirty>(() => {});

export function useAgencySettingsDirty(section: string, source: string, isDirty: boolean): void {
  const reportDirty = useContext(AgencySettingsDirtyContext);

  useEffect(() => {
    reportDirty(section, source, isDirty);
  }, [isDirty, reportDirty, section, source]);
}
