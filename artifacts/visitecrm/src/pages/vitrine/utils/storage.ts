// Vitrine localStorage utilities
// Extracted from component files to avoid Fast Refresh "incompatible export" warnings

const REFERRAL_CODE_KEY = "referral_code";
const REFERRAL_CODE_EXPIRY_KEY = "referral_code_expiry";
const REFERRAL_REFERRER_NAME_KEY = "referral_referrer_name";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ORDER_LOOKUP_STORAGE_KEY = "pending_order_lookup";

export function getStoredValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function setStoredValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Browser storage is optional for all public storefront features.
  }
}

export function removeStoredValue(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Browser storage is optional for all public storefront features.
  }
}

export function saveReferralToStorage(code: string, referrerName?: string) {
  try {
    const expiry = Date.now() + THIRTY_DAYS_MS;
    localStorage.setItem(REFERRAL_CODE_KEY, code);
    localStorage.setItem(REFERRAL_CODE_EXPIRY_KEY, String(expiry));
    if (referrerName) localStorage.setItem(REFERRAL_REFERRER_NAME_KEY, referrerName);
  } catch {
    // Referral storage enhances the welcome message; a storage policy must
    // never stop a visitor from reaching the storefront.
  }
}

export function getReferralFromStorage(): { code: string; referrerName?: string } | null {
  const code = getStoredValue(REFERRAL_CODE_KEY);
  const expiry = getStoredValue(REFERRAL_CODE_EXPIRY_KEY);
  if (!code) return null;
  if (expiry && Date.now() > parseInt(expiry)) {
    removeStoredValue(REFERRAL_CODE_KEY);
    removeStoredValue(REFERRAL_CODE_EXPIRY_KEY);
    removeStoredValue(REFERRAL_REFERRER_NAME_KEY);
    return null;
  }
  const referrerName = getStoredValue(REFERRAL_REFERRER_NAME_KEY) ?? undefined;
  return { code, referrerName };
}

export function saveOrderLookupToStorage(orderNumber: string, token: string, storeSlug: string) {
  try {
    localStorage.setItem(ORDER_LOOKUP_STORAGE_KEY, JSON.stringify({ orderNumber, token, storeSlug }));
  } catch {
    // Silently ignore localStorage errors
  }
}

export function getOrderLookupFromStorage(): { orderNumber: string; token: string; storeSlug: string } | null {
  try {
    const raw = localStorage.getItem(ORDER_LOOKUP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.orderNumber && parsed.token && parsed.storeSlug) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
