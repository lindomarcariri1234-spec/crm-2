import type { LinkedData } from "@/lib/linked-data";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface VariantOption {
  label: string;
  price: number;
}

export interface VariantItem {
  name: string;
  options: VariantOption[];
}

async function authHeaders(): Promise<HeadersInit> {
  return { "Content-Type": "application/json" };
}

async function req<T = void>(
  method: string,
  path: string,
  body?: unknown,
  options?: Pick<RequestInit, "cache">,
): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    credentials: "include",
    body: body != null ? JSON.stringify(body) : undefined,
    cache: "no-store",
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Request failed");
  }
  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return undefined as unknown as T;
  }
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  return JSON.parse(text) as T;
}

export const storeApi = {
  getSettings: () => req<StoreSettings>("GET", "/store/settings", undefined, { cache: "no-store" }),
  updateSettings: (data: Partial<StoreSettings>) =>
    req<StoreSettings>("PUT", "/store/settings", data),
  initStore: (data: InitStoreInput) =>
    req<StoreSettings>("POST", "/store/init", data),

  getCategories: () => req<StoreCategory[]>("GET", "/store/categories"),
  createCategory: (data: CategoryInput) =>
    req<StoreCategory>("POST", "/store/categories", data),
  updateCategory: (id: string, data: Partial<CategoryInput>) =>
    req<StoreCategory>("PUT", `/store/categories/${id}`, data),
  deleteCategory: (id: string) =>
    req<void>("DELETE", `/store/categories/${id}`),

  getProducts: () => req<StoreProduct[]>("GET", "/store/products"),
  createProduct: (data: ProductInput) =>
    req<StoreProduct>("POST", "/store/products", data),
  updateProduct: (id: string, data: Partial<ProductInput>) =>
    req<StoreProduct>("PUT", `/store/products/${id}`, data),
  deleteProduct: (id: string) =>
    req<void>("DELETE", `/store/products/${id}`),

  getOrders: (params?: {
    status?: string;
    paymentStatus?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) => {
    const qs = params ? "?" + new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== "" && v !== "all")
        .map(([k, v]) => [k, String(v)])
    ).toString() : "";
    return req<{ data: StoreOrder[]; total: number; page: number; limit: number }>("GET", `/store/orders${qs}`);
  },
  getOrder: (id: string) => req<StoreOrder>("GET", `/store/orders/${id}`),
  updateOrderStatus: (
    id: string,
    status: string,
    paymentStatus?: string,
    fulfillmentStatus?: string,
    internalNotes?: string,
  ) =>
    req<StoreOrder>("PUT", `/store/orders/${id}/status`, {
      status,
      paymentStatus,
      fulfillmentStatus,
      internalNotes,
    }),

  getCoupons: () => req<StoreCoupon[]>("GET", "/store/coupons"),
  createCoupon: (data: CouponInput) =>
    req<StoreCoupon>("POST", "/store/coupons", data),
  updateCoupon: (id: string, data: Partial<CouponInput>) =>
    req<StoreCoupon>("PUT", `/store/coupons/${id}`, data),
  deleteCoupon: (id: string) =>
    req<{ success: boolean }>("DELETE", `/store/coupons/${id}`),

  getReviews: () => req<StoreReview[]>("GET", "/store/reviews"),
  updateReviewStatus: (
    id: string,
    status: "pending" | "approved" | "rejected",
    reply?: string
  ) =>
    req<StoreReview>("PUT", `/store/reviews/${id}/status`, { status, reply }),

  sendManifest: (tripId: string, data: { channel: "email" | "whatsapp"; to: string }) =>
    req<{ success: boolean; channel: string; whatsappUrl?: string }>("POST", `/trips/${tripId}/manifest/send`, data),
};

export class PublicApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "PublicApiError";
    this.code = code;
  }
}

async function publicReq<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: Pick<RequestInit, "cache">,
): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
    cache: "no-store",
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new PublicApiError(err.error ?? "Request failed", err.code);
  }
  return res.json();
}

