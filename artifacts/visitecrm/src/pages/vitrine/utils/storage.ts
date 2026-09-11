// Vitrine localStorage utilities
// Extracted from component files to avoid Fast Refresh "incompatible export" warnings

const REFERRAL_CODE_KEY = "referral_code";
const REFERRAL_CODE_EXPIRY_KEY = "referral_code_expiry";
const REFERRAL_REFERRER_NAME_KEY = "referral_referrer_name";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ORDER_LOOKUP_STORAGE_KEY = "pending_order_lookup";
const MAX_ORDER_LOOKUPS = 10;

export interface OrderLookupStorage {
  orderNumber: string;
  token: string;
  storeSlug: string;
  paymentIntentId?: string;
  referralCreditRequested?: number;
  referralCreditApplied?: number;
  referralCreditBalanceAfter?: number | null;
}

type StoredOrderLookupCollection = {
  version: 1;
  entries: OrderLookupStorage[];
};

function isOrderLookup(value: unknown): value is OrderLookupStorage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<OrderLookupStorage>;
  return (
    typeof candidate.orderNumber === "string" &&
    candidate.orderNumber.length > 0 &&
    typeof candidate.token === "string" &&
    candidate.token.length > 0 &&
    typeof candidate.storeSlug === "string" &&
    candidate.storeSlug.length > 0
  );
}

function getStoredOrderLookups(): OrderLookupStorage[] {
  const raw = getStoredValue(ORDER_LOOKUP_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isOrderLookup(parsed)) return [parsed];
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as Partial<StoredOrderLookupCollection>).version === 1 &&
      Array.isArray((parsed as Partial<StoredOrderLookupCollection>).entries)
    ) {
      return (parsed as StoredOrderLookupCollection).entries.filter(isOrderLookup);
    }
  } catch {
    // Ignore malformed lookup data and let the checkout recover normally.
  }
  return [];
}

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

export function saveOrderLookupToStorage(
  orderNumber: string,
  token: string,
  storeSlug: string,
  referralCredit?: {
    paymentIntentId?: string;
    requested?: number;
    applied?: number;
    balanceAfter?: number | null;
  },
) {
  try {
    const entry: OrderLookupStorage = {
      orderNumber,
      token,
      storeSlug,
      ...(referralCredit?.paymentIntentId
        ? { paymentIntentId: referralCredit.paymentIntentId }
        : {}),
      ...(referralCredit?.requested != null
        ? { referralCreditRequested: referralCredit.requested }
        : {}),
      ...(referralCredit?.applied != null
        ? { referralCreditApplied: referralCredit.applied }
        : {}),
      ...(referralCredit?.balanceAfter !== undefined
        ? { referralCreditBalanceAfter: referralCredit.balanceAfter }
        : {}),
    };
    const existing = getStoredOrderLookups();
    const matchIndex = existing.findIndex(
      (lookup) =>
        (entry.paymentIntentId != null && lookup.paymentIntentId === entry.paymentIntentId) ||
        (lookup.orderNumber === orderNumber && lookup.token === token),
    );
    if (matchIndex >= 0) {
      existing[matchIndex] = entry;
    } else {
      existing.unshift(entry);
    }
    const stored: StoredOrderLookupCollection = {
      version: 1,
      entries: existing.slice(0, MAX_ORDER_LOOKUPS),
    };
    localStorage.setItem(ORDER_LOOKUP_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Silently ignore localStorage errors
  }
}

export function getOrderLookupFromStorage(paymentIntentId?: string): OrderLookupStorage | null {
  const lookups = getStoredOrderLookups();
  if (lookups.length === 0) return null;

  if (paymentIntentId) {
    const exactMatch = lookups.find((lookup) => lookup.paymentIntentId === paymentIntentId);
    if (exactMatch) return exactMatch;
    const unboundLookups = lookups.filter((lookup) => !lookup.paymentIntentId);
    return unboundLookups.length === 1 ? unboundLookups[0] : null;
  }

  return lookups[0] ?? null;
}
