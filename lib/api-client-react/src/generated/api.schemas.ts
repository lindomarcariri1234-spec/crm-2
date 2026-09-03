llable */
  replicatedFromId?: string | null;
}

export type OutboundMessageResult = OutboundMessage & {
  created: boolean;
};

export interface MessageTemplate {
  id: string;
  name: string;
  channel: string;
  /** @nullable */
  subject?: string | null;
  content: string;
  variables: string[];
  /** @nullable */
  category?: string | null;
  createdAt: string;
}

export interface CreateMessageTemplateBody {
  name: string;
  channel: string;
  /** @nullable */
  subject?: string | null;
  content: string;
  variables?: string[];
  /** @nullable */
  category?: string | null;
}

export interface UpdateMessageTemplateBody {
  /** @nullable */
  name?: string | null;
  /** @nullable */
  subject?: string | null;
  /** @nullable */
  content?: string | null;
  /** @nullable */
  category?: string | null;
}

export type AutomationTriggerConfig = { [key: string]: unknown };

export interface Automation {
  id: string;
  name: string;
  /** @nullable */
  description?: string | null;
  triggerType: string;
  triggerConfig: AutomationTriggerConfig;
  isActive: boolean;
  executionsCount: number;
  /** @nullable */
  lastExecutedAt?: string | null;
  createdAt: string;
}

export type CreateAutomationBodyTriggerConfig = { [key: string]: unknown };

/**
 * @nullable
 */
export type CreateAutomationBodyConditions = { [key: string]: unknown } | null;

export interface CreateAutomationBody {
  name: string;
  /** @nullable */
  description?: string | null;
  triggerType: string;
  triggerConfig: CreateAutomationBodyTriggerConfig;
  /** @nullable */
  conditions?: CreateAutomationBodyConditions;
}

/**
 * @nullable
 */
export type UpdateAutomationBodyTriggerConfig = {
  [key: string]: unknown;
} | null;

export interface UpdateAutomationBody {
  /** @nullable */
  name?: string | null;
  /** @nullable */
  description?: string | null;
  /** @nullable */
  isActive?: boolean | null;
  /** @nullable */
  triggerConfig?: UpdateAutomationBodyTriggerConfig;
}

export interface Supplier {
  id: string;
  name: string;
  type: string;
  /** @nullable */
  cnpj?: string | null;
  /** @nullable */
  contactName?: string | null;
  /** @nullable */
  email?: string | null;
  /** @nullable */
  whatsapp?: string | null;
  /** @nullable */
  phone?: string | null;
  /** @nullable */
  addressCity?: string | null;
  /** @nullable */
  addressState?: string | null;
  /** @nullable */
  pixKey?: string | null;
  /** @nullable */
  pixType?: string | null;
  /** @nullable */
  bankName?: string | null;
  /** @nullable */
  bankAgency?: string | null;
  /** @nullable */
  bankAccount?: string | null;
  status: string;
  createdAt: string;
}

export interface CreateSupplierBody {
  name: string;
  type: string;
  /** @nullable */
  cnpj?: string | null;
  /** @nullable */
  contactName?: string | null;
  /** @nullable */
  email?: string | null;
  /** @nullable */
  whatsapp?: string | null;
  /** @nullable */
  addressCity?: string | null;
  /** @nullable */
  addressState?: string | null;
  /** @nullable */
  pixKey?: string | null;
  /** @nullable */
  pixType?: string | null;
  /** @nullable */
  bankName?: string | null;
  /** @nullable */
  bankAgency?: string | null;
  /** @nullable */
  bankAccount?: string | null;
}

export interface UpdateSupplierBody {
  /** @nullable */
  name?: string | null;
  /** @nullable */
  status?: string | null;
  /** @nullable */
  contactName?: string | null;
  /** @nullable */
  email?: string | null;
  /** @nullable */
  pixKey?: string | null;
  /** @nullable */
  pixType?: string | null;
  /** @nullable */
  bankName?: string | null;
  /** @nullable */
  bankAgency?: string | null;
  /** @nullable */
  bankAccount?: string | null;
}

export interface Vehicle {
  id: string;
  name: string;
  type: string;
  plate: string;
  capacity: number;
  /** @nullable */
  model?: string | null;
  /** @nullable */
  year?: number | null;
  amenities: string[];
  /** @nullable */
  dailyRate?: number | null;
  /** @nullable */
  photoUrl?: string | null;
  /** @nullable */
  driverName?: string | null;
  /** @nullable */
  driverPhone?: string | null;
  /** @nullable */
  seatLayout?: string | null;
  /** @nullable */
  notes?: string | null;
  status: string;
  createdAt: string;
}

export interface CreateVehicleBody {
  name: string;
  type: string;
  plate: string;
  capacity: number;
  /** @nullable */
  model?: string | null;
  /** @nullable */
  year?: number | null;
  amenities?: string[];
  /** @nullable */
  dailyRate?: number | null;
  /** @nullable */
  photoUrl?: string | null;
  /** @nullable */
  driverName?: string | null;
  /** @nullable */
  driverPhone?: string | null;
  /** @nullable */
  seatLayout?: string | null;
  /** @nullable */
  notes?: string | null;
}

export interface UpdateVehicleBody {
  /** @nullable */
  name?: string | null;
  /** @nullable */
  status?: string | null;
  /** @nullable */
  capacity?: number | null;
  /** @nullable */
  dailyRate?: number | null;
  amenities?: string[];
  /** @nullable */
  driverName?: string | null;
  /** @nullable */
  driverPhone?: string | null;
  /** @nullable */
  seatLayout?: string | null;
  /** @nullable */
  notes?: string | null;
}

export interface Accommodation {
  id: string;
  name: string;
  type: string;
  /** @nullable */
  address?: string | null;
  /** @nullable */
  city?: string | null;
  /** @nullable */
  state?: string | null;
  /** @nullable */
  contactName?: string | null;
  /** @nullable */
  phone?: string | null;
  /** @nullable */
  email?: string | null;
  /** @nullable */
  totalRooms?: number | null;
  amenities: string[];
  /** @nullable */
  pricePerNight?: number | null;
  /** @nullable */
  coverImage?: string | null;
  /** @nullable */
  rating?: number | null;
  gallery?: string[] | null;
  status: string;
  createdAt: string;
}

export interface CreateAccommodationBody {
  name: string;
  type: string;
  /** @nullable */
  address?: string | null;
  /** @nullable */
  city?: string | null;
  /** @nullable */
  state?: string | null;
  /** @nullable */
  contactName?: string | null;
  /** @nullable */
  phone?: string | null;
  /** @nullable */
  email?: string | null;
  /** @nullable */
  totalRooms?: number | null;
  amenities?: string[];
  galleryUrls?: string[];
  /** @nullable */
  pricePerNight?: number | null;
}

export interface UpdateAccommodationBody {
  /** @nullable */
  name?: string | null;
  /** @nullable */
  status?: string | null;
  /** @nullable */
  pricePerNight?: number | null;
  /** @nullable */
  totalRooms?: number | null;
  amenities?: string[];
  galleryUrls?: string[];
}

export interface Destination {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
  /** @nullable */
  description?: string | null;
  mainAttractions: string[];
  /** @nullable */
  bestSeason?: string | null;
  /** @nullable */
  coverImage?: string | null;
  /** @nullable */
  rating?: number | null;
  createdAt: string;
}

export interface CreateDestinationBody {
  name: string;
  city: string;
  state: string;
  country?: string;
  /** @nullable */
  description?: string | null;
  mainAttractions?: string[];
  /** @nullable */
  bestSeason?: string | null;
  /** @nullable */
  coverImage?: string | null;
}

