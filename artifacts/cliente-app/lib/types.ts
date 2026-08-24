export interface ClientPortalReservation {
  id: string;
  tripId: string;
  reservationNumber: string | null;
  status: string;
  voucherCode: string;
  totalValue: number;
  paidValue: number;
  balance: number;
  seatsCount: number;
  paymentMethod: string | null;
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
  createdAt: string;
}

export interface ClientLoyalty {
  availablePoints: number;
  totalPoints: number;
  tier: string;
  programName: string;
  pointsPerReal: number;
  realPerPoint: number;
  minRedeemPoints: number;
  recentTransactions: ClientLoyaltyTransaction[];
}

export interface ClientLoyaltyFull {
  availablePoints: number;
  totalPoints: number;
  tier: string;
  nextTier: string | null;
  pointsToNext: number;
  programName: string;
  pointsPerReal: number;
  realPerPoint: number;
  minRedeemPoints: number;
  tierBenefits: unknown | null;
}

export interface ClientReferral {
  id: string;
  referredName: string | null;
  referredEmail: string | null;
  status: string;
  convertedAt: string | null;
  bonusAmount: string;
  bonusPaid: boolean;
  createdAt: string;
  expiresAt: string | null;
}

export interface ClientPortalProfile {
  user: {
    id: string;
    name: string;
    email: string;
    cpf: string | null;
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
    customerCode: string | null;
  } | null;
  tenant: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    primaryColor: string;
    npsCategories?: {
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
    bonusValidityDays: number;
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
    nextTierRemaining: number | null;
    nextTierMultiplier: number | null;
    pointsPerReferral: number;
    wallet: {
      availableCredit: number;
      pendingCredit: number;
      usedCredit: number;
      expiringCredit: number;
      expiringOn: string | null;
    };
  };
  stats: {
    totalSpent: number;
  };
  loyalty: ClientLoyalty | null;
}

export interface TripMemoryMedia {
  id: string;
  url: string;
  type: string;
  caption: string | null;
  createdAt: string;
}

export interface TripMemory {
  reservationId: string;
  tripId: string;
  tripName: string;
  tripDestination: string;
  tripDestinationCity: string | null;
  tripDestinationState: string | null;
  tripCoverImage: string | null;
  tripDepartureDate: string;
  tripReturnDate: string | null;
  npsSubmitted: boolean;
  tripVideos: string[];
  media: TripMemoryMedia[];
}

export interface MemoriesResponse {
  memories: TripMemory[];
}

export interface MyReferralsResponse {
  data: ClientReferral[];
}

export interface ClientReferralCampaign {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  bonusType: string;
  bonusValue: string | number;
  bannerText: string | null;
  shareMessage: string | null;
  materialUrl: string | null;
  eligibleActivitySegments: string[] | null;
}

export interface LoyaltyTransactionsResponse {
  data: ClientLoyaltyTransaction[];
  hasMore: boolean;
  total: number;
}
