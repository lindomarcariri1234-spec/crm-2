import { describe, expect, it } from "vitest";
import {
  hasUnsavedAgencySettings,
  updateAgencySettingsDirtySources,
} from "./agency-settings-dirty";

describe("agency settings dirty-state tracking", () => {
  it("tracks edits across sources and clears only the saved or discarded source", () => {
    let dirtySources = {};
    dirtySources = updateAgencySettingsDirtySources(dirtySources, "integrations", "stripe", true);
    dirtySources = updateAgencySettingsDirtySources(dirtySources, "integrations", "whatsapp", true);

    expect(hasUnsavedAgencySettings(dirtySources)).toBe(true);
    expect(hasUnsavedAgencySettings(dirtySources, "integrations")).toBe(true);

    dirtySources = updateAgencySettingsDirtySources(dirtySources, "integrations", "stripe", false);
    expect(hasUnsavedAgencySettings(dirtySources, "integrations")).toBe(true);

    dirtySources = updateAgencySettingsDirtySources(dirtySources, "integrations", "whatsapp", false);
    expect(hasUnsavedAgencySettings(dirtySources)).toBe(false);
  });

  it("does not flag untouched sections as dirty", () => {
    expect(hasUnsavedAgencySettings({}, "agency")).toBe(false);
    expect(updateAgencySettingsDirtySources({}, "agency", "profile", false)).toEqual({});
  });
});
