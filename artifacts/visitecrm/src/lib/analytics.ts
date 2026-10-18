type AnalyticsData = Record<string, string | number | boolean>;
type StoreGroupAttribution = "travel" | "other";
const STORE_GROUP_ATTRIBUTION_KEY = "storefront_analytics_group";

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

export function trackStoreGroupSelection(
  group: "all" | "travel" | "other",
  source: "catalog_tab" | "home_link",
): void {
  setStoreGroupAttribution(group === "all" ? null : group);
  trackEvent("store_group_selected", { group, source });
}

export function trackStoreProductOpened(
  group: StoreGroupAttribution | "unknown",
): void {
  const attributedGroup =
    group === "unknown" ? getStoreGroupAttribution() ?? "unknown" : group;
  if (attributedGroup !== "unknown") {
    setStoreGroupAttribution(attributedGroup);
  }
  trackEvent("store_product_opened", { group: attributedGroup });
}

export function trackStoreCheckoutStarted(): void {
  trackEvent("store_checkout_started", {
    group: getStoreGroupAttribution() ?? "unknown",
  });
}

function getStoreGroupAttribution(): StoreGroupAttribution | null {
  if (typeof window === "undefined") return null;
  try {
    const group = window.sessionStorage.getItem(STORE_GROUP_ATTRIBUTION_KEY);
    return group === "travel" || group === "other" ? group : null;
  } catch {
    return null;
  }
}

function setStoreGroupAttribution(group: StoreGroupAttribution | null): void {
  if (typeof window === "undefined") return;
  try {
    if (group) {
      window.sessionStorage.setItem(STORE_GROUP_ATTRIBUTION_KEY, group);
    } else {
      window.sessionStorage.removeItem(STORE_GROUP_ATTRIBUTION_KEY);
    }
  } catch {
    // Analytics attribution must never interfere with the customer flow.
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