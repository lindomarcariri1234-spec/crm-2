import { describe, expect, it } from "vitest";
import {
  formatTripCalendarDate,
  formatTripDeparture,
  normalizeTripTime,
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

  it("calculates the excursion duration from the local date/time pair", () => {
    const departure = parseTripDeparture("2026-09-24T15:00:00.000Z", "20:00");
    const returned = parseTripDeparture("2026-09-28T15:00:00.000Z", "03:00");
    expect(departure).toEqual(new Date("2026-09-24T23:00:00.000Z"));
    expect(returned).toEqual(new Date("2026-09-28T06:00:00.000Z"));
    expect((returned!.getTime() - departure!.getTime()) / 3_600_000).toBe(79);
  });

  it("normalizes only valid local wall-clock times", () => {
    expect(normalizeTripTime("20:00")).toBe("20:00");
    expect(normalizeTripTime("03:00:00")).toBe("03:00");
    expect(normalizeTripTime("")).toBeNull();
    expect(normalizeTripTime("24:00")).toBeNull();
  });

  it("formats the persisted calendar date in Brazil time", () => {
    expect(formatTripCalendarDate("2026-09-24T15:00:00.000Z")).toBe("24/09/2026");
    expect(formatTripCalendarDate("2026-09-24")).toBe("24/09/2026");
  });
});