export const publicStoreApi = {
  getStore: async (slug: string): Promise<PublicStore> => {
    const raw = await publicReq<Record<string, unknown>>("GET", `/public/store/${slug}`, undefined, { cache: "no-store" });
    return {
      ...raw,
      logoUrl: (raw.logoUrl ?? raw.logo) as string | null,
      faviconUrl: (raw.faviconUrl ?? raw.favicon) as string | null,
      bannerUrl: (raw.bannerUrl ?? raw.bannerHome) as string | null,
      bannerMobileUrl: (raw.bannerMobileUrl ?? raw.bannerMobile) as string | null,
      contactEmail: (raw.contactEmail ?? raw.email) as string | null,
      contactPhone: (raw.contactPhone ?? raw.phone) as string | null,
      contactWhatsapp: (raw.contactWhatsapp ?? raw.whatsapp) as string | null,
      contactAddress: (raw.contactAddress ?? raw.address) as string | null,
      socialInstagram: (raw.socialInstagram ?? raw.instagramUrl) as string | null,
      socialFacebook: (raw.socialFacebook ?? raw.facebookUrl) as string | null,
      socialYoutube: (raw.socialYoutube ?? raw.youtubeUrl) as string | null,
      seoTitle: (raw.seoTitle ?? raw.metaTitle) as string | null,
      seoDescription: (raw.seoDescription ?? raw.metaDescription) as string | null,
      seoKeywords: (raw.seoKeywords ?? raw.metaKeywords) as string | null,
      paymentMethods: Array.isArray(raw.paymentMethods) ? raw.paymentMethods as string[] : [],
    } as PublicStore;
  },
  getCategories: (slug: string) =>
    publicReq<StoreCategory[]>("GET", `/public/store/${slug}/categories`),
  getProducts: (
    slug: string,
    params?: Record<string, string | number | boolean>
  ) => {
    const qs = params
      ? "?" + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
      : "";
    return publicReq<{
      data: StoreProduct[];
      total: number;
      page: number;
      limit: number;
    }>("GET", `/public/store/${slug}/products${qs}`);
  },
  getProduct: (slug: string, productSlug: string) =>
    publicReq<StoreProduct & { reviews: StoreReview[] }>(
      "GET",
      `/public/store/${slug}/products/${productSlug}`
    ),
  getPartnerInfo: (slug: string, productSlug: string) =>
    publicReq<PartnerProductInfo>(
      "GET",
      `/public/store/${slug}/products/${productSlug}/partner-info`
    ),
  getRecommendations: (slug: string, productSlug: string, limit = 4) =>
    publicReq<{ data: StoreProduct[] }>(
      "GET",
      `/public/store/${slug}/products/${productSlug}/recommendations?limit=${limit}`
    ),
  subscribePriceAlert: (slug: string, productId: string, email: string) =>
    publicReq<{ success: boolean; message: string }>(
      "POST",
      `/public/store/${slug}/price-alerts`,
      { productId, email }
    ),
  getReviews: (slug: string, params?: { limit?: number; featured?: boolean }) => {
    const qs = params ? "?" + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString() : "";
    return publicReq<StoreReview[]>("GET", `/public/store/${slug}/reviews${qs}`);
  },
  createOrder: (slug: string, data: CreateOrderInput) =>
    publicReq<StoreCheckoutOrder>("POST", `/public/store/${slug}/orders`, data),
  getOrder: (slug: string, orderNumber: string, paymentToken: string) =>
    publicReq<StoreCheckoutOrder>(
      "GET",
      `/public/store/${slug}/orders/${encodeURIComponent(orderNumber)}?token=${encodeURIComponent(paymentToken)}`
    ),
  validateCoupon: (
    slug: string,
    code: string,
    orderTotal: number
  ) =>
    publicReq<CouponValidation>(
      "POST",
      `/public/store/${slug}/coupons/validate`,
      { code, orderTotal }
    ),
  submitReview: (
    slug: string,
    data: {
      productId: string;
      customerName: string;
      customerEmail?: string;
      rating: number;
      comment?: string;
    }
  ) =>
    publicReq<{ success: boolean; message: string }>(
      "POST",
      `/public/store/${slug}/reviews`,
      data
    ),
  getTripSeatMap: (slug: string, tripId: string) =>
    publicReq<{
      tripId: string;
      layout: string;
      floors: number;
      totalSeats: number;
      cols: number;
      seats: Array<{
        number: string;
        row: number;
        col: number;
        floor: number;
        type: string;
        status: string;
      }>;
    }>("GET", `/public/store/${slug}/trips/${tripId}/seat-map`),
  createPaymentIntent: (slug: string, orderNumber: string, paymentToken: string) =>
    publicReq<{ clientSecret: string; publishableKey: string }>(
      "POST",
      `/public/store/${slug}/create-payment-intent`,
      { orderNumber, paymentToken }
    ),
  validateReferral: (slug: string, code: string) =>
    publicReq<ReferralValidation>("POST", `/public/store/${slug}/referral/validate`, { code }),
  getReferralInfo: (slug: string, code: string) =>
    publicReq<ReferralValidation>("GET", `/public/store/${slug}/referral/info?code=${encodeURIComponent(code)}`),
  trackReferral: (slug: string, data: {
    code: string;
    serverCookieId?: string;
    landingPage?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
  }) =>
    publicReq<{ cookieId: string; tracked: boolean }>("POST", `/public/store/${slug}/referral/track`, data),
};

