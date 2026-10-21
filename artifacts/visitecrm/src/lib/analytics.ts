import {
  publicStoreApi,
  type StorefrontMetricEvent,
  type StorefrontPageType,
} from "@/lib/storeApi";

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

function recordStorefrontMetric(slug: string, event: StorefrontMetricEvent): void {
  if (!slug) return;
  try {
    void publicStoreApi.trackAnalyticsEvent(slug, event).catch(() => {
      // First-party metrics are best-effort and never block the storefront.
    });
  } catch {
    // A synchronous client failure must not interrupt navigation or checkout.
  }
}

export function trackStorefrontPageView(slug: string, pageType: StorefrontPageType): void {
  recordStorefrontMetric(slug, {
    event: "page_view",
    pageType,
    group: getStoreGroupAttribution(slug) ?? "unknown",
  });
}

export function trackStorefrontSearch(
  slug: string,
  source: "header_search" | "catalog_search",
): void {
  recordStorefrontMetric(slug, {
    event: "search_submitted",
    group: getStoreGroupAttribution(slug) ?? "unknown",
    source,
  });
}

export function trackStoreGroupSelection(
  group: "all" | "travel" | "other",
  source: "catalog_tab" | "home_link",
  slug: string,
): void {
  setStoreGroupAttribution(slug, group === "all" ? null : group);
  trackEvent("store_group_selected", { group, source });
  recordStorefrontMetric(slug, { event: "group_selected", group, source });
}

export function trackStoreProductOpened(
  group: StoreGroupAttribution | "unknown",
  slug: string,
): void {
  const attributedGroup =
    group === "unknown" ? getStoreGroupAttribution(slug) ?? "unknown" : group;
  if (attributedGroup !== "unknown") {
    setStoreGroupAttribution(slug, attributedGroup);
  }
  trackEvent("store_product_opened", { group: attributedGroup });
  recordStorefrontMetric(slug, { event: "product_opened", group: attributedGroup });
}

export function trackStoreCheckoutStarted(slug: string): void {
  const group = getStoreGroupAttribution(slug) ?? "unknown";
  trackEvent("store_checkout_started", {
    group,
  });
  recordStorefrontMetric(slug, { event: "checkout_started", group });
}

function getStoreGroupAttribution(slug: string): StoreGroupAttribution | null {
  if (typeof window === "undefined") return null;
  try {
    const group = window.sessionStorage.getItem(`${STORE_GROUP_ATTRIBUTION_KEY}:${slug}`);
    return group === "travel" || group === "other" ? group : null;
  } catch {
    return null;
  }
}

function setStoreGroupAttribution(slug: string, group: StoreGroupAttribution | null): void {
  if (typeof window === "undefined") return;
  try {
    const key = `${STORE_GROUP_ATTRIBUTION_KEY}:${slug}`;
    if (group) {
      window.sessionStorage.setItem(key, group);
    } else {
      window.sessionStorage.removeItem(key);
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