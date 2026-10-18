import { describe, expect, it } from "vitest";
import {
  countSeatBearingCoPassengers,
  getStorefrontPassengerPolicyError,
  type StorefrontCoPassenger,
} from "./storefront-passenger-rules.js";

const child = (overrides: Partial<StorefrontCoPassenger> = {}): StorefrontCoPassenger => ({
  name: "Criança",
  isChildUnder7: false,
  occupiesSeat: true,
  ...overrides,
});

describe("storefront passenger seat rules", () => {
  it("allows a child under 7 to travel on a lap without consuming a seat", () => {
    const passenger = child({ isChildUnder7: true, occupiesSeat: false });

    expect(getStorefrontPassengerPolicyError([passenger])).toBeNull();
    expect(countSeatBearingCoPassengers([passenger])).toBe(0);
  });

  it("rejects a child aged 7 or older without a seat", () => {
    const passenger = child({ isChildUnder7: false, occupiesSeat: false });

    expect(getStorefrontPassengerPolicyError([passenger])).toMatchObject({
      code: "CHILD_OVER_7_REQUIRES_SEAT",
    });
  });

  it("requires both child-age and seat-choice flags for new child records", () => {
    expect(getStorefrontPassengerPolicyError([
      { name: "Criança", isChildUnder7: true },
    ])).toMatchObject({ code: "CHILD_SEAT_SELECTION_REQUIRED" });
  });

  it("keeps legacy companions as seated passengers", () => {
    const legacyPassenger = { name: "Acompanhante antigo" };

    expect(getStorefrontPassengerPolicyError([legacyPassenger])).toBeNull();
    expect(countSeatBearingCoPassengers([legacyPassenger])).toBe(1);
  });
});
