import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../routes/reservations.ts", import.meta.url), "utf8");

describe("reservation referral conversion route wiring", () => {
  it("converts a paid creation only after the creation transaction commits", () => {
    const start = source.indexOf('router.post("/reservations"');
    const end = source.indexOf('router.get("/reservations/:id"', start);
    const route = source.slice(start, end);
    const commit = route.indexOf('if ("error" in txResult)');
    const convert = route.indexOf("await convertPaidReservationReferral(reservation.id, me.tenantId)");
    expect(commit).toBeGreaterThan(0);
    expect(convert).toBeGreaterThan(commit);
    expect(route).toContain("Number(reservation.paidValue ?? 0) > 0");
    expect(route).toContain("RESERVATION_STATUS.CANCELLED");
  });

  it("converts after the PATCH transaction and relies on idempotent service replay", () => {
    const start = source.indexOf('router.patch("/reservations/:id"');
    const end = source.indexOf('router.get("/reservations/:id/installments"', start);
    const route = source.slice(start, end);
    const transactionEnd = route.indexOf("if (!reservation)");
    const convert = route.indexOf("await convertPaidReservationReferral(reservation.id, me.tenantId)");
    expect(convert).toBeGreaterThan(transactionEnd);
    expect(route).toContain("Number(reservation.paidValue ?? 0) > 0");
    expect(route).toContain("RESERVATION_STATUS.CANCELLED");
  });
});