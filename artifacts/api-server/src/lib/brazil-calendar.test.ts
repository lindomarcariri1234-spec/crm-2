import { describe, expect, it } from "vitest";
import { getBrazilMonthBuckets, parseBrazilDateRange } from "./brazil-calendar";

describe("Brazil civil date ranges", () => {
  it("uses São Paulo midnight through the exclusive midnight after the selected end date", () => {
    const range = parseBrazilDateRange("2026-08-31", "2026-08-31");
    expect(range.ok).toBe(true);
    if (!range.ok) return;

    expect(range.startInclusive?.toISOString()).toBe("2026-08-31T03:00:00.000Z");
    expect(range.endExclusive?.toISOString()).toBe("2026-09-01T03:00:00.000Z");

    const start = range.startInclusive!.getTime();
    const end = range.endExclusive!.getTime();
    const isIncluded = (timestamp: number) => timestamp >= start && timestamp < end;
    expect(isIncluded(start - 1)).toBe(false);
    expect(isIncluded(start)).toBe(true);
    expect(isIncluded(end - 1)).toBe(true);
    expect(isIncluded(end)).toBe(false);
  });

  it("rejects impossible dates, timestamp strings, and reversed ranges", () => {
    expect(parseBrazilDateRange("2026-02-30", undefined)).toEqual({ ok: false, reason: "invalid" });
    expect(parseBrazilDateRange("2026-08-31T00:00:00Z", undefined)).toEqual({ ok: false, reason: "invalid" });
    expect(parseBrazilDateRange("2026-09-01", "2026-08-31")).toEqual({ ok: false, reason: "reversed" });
  });
});

describe("Brazil calendar month buckets", () => {
  it("keeps the previous Brazil month until the UTC instant reaches São Paulo midnight", () => {
    const beforeBrazilMidnight = getBrazilMonthBuckets(2, new Date("2026-10-01T02:59:59.999Z"));
    expect(beforeBrazilMidnight.at(-1)).toMatchObject({
      key: "2026-09",
      year: 2026,
      month: 9,
      start: new Date("2026-09-01T03:00:00.000Z"),
      endExclusive: new Date("2026-10-01T03:00:00.000Z"),
    });

    const atBrazilMidnight = getBrazilMonthBuckets(1, new Date("2026-10-01T03:00:00.000Z"));
    expect(atBrazilMidnight[0]).toMatchObject({
      key: "2026-10",
      year: 2026,
      month: 10,
      start: new Date("2026-10-01T03:00:00.000Z"),
      endExclusive: new Date("2026-11-01T03:00:00.000Z"),
    });
  });
});