export interface UpdateDestinationBody {
  /** @nullable */
  name?: string | null;
  /** @nullable */
  description?: string | null;
  /** @nullable */
  mainAttractions?: string[] | null;
  /** @nullable */
  bestSeason?: string | null;
  /** @nullable */
  coverImage?: string | null;
  /** @nullable */
  rating?: number | null;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  /** @nullable */
  description?: string | null;
  type: string;
  price: number;
  /** @nullable */
  promotionalPrice?: number | null;
  /** @nullable */
  stock?: number | null;
  active: boolean;
  featured: boolean;
  createdAt: string;
}

export interface CreateProductBody {
  name: string;
  /** @nullable */
  description?: string | null;
  type: string;
  price: number;
  /** @nullable */
  promotionalPrice?: number | null;
  /** @nullable */
  stock?: number | null;
}

export interface UpdateProductBody {
  /** @nullable */
  name?: string | null;
  /** @nullable */
  price?: number | null;
  /** @nullable */
  promotionalPrice?: number | null;
  /** @nullable */
  active?: boolean | null;
  /** @nullable */
  featured?: boolean | null;
  /** @nullable */
  stock?: number | null;
}

export interface OrderItem {
  id: string;
  productId: string;
  quantity: number;
  price: number;
  /** @nullable */
  productName?: string | null;
}

export interface Order {
  id: string;
  userId: string;
  /** Full order total (subtotal - discounts). Not overwritten by depositAmount. */
  totalAmount: number;
  finalAmount: number;
  /**
   * Amount the customer chose to pay now (partial payment). Null when full payment is required.
   * @nullable
   */
  depositAmount?: number | null;
  /**
   * Balance remaining after deposit (totalAmount - depositAmount). Null when fully paid upfront.
   * @nullable
   */
  amountRemaining?: number | null;
  status: string;
  paymentStatus: string;
  createdAt: string;
  items: OrderItem[];
}

export interface UpdateOrderBody {
  /** @nullable */
  status?: string | null;
  /** @nullable */
  paymentStatus?: string | null;
}

export type PublicCheckoutBodyItemsItem = {
  productId?: string;
  quantity?: number;
};

/**
 * Body for POST /public/store/{slug}/orders (vitrine checkout)
 */
export interface PublicCheckoutBody {
  items: PublicCheckoutBodyItemsItem[];
  customerName: string;
  customerEmail: string;
  /** @nullable */
  customerPhone?: string | null;
  /** @nullable */
  customerCpf?: string | null;
  /** @nullable */
  paymentMethod?: string | null;
  /** @nullable */
  couponCode?: string | null;
  /** @nullable */
  referralCode?: string | null;
  /** @nullable */
  notes?: string | null;
  seats?: string[];
  /** @nullable */
  boardingLocationId?: string | null;
  /**
   * Partial payment amount chosen by the customer. Must be >= store.minDepositAmount and <= order total. Rejected when store.minDepositAmount is not configured. The order totalAmount is always the full price — depositAmount does NOT overwrite it.

   * @nullable
   */
  depositAmount?: number | null;
  /**
   * Client-generated key for idempotent checkout retry (max 128 chars)
   * @nullable
   */
  idempotencyKey?: string | null;
}

/**
 * Response from POST /public/store/{slug}/orders (vitrine checkout)
 */
export interface PublicStoreOrderResponse {
  id: string;
  orderNumber: string;
  status: string;
  /** Full order total (subtotal - discounts). Never overwritten by depositAmount. */
  totalAmount: number;
  /**
   * Amount charged now for partial-payment orders. Null when full payment is due upfront.
   * @nullable
   */
  depositAmount?: number | null;
  /**
   * Balance owed after deposit (totalAmount - depositAmount). Null when fully paid.
   * @nullable
   */
  amountRemaining?: number | null;
  /** @nullable */
  paymentMethod?: string | null;
  createdAt: string;
}

/**
 * Public store configuration returned for vitrine pages
 */
export interface PublicStoreInfo {
  id: string;
  name: string;
  slug: string;
  /**
   * Minimum deposit amount (BRL) the store accepts for partial payments. Null means full payment is required; when set, customers may pay this amount now and the remainder later.

   * @nullable
   */
  minDepositAmount?: string | null;
  /** @nullable */
  minOrderValue?: string | null;
  paymentMethods: string[];
  stripeEnabled: boolean;
  maintenanceMode: boolean;
  couponsEnabled: boolean;
  referralsEnabled: boolean;
  seatMapEnabled: boolean;
}

/**
 * @nullable
 */
export type CampaignTriggerConfig = { [key: string]: unknown } | null;

export interface Campaign {
  id: string;
  name: string;
  type: string;
  status: string;
  /** @nullable */
  subject?: string | null;
  content: string;
  /** @nullable */
  scheduledAt?: string | null;
  /** @nullable */
  sentAt?: string | null;
  recipientsCount: number;
  sentCount: number;
  openedCount: number;
  clickedCount: number;
  deliveredCount?: number;
  /** @nullable */
  triggerType?: string | null;
  /** @nullable */
  triggerConfig?: CampaignTriggerConfig;
  autoEnabled?: boolean;
  createdAt: string;
}

export type CreateCampaignBodyTargetSegment = { [key: string]: unknown };

/**
 * @nullable
 */
export type CreateCampaignBodyTriggerConfig = { [key: string]: unknown } | null;

export interface CreateCampaignBody {
  name: string;
  type: string;
  /** @nullable */
  subject?: string | null;
  content: string;
  targetSegment: CreateCampaignBodyTargetSegment;
  /** @nullable */
  scheduledAt?: string | null;
  /** @nullable */
  triggerType?: string | null;
  /** @nullable */
  triggerConfig?: CreateCampaignBodyTriggerConfig;
  /** @nullable */
  autoEnabled?: boolean | null;
}

/**
 * @nullable
 */
export type UpdateCampaignBodyTriggerConfig = { [key: string]: unknown } | null;

export interface UpdateCampaignBody {
  /** @nullable */
  name?: string | null;
  /** @nullable */
  status?: string | null;
  /** @nullable */
  scheduledAt?: string | null;
  /** @nullable */
  content?: string | null;
  /** @nullable */
  subject?: string | null;
  /** @nullable */
  autoEnabled?: boolean | null;
  /** @nullable */
  triggerConfig?: UpdateCampaignBodyTriggerConfig;
}

export interface NpsResponse {
  id: string;
  userId: string;
  score: number;
  classification: string;
  /** @nullable */
  feedback?: string | null;
  /** @nullable */
  clientName?: string | null;
  /** @nullable */
  scoreTransport?: number | null;
  /** @nullable */
  scoreService?: number | null;
  /** @nullable */
  scoreOrganization?: number | null;
  /** @nullable */
  scoreGuide?: number | null;
  createdAt: string;
}

export interface NpsSendLink {
  clientId: string;
  clientName: string;
  surveyUrl: string;
}

export interface NpsSummary {
  averageScore: number;
  npsScore: number;
  promoters: number;
  passives: number;
  detractors: number;
  total: number;
  /** @nullable */
  avgTransport?: number | null;
  /** @nullable */
  avgService?: number | null;
  /** @nullable */
  avgOrganization?: number | null;
  /** @nullable */
  avgGuide?: number | null;
}

/**
 * @nullable
 */
export type UserProfileTenantSettings = { [key: string]: unknown } | null;

export type UserProfileTenant = {
  id: string;
  name: string;
  slug: string;
  /** @nullable */
  logoUrl?: string | null;
  /** @nullable */
  primaryColor?: string | null;
  /** @nullable */
  secondaryColor?: string | null;
  status: string;
  planId: string;
  /** @nullable */
  website?: string | null;
  /** @nullable */
  settings?: UserProfileTenantSettings;
} | null;

export interface UserProfile {
  id: string;
  clerkId: string;
  name: string;
  email: string;
  role: Role;
  /** @nullable */
  avatarUrl?: string | null;
  isActive: boolean;
  /** @nullable */
  tenantId?: string | null;
  referralCode: string;
  referralBalance: number;
  commissionType?: string;
  commissionRate?: number;
  commissionFixed?: number;
  /** @nullable */
  monthlyGoal?: number | null;
  /** @nullable */
  trialDaysLeft?: number | null;
  createdAt: string;
  tenant?: UserProfileTenant;
}