export interface StoreSettings {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  tagline?: string | null;
  description?: string | null;

  logo?: string | null;
  logoDark?: string | null;
  favicon?: string | null;
  bannerHome?: string | null;
  bannerMobile?: string | null;

  primaryColor: string;
  secondaryColor: string;
  accentColor: string;

  customDomain?: string | null;
  domainVerified: boolean;
  sslEnabled: boolean;

  email: string;
  phone?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;

  facebookUrl?: string | null;
  instagramUrl?: string | null;
  twitterUrl?: string | null;
  youtubeUrl?: string | null;
  linkedinUrl?: string | null;
  tiktokUrl?: string | null;

  metaTitle?: string | null;
  metaDescription?: string | null;
  metaKeywords?: string | null;
  googleAnalyticsId?: string | null;
  facebookPixelId?: string | null;
  googleTagManagerId?: string | null;

  requireLogin: boolean;
  guestCheckout: boolean;

  paymentMethods: string[];
  stripeEnabled: boolean;
  stripePublicKey?: string | null;
  // Sensitive credentials are write-only: PUT accepts a non-empty string to
  // update; GET never returns the stored value. The *Configured flags let
  // the UI show whether a credential is currently set.
  stripeSecretKey?: string | null;
  stripeSecretKeyConfigured?: boolean;
  stripeWebhookSecret?: string | null;
  stripeWebhookSecretConfigured?: boolean;
  mpEnabled: boolean;
  mpPublicKey?: string | null;
  mpAccessToken?: string | null;
  mpAccessTokenConfigured?: boolean;
  pixEnabled: boolean;
  pixKey?: string | null;
  pixKeyConfigured?: boolean;
  pixKeyType?: string | null;
  boletoEnabled: boolean;

  termsOfService?: string | null;
  privacyPolicy?: string | null;
  refundPolicy?: string | null;
  cancellationPolicy?: string | null;
  termsUrl?: string | null;
  privacyUrl?: string | null;

  notificationEmail?: string | null;
  orderNotificationEnabled: boolean;

  minInstallments?: number;
  maxInstallments?: number;
  installmentFee?: string;
  minOrderValue?: string | null;
  minDepositAmount?: string | null;

