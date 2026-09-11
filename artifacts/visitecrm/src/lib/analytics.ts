type AnalyticsData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void;
    };
  }
}

export function trackEvent(name: string, data?: AnalyticsData): void {
  if (typeof window === "undefined") return;

  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics must never interfere with the customer flow.
  }
}

type ReferralCreditSource = "cart_checkout" | "reservation_wizard";

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

export function trackReferralCreditReduction(
  source: ReferralCreditSource,
  requested: number,
  applied: number,
): boolean {
  if (
    !Number.isFinite(requested) ||
    !Number.isFinite(applied) ||
    requested - applied <= 0.005
  ) {
    return false;
  }

  trackEvent("referral_credit_reduced", {
    source,
    requested_amount: roundCurrency(requested),
    applied_amount: roundCurrency(applied),
    currency: "BRL",
  });
  return true;
}