export interface SyncUserBody {
  clerkId: string;
  name: string;
  email: string;
  /** @nullable */
  avatarUrl?: string | null;
  /**
   * CPF do usuário. Quando informado, é usado para localizar ou vincular o cadastro de cliente dentro da agência.
   * @maxLength 20
   * @nullable
   */
  cpf?: string | null;
  /** When present on a brand-new account, links the user to the agency store as a CLIENT. Ignored for existing users. */
  storeSlug?: string;
}

export interface CreateUserBody {
  name: string;
  email: string;
  role: Role;
}

export interface UpdateUserBody {
  /** @nullable */
  name?: string | null;
  role?: Role | null;
  /** @nullable */
  isActive?: boolean | null;
  /** @nullable */
  commissionType?: string | null;
  /** @nullable */
  commissionRate?: number | null;
  /** @nullable */
  commissionFixed?: number | null;
  /** @nullable */
  monthlyGoal?: number | null;
}

export interface SalesGoal {
  id: string;
  tenantId: string;
  userId: string;
  periodType: string;
  /** @nullable */
  year?: number | null;
  month: string;
  /** @nullable */
  monthInt?: number | null;
  /** @nullable */
  quarter?: number | null;
  goalAmount: number;
  achievedAmount: number;
  /** @nullable */
  goalQuantity?: number | null;
  /** @nullable */
  achievedQuantity?: number | null;
  /** @nullable */
  progressPercentage?: number | null;
  /** @nullable */
  bonusAmount?: number | null;
  bonusPaid: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSalesGoalBody {
  userId: string;
  periodType?: string;
  year?: number;
  month: string;
  monthInt?: number;
  quarter?: number;
  goalAmount: number;
  goalQuantity?: number;
  bonusAmount?: number;
}

export interface UpdateSalesGoalBody {
  /** @nullable */
  goalAmount?: number | null;
  /** @nullable */
  achievedAmount?: number | null;
  /** @nullable */
  goalQuantity?: number | null;
  /** @nullable */
  achievedQuantity?: number | null;
  /** @nullable */
  progressPercentage?: number | null;
  /** @nullable */
  bonusAmount?: number | null;
  /** @nullable */
  bonusPaid?: boolean | null;
  /** @nullable */
  status?: string | null;
}

export interface CommissionPreview {
  commissionAmount: number;
  /** @nullable */
  commissionRate?: number | null;
  commissionType: string;
  source: string;
  saleAmount: number;
}

export interface CommissionRank {
  /** @nullable */
  rank?: number | null;
  totalSellers: number;
  monthlyCommission: number;
  month: string;
}

export type SystemHealthRedisStatus =
  (typeof SystemHealthRedisStatus)[keyof typeof SystemHealthRedisStatus];

export const SystemHealthRedisStatus = {
  ok: "ok",
  degraded: "degraded",
  unavailable: "unavailable",
} as const;

/**
 * @nullable
 */
export type SystemHealthRedisDailyUsage = {
  commandCount: number;
  maxCommands: number;
  usagePct: number;
  warningThresholdPct: number;
} | null;

export interface SystemHealthRedis {
  status: SystemHealthRedisStatus;
  /** @nullable */
  dailyUsage?: SystemHealthRedisDailyUsage;
}

export interface SystemHealthStripeWebhookAuditEndpoint {
  id: string;
  url: string;
}

export type SystemHealthStripeWebhookAuditStatus =
  (typeof SystemHealthStripeWebhookAuditStatus)[keyof typeof SystemHealthStripeWebhookAuditStatus];

export const SystemHealthStripeWebhookAuditStatus = {
  ok: "ok",
  duplicate: "duplicate",
  unknown: "unknown",
} as const;

export interface SystemHealthStripeWebhookAudit {
  status: SystemHealthStripeWebhookAuditStatus;
  duplicateCount: number;
  endpoints: SystemHealthStripeWebhookAuditEndpoint[];
  checkedAt: string | null;
}

export interface SystemHealthStripeSyncTables {
  /** @nullable */
  ok: boolean | null;
  /** @nullable */
  checkedAt: string | null;
}

export type SystemHealthWorkers = { [key: string]: unknown };

export type SystemHealthSeatDrift = { [key: string]: unknown };

export type SystemHealthPipelineOrphans = { [key: string]: unknown };

export type SystemHealthClientFinancialDrift = { [key: string]: unknown };

export interface SystemHealth {
  redis: SystemHealthRedis;
  stripeWebhookAudit: SystemHealthStripeWebhookAudit;
  stripeSyncTables: SystemHealthStripeSyncTables;
  workers?: SystemHealthWorkers;
  seatDrift?: SystemHealthSeatDrift;
  pipelineOrphans?: SystemHealthPipelineOrphans;
  clientFinancialDrift?: SystemHealthClientFinancialDrift;
}

export interface RepairSystemHealth {
  orphansFixed: number;
  tripsCorrected: number;
}

export interface RepairSeatDrift {
  fixed: number;
  skipped: number;
}

export type AdminStatsByStatus = { [key: string]: number };

export type AdminStatsByPlan = { [key: string]: number };

export interface AdminStats {
  totalTenants: number;
  byStatus: AdminStatsByStatus;
  byPlan: AdminStatsByPlan;
  mrr: number;
}

/**
 * @nullable
 */
export type TenantSettings = { [key: string]: unknown } | null;

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  email: string;
  /** @nullable */
  whatsapp?: string | null;
  /** @nullable */
  phone?: string | null;
  planId: string;
  status: string;
  /** @nullable */
  logoUrl?: string | null;
  /** @nullable */
  primaryColor?: string | null;
  /** @nullable */
  secondaryColor?: string | null;
  /** @nullable */
  website?: string | null;
  /** @nullable */
  reservationPrefix?: string | null;
  prefixLocked?: boolean;
  /** @nullable */
  settings?: TenantSettings;
  createdAt: string;
}

export type TenantWithCount = Tenant & {
  userCount: number;
};

export interface CreateTenantBody {
  name: string;
  slug: string;
  email: string;
  planId?: string;
  status?: string;
}

export type UpdateTenantBodyNpsCategories = {
  transport?: boolean;
  service?: boolean;
  organization?: boolean;
  guide?: boolean;
};

export interface UpdateTenantBody {
  name?: string;
  planId?: string;
  status?: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  whatsapp?: string;
  phone?: string;
  cnpj?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  /** @nullable */
  maxUsersOverride?: number | null;
  /** @nullable */
  maxClientsOverride?: number | null;
  /** @nullable */
  maxTripsOverride?: number | null;
  /** @nullable */
  website?: string | null;
  /** @nullable */
  reservationPrefix?: string | null;
  npsCategories?: UpdateTenantBodyNpsCategories;
  /** @nullable */
  trialEndsAt?: string | null;
  /** @nullable */
  birthdayMessagesEnabled?: boolean | null;
}

export interface BoardingLocation {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  /** @nullable */
  reference?: string | null;
  /** @nullable */
  departureTime?: string | null;
  createdAt: string;
  /** @nullable */
  sellerName?: string | null;
}

export interface CreateBoardingLocationBody {
  name: string;
  address: string;
  city: string;
  state: string;
  reference?: string;
  departureTime?: string;
}

export interface CommissionRule {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  value: string;
  appliesTo: string;
  /** @nullable */
  tripId?: string | null;
  isActive: boolean;
  createdAt: string;
}

export type CreateCommissionRuleBodyType =
  (typeof CreateCommissionRuleBodyType)[keyof typeof CreateCommissionRuleBodyType];

export const CreateCommissionRuleBodyType = {
  percentage: "percentage",
  fixed: "fixed",
} as const;

