import { afterEach, describe, expect, it, vi } from "vitest";
import { publicStoreApi } from "../lib/storeApi.js";
import { trackStorefrontPageView, trackStorefrontSearch } from "../lib/analytics.js";

vi.mock("../lib/storeApi.js", () => ({
  publicStoreApi: {
    trackAnalyticsEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

import {
  trackEvent,
  trackReferralCreditReduction,
  trackStoreCheckoutStarted,
  trackStoreGroupSelection,
  trackStoreProductOpened,
} from "../lib/analytics.js";

afterEach(() => {
  delete window.umami;
  window.sessionStorage.clear();
  vi.mocked(publicStoreApi.trackAnalyticsEvent).mockClear();
});

describe("analytics tracking", () => {
  it("does nothing when the published tracker is unavailable", () => {
    delete window.umami;

    expect(() => trackEvent("checkout_started")).not.toThrow();
    expect(() => trackReferralCreditReduction("cart_checkout", 100, 40)).not.toThrow();
    expect(() => trackStoreGroupSelection("travel", "catalog_tab", "cariri")).not.toThrow();
    expect(() => trackStoreProductOpened("unknown", "cariri")).not.toThrow();
    expect(() => trackStoreCheckoutStarted("cariri")).not.toThrow();
  });

  it("does not let tracker errors affect the checkout", () => {
    window.umami = {
      track: () => {
        throw new Error("tracker unavailable");
      },
    };

    expect(() => trackEvent("checkout_started")).not.toThrow();
    expect(() => trackReferralCreditReduction("reservation_wizard", 100, 40)).not.toThrow();
    expect(() => trackStoreGroupSelection("other", "home_link", "cariri")).not.toThrow();
    expect(() => trackStoreProductOpened("travel", "cariri")).not.toThrow();
    expect(() => trackStoreCheckoutStarted("cariri")).not.toThrow();
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

  it("records only the selected store group and interaction source", () => {
    const trackSpy = vi.fn();
    window.umami = { track: trackSpy };

    trackStoreGroupSelection("travel", "catalog_tab", "cariri");
    trackStoreGroupSelection("other", "home_link", "cariri");

    expect(trackSpy).toHaveBeenNthCalledWith(1, "store_group_selected", {
      group: "travel",
      source: "catalog_tab",
    });
    expect(trackSpy).toHaveBeenNthCalledWith(2, "store_group_selected", {
      group: "other",
      source: "home_link",
    });
    expect(publicStoreApi.trackAnalyticsEvent).toHaveBeenNthCalledWith(1, "cariri", {
      event: "group_selected",
      group: "travel",
      source: "catalog_tab",
    });
  });

  it("carries only the group dimension from selection to product and checkout events", () => {
    const trackSpy = vi.fn();
    window.umami = { track: trackSpy };

    trackStoreGroupSelection("travel", "catalog_tab", "cariri");
    trackStoreProductOpened("unknown", "cariri");
    trackStoreCheckoutStarted("cariri");

    expect(trackSpy).toHaveBeenNthCalledWith(1, "store_group_selected", {
      group: "travel",
      source: "catalog_tab",
    });
    expect(trackSpy).toHaveBeenNthCalledWith(2, "store_product_opened", {
      group: "travel",
    });
    expect(trackSpy).toHaveBeenNthCalledWith(3, "store_checkout_started", {
      group: "travel",
    });
  });

  it("uses the product's explicit group and clears an unclassified all-items selection", () => {
    const trackSpy = vi.fn();
    window.umami = { track: trackSpy };

    trackStoreGroupSelection("other", "home_link", "cariri");
    trackStoreProductOpened("travel", "cariri");
    trackStoreCheckoutStarted("cariri");
    trackStoreGroupSelection("all", "catalog_tab", "cariri");
    trackStoreProductOpened("unknown", "cariri");

    expect(trackSpy).toHaveBeenNthCalledWith(2, "store_product_opened", {
      group: "travel",
    });
    expect(trackSpy).toHaveBeenNthCalledWith(3, "store_checkout_started", {
      group: "travel",
    });
    expect(trackSpy).toHaveBeenNthCalledWith(5, "store_product_opened", {
      group: "unknown",
    });
  });

  it("records page and search activity using only controlled dimensions", () => {
    trackStorefrontPageView("cariri", "product");
    trackStorefrontSearch("cariri", "header_search");

    expect(publicStoreApi.trackAnalyticsEvent).toHaveBeenNthCalledWith(1, "cariri", {
      event: "page_view",
      pageType: "product",
      group: "unknown",
    });
    expect(publicStoreApi.trackAnalyticsEvent).toHaveBeenNthCalledWith(2, "cariri", {
      event: "search_submitted",
      group: "unknown",
      source: "header_search",
    });
  });

  it("keeps group attribution separate between storefronts", () => {
    trackStoreGroupSelection("travel", "catalog_tab", "cariri");
    trackStoreProductOpened("unknown", "another-store");

    expect(publicStoreApi.trackAnalyticsEvent).toHaveBeenNthCalledWith(1, "cariri", {
      event: "group_selected",
      group: "travel",
      source: "catalog_tab",
    });
    expect(publicStoreApi.trackAnalyticsEvent).toHaveBeenNthCalledWith(2, "another-store", {
      event: "product_opened",
      group: "unknown",
    });
  });
});