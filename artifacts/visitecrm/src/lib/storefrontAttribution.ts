export interface StorefrontAttribution {
  referralCode?: string;
  landingPage: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

function storageKey(slug: string) {
  return `storefront_attribution_${slug}`;
}

function referralCodeKey(slug: string) {
  return `storefront_referral_code_${slug}`;
}

function referralCookieKey(slug: string) {
  return `storefront_referral_cookie_${slug}`;
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private-mode storage failures must not block discovery or checkout.
  }
}

function safeRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage is an enhancement, never a storefront requirement.
  }
}

function safeRead(slug: string): Partial<StorefrontAttribution> {
  try {
    const raw = safeGet(storageKey(slug));
    return raw ? JSON.parse(raw) as Partial<StorefrontAttribution> : {};
  } catch {
    return {};
  }
}

export function getStorefrontReferralCode(slug: string): string | undefined {
  return safeGet(referralCodeKey(slug)) ?? undefined;
}

export function setStorefrontReferralCode(slug: string, code: string): void {
  safeSet(referralCodeKey(slug), code.trim().toUpperCase());
}

export function clearStorefrontReferralCode(slug: string): void {
  safeRemove(referralCodeKey(slug));
  safeRemove(referralCookieKey(slug));
  const attribution = safeRead(slug);
  if (Object.keys(attribution).length > 0) {
    delete attribution.referralCode;
    safeSet(storageKey(slug), JSON.stringify(attribution));
  }
}

export function getStorefrontReferralCookie(slug: string): string | undefined {
  return safeGet(referralCookieKey(slug)) ?? undefined;
}

export function setStorefrontReferralCookie(slug: string, cookieId: string): void {
  safeSet(referralCookieKey(slug), cookieId);
}

/**
 * Keeps the first campaign touch for a storefront visit. Referral attribution
 * is only sent to the existing referral endpoint when a real referral code is
 * present, so anonymous browsing never becomes a CRM contact by accident.
 */
export function captureStorefrontAttribution(slug: string): StorefrontAttribution {
  const params = new URLSearchParams(window.location.search);
  const stored = safeRead(slug);
  // Query codes are intentionally not trusted here. VitrineLayout validates
  // them with the server before calling setStorefrontReferralCode.
  const referralCode = stored.referralCode || getStorefrontReferralCode(slug);

  const attribution: StorefrontAttribution = {
    referralCode,
    // Never persist query parameters: checkout and payment redirects may carry
    // tokens or customer identifiers. The funnel only needs the route.
    landingPage: stored.landingPage || window.location.pathname,
    utmSource: stored.utmSource || params.get("utm_source") || undefined,
    utmMedium: stored.utmMedium || params.get("utm_medium") || undefined,
    utmCampaign: stored.utmCampaign || params.get("utm_campaign") || undefined,
  };

  safeSet(storageKey(slug), JSON.stringify(attribution));
  return attribution;
}