export interface CreateCommissionRuleBody {
  name: string;
  type?: CreateCommissionRuleBodyType;
  value: string;
  appliesTo?: string;
  tripId?: string;
  isActive?: boolean;
}

export interface Commission {
  id: string;
  tenantId: string;
  /** @nullable */
  ruleId?: string | null;
  userId: string;
  /** @nullable */
  reservationId?: string | null;
  baseAmount: string;
  commissionAmount: string;
  /** @nullable */
  commissionRate?: string | null;
  /** @nullable */
  commissionType?: string | null;
  status: string;
  /** @nullable */
  paidAt?: string | null;
  createdAt: string;
  /** @nullable */
  sellerName?: string | null;
}

export interface UpdateCommissionBody {
  status?: string;
  paidAt?: string;
}

export interface CreateReferralBody {
  referrerId: string;
  referredId?: string;
  referredEmail?: string;
  code: string;
  bonusAmount?: string;
}

export interface UpdateReferralBody {
  status?: string;
  bonusPaid?: boolean;
  convertedAt?: string;
  isActive?: boolean;
  notes?: string;
}

export interface ReferralStats {
  total: number;
  pending: number;
  completed: number;
  expired: number;
  conversionRate: number;
  totalBonusPaid: number;
  totalDiscountGiven: number;
}

export interface ReferralTierConfig {
  level: string;
  label: string;
  minReferrals: number;
  bonusMultiplier: number;
}

