import { describe, expect, it } from "vitest";
import { calculateTripDuration } from "../lib/tripDuration.js";

describe("calculateTripDuration", () => {
  it("combines both date/time pairs for an overnight trip", () => {
    const result = calculateTripDuration(
      "2026-09-19",
      "2026-09-21",
      "21:00",
      "02:00",
    );

    expect(result).toMatchObject({
      totalMinutes: 29 * 60,
      days: 1,
      hours: 5,
      formatted: "1 dia e 5 horas",
      formattedShort: "1d 5h",
    });
  });

  it("returns null when either combined datetime is invalid", () => {
    expect(calculateTripDuration(
      "invalid",
      "2026-09-21",
      "21:00",
      "02:00",
    )).toBeNull();
  });
});