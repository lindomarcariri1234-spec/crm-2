import { describe, expect, it } from "vitest";
import { isWithinTicketReopenWindow } from "../services/support-ticketing.js";

describe("support ticket reopen grace period", () => {
  const resolvedAt = new Date("2026-10-05T12:00:00.000Z");

  it("allows reopening at the two-hour boundary", () => {
    expect(isWithinTicketReopenWindow(
      resolvedAt,
      new Date("2026-10-05T14:00:00.000Z"),
    )).toBe(true);
  });

  it("rejects messages received after the two-hour grace period", () => {
    expect(isWithinTicketReopenWindow(
      resolvedAt,
      new Date("2026-10-05T14:00:00.001Z"),
    )).toBe(false);
  });

  it("rejects messages dated before resolution and unresolved tickets", () => {
    expect(isWithinTicketReopenWindow(
      resolvedAt,
      new Date("2026-10-05T11:59:59.999Z"),
    )).toBe(false);
    expect(isWithinTicketReopenWindow(null, new Date("2026-10-05T14:00:00.000Z"))).toBe(false);
  });
});
