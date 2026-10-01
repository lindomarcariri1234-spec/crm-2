import { describe, expect, it } from "vitest";
import { parseBrazilCalendarDateStart } from "../lib/trip-date-filter";

describe("parseBrazilCalendarDateStart", () => {
  it("converts a Brazil calendar date to midnight in UTC", () => {
    expect(parseBrazilCalendarDateStart("2026-10-01")?.toISOString())
      .toBe("2026-10-01T03:00:00.000Z");
  });

  it.each(["", "2026-2-01", "not-a-date", "2026-02-30", "2026-13-01"])(
    "rejects an invalid calendar date: %s",
    (value) => {
      expect(parseBrazilCalendarDateStart(value)).toBeNull();
    },
  );
});