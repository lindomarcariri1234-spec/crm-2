import { describe, expect, it } from "vitest";
import { RESERVATION_STATUS } from "@workspace/permissions";
import { canRedeemForStatus, canSubmitNps, maskReferralName, validBirthDate } from "../lib/client-portal-rules";

describe("client portal eligibility and privacy", () => {
  it("rejects non-calendar dates, wrong formats, future dates and implausible ages", () => {
    for (const date of ["1990-02-30", "2023-02-29", "1990-2-01", "1900-01-01", "9999-01-01", "1990-13-01"]) {
      expect(validBirthDate(date)).toBe(false);
    }
    expect(validBirthDate("2000-02-29")).toBe(true);
  });

  it("permits redemption only for pending or confirmed reservations", () => {
    for (const status of Object.values(RESERVATION_STATUS)) {
      expect(canRedeemForStatus(status)).toBe(
        status === RESERVATION_STATUS.PENDING || status === RESERVATION_STATUS.CONFIRMED,
      );
    }
  });

  it("checks return calendar dates in Brazil inclusive of the 30-day boundary", () => {
    const today = "2025-05-31";
    const returnAt = (date: string) => new Date(`${date}T12:00:00-03:00`);
    expect(canSubmitNps("confirmed", returnAt("2025-05-01"), today)).toBe(true);
    expect(canSubmitNps("completed", returnAt("2025-05-31"), today)).toBe(true);
    expect(canSubmitNps("confirmed", returnAt("2025-04-30"), today)).toBe(false);
    expect(canSubmitNps("confirmed", returnAt("2025-06-01"), today)).toBe(false);
    expect(canSubmitNps("cancelled", returnAt("2025-05-25"), today)).toBe(false);
    expect(canSubmitNps("refunded", returnAt("2025-05-25"), today)).toBe(false);
    expect(canSubmitNps("pending", returnAt("2025-05-25"), today)).toBe(false);
    expect(canSubmitNps("confirmed", null, today)).toBe(false);
  });

  it("never reveals the full referred name", () => {
    expect(maskReferralName("Ana Maria Souza")).toBe("A*** M. S.");
    expect(maskReferralName(null)).toBeNull();
  });
});