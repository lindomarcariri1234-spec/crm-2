import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEvent, trackReferralCreditReduction } from "../lib/analytics.js";

afterEach(() => {
  delete window.umami;
});

describe("analytics tracking", () => {
  it("does nothing when the published tracker is unavailable", () => {
    delete window.umami;

    expect(() => trackEvent("checkout_started")).not.toThrow();
    expect(() => trackReferralCreditReduction("cart_checkout", 100, 40)).not.toThrow();
  });

  it("does not let tracker errors affect the checkout", () => {
    window.umami = {
      track: () => {
        throw new Error("tracker unavailable");
      },
    };

    expect(() => trackEvent("checkout_started")).not.toThrow();
    expect(() => trackReferralCreditReduction("reservation_wizard", 100, 40)).not.toThrow();
  });

  it("records only confirmed cashback reductions with rounded BRL values", () => {
    const trackSpy = vi.fn();
    window.umami = { track: trackSpy };

    expect(trackReferralCreditReduction("reservation_wizard", 100.006, 40.004)).toBe(true);
    expect(trackSpy).toHaveBeenCalledOnce();
    expect(trackSpy).toHaveBeenCalledWith("referral_credit_reduced", {
      source: "reservation_wizard",
      requested_amount: 100.01,
      applied_amount: 40,
      currency: "BRL",
    });

    expect(trackReferralCreditReduction("reservation_wizard", 40, 40)).toBe(false);
    expect(trackReferralCreditReduction("reservation_wizard", 40, 41)).toBe(false);
    expect(trackSpy).toHaveBeenCalledOnce();
  });
});