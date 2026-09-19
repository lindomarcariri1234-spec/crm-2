import { describe, expect, it } from "vitest";
import {
  formatTripDeparture,
  parseTripDeparture,
} from "../lib/trip-date-time.js";

describe("trip departure date and time", () => {
  it("combines a stored Brazil calendar date with a late departure time", () => {
    expect(parseTripDeparture("2026-09-19T15:00:00.000Z", "21:00"))
      .toEqual(new Date("2026-09-20T00:00:00.000Z"));
  });

  it("uses Brazil midnight when a trip has no departure time", () => {
    expect(parseTripDeparture("2026-09-19T15:00:00.000Z"))
      .toEqual(new Date("2026-09-19T03:00:00.000Z"));
  });

  it("formats the same pair without shifting the calendar date", () => {
    expect(formatTripDeparture("2026-09-19T15:00:00.000Z", "21:00"))
      .toBe("19/09/2026 às 21:00");
  });

  it("rejects malformed trip times instead of inventing an instant", () => {
    expect(parseTripDeparture("2026-09-19T15:00:00.000Z", "not-a-time"))
      .toBeNull();
  });
});