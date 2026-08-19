const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface ClientPortalReservation {
  id: string;
  reservationNumber: string | null;
  status: string;
  voucherCode: string;
  totalValue: number;
  paidValue: number;
  balance: number;
  seatsCount: number;
  paymentMethod: string | null;
  storeOrderId: string | null;
  createdAt: string;
  tripName: string;
  tripDestination: string;
  tripDepartureDate: string | null;
  tripReturnDate: string | null;
  tripType: string;
  boardingPointName: string | null;
  boardingPointTime: string | null;
  npsSubmitted: boolean;
}

export interface ClientLoyaltyTransaction {
  id: string;
  type: string;
  points: number;
  description: string;
  referenceId?: string | null;
  referenceType?: string | null;
  runningBalance?: number;
  createdAt: string;
}

export interface TierBenefits {
  bronze?: string[];
  silver?: string[];
  gold?: string[];
  diamond?: string[];
}

export interface ClientLoyalty {
  availablePoints: number;
  totalPoints: number;
  tier: string;
  programName: string;
  pointsPerReal: number;
  realPerPoint: number;
  minRedeemPoints: number;
  tierBenefits: TierBenefits | null;
  recentTransactions: ClientLoyaltyTransaction[];
}

export interface ClientReferral {
  id: string;
  referredName: string | null;
  referredEmail: string | null;
  status: string;
  convertedAt: string | null;
  bonusAmount: string;
  bonusPaid: boolean;
  bonusPaidAt: string | null;
  bonusCreditUsedAt: string | null;
  bonusCreditOrderId: string | null;
  bonusCreditUsedAmount: string | null;
  createdAt: string;
  expiresAt: string | null;
  bonusReleasesAt: string | null;
  bonusBlocked: boolean;
  reversalReason: string | null;
  loyaltyPoints: number | null;
}

export interface ClientPortalProfile {
  user: {
    id: string;
    name: string;
    email: string;
    cpf: string | null;
    referralCode: string;
    createdAt: string | null;
  } | null;
  client: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    cpf: string | null;
    birthDate: string | null;
    addressCity: string | null;
    addressState: string | null;
    referralCode: string | null;
    musicalPreferences: string | null;
    favoriteDrink: string | null;
    dreamDestinations: string[];
    foodPreferences: string | null;
    travelPreference: string | null;
    travelInterests: string[];
    likesPhotosVideos: boolean | null;
    preferredDestinationTypes: string[];
    ambassadorOptIn: boolean;
    customerCode: string | null;
  } | null;
  tenant: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    primaryColor: string;
    npsCategories: {
      transport?: boolean;
      service?: boolean;
      organization?: boolean;
      guide?: boolean;
    } | null;
  } | null;
  reservations: ClientPortalReservation[];
  referral: {
    code: string | null;
    referralCodeStatus: string;
    totalReferrals: number;
    completedReferrals: number;
    pendingReferrals: number;
    totalEarnings: string;
    creditBalance: string;
    shareMessage: string | null;
    currentTierLevel: string;
    currentTierLabel: string;
    currentTierMultiplier: number;
    tierProgress: number;
    nextTierMin: number | null;
    nextTierLabel: string | null;
    pointsPerReferral: number;
  };
  stats: {
    totalSpent: number;
  };
  loyalty: ClientLoyalty | null;
}

async function apiReq<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.message ?? err.error ?? "Request failed");
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

export type ClientNotificationType =
  | "referral_converted"
  | "referral_bonus_released"
  | "referral_bonus_paid"
  | "referral_link_clicked";

export interface ClientNotification {
  id: string;
  type: ClientNotificationType;
  payload: {
    referredName?: string;
    referralCode?: string;
    bonusAmount?: number;
    agencyName?: string;
  };
  readAt: string | null;
  createdAt: string;
}

export interface ClientNotificationsResponse {
  data: ClientNotification[];
  unreadCount: number;
}

export interface FavoriteTripItem {
  favoriteId: string;
  tripId: string;
  productSlug: string;
  name: string;
  imageUrl: string | null;
  destination: string | null;
  price: string;
  salePrice: string | null;
}

export interface FavoriteProductItem {
  favoriteId: string;
  productId: string;
  productSlug: string;
  name: string;
  imageUrl: string | null;
  price: string;
  salePrice: string | null;
}

export interface FavoritesResponse {
  trips: FavoriteTripItem[];
  products: FavoriteProductItem[];
}

export interface LoyaltyTransactionsResponse {
  data: ClientLoyaltyTransaction[];
  hasMore: boolean;
  total: number;
}

export interface RedeemLoyaltyResponse {
  pointsRedeemed: number;
  discountAmount: number;
  newAvailablePoints: number;
}

export interface ClientBadge {
  key: string;
  name: string;
  description: string;
  earned: boolean;
  earnedAt: string | null;
  progress?: number;
  target?: number;
}

