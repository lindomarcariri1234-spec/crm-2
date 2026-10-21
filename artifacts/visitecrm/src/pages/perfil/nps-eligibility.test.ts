import { describe, expect, it } from "vitest";
import { RESERVATION_STATUS } from "@workspace/permissions";
import { isNpsReservationStatusEligible } from "./nps-eligibility";

describe("travel NPS reservation eligibility", () => {
  it("allows only confirmed or completed reservations", () => {
    expect(isNpsReservationStatusEligible(RESERVATION_STATUS.CONFIRMED)).toBe(true);
    expect(isNpsReservationStatusEligible(RESERVATION_STATUS.COMPLETED)).toBe(true);
    expect(isNpsReservationStatusEligible(RESERVATION_STATUS.PENDING)).toBe(false);
    expect(isNpsReservationStatusEligible(RESERVATION_STATUS.CANCELLED)).toBe(false);
    expect(isNpsReservationStatusEligible(RESERVATION_STATUS.REFUNDED)).toBe(false);
  });
});