  isActive: boolean;
  maintenanceMode: boolean;
  maintenanceMessage?: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface PublicStore {
  id: string;
  name: string;
  slug: string;
  tagline?: string | null;
  description?: string | null;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  bannerUrl?: string | null;
  bannerMobileUrl?: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactWhatsapp?: string | null;
  contactAddress?: string | null;
  socialInstagram?: string | null;
  socialFacebook?: string | null;
  socialYoutube?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoKeywords?: string | null;
  paymentMethods: string[];
  stripeEnabled: boolean;
  stripePublicKey?: string | null;
  shippingPolicy?: string | null;
  returnPolicy?: string | null;
  cancellationPolicy?: string | null;
  privacyPolicy?: string | null;
  termsOfService?: string | null;
  isActive: boolean;
  maintenanceMode: boolean;
  maintenanceMessage?: string | null;
  couponsEnabled?: boolean;
  referralsEnabled?: boolean;
  seatMapEnabled?: boolean;
  minInstallments?: number;
  maxInstallments?: number;
  installmentFee?: string;
  minOrderValue?: string | null;
  minDepositAmount?: string | null;
}

export interface StoreCategory {
  id: string;
  storeId: string;
  tenantId: string;
  name: string;
  slug: string;
  description?: string | null;
  imageUrl?: string | null;
  parentId?: string | null;
  position: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoreProduct {
  id: string;
  storeId?: string;
  categoryId?: string | null;
  tripId?: string | null;
  availableSeats?: number | null;
  totalCapacity?: number | null;
  departureDate?: string | null;
  returnDate?: string | null;
  inclusions?: string[] | null;
  tripType?: string | null;
  originCity?: string | null;
  originState?: string | null;
  destinationCity?: string | null;
  destinationState?: string | null;
  departureTime?: string | null;
  returnTime?: string | null;
  showSeatMap?: boolean | null;
  boardingPoints?: Array<{ id: string; name: string; time?: string | null; address?: string | null }> | null;
  tripVideos?: string[] | null;
  type: string;
  name: string;
  slug: string;
  shortDescription?: string | null;
  description?: string | null;
  price: string;
  comparePrice?: string | null;
  costPrice?: string | null;
  onSale: boolean;
  salePrice?: string | null;
  saleStartsAt?: string | null;
  saleEndsAt?: string | null;
  trackInventory: boolean;
  stockQuantity?: number | null;
  allowBackorder: boolean;
  hasDates: boolean;
  startDate?: string | null;
  endDate?: string | null;
  images: string[];
  thumbnail?: string | null;
  gallery: string[];
  features: string[];
  includes: string[];
  excludes: string[];
  requirements: string[];
  destination?: string | null;
  durationDays?: number | null;
  durationNights?: number | null;
  productCity?: string | null;
  productState?: string | null;
  country?: string | null;
  hasVariants: boolean;
  variants: VariantItem[];
  metaTitle?: string | null;
  metaDescription?: string | null;
  metaKeywords?: string | null;
  isFeatured: boolean;
  order: number;
  ratingAverage?: string | null;
  ratingCount: number;
  status: string;
  publishedAt?: string | null;
  viewsCount: number;
  salesCount: number;
  createdAt: string;
  updatedAt: string;
  partnerProductId?: string | null;
  sellerName?: string | null;
}

export interface PartnerProductInfo {
  hasPartner: boolean;
  id?: string;
  type?: string;
  title?: string;
  meetingPoint?: string | null;
  durationMinutes?: number | null;
  maxCapacity?: number | null;
  cancellationPolicy?: string | null;
  origin?: string | null;
  locationUrl?: string | null;
  seller?: { name: string; slug: string; description?: string | null; logo?: string | null } | null;
  faq?: Array<{ question: string; answer: string }>;
  availability?: Array<{ date: string; spotsTotal: number; spotsUsed: number }>;
}

export interface StoreOrderItem {
  id?: string;
  productId: string;
  productName: string;
  productType?: string;
  productImage?: string | null;
  quantity: number;
  unitPrice: number;
  variantLabel?: string | null;
  partnerId?: string | null;
  partnerProductId?: string | null;
  sellerName?: string | null;
  itemStatus?: string;
  voucherCode?: string | null;
  cancellationReason?: string | null;
  cancellationRequestedAt?: string | null;
  cancelledAt?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface StoreOrder extends LinkedData {
  id: string;
  storeId: string;
  tenantId: string;
  orderNumber: string;
  clientId?: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  customerCpf?: string | null;
  customerAddress?: Record<string, unknown> | null;
  subtotal: string;
  discountAmount: string;
  taxAmount?: string | null;
  shippingAmount?: string | null;
  totalAmount: string;
  couponId?: string | null;
  couponCode?: string | null;
  paymentMethod?: string | null;
  paymentProvider?: string | null;
  paymentStatus: string;
  installments?: number | null;
  installmentAmount?: string | null;
  depositAmount?: string | null;
  amountRemaining?: string | null;
  pixQrCode?: string | null;
  pixQrCodeUrl?: string | null;
  pixCopyPaste?: string | null;
  boletoUrl?: string | null;
  boletoBarcode?: string | null;
  status: string;
  fulfillmentStatus?: string | null;
  customerNotes?: string | null;
  internalNotes?: string | null;
  paidAt?: string | null;
  confirmedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  refundedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount?: number;
  items: StoreOrderItem[];
  reservationExpiresAt?: string | null;
  referralDiscountType?: string | null;
  referralDiscountPct?: number | null;
  referralDiscountAmount?: number | null;
  couponDiscountAmount?: number | null;
}

/** Public checkout response only; administrative order responses never include this token. */
export interface StoreCheckoutOrder extends StoreOrder {
  paymentToken?: string | null;
}

export interface StoreCoupon {
  id: string;
  storeId: string;
  code: string;
  type: string;
  value: string;
  description?: string | null;
  minPurchaseAmount?: string | null;
  maxDiscountAmount?: string | null;
  usageLimit?: number | null;
  usageLimitPerCustomer?: number | null;
  usageCount: number;
  startsAt: string;
  expiresAt: string;
  applicableProducts: string[];
  applicableCategories: string[];
  minimumItems?: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoreReview {
  id: string;
  storeId: string;
  tenantId: string;
  productId: string;
  customerName: string;
  customerEmail?: string | null;
  rating: number;
  comment?: string | null;
  status: string;
  reply?: string | null;
  replyAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InitStoreInput {
  name: string;
  slug: string;
  contactEmail?: string;
  contactWhatsapp?: string;
  paymentMethods?: string[];
}

export interface CategoryInput {
  name: string;
  slug?: string;
  description?: string;
  imageUrl?: string;
  parentId?: string;
  position?: number;
  isActive?: boolean;
}

export interface ProductInput {
  name: string;
  slug?: string;
  type?: string;
  categoryId?: string;
  tripId?: string;
  shortDescription?: string;
  description?: string;
  price?: string;
  comparePrice?: string;
  costPrice?: string;
  onSale?: boolean;
  salePrice?: string;
  trackInventory?: boolean;
  stockQuantity?: number;
  allowBackorder?: boolean;
  hasDates?: boolean;
  startDate?: string;
  endDate?: string;
  images?: string[];
  thumbnail?: string;
  gallery?: string[];
  features?: string[];
  includes?: string[];
  excludes?: string[];
  requirements?: string[];
  variants?: VariantItem[];
  destination?: string;
  durationDays?: number;
  durationNights?: number;
  productCity?: string;
  productState?: string;
  country?: string;
  hasVariants?: boolean;
  metaTitle?: string;
  metaDescription?: string;
  metaKeywords?: string;
  status?: string;
  isFeatured?: boolean;
  order?: number;
  originCity?: string;
  originState?: string;
  departureTime?: string;
  returnTime?: string;
}

export interface CouponInput {
  code: string;
  type: "percentage" | "fixed" | "free_shipping";
  value: string;
  description?: string;
  minPurchaseAmount?: string;
  maxDiscountAmount?: string;
  usageLimit?: number;
  usageLimitPerCustomer?: number;
  startsAt: string;
  expiresAt: string;
  applicableProducts?: string[];
  applicableCategories?: string[];
  minimumItems?: number;
  isActive?: boolean;
}

export interface CreateOrderInput {
  customerName: string;

  customerEmail: string;

  customerPhone?: string;

  customerCpf?: string;

  customerBirthdate?: string;

  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    variantLabel?: string;
    metadata?: Record<string, unknown>;
  }>;

  couponCode?: string;

  referralCode?: string;

  referralCookieId?: string;

  referralCreditUsed?: number;

  paymentMethod?: string;

  notes?: string;

  seats?: string[];

  boardingLocationId?: string;

  coPassengers?: Array<{ name: string; cpf?: string; phone?: string }>;
  depositAmount?: number;
  /**
   * Client-generated key, one per checkout attempt (see checkout.tsx). Lets a
   * browser retry / accidental double-submit of the same attempt reuse the
   * original order instead of creating a duplicate and double-reserving seats.
   */
  idempotencyKey?: string;
}

export interface ReferralValidation {
  valid: boolean;
  code?: string;
  referrerName?: string;
  discountPercent?: number;
  discountValue?: number;
  discountType?: string;
  description?: string;
  error?: string;
}

export interface CouponValidation {
  valid: boolean;
  code?: string;
  type?: string;
  value?: number;
  discountAmount?: number;
  error?: string;
}