export interface ReferralSettings {
  id: string;
  tenantId: string;
  isEnabled: boolean;
  discountType: string;
  discountValue: string;
  bonusType: string;
  bonusValue: string;
  expirationDays: number;
  allowSelfReferral: boolean;
  requireFirstPurchase: boolean;
  /** @nullable */
  shareMessage?: string | null;
  tiersConfig: ReferralTierConfig[];
  whatsappEnabled: boolean;
  /** @nullable */
  whatsappPhoneNumber?: string | null;
  /** @nullable */
  whatsappConvertedMessage?: string | null;
  /** @nullable */
  whatsappBonusPaidMessage?: string | null;
  /** @nullable */
  whatsappReversedMessage?: string | null;
  expiryWarning7DaysEnabled: boolean;
  expiryWarning1DayEnabled: boolean;
  bonusReleaseEmailEnabled: boolean;
  loyaltyPointsEmailEnabled?: boolean;
  pointsPerReferral: number;
  gracePeriodDays: number;
  bonusValidityDays: number;
  discountExpirationDays: number;
  /** @nullable */
  minPurchaseAmount?: string | null;
  maxReferralsPerUser: number;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateReferralSettingsBody {
  isEnabled?: boolean;
  discountType?: string;
  discountValue?: number;
  bonusType?: string;
  bonusValue?: number;
  expirationDays?: number;
  allowSelfReferral?: boolean;
  requireFirstPurchase?: boolean;
  shareMessage?: string;
  tiersConfig?: ReferralTierConfig[];
  whatsappEnabled?: boolean;
  whatsappPhoneNumber?: string;
  whatsappConvertedMessage?: string;
  whatsappBonusPaidMessage?: string;
  whatsappReversedMessage?: string;
  expiryWarning7DaysEnabled?: boolean;
  expiryWarning1DayEnabled?: boolean;
  bonusReleaseEmailEnabled?: boolean;
  loyaltyPointsEmailEnabled?: boolean;
  pointsPerReferral?: number;
  gracePeriodDays?: number;
  bonusValidityDays?: number;
  discountExpirationDays?: number;
  minPurchaseAmount?: number;
  maxReferralsPerUser?: number;
}

export type ClientReferralInfoAttemptLogsItem = {
  id: string;
  storeSlug: string;
  /** @nullable */
  ipAddress?: string | null;
  createdAt: string;
};

export interface ClientReferralInfo {
  /** @nullable */
  referralCode: string | null;
  totalReferrals: number;
  successfulReferrals: number;
  referralEarnings: number;
  referrals: Referral[];
  /** @nullable */
  referralCodeStatus?: string | null;
  /** @nullable */
  referralSuspendedAttemptAt?: string | null;
  referralSuspendedAttemptCount?: number;
  attemptLogs?: ClientReferralInfoAttemptLogsItem[];
}

export interface Coupon {
  id: string;
  tenantId: string;
  code: string;
  type: string;
  value: string;
  /** @nullable */
  minOrderValue?: string | null;
  /** @nullable */
  maxUses?: number | null;
  usedCount: number;
  isActive: boolean;
  /** @nullable */
  validFrom?: string | null;
  /** @nullable */
  validUntil?: string | null;
  createdAt: string;
}

export type CreateCouponBodyType =
  (typeof CreateCouponBodyType)[keyof typeof CreateCouponBodyType];

export const CreateCouponBodyType = {
  percentage: "percentage",
  fixed: "fixed",
} as const;

export interface CreateCouponBody {
  code: string;
  type?: CreateCouponBodyType;
  value: string;
  minOrderValue?: string;
  maxUses?: number;
  isActive?: boolean;
  validFrom?: string;
  validUntil?: string;
}

export interface Document {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  url: string;
  /** @nullable */
  mimeType?: string | null;
  /** @nullable */
  sizeBytes?: number | null;
  /** @nullable */
  entityType?: string | null;
  /** @nullable */
  entityId?: string | null;
  uploadedById: string;
  createdAt: string;
}

export interface CreateDocumentBody {
  name: string;
  type: string;
  url: string;
  mimeType?: string;
  sizeBytes?: number;
  entityType?: string;
  entityId?: string;
}

export type LoyaltyProgramTierBenefits = { [key: string]: string[] };

export interface LoyaltyProgram {
  id: string;
  tenantId: string;
  name: string;
  /** @nullable */
  description?: string | null;
  pointsPerReal: string;
  realPerPoint: string;
  minRedeemPoints: number;
  isActive: boolean;
  tierBenefits?: LoyaltyProgramTierBenefits;
  createdAt: string;
}

export type CreateLoyaltyProgramBodyTierBenefits = { [key: string]: string[] };

export interface CreateLoyaltyProgramBody {
  /** @nullable */
  name?: string | null;
  description?: string;
  pointsPerReal?: string;
  realPerPoint?: string;
  minRedeemPoints?: number;
  tierBenefits?: CreateLoyaltyProgramBodyTierBenefits;
}

export interface LoyaltyMember {
  id: string;
  tenantId: string;
  programId: string;
  clientId: string;
  totalPoints: number;
  availablePoints: number;
  tier: string;
  joinedAt: string;
}

export interface CreateLoyaltyMemberBody {
  programId: string;
  clientId: string;
  tier?: string;
}

export interface LoyaltyTransaction {
  id: string;
  tenantId: string;
  memberId: string;
  programId: string;
  type: string;
  points: number;
  description: string;
  /** @nullable */
  referenceId?: string | null;
  /** @nullable */
  referenceType?: string | null;
  createdAt: string;
}

export type CreateLoyaltyTransactionBodyType =
  (typeof CreateLoyaltyTransactionBodyType)[keyof typeof CreateLoyaltyTransactionBodyType];

export const CreateLoyaltyTransactionBodyType = {
  earn: "earn",
  redeem: "redeem",
  expire: "expire",
  bonus: "bonus",
} as const;

export interface CreateLoyaltyTransactionBody {
  memberId: string;
  programId: string;
  type: CreateLoyaltyTransactionBodyType;
  points: number;
  description?: string;
  referenceId?: string;
  referenceType?: string;
}

export interface LoyaltySyncResult {
  membersUpdated: number;
  transactionsCreated: number;
}

export interface ChatbotConversation {
  id: string;
  tenantId: string;
  /** @nullable */
  clientId?: string | null;
  channel: string;
  status: string;
  /** @nullable */
  assignedUserId?: string | null;
  /** @nullable */
  sessionId?: string | null;
  startedAt: string;
  /** @nullable */
  endedAt?: string | null;
  createdAt: string;
}

export type CreateChatbotConversationBodyChannel =
  (typeof CreateChatbotConversationBodyChannel)[keyof typeof CreateChatbotConversationBodyChannel];

export const CreateChatbotConversationBodyChannel = {
  webchat: "webchat",
  whatsapp: "whatsapp",
  email: "email",
} as const;

export interface CreateChatbotConversationBody {
  clientId?: string;
  channel?: CreateChatbotConversationBodyChannel;
  sessionId?: string;
}

export interface UpdateChatbotConversationBody {
  status?: string;
  assignedUserId?: string;
  endedAt?: string;
}

export interface ChatbotMessage {
  id: string;
  conversationId: string;
  tenantId: string;
  role: string;
  content: string;
  /** @nullable */
  mediaUrl?: string | null;
  isBot: boolean;
  sentAt: string;
}

export type CreateChatbotMessageBodyRole =
  (typeof CreateChatbotMessageBodyRole)[keyof typeof CreateChatbotMessageBodyRole];

export const CreateChatbotMessageBodyRole = {
  user: "user",
  assistant: "assistant",
  system: "system",
} as const;

export interface CreateChatbotMessageBody {
  conversationId: string;
  role?: CreateChatbotMessageBodyRole;
  content: string;
  mediaUrl?: string;
  isBot?: boolean;
}

export type AuditLogBefore = { [key: string]: unknown } | null;

export type AuditLogAfter = { [key: string]: unknown } | null;

export interface AuditLog {
  id: string;
  tenantId: string;
  /** @nullable */
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: AuditLogBefore;
  after?: AuditLogAfter;
  /** @nullable */
  ipAddress?: string | null;
  /** @nullable */
  userAgent?: string | null;
  createdAt: string;
}

export type SystemConfigValue = { [key: string]: unknown } | null;

export interface SystemConfig {
  id: string;
  tenantId: string;
  key: string;
  value?: SystemConfigValue;
  /** @nullable */
  updatedById?: string | null;
  updatedAt: string;
}

export interface UpsertSystemConfigBody {
  key: string;
  value?: unknown;
}

export interface NotificationAlert {
  type: string;
  severity: string;
  title: string;
  message: string;
  link: string;
  /** @nullable */
  entityId?: string | null;
}

export interface NotificationsResponse {
  alerts: NotificationAlert[];
  total: number;
}

export interface ProductCategory {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  /** @nullable */
  description?: string | null;
  /** @nullable */
  parentId?: string | null;
  /** @nullable */
  imageUrl?: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface CreateProductCategoryBody {
  name: string;
  slug: string;
  description?: string;
  parentId?: string;
  imageUrl?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface ProductImage {
  id: string;
  productId: string;
  tenantId: string;
  url: string;
  /** @nullable */
  altText?: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface CreateProductImageBody {
  productId: string;
  url: string;
  altText?: string;
  sortOrder?: number;
}

export interface CartItem {
  id: string;
  tenantId: string;
  clientId: string;
  productId: string;
  quantity: number;
  addedAt: string;
}

export interface CreateCartItemBody {
  clientId: string;
  productId: string;
  quantity?: number;
}

export type AutomationActionConfig = { [key: string]: unknown };

export interface AutomationAction {
  id: string;
  automationId: string;
  tenantId: string;
  type: string;
  config: AutomationActionConfig;
  order: number;
  isActive: boolean;
  createdAt: string;
}

export type CreateAutomationActionBodyConfig = { [key: string]: unknown };

export interface CreateAutomationActionBody {
  automationId: string;
  type: string;
  config?: CreateAutomationActionBodyConfig;
  order?: number;
  isActive?: boolean;
}

export type AutomationLogTriggerData = { [key: string]: unknown } | null;

export type AutomationLogResult = { [key: string]: unknown } | null;

export interface AutomationLog {
  id: string;
  automationId: string;
  tenantId: string;
  status: string;
  triggerData?: AutomationLogTriggerData;
  result?: AutomationLogResult;
  /** @nullable */
  errorMessage?: string | null;
  executedAt: string;
}

export interface CreateTenantBodyV2 {
  name: string;
  slug: string;
  email: string;
  planId?: string;
  status?: string;
}

export interface UpdateTenantBodyV2 {
  name?: string;
  planId?: string;
  status?: string;
  logoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  whatsapp?: string;
  phone?: string;
  cnpj?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

export interface Plan {
  id: string;
  name: string;
  slug: string;
  /** @nullable */
  description?: string | null;
  monthlyPrice: string;
  annualPrice: string;
  maxUsers: number;
  maxClients: number;
  maxTrips: number;
  features: string[];
  supportedFeatures?: string[];
  isActive: boolean;
  isFeatured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlanBody {
  name: string;
  slug: string;
  description?: string;
  monthlyPrice?: string;
  annualPrice?: string;
  maxUsers?: number;
  maxClients?: number;
  maxTrips?: number;
  features?: string[];
  isActive?: boolean;
  isFeatured?: boolean;
}

export interface UpdatePlanBody {
  name?: string;
  slug?: string;
  description?: string;
  monthlyPrice?: string;
  annualPrice?: string;
  maxUsers?: number;
  maxClients?: number;
  maxTrips?: number;
  features?: string[];
  isActive?: boolean;
  isFeatured?: boolean;
}

export interface Invoice {
  id: string;
  tenantId: string;
  /** @nullable */
  planId?: string | null;
  amount: string;
  currency: string;
  status: string;
  /** @nullable */
  dueDate?: string | null;
  /** @nullable */
  paidAt?: string | null;
  /** @nullable */
  description?: string | null;
  /** @nullable */
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceWithTenant {
  id: string;
  tenantId: string;
  /** @nullable */
  planId?: string | null;
  amount: string;
  currency: string;
  status: string;
  /** @nullable */
  dueDate?: string | null;
  /** @nullable */
  paidAt?: string | null;
  /** @nullable */
  description?: string | null;
  /** @nullable */
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  /** @nullable */
  tenantName?: string | null;
  /** @nullable */
  pixCode?: string | null;
  /** @nullable */
  pixQrCodeUrl?: string | null;
  /** @nullable */
  pixExpiresAt?: string | null;
}

export interface CreateInvoiceBody {
  tenantId: string;
  planId?: string;
  amount: string;
  currency?: string;
  status?: string;
  dueDate?: string;
  description?: string;
  notes?: string;
}

export interface UpdateInvoiceBody {
  status?: string;
  paidAt?: string;
  notes?: string;
  amount?: string;
  dueDate?: string;
}

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  /** @nullable */
  description?: string | null;
  isEnabled: boolean;
  rolloutPercent: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFeatureFlagBody {
  key: string;
  name: string;
  description?: string;
  isEnabled?: boolean;
  rolloutPercent?: number;
}

export interface UpdateFeatureFlagBody {
  key?: string;
  name?: string;
  description?: string;
  isEnabled?: boolean;
  rolloutPercent?: number;
}

export interface MetricPoint {
  label: string;
  value: number;
}

export interface TenantDetails {
  id: string;
  name: string;
  slug: string;
  email: string;
  /** @nullable */
  whatsapp?: string | null;
  /** @nullable */
  phone?: string | null;
  /** @nullable */
  logoUrl?: string | null;
  /** @nullable */
  primaryColor?: string | null;
  /** @nullable */
  secondaryColor?: string | null;
  planId: string;
  status: string;
  /** @nullable */
  trialEndsAt?: string | null;
  /** @nullable */
  cnpj?: string | null;
  /** @nullable */
  address?: string | null;
  /** @nullable */
  city?: string | null;
  /** @nullable */
  state?: string | null;
  /** @nullable */
  zipCode?: string | null;
  userCount: number;
  clientCount: number;
  tripCount: number;
  reservationCount: number;
  /** @nullable */
  planMaxUsers?: number | null;
  /** @nullable */
  planMaxClients?: number | null;
  /** @nullable */
  planMaxTrips?: number | null;
  /** @nullable */
  maxUsersOverride?: number | null;
  /** @nullable */
  maxClientsOverride?: number | null;
  /** @nullable */
  maxTripsOverride?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminUserItem {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  /** @nullable */
  tenantId?: string | null;
  /** @nullable */
  tenantName?: string | null;
  /** @nullable */
  tenantStatus?: string | null;
  createdAt: string;
}

export type AuditLogWithTenantBefore = { [key: string]: unknown } | null;

export type AuditLogWithTenantAfter = { [key: string]: unknown } | null;

export interface AuditLogWithTenant {
  id: string;
  tenantId: string;
  /** @nullable */
  userId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: AuditLogWithTenantBefore;
  after?: AuditLogWithTenantAfter;
  /** @nullable */
  ipAddress?: string | null;
  createdAt: string;
  /** @nullable */
  tenantName?: string | null;
  /** @nullable */
  userName?: string | null;
  /** @nullable */
  userEmail?: string | null;
}

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  status: string;
  billingCycle: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  /** @nullable */
  canceledAt?: string | null;
  /** @nullable */
  trialEnd?: string | null;
  /** @nullable */
  externalId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BirthdayMessage {
  id: string;
  tenantId: string;
  clientId: string;
  birthdayYear: number;
  sentWhatsapp: boolean;
  sentEmail: boolean;
  /** @nullable */
  whatsappSentAt?: string | null;
  /** @nullable */
  emailSentAt?: string | null;
  /** @nullable */
  whatsappError?: string | null;
  /** @nullable */
  emailError?: string | null;
  /** @nullable */
  couponId?: string | null;
  /** @nullable */
  couponCode?: string | null;
  emailOpened: boolean;
  /** @nullable */
  emailOpenedAt?: string | null;
  converted: boolean;
  isManual: boolean;
  /** @nullable */
  sentById?: string | null;
  createdAt: string;
}

export interface BirthdayClient {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  whatsapp: string;
  /** @nullable */
  birthDate?: string | null;
  whatsappOptIn?: boolean;
  emailOptIn?: boolean;
  /** @nullable */
  daysUntil?: number | null;
  birthdayMessage?: BirthdayMessage | null;
}

export type BirthdayHistoryItem = BirthdayMessage & {
  client?: BirthdayClient | null;
};

export interface BirthdayStats {
  totalSentYear: number;
  sentThisMonth: number;
  whatsappSent: number;
  emailSent: number;
  emailOpened: number;
  converted: number;
  conversionRate: number;
  todayCount: number;
  upcomingWeek: number;
  revenueGenerated: number;
}

export interface BirthdaySendResult {
  success: boolean;
  /** @nullable */
  couponCode?: string | null;
  /** @nullable */
  error?: string | null;
}

export interface BirthdaySettings {
  enabled: boolean;
  discountPercent: number;
  validDays: number;
  sendWhatsapp: boolean;
  sendEmail: boolean;
  /** @nullable */
  whatsappMessage?: string | null;
  /** @nullable */
  emailSubject?: string | null;
  /** @nullable */
  emailMessage?: string | null;
  /** @nullable */
  senderName?: string | null;
}

export interface PlatformSetting {
  id: string;
  key: string;
  /** @nullable */
  value?: string | null;
  /** @nullable */
  fallbackValue?: string | null;
  label: string;
  /** @nullable */
  description?: string | null;
  type: string;
  updatedAt: string;
}

export interface CalendarConnectResponse {
  url: string;
}

export interface CalendarStatus {
  connected: boolean;
  status?: string;
  tokenValid?: boolean;
  eventsCount: number;
  /** @nullable */
  lastSync?: string | null;
}

export type CalendarSyncRequestType =
  (typeof CalendarSyncRequestType)[keyof typeof CalendarSyncRequestType];

export const CalendarSyncRequestType = {
  all: "all",
  trip: "trip",
  payment: "payment",
  birthday: "birthday",
} as const;

export interface CalendarSyncRequest {
  type: CalendarSyncRequestType;
  /** @nullable */
  id?: string | null;
}

export interface CalendarSyncResponse {
  success: boolean;
  message: string;
  synced: number;
}

export type CalendarReconciliationMatchType =
  (typeof CalendarReconciliationMatchType)[keyof typeof CalendarReconciliationMatchType];

export const CalendarReconciliationMatchType = {
  trip: "trip",
  payment: "payment",
  birthday: "birthday",
} as const;

export interface CalendarReconciliationMatch {
  id: string;
  type: CalendarReconciliationMatchType;
  label: string;
}

export type CalendarLegacyReconciliationStatus =
  (typeof CalendarLegacyReconciliationStatus)[keyof typeof CalendarLegacyReconciliationStatus];

export const CalendarLegacyReconciliationStatus = {
  pending: "pending",
  associated: "associated",
  removed: "removed",
  dismissed: "dismissed",
} as const;

export type CalendarLegacyReconciliationEventType =
  (typeof CalendarLegacyReconciliationEventType)[keyof typeof CalendarLegacyReconciliationEventType];

export const CalendarLegacyReconciliationEventType = {
  trip: "trip",
  payment: "payment",
  birthday: "birthday",
} as const;

export interface CalendarLegacyReconciliation {
  reconciliationId: string;
  status: CalendarLegacyReconciliationStatus;
  googleEventId: string;
  calendarId: string;
  eventType: CalendarLegacyReconciliationEventType;
  eventSummary: string;
  /** @nullable */
  eventDescription: string | null;
  /** @nullable */
  eventLocation: string | null;
  eventStartDate: string;
  /** @nullable */
  eventEndDate: string | null;
  candidateMatches: CalendarReconciliationMatch[];
}

export interface CalendarReconciliationScanRequest {
  from?: string;
  to?: string;
}

export interface CalendarReconciliationScanResponse {
  success: boolean;
  scanned: number;
  pending: CalendarLegacyReconciliation[];
  alreadyReconciled: CalendarLegacyReconciliation[];
}

export interface CalendarReconciliationListResponse {
  success: boolean;
  reconciliations: CalendarLegacyReconciliation[];
}

export interface CalendarReconciliationAssociateRequest {
  candidateId: string;
}

export type CalendarReconciliationActionResponseStatus =
  (typeof CalendarReconciliationActionResponseStatus)[keyof typeof CalendarReconciliationActionResponseStatus];

export const CalendarReconciliationActionResponseStatus = {
  associated: "associated",
  removed: "removed",
  dismissed: "dismissed",
} as const;

export interface CalendarReconciliationActionResponse {
  success: boolean;
  status: CalendarReconciliationActionResponseStatus;
}

export interface SalesCycleChannelBreakdown {
  /** Acquisition channel name (COALESCE'd to "Outros" when null) */
  origin: string;
  clients: number;
  /** @nullable */
  avgDaysToPayment?: number | null;
  /** @nullable */
  avgDaysToTrip?: number | null;
  /** Percentage of clients in this channel who made a payment */
  conversionRate: number;
}

/**
 * Sales cycle metrics for a single salesperson (seller_id on reservations). Only sellers with ≥ 3 clients in the period are included, sorted by shortest avgDaysToPayment (NULLS LAST).
 */
export interface SalesCycleSellerBreakdown {
  sellerId: string;
  sellerName: string;
  /** Number of clients assigned to this seller in the period */
  clients: number;
  /**
   * Mean days from client registration to first payment; null when no client has paid
   * @nullable
   */
  avgDaysToPayment?: number | null;
  /** Percentage of assigned clients who made at least one payment */
  conversionRate: number;
}

export interface SalesCycleTrendPoint {
  /** ISO month label: YYYY-MM */
  month: string;
  /** @nullable */
  avgDaysToPayment?: number | null;
  /** @nullable */
  avgDaysToTrip?: number | null;
}

export interface SalesCycleData {
  /**
   * Mean days from client registration to first payment
   * @nullable
   */
  avgDaysToPayment?: number | null;
  /** @nullable */
  medianDaysToPayment?: number | null;
  /** @nullable */
  p25DaysToPayment?: number | null;
  /** @nullable */
  p75DaysToPayment?: number | null;
  /**
   * Mean days from client registration to first confirmed trip departure
   * @nullable
   */
  avgDaysToTrip?: number | null;
  /** @nullable */
  medianDaysToTrip?: number | null;
  /** Number of clients registered in the selected period */
  totalClients: number;
  /** Subset of totalClients who made at least one payment */
  clientsWithPayment: number;
  byChannel: SalesCycleChannelBreakdown[];
  /** Breakdown by assigned salesperson; only sellers with ≥ 3 clients, sorted by shortest cycle */
  bySeller: SalesCycleSellerBreakdown[];
  /** Last 12 months, gap-filled with null for months with no data */
  trend: SalesCycleTrendPoint[];
}

export type ListAdminInvoicesParams = {
  tenantId?: string;
  status?: string;
};

export type ListAdminUsersParams = {
  tenantId?: string;
  role?: string;
};

export type UpdatePlatformSettingBody = {
  /** @nullable */
  value: string | null;
};

export type ListAdminAuditLogsParams = {
  tenantId?: string;
  action?: string;
  entityType?: string;
};

export type GetDashboardRevenueChartParams = {
  period?: GetDashboardRevenueChartPeriod;
};

export type GetDashboardRevenueChartPeriod =
  (typeof GetDashboardRevenueChartPeriod)[keyof typeof GetDashboardRevenueChartPeriod];

export const GetDashboardRevenueChartPeriod = {
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
  "12m": "12m",
} as const;

export type GetDashboardChartsParams = {
  /**
   * Time period for monthly series (default: 12m)
   */
  period?: GetDashboardChartsPeriod;
};

export type GetDashboardChartsPeriod =
  (typeof GetDashboardChartsPeriod)[keyof typeof GetDashboardChartsPeriod];

export const GetDashboardChartsPeriod = {
  "3m": "3m",
  "6m": "6m",
  "12m": "12m",
} as const;

export type GetSalesCycleParams = {
  /**
   * Lookback window for clients included in the analysis
   */
  period?: GetSalesCyclePeriod;
  /**
 * Optional acquisition channel (client origin) to scope the trend
series. When omitted the trend covers all channels. The overall
aggregates and byChannel breakdown are always unfiltered.

 */
  channel?: string;
  /**
 * Optional seller identifier to scope the trend series. When omitted
the trend covers all sellers. The overall aggregates and breakdowns
are always unfiltered.

 */
  seller?: string;
};

export type GetSalesCyclePeriod =
  (typeof GetSalesCyclePeriod)[keyof typeof GetSalesCyclePeriod];

export const GetSalesCyclePeriod = {
  "30d": "30d",
  "90d": "90d",
  "12m": "12m",
} as const;

export type ListClientsParams = {
  /**
   * @nullable
   */
  search?: string | null;
  /**
   * @nullable
   */
  cpf?: string | null;
  /**
   * @nullable
   */
  status?: string | null;
  /**
   * @nullable
   */
  pipelineStage?: string | null;
  /**
   * @nullable
   */
  classification?: string | null;
  /**
   * @nullable
   */
  city?: string | null;
  /**
   * @nullable
   */
  tripId?: string | null;
  /**
   * @nullable
   */
  sellerId?: string | null;
  /**
   * @nullable
   */
  origin?: string | null;
  /**
   * @nullable
   */
  dateFrom?: string | null;
  /**
   * @nullable
   */
  dateTo?: string | null;
  /**
   * @nullable
   */
  hasAutoRetry?: boolean | null;
  /**
   * @nullable
   */
  sortBy?: string | null;
  /**
   * @nullable
   */
  sortOrder?: string | null;
  page?: number;
  limit?: number;
};

export type UpdateClientPipelineStageBody = {
  stage: string;
};

export type GenerateClientReferralCode200 = {
  code: string;
};

export type ListTripsParams = {
  /**
   * @nullable
   */
  search?: string | null;
  /**
   * @nullable
   */
  status?: string | null;
  page?: number;
  limit?: number;
};

export type SyncTripPassengers200 = {
  /** Number of passenger records created */
  created: number;
};

export type GetReservationStatsParams = {
  /**
   * @nullable
   */
  search?: string | null;
  /**
   * @nullable
   */
  tripId?: string | null;
  /**
   * @nullable
   */
  status?: string | null;
  /**
   * @nullable
   */
  sellerId?: string | null;
  /**
   * @nullable
   */
  dateFrom?: string | null;
  /**
   * @nullable
   */
  dateTo?: string | null;
  /**
   * @nullable
   */
  hasAutoRetry?: boolean | null;
};

export type ListReservationsParams = {
  /**
   * @nullable
   */
  search?: string | null;
  /**
   * @nullable
   */
  tripId?: string | null;
  /**
   * @nullable
   */
  clientId?: string | null;
  /**
   * @nullable
   */
  status?: string | null;
  /**
   * @nullable
   */
  createdById?: string | null;
  /**
   * @nullable
   */
  sellerId?: string | null;
  /**
   * @nullable
   */
  dateFrom?: string | null;
  /**
   * @nullable
   */
  dateTo?: string | null;
  /**
   * @nullable
   */
  departureDateFrom?: string | null;
  /**
   * @nullable
   */
  departureDateTo?: string | null;
  /**
   * @nullable
   */
  commissionSyncStatus?: string | null;
  /**
   * @nullable
   */
  hasAutoRetry?: boolean | null;
  page?: number;
  limit?: number;
};

export type RetryCommissionSync200 = {
  success: boolean;
};

export type ListPaymentsParams = {
  /**
   * @nullable
   */
  reservationId?: string | null;
  /**
   * @nullable
   */
  clientId?: string | null;
  /**
   * @nullable
   */
  status?: string | null;
  /**
   * @nullable
   */
  type?: string | null;
  /**
   * @nullable
   */
  dateFrom?: string | null;
  /**
   * @nullable
   */
  dateTo?: string | null;
  page?: number;
  limit?: number;
};

export type DeletePayment200 = {
  success: boolean;
};

export type ListExpensesParams = {
  /**
   * @nullable
   */
  tripId?: string | null;
  /**
   * @nullable
   */
  status?: string | null;
  page?: number;
  limit?: number;
};

export type ListDealsParams = {
  /**
   * @nullable
   */
  stageId?: string | null;
  /**
   * @nullable
   */
  status?: string | null;
  /**
   * @nullable
   */
  ownerId?: string | null;
};

export type MoveDealBody = {
  stageId: string;
};

export type ListMessagesParams = {
  /**
   * @nullable
   */
  clientId?: string | null;
  /**
   * @nullable
   */
  channel?: string | null;
  page?: number;
  limit?: number;
};

export type ListOutboundMessagesParams = {
  status?: string;
  channel?: ListOutboundMessagesChannel;
  /**
   * Filter messages that have a delivery with this status
   */
  deliveryStatus?: ListOutboundMessagesDeliveryStatus;
  /**
   * Filter messages that have a delivery handled by this provider
   */
  provider?: string;
  /**
   * Filter messages by the validated Resend bounce classification
   */
  bounceType?: ListOutboundMessagesBounceType;
  clientId?: string;
  origin?: string;
  eventType?: string;
  campaignId?: string;
  automationId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
};

export type ListOutboundMessagesChannel =
  (typeof ListOutboundMessagesChannel)[keyof typeof ListOutboundMessagesChannel];

export const ListOutboundMessagesChannel = {
  email: "email",
  whatsapp: "whatsapp",
} as const;

export type ListOutboundMessagesDeliveryStatus =
  (typeof ListOutboundMessagesDeliveryStatus)[keyof typeof ListOutboundMessagesDeliveryStatus];

export const ListOutboundMessagesDeliveryStatus = {
  pending: "pending",
  processing: "processing",
  accepted: "accepted",
  failed: "failed",
  skipped: "skipped",
} as const;

export type ListOutboundMessagesBounceType =
  (typeof ListOutboundMessagesBounceType)[keyof typeof ListOutboundMessagesBounceType];

export const ListOutboundMessagesBounceType = {
  permanent: "permanent",
  temporary: "temporary",
} as const;

export type ListOutboundProviderFailureSummaryParams = {
  status?: string;
  channel?: ListOutboundProviderFailureSummaryChannel;
  /**
   * Keep only messages that have a delivery with this status
   */
  deliveryStatus?: ListOutboundProviderFailureSummaryDeliveryStatus;
  /**
   * Keep only deliveries handled by this provider
   */
  provider?: string;
  /**
   * Keep only deliveries with this validated Resend bounce classification
   */
  bounceType?: ListOutboundProviderFailureSummaryBounceType;
  clientId?: string;
  origin?: string;
  eventType?: string;
  campaignId?: string;
  automationId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type ListOutboundProviderFailureSummaryChannel =
  (typeof ListOutboundProviderFailureSummaryChannel)[keyof typeof ListOutboundProviderFailureSummaryChannel];

export const ListOutboundProviderFailureSummaryChannel = {
  email: "email",
  whatsapp: "whatsapp",
} as const;

export type ListOutboundProviderFailureSummaryDeliveryStatus =
  (typeof ListOutboundProviderFailureSummaryDeliveryStatus)[keyof typeof ListOutboundProviderFailureSummaryDeliveryStatus];

export const ListOutboundProviderFailureSummaryDeliveryStatus = {
  pending: "pending",
  processing: "processing",
  accepted: "accepted",
  failed: "failed",
  skipped: "skipped",
} as const;

export type ListOutboundProviderFailureSummaryBounceType =
  (typeof ListOutboundProviderFailureSummaryBounceType)[keyof typeof ListOutboundProviderFailureSummaryBounceType];

export const ListOutboundProviderFailureSummaryBounceType = {
  permanent: "permanent",
  temporary: "temporary",
} as const;

export type ExportOutboundMessagesParams = {
  format: ExportOutboundMessagesFormat;
  status?: string;
  channel?: ExportOutboundMessagesChannel;
  /**
   * Filter exported rows by delivery status
   */
  deliveryStatus?: ExportOutboundMessagesDeliveryStatus;
  /**
   * Filter exported rows by provider
   */
  provider?: string;
  /**
   * Filter exported rows by the validated Resend bounce classification
   */
  bounceType?: ExportOutboundMessagesBounceType;
  clientId?: string;
  origin?: string;
  eventType?: string;
  campaignId?: string;
  automationId?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type ExportOutboundMessagesFormat =
  (typeof ExportOutboundMessagesFormat)[keyof typeof ExportOutboundMessagesFormat];

export const ExportOutboundMessagesFormat = {
  csv: "csv",
  pdf: "pdf",
} as const;

export type ExportOutboundMessagesChannel =
  (typeof ExportOutboundMessagesChannel)[keyof typeof ExportOutboundMessagesChannel];

export const ExportOutboundMessagesChannel = {
  email: "email",
  whatsapp: "whatsapp",
} as const;

export type ExportOutboundMessagesDeliveryStatus =
  (typeof ExportOutboundMessagesDeliveryStatus)[keyof typeof ExportOutboundMessagesDeliveryStatus];

export const ExportOutboundMessagesDeliveryStatus = {
  pending: "pending",
  processing: "processing",
  accepted: "accepted",
  failed: "failed",
  skipped: "skipped",
} as const;

export type ExportOutboundMessagesBounceType =
  (typeof ExportOutboundMessagesBounceType)[keyof typeof ExportOutboundMessagesBounceType];

export const ExportOutboundMessagesBounceType = {
  permanent: "permanent",
  temporary: "temporary",
} as const;

export type ListProductsParams = {
  /**
   * @nullable
   */
  search?: string | null;
  /**
   * @nullable
   */
  active?: boolean | null;
};

export type ListOrdersParams = {
  /**
   * @nullable
   */
  status?: string | null;
  page?: number;
  limit?: number;
};

export type ListNpsResponsesParams = {
  /**
   * @nullable
   */
  classification?: string | null;
  /**
   * @nullable
   */
  tripId?: string | null;
  page?: number;
  limit?: number;
};

export type SendNpsSurveyBody = {
  tripId: string;
  clientIds?: string[];
};

export type SendNpsSurvey200 = {
  links: NpsSendLink[];
};

export type GetNpsSummaryParams = {
  /**
   * @nullable
   */
  tripId?: string | null;
  /**
   * @nullable
   */
  dateFrom?: string | null;
  /**
   * @nullable
   */
  dateTo?: string | null;
};

export type CalculateCommissionParams = {
  sellerId: string;
  saleAmount: number;
  tripId?: string;
};

export type ListSalesGoalsParams = {
  userId?: string;
  month?: string;
};

export type GetPublicReferralInfoParams = {
  code: string;
};

export type GetPublicReferralInfo200 = {
  code: string;
  referrerName: string;
  discountPercent: number;
  discountType: string;
};

export type ValidatePublicReferralCodeBody = {
  code: string;
  /** Optional customer email for self-referral prevention check */
  customerEmail?: string;
};

export type ValidatePublicReferralCode200 = {
  valid: boolean;
  code?: string;
  referrerName?: string;
  discountPercent?: number;
  discountType?: string;
  description?: string;
};

export type TrackPublicReferralVisitBody = {
  code: string;
  /** Previously server-issued tracking cookie ID for return visit recognition */
  serverCookieId?: string;
  landingPage?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
};

export type TrackPublicReferralVisit200 = {
  cookieId: string;
  tracked: boolean;
};

export type ListReferralsParams = {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
};

export type ListReferrals200Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ListReferrals200 = {
  data: Referral[];
  pagination: ListReferrals200Pagination;
};

export type GetBirthdayUpcomingParams = {
  /**
   * Number of days to look ahead (default 7, max 60)
   */
  days?: number;
};

export type GetBirthdayHistoryParams = {
  limit?: number;
  year?: number;
};

export type MarkBirthdayConvertedBody = {
  couponCode: string;
};

export type MarkBirthdayConverted200 = {
  success: boolean;
};

export type ListCalendarReconciliationsParams = {
  status?: ListCalendarReconciliationsStatus;
};

export type ListCalendarReconciliationsStatus =
  (typeof ListCalendarReconciliationsStatus)[keyof typeof ListCalendarReconciliationsStatus];

export const ListCalendarReconciliationsStatus = {
  pending: "pending",
  associated: "associated",
  removed: "removed",
  dismissed: "dismissed",
} as const;

export type GetCalendarCallbackParams = {
  /**
   * Authorization code from Google
   */
  code?: string;
  /**
   * HMAC-signed state blob (base64url JSON); absent when error is present
   */
  state?: string;
  /**
   * Present when the user denied access
   */
  error?: string;
};

export type GetInsightsSummaryParams = {
  period?: GetInsightsSummaryPeriod;
};

export type GetInsightsSummaryPeriod =
  (typeof GetInsightsSummaryPeriod)[keyof typeof GetInsightsSummaryPeriod];

export const GetInsightsSummaryPeriod = {
  month: "month",
  quarter: "quarter",
  year: "year",
} as const;

export type ResendExpiryWarningParams = {
  window: ResendExpiryWarningWindow;
};

export type ResendExpiryWarningWindow =
  (typeof ResendExpiryWarningWindow)[keyof typeof ResendExpiryWarningWindow];

export const ResendExpiryWarningWindow = {
  NUMBER_1: 1,
  NUMBER_7: 7,
} as const;