export interface ClientAchievementsResponse {
  badges: ClientBadge[];
  stats: {
    totalTrips: number;
    visitedStates: string[];
    uniqueDestinations: string[];
  };
}

export interface TripMediaItem {
  id: string;
  url: string;
  type: string;
  caption: string | null;
  createdAt: string;
}

export interface ClientMemory {
  reservationId: string;
  tripId: string;
  tripName: string;
  tripDestination: string;
  tripDestinationCity: string;
  tripDestinationState: string;
  tripCoverImage: string | null;
  tripDepartureDate: string;
  tripReturnDate: string | null;
  npsSubmitted: boolean;
  media: TripMediaItem[];
}

export interface ClientMemoriesResponse {
  memories: ClientMemory[];
}

export interface DreamDestinationItem {
  id: string;
  destinationName: string;
  note: string | null;
  createdAt: string;
}

export interface DreamDestinationsResponse {
  data: DreamDestinationItem[];
}

export const clientPortalApi = {
  getProfile: () => apiReq<ClientPortalProfile>("GET", "/client/me"),
  updateProfile: (data: {
    name?: string;
    phone?: string | null;
    cpf?: string | null;
    birthDate?: string | null;
  }) => apiReq<ClientPortalProfile["client"]>("PATCH", "/client/me", data),
  getMyReferrals: () => apiReq<{ data: ClientReferral[] }>("GET", "/client/me/referrals"),
  deleteMyAccount: () => apiReq<void>("DELETE", "/users/me"),
  getNotifications: () => apiReq<ClientNotificationsResponse>("GET", "/client/notifications"),
  markAllNotificationsRead: () => apiReq<void>("POST", "/client/notifications/read-all"),
  getNotificationStreamUrl: () => `${BASE}/api/client/notifications/stream`,
  updatePreferences: (data: {
    musicalPreferences?: string | null;
    favoriteDrink?: string | null;
    dreamDestinations?: string[];
    foodPreferences?: string | null;
    birthDate?: string | null;
    travelInterests?: string[];
    likesPhotosVideos?: boolean | null;
    preferredDestinationTypes?: string[];
    travelPreference?: string | null;
  }) => apiReq<void>("PATCH", "/client/me/preferences", data),
  submitNps: (data: {
    reservationId: string;
    score: number;
    comment?: string | null;
    scoreTransport?: number | null;
    scoreService?: number | null;
    scoreOrganization?: number | null;
    scoreGuide?: number | null;
  }) => apiReq<{ id: string }>("POST", "/client/nps", data),
  getFavorites: () => apiReq<FavoritesResponse>("GET", "/client/me/favorites"),
  addFavorite: (itemType: "trip" | "product", itemId: string) =>
    apiReq<{ id: string }>("POST", "/client/me/favorites", { itemType, itemId }),
  removeFavorite: (itemType: "trip" | "product", itemId: string) =>
    apiReq<void>("DELETE", `/client/me/favorites/${itemType}/${itemId}`),
  getLoyaltyTransactions: (page = 1) =>
    apiReq<LoyaltyTransactionsResponse>("GET", `/client/me/loyalty/transactions?page=${page}`),
  redeemLoyaltyPoints: (reservationId: string, pointsToRedeem: number) =>
    apiReq<RedeemLoyaltyResponse>("POST", "/client/me/loyalty/redeem", { reservationId, pointsToRedeem }),
  getAchievements: () => apiReq<ClientAchievementsResponse>("GET", "/client/me/achievements"),
  getMemories: () => apiReq<ClientMemoriesResponse>("GET", "/client/me/memories"),
  getDreamDestinations: () => apiReq<DreamDestinationsResponse>("GET", "/client/me/dream-destinations"),
  addDreamDestination: (destinationName: string, note?: string) =>
    apiReq<DreamDestinationItem>("POST", "/client/me/dream-destinations", { destinationName, note }),
  removeDreamDestination: (id: string) =>
    apiReq<void>("DELETE", `/client/me/dream-destinations/${id}`),
  getVoucherUrl: (reservationId: string) => `${BASE}/api/client/reservations/${reservationId}/voucher`,
  getClubConfig: () => apiReq<{ clubName: string; description: string | null }>("GET", "/club/config"),
  getClubBenefits: () => apiReq<{ data: ClubBenefit[] }>("GET", "/club/benefits"),
  getClubRanking: () => apiReq<ClubRankingResponse>("GET", "/club/ranking"),
  setAmbassadorOptIn: (ambassadorOptIn: boolean) =>
    apiReq<void>("PATCH", "/client/me/ambassador", { ambassadorOptIn }),
};

export interface ClubBenefit {
  id: string;
  tenantId: string;
  tier: string;
  benefitKey: string;
  label: string;
  description: string | null;
  value: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClubRankingEntry {
  rank: number;
  name: string;
  count: number;
}

export interface ClubRankingResponse {
  referrers: ClubRankingEntry[];
  travelers: ClubRankingEntry[];
  month: string;
}
