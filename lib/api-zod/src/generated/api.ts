od.string(),
  sellerName: zod.string().nullish(),
});

/**
 * @summary Get public referral info by code
 */
export const GetPublicReferralInfoParams = zod.object({
  slug: zod.coerce.string(),
});

export const GetPublicReferralInfoQueryParams = zod.object({
  code: zod.coerce.string(),
});

export const GetPublicReferralInfoResponse = zod.object({
  code: zod.string(),
  referrerName: zod.string(),
  discountPercent: zod.number(),
  discountType: zod.string(),
});

/**
 * @summary Validate a referral code at checkout
 */
export const ValidatePublicReferralCodeParams = zod.object({
  slug: zod.coerce.string(),
});

export const ValidatePublicReferralCodeBody = zod.object({
  code: zod.string(),
  customerEmail: zod
    .string()
    .optional()
    .describe("Optional customer email for self-referral prevention check"),
});

export const ValidatePublicReferralCodeResponse = zod.object({
  valid: zod.boolean(),
  code: zod.string().optional(),
  referrerName: zod.string().optional(),
  discountPercent: zod.number().optional(),
  discountType: zod.string().optional(),
  description: zod.string().optional(),
});

/**
 * @summary Track a referral landing page visit
 */
export const TrackPublicReferralVisitParams = zod.object({
  slug: zod.coerce.string(),
});

export const TrackPublicReferralVisitBody = zod.object({
  code: zod.string(),
  serverCookieId: zod
    .string()
    .optional()
    .describe(
      "Previously server-issued tracking cookie ID for return visit recognition",
    ),
  landingPage: zod.string().optional(),
  utmSource: zod.string().optional(),
  utmMedium: zod.string().optional(),
  utmCampaign: zod.string().optional(),
});

export const TrackPublicReferralVisitResponse = zod.object({
  cookieId: zod.string(),
  tracked: zod.boolean(),
});

/**
 * @summary List referrals with pagination and filters
 */
export const listReferralsQueryPageDefault = 1;
export const listReferralsQueryLimitDefault = 20;

export const ListReferralsQueryParams = zod.object({
  page: zod.coerce.number().int().default(listReferralsQueryPageDefault),
  limit: zod.coerce.number().int().default(listReferralsQueryLimitDefault),
  status: zod.coerce.string().optional(),
  search: zod.coerce.string().optional(),
});

export const ListReferralsResponse = zod.object({
  data: zod.array(
    zod.object({
      id: zod.string(),
      tenantId: zod.string(),
      referrerId: zod.string(),
      referredId: zod.string().nullish(),
      referredEmail: zod.string().nullish(),
      referredName: zod.string().nullish(),
      referredPhone: zod.string().nullish(),
      referrerName: zod.string().nullish(),
      referrerEmail: zod.string().nullish(),
      referrerPhone: zod.string().nullish(),
      code: zod.string(),
      status: zod.string(),
      bonusAmount: zod.string(),
      bonusPaid: zod.boolean(),
      bonusPaidAt: zod.string().nullish(),
      discountType: zod.string(),
      discountValue: zod.string(),
      discountApplied: zod.boolean(),
      discountAmount: zod.string().nullish(),
      cookieId: zod.string().nullish(),
      ipAddress: zod.string().nullish(),
      utmSource: zod.string().nullish(),
      utmMedium: zod.string().nullish(),
      utmCampaign: zod.string().nullish(),
      visitsCount: zod.number().int(),
      firstVisit: zod.string().nullish(),
      lastVisit: zod.string().nullish(),
      expiresAt: zod.string().nullish(),
      isActive: zod.boolean(),
      reservationId: zod.string().nullish(),
      notes: zod.string().nullish(),
      convertedAt: zod.string().nullish(),
      createdAt: zod.string(),
      updatedAt: zod.string(),
      fraudFlag: zod.boolean().nullish(),
      fraudReason: zod.string().nullish(),
      expiryWarning7SentAt: zod.string().nullish(),
      expiryWarning1SentAt: zod.string().nullish(),
      bonusReleaseNotifiedAt: zod.string().nullish(),
    }),
  ),
  pagination: zod.object({
    page: zod.number().int(),
    limit: zod.number().int(),
    total: zod.number().int(),
    totalPages: zod.number().int(),
  }),
});

/**
 * @summary Create a referral
 */
export const CreateReferralBody = zod.object({
  referrerId: zod.string(),
  referredId: zod.string().optional(),
  referredEmail: zod.string().email().optional(),
  code: zod.string(),
  bonusAmount: zod.string().optional(),
});

export const CreateReferralResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  referrerId: zod.string(),
  referredId: zod.string().nullish(),
  referredEmail: zod.string().nullish(),
  referredName: zod.string().nullish(),
  referredPhone: zod.string().nullish(),
  referrerName: zod.string().nullish(),
  referrerEmail: zod.string().nullish(),
  referrerPhone: zod.string().nullish(),
  code: zod.string(),
  status: zod.string(),
  bonusAmount: zod.string(),
  bonusPaid: zod.boolean(),
  bonusPaidAt: zod.string().nullish(),
  discountType: zod.string(),
  discountValue: zod.string(),
  discountApplied: zod.boolean(),
  discountAmount: zod.string().nullish(),
  cookieId: zod.string().nullish(),
  ipAddress: zod.string().nullish(),
  utmSource: zod.string().nullish(),
  utmMedium: zod.string().nullish(),
  utmCampaign: zod.string().nullish(),
  visitsCount: zod.number().int(),
  firstVisit: zod.string().nullish(),
  lastVisit: zod.string().nullish(),
  expiresAt: zod.string().nullish(),
  isActive: zod.boolean(),
  reservationId: zod.string().nullish(),
  notes: zod.string().nullish(),
  convertedAt: zod.string().nullish(),
  createdAt: zod.string(),
  updatedAt: zod.string(),
  fraudFlag: zod.boolean().nullish(),
  fraudReason: zod.string().nullish(),
  expiryWarning7SentAt: zod.string().nullish(),
  expiryWarning1SentAt: zod.string().nullish(),
  bonusReleaseNotifiedAt: zod.string().nullish(),
});

/**
 * @summary Get referral statistics for the tenant
 */
export const GetReferralStatsResponse = zod.object({
  total: zod.number().int(),
  pending: zod.number().int(),
  completed: zod.number().int(),
  expired: zod.number().int(),
  conversionRate: zod.number().int(),
  totalBonusPaid: zod.number(),
  totalDiscountGiven: zod.number(),
});

/**
 * @summary Validate a referral code for discount
 */
export const ValidateReferralCodeParams = zod.object({
  code: zod.coerce.string(),
});

export const ValidateReferralCodeResponse = zod.object({
  valid: zod.boolean(),
  referralId: zod.string().optional(),
  bonusAmount: zod.number(),
  message: zod.string().nullish(),
});

/**
 * @summary Update referral status
 */
export const UpdateReferralParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateReferralBody = zod.object({
  status: zod.string().optional(),
  bonusPaid: zod.boolean().optional(),
  convertedAt: zod.string().optional(),
  isActive: zod.boolean().optional(),
  notes: zod.string().optional(),
});

export const UpdateReferralResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  referrerId: zod.string(),
  referredId: zod.string().nullish(),
  referredEmail: zod.string().nullish(),
  referredName: zod.string().nullish(),
  referredPhone: zod.string().nullish(),
  referrerName: zod.string().nullish(),
  referrerEmail: zod.string().nullish(),
  referrerPhone: zod.string().nullish(),
  code: zod.string(),
  status: zod.string(),
  bonusAmount: zod.string(),
  bonusPaid: zod.boolean(),
  bonusPaidAt: zod.string().nullish(),
  discountType: zod.string(),
  discountValue: zod.string(),
  discountApplied: zod.boolean(),
  discountAmount: zod.string().nullish(),
  cookieId: zod.string().nullish(),
  ipAddress: zod.string().nullish(),
  utmSource: zod.string().nullish(),
  utmMedium: zod.string().nullish(),
  utmCampaign: zod.string().nullish(),
  visitsCount: zod.number().int(),
  firstVisit: zod.string().nullish(),
  lastVisit: zod.string().nullish(),
  expiresAt: zod.string().nullish(),
  isActive: zod.boolean(),
  reservationId: zod.string().nullish(),
  notes: zod.string().nullish(),
  convertedAt: zod.string().nullish(),
  createdAt: zod.string(),
  updatedAt: zod.string(),
  fraudFlag: zod.boolean().nullish(),
  fraudReason: zod.string().nullish(),
  expiryWarning7SentAt: zod.string().nullish(),
  expiryWarning1SentAt: zod.string().nullish(),
  bonusReleaseNotifiedAt: zod.string().nullish(),
});

/**
 * @summary List coupons
 */
export const ListCouponsResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  code: zod.string(),
  type: zod.string(),
  value: zod.string(),
  minOrderValue: zod.string().nullish(),
  maxUses: zod.number().int().nullish(),
  usedCount: zod.number().int(),
  isActive: zod.boolean(),
  validFrom: zod.string().nullish(),
  validUntil: zod.string().nullish(),
  createdAt: zod.string(),
});
export const ListCouponsResponse = zod.array(ListCouponsResponseItem);

/**
 * @summary Create a coupon
 */
export const CreateCouponBody = zod.object({
  code: zod.string(),
  type: zod.enum(["percentage", "fixed"]).optional(),
  value: zod.string(),
  minOrderValue: zod.string().optional(),
  maxUses: zod.number().int().optional(),
  isActive: zod.boolean().optional(),
  validFrom: zod.string().optional(),
  validUntil: zod.string().optional(),
});

export const CreateCouponResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  code: zod.string(),
  type: zod.string(),
  value: zod.string(),
  minOrderValue: zod.string().nullish(),
  maxUses: zod.number().int().nullish(),
  usedCount: zod.number().int(),
  isActive: zod.boolean(),
  validFrom: zod.string().nullish(),
  validUntil: zod.string().nullish(),
  createdAt: zod.string(),
});

/**
 * @summary Update a coupon
 */
export const UpdateCouponParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateCouponBody = zod.object({
  code: zod.string(),
  type: zod.enum(["percentage", "fixed"]).optional(),
  value: zod.string(),
  minOrderValue: zod.string().optional(),
  maxUses: zod.number().int().optional(),
  isActive: zod.boolean().optional(),
  validFrom: zod.string().optional(),
  validUntil: zod.string().optional(),
});

export const UpdateCouponResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  code: zod.string(),
  type: zod.string(),
  value: zod.string(),
  minOrderValue: zod.string().nullish(),
  maxUses: zod.number().int().nullish(),
  usedCount: zod.number().int(),
  isActive: zod.boolean(),
  validFrom: zod.string().nullish(),
  validUntil: zod.string().nullish(),
  createdAt: zod.string(),
});

/**
 * @summary Delete a coupon
 */
export const DeleteCouponParams = zod.object({
  id: zod.coerce.string(),
});

export const DeleteCouponResponse = zod.void();

/**
 * @summary Get today's birthday clients
 */
export const GetBirthdayTodayResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  name: zod.string(),
  email: zod.string(),
  whatsapp: zod.string(),
  birthDate: zod.string().nullish(),
  whatsappOptIn: zod.boolean().optional(),
  emailOptIn: zod.boolean().optional(),
  daysUntil: zod.number().int().nullish(),
  birthdayMessage: zod
    .union([
      zod.object({
        id: zod.string(),
        tenantId: zod.string(),
        clientId: zod.string(),
        birthdayYear: zod.number().int(),
        sentWhatsapp: zod.boolean(),
        sentEmail: zod.boolean(),
        whatsappSentAt: zod.string().nullish(),
        emailSentAt: zod.string().nullish(),
        whatsappError: zod.string().nullish(),
        emailError: zod.string().nullish(),
        couponId: zod.string().nullish(),
        couponCode: zod.string().nullish(),
        emailOpened: zod.boolean(),
        emailOpenedAt: zod.string().nullish(),
        converted: zod.boolean(),
        isManual: zod.boolean(),
        sentById: zod.string().nullish(),
        createdAt: zod.string(),
      }),
      zod.null(),
    ])
    .optional(),
});
export const GetBirthdayTodayResponse = zod.array(GetBirthdayTodayResponseItem);

/**
 * @summary Get upcoming birthday clients
 */
export const GetBirthdayUpcomingQueryParams = zod.object({
  days: zod.coerce
    .number()
    .int()
    .optional()
    .describe("Number of days to look ahead (default 7, max 60)"),
});

export const GetBirthdayUpcomingResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  name: zod.string(),
  email: zod.string(),
  whatsapp: zod.string(),
  birthDate: zod.string().nullish(),
  whatsappOptIn: zod.boolean().optional(),
  emailOptIn: zod.boolean().optional(),
  daysUntil: zod.number().int().nullish(),
  birthdayMessage: zod
    .union([
      zod.object({
        id: zod.string(),
        tenantId: zod.string(),
        clientId: zod.string(),
        birthdayYear: zod.number().int(),
        sentWhatsapp: zod.boolean(),
        sentEmail: zod.boolean(),
        whatsappSentAt: zod.string().nullish(),
        emailSentAt: zod.string().nullish(),
        whatsappError: zod.string().nullish(),
        emailError: zod.string().nullish(),
        couponId: zod.string().nullish(),
        couponCode: zod.string().nullish(),
        emailOpened: zod.boolean(),
        emailOpenedAt: zod.string().nullish(),
        converted: zod.boolean(),
        isManual: zod.boolean(),
        sentById: zod.string().nullish(),
        createdAt: zod.string(),
      }),
      zod.null(),
    ])
    .optional(),
});
export const GetBirthdayUpcomingResponse = zod.array(
  GetBirthdayUpcomingResponseItem,
);

/**
 * @summary Get birthday message history
 */
export const GetBirthdayHistoryQueryParams = zod.object({
  limit: zod.coerce.number().int().optional(),
  year: zod.coerce.number().int().optional(),
});

export const GetBirthdayHistoryResponseItem = zod
  .object({
    id: zod.string(),
    tenantId: zod.string(),
    clientId: zod.string(),
    birthdayYear: zod.number().int(),
    sentWhatsapp: zod.boolean(),
    sentEmail: zod.boolean(),
    whatsappSentAt: zod.string().nullish(),
    emailSentAt: zod.string().nullish(),
    whatsappError: zod.string().nullish(),
    emailError: zod.string().nullish(),
    couponId: zod.string().nullish(),
    couponCode: zod.string().nullish(),
    emailOpened: zod.boolean(),
    emailOpenedAt: zod.string().nullish(),
    converted: zod.boolean(),
    isManual: zod.boolean(),
    sentById: zod.string().nullish(),
    createdAt: zod.string(),
  })
  .and(
    zod.object({
      client: zod
        .union([
          zod.object({
            id: zod.string(),
            tenantId: zod.string(),
            name: zod.string(),
            email: zod.string(),
            whatsapp: zod.string(),
            birthDate: zod.string().nullish(),
            whatsappOptIn: zod.boolean().optional(),
            emailOptIn: zod.boolean().optional(),
            daysUntil: zod.number().int().nullish(),
            birthdayMessage: zod
              .union([
                zod.object({
                  id: zod.string(),
                  tenantId: zod.string(),
                  clientId: zod.string(),
                  birthdayYear: zod.number().int(),
                  sentWhatsapp: zod.boolean(),
                  sentEmail: zod.boolean(),
                  whatsappSentAt: zod.string().nullish(),
                  emailSentAt: zod.string().nullish(),
                  whatsappError: zod.string().nullish(),
                  emailError: zod.string().nullish(),
                  couponId: zod.string().nullish(),
                  couponCode: zod.string().nullish(),
                  emailOpened: zod.boolean(),
                  emailOpenedAt: zod.string().nullish(),
                  converted: zod.boolean(),
                  isManual: zod.boolean(),
                  sentById: zod.string().nullish(),
                  createdAt: zod.string(),
                }),
                zod.null(),
              ])
              .optional(),
          }),
          zod.null(),
        ])
        .optional(),
    }),
  );
export const GetBirthdayHistoryResponse = zod.array(
  GetBirthdayHistoryResponseItem,
);

/**
 * @summary Get birthday message statistics
 */
export const GetBirthdayStatsResponse = zod.object({
  totalSentYear: zod.number().int(),
  sentThisMonth: zod.number().int(),
  whatsappSent: zod.number().int(),
  emailSent: zod.number().int(),
  emailOpened: zod.number().int(),
  converted: zod.number().int(),
  conversionRate: zod.number().int(),
  todayCount: zod.number().int(),
  upcomingWeek: zod.number().int(),
  revenueGenerated: zod.number(),
});

/**
 * @summary Manually send birthday message to a client
 */
export const SendBirthdayMessageParams = zod.object({
  clientId: zod.coerce.string(),
});

export const SendBirthdayMessageResponse = zod.object({
  success: zod.boolean(),
  couponCode: zod.string().nullish(),
  error: zod.string().nullish(),
});

/**
 * @summary Mark a birthday coupon as converted (redeemed)
 */
export const MarkBirthdayConvertedBody = zod.object({
  couponCode: zod.string(),
});

export const MarkBirthdayConvertedResponse = zod.object({
  success: zod.boolean(),
});

/**
 * @summary Get birthday message settings
 */
export const GetBirthdaySettingsResponse = zod.object({
  enabled: zod.boolean(),
  discountPercent: zod.number().int(),
  validDays: zod.number().int(),
  sendWhatsapp: zod.boolean(),
  sendEmail: zod.boolean(),
  whatsappMessage: zod.string().nullish(),
  emailSubject: zod.string().nullish(),
  emailMessage: zod.string().nullish(),
  senderName: zod.string().nullish(),
});

/**
 * @summary Update birthday message settings
 */
export const UpdateBirthdaySettingsBody = zod.object({
  enabled: zod.boolean(),
  discountPercent: zod.number().int(),
  validDays: zod.number().int(),
  sendWhatsapp: zod.boolean(),
  sendEmail: zod.boolean(),
  whatsappMessage: zod.string().nullish(),
  emailSubject: zod.string().nullish(),
  emailMessage: zod.string().nullish(),
  senderName: zod.string().nullish(),
});

export const UpdateBirthdaySettingsResponse = zod.object({
  enabled: zod.boolean(),
  discountPercent: zod.number().int(),
  validDays: zod.number().int(),
  sendWhatsapp: zod.boolean(),
  sendEmail: zod.boolean(),
  whatsappMessage: zod.string().nullish(),
  emailSubject: zod.string().nullish(),
  emailMessage: zod.string().nullish(),
  senderName: zod.string().nullish(),
});

/**
 * @summary List documents
 */
export const ListDocumentsResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  name: zod.string(),
  type: zod.string(),
  url: zod.string(),
  mimeType: zod.string().nullish(),
  sizeBytes: zod.number().int().nullish(),
  entityType: zod.string().nullish(),
  entityId: zod.string().nullish(),
  uploadedById: zod.string(),
  createdAt: zod.string(),
});
export const ListDocumentsResponse = zod.array(ListDocumentsResponseItem);

/**
 * @summary Upload/register a document
 */
export const CreateDocumentBody = zod.object({
  name: zod.string(),
  type: zod.string(),
  url: zod.string().url(),
  mimeType: zod.string().optional(),
  sizeBytes: zod.number().int().optional(),
  entityType: zod.string().optional(),
  entityId: zod.string().optional(),
});

export const CreateDocumentResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  name: zod.string(),
  type: zod.string(),
  url: zod.string(),
  mimeType: zod.string().nullish(),
  sizeBytes: zod.number().int().nullish(),
  entityType: zod.string().nullish(),
  entityId: zod.string().nullish(),
  uploadedById: zod.string(),
  createdAt: zod.string(),
});

/**
 * @summary Delete a document
 */
export const DeleteDocumentParams = zod.object({
  id: zod.coerce.string(),
});

export const DeleteDocumentResponse = zod.void();

/**
 * @summary List loyalty programs
 */
export const ListLoyaltyProgramsResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  name: zod.string(),
  description: zod.string().nullish(),
  pointsPerReal: zod.string(),
  realPerPoint: zod.string(),
  minRedeemPoints: zod.number().int(),
  isActive: zod.boolean(),
  tierBenefits: zod.record(zod.string(), zod.array(zod.string())).optional(),
  createdAt: zod.string(),
});
export const ListLoyaltyProgramsResponse = zod.array(
  ListLoyaltyProgramsResponseItem,
);

/**
 * @summary Create a loyalty program
 */
export const CreateLoyaltyProgramBody = zod.object({
  name: zod.string().nullish(),
  description: zod.string().optional(),
  pointsPerReal: zod.string().optional(),
  realPerPoint: zod.string().optional(),
  minRedeemPoints: zod.number().int().optional(),
  tierBenefits: zod.record(zod.string(), zod.array(zod.string())).optional(),
});

export const CreateLoyaltyProgramResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  name: zod.string(),
  description: zod.string().nullish(),
  pointsPerReal: zod.string(),
  realPerPoint: zod.string(),
  minRedeemPoints: zod.number().int(),
  isActive: zod.boolean(),
  tierBenefits: zod.record(zod.string(), zod.array(zod.string())).optional(),
  createdAt: zod.string(),
});

/**
 * @summary Update a loyalty program
 */
export const UpdateLoyaltyProgramParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateLoyaltyProgramBody = zod.object({
  name: zod.string().nullish(),
  description: zod.string().optional(),
  pointsPerReal: zod.string().optional(),
  realPerPoint: zod.string().optional(),
  minRedeemPoints: zod.number().int().optional(),
  tierBenefits: zod.record(zod.string(), zod.array(zod.string())).optional(),
});

export const UpdateLoyaltyProgramResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  name: zod.string(),
  description: zod.string().nullish(),
  pointsPerReal: zod.string(),
  realPerPoint: zod.string(),
  minRedeemPoints: zod.number().int(),
  isActive: zod.boolean(),
  tierBenefits: zod.record(zod.string(), zod.array(zod.string())).optional(),
  createdAt: zod.string(),
});

/**
 * @summary List loyalty members
 */
export const ListLoyaltyMembersResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  programId: zod.string(),
  clientId: zod.string(),
  totalPoints: zod.number().int(),
  availablePoints: zod.number().int(),
  tier: zod.string(),
  joinedAt: zod.string(),
});
export const ListLoyaltyMembersResponse = zod.array(
  ListLoyaltyMembersResponseItem,
);

/**
 * @summary Enroll a client in loyalty program
 */
export const CreateLoyaltyMemberBody = zod.object({
  programId: zod.string(),
  clientId: zod.string(),
  tier: zod.string().optional(),
});

export const CreateLoyaltyMemberResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  programId: zod.string(),
  clientId: zod.string(),
  totalPoints: zod.number().int(),
  availablePoints: zod.number().int(),
  tier: zod.string(),
  joinedAt: zod.string(),
});

/**
 * @summary List loyalty transactions
 */
export const ListLoyaltyTransactionsResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  memberId: zod.string(),
  programId: zod.string(),
  type: zod.string(),
  points: zod.number().int(),
  description: zod.string(),
  referenceId: zod.string().nullish(),
  referenceType: zod.string().nullish(),
  createdAt: zod.string(),
});
export const ListLoyaltyTransactionsResponse = zod.array(
  ListLoyaltyTransactionsResponseItem,
);

/**
 * @summary Create a loyalty transaction
 */
export const CreateLoyaltyTransactionBody = zod.object({
  memberId: zod.string(),
  programId: zod.string(),
  type: zod.enum(["earn", "redeem", "expire", "bonus"]),
  points: zod.number().int(),
  description: zod.string().optional(),
  referenceId: zod.string().optional(),
  referenceType: zod.string().optional(),
});

export const CreateLoyaltyTransactionResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  memberId: zod.string(),
  programId: zod.string(),
  type: zod.string(),
  points: zod.number().int(),
  description: zod.string(),
  referenceId: zod.string().nullish(),
  referenceType: zod.string().nullish(),
  createdAt: zod.string(),
});

/**
 * @summary Sync loyalty points from paid payments
 */
export const SyncLoyaltyPointsResponse = zod.object({
  membersUpdated: zod.number().int(),
  transactionsCreated: zod.number().int(),
});

/**
 * @summary List chatbot conversations
 */
export const ListChatbotConversationsResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  clientId: zod.string().nullish(),
  channel: zod.string(),
  status: zod.string(),
  assignedUserId: zod.string().nullish(),
  sessionId: zod.string().nullish(),
  startedAt: zod.string(),
  endedAt: zod.string().nullish(),
  createdAt: zod.string(),
});
export const ListChatbotConversationsResponse = zod.array(
  ListChatbotConversationsResponseItem,
);

/**
 * @summary Start a chatbot conversation
 */
export const CreateChatbotConversationBody = zod.object({
  clientId: zod.string().optional(),
  channel: zod.enum(["webchat", "whatsapp", "email"]).optional(),
  sessionId: zod.string().optional(),
});

export const CreateChatbotConversationResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  clientId: zod.string().nullish(),
  channel: zod.string(),
  status: zod.string(),
  assignedUserId: zod.string().nullish(),
  sessionId: zod.string().nullish(),
  startedAt: zod.string(),
  endedAt: zod.string().nullish(),
  createdAt: zod.string(),
});

/**
 * @summary Update a chatbot conversation
 */
export const UpdateChatbotConversationParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateChatbotConversationBody = zod.object({
  status: zod.string().optional(),
  assignedUserId: zod.string().optional(),
  endedAt: zod.string().optional(),
});

export const UpdateChatbotConversationResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  clientId: zod.string().nullish(),
  channel: zod.string(),
  status: zod.string(),
  assignedUserId: zod.string().nullish(),
  sessionId: zod.string().nullish(),
  startedAt: zod.string(),
  endedAt: zod.string().nullish(),
  createdAt: zod.string(),
});

/**
 * @summary List messages for a conversation
 */
export const ListChatbotMessagesParams = zod.object({
  id: zod.coerce.string(),
});

export const ListChatbotMessagesResponseItem = zod.object({
  id: zod.string(),
  conversationId: zod.string(),
  tenantId: zod.string(),
  role: zod.string(),
  content: zod.string(),
  mediaUrl: zod.string().nullish(),
  isBot: zod.boolean(),
  sentAt: zod.string(),
});
export const ListChatbotMessagesResponse = zod.array(
  ListChatbotMessagesResponseItem,
);

/**
 * @summary Send a chatbot message
 */
export const CreateChatbotMessageBody = zod.object({
  conversationId: zod.string(),
  role: zod.enum(["user", "assistant", "system"]).optional(),
  content: zod.string(),
  mediaUrl: zod.string().optional(),
  isBot: zod.boolean().optional(),
});

export const CreateChatbotMessageResponse = zod.object({
  id: zod.string(),
  conversationId: zod.string(),
  tenantId: zod.string(),
  role: zod.string(),
  content: zod.string(),
  mediaUrl: zod.string().nullish(),
  isBot: zod.boolean(),
  sentAt: zod.string(),
});

/**
 * @summary List product categories
 */
export const ListProductCategoriesResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  name: zod.string(),
  slug: zod.string(),
  description: zod.string().nullish(),
  parentId: zod.string().nullish(),
  imageUrl: zod.string().nullish(),
  isActive: zod.boolean(),
  sortOrder: zod.number().int(),
  createdAt: zod.string(),
});
export const ListProductCategoriesResponse = zod.array(
  ListProductCategoriesResponseItem,
);

/**
 * @summary Create a product category
 */
export const CreateProductCategoryBody = zod.object({
  name: zod.string(),
  slug: zod.string(),
  description: zod.string().optional(),
  parentId: zod.string().optional(),
  imageUrl: zod.string().optional(),
  isActive: zod.boolean().optional(),
  sortOrder: zod.number().int().optional(),
});

export const CreateProductCategoryResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  name: zod.string(),
  slug: zod.string(),
  description: zod.string().nullish(),
  parentId: zod.string().nullish(),
  imageUrl: zod.string().nullish(),
  isActive: zod.boolean(),
  sortOrder: zod.number().int(),
  createdAt: zod.string(),
});

/**
 * @summary Update a product category
 */
export const UpdateProductCategoryParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateProductCategoryBody = zod.object({
  name: zod.string(),
  slug: zod.string(),
  description: zod.string().optional(),
  parentId: zod.string().optional(),
  imageUrl: zod.string().optional(),
  isActive: zod.boolean().optional(),
  sortOrder: zod.number().int().optional(),
});

export const UpdateProductCategoryResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  name: zod.string(),
  slug: zod.string(),
  description: zod.string().nullish(),
  parentId: zod.string().nullish(),
  imageUrl: zod.string().nullish(),
  isActive: zod.boolean(),
  sortOrder: zod.number().int(),
  createdAt: zod.string(),
});

/**
 * @summary Delete a product category
 */
export const DeleteProductCategoryParams = zod.object({
  id: zod.coerce.string(),
});

export const DeleteProductCategoryResponse = zod.void();

/**
 * @summary List product images
 */
export const ListProductImagesResponseItem = zod.object({
  id: zod.string(),
  productId: zod.string(),
  tenantId: zod.string(),
  url: zod.string(),
  altText: zod.string().nullish(),
  sortOrder: zod.number().int(),
  createdAt: zod.string(),
});
export const ListProductImagesResponse = zod.array(
  ListProductImagesResponseItem,
);

/**
 * @summary Add a product image
 */
export const CreateProductImageBody = zod.object({
  productId: zod.string(),
  url: zod.string().url(),
  altText: zod.string().optional(),
  sortOrder: zod.number().int().optional(),
});

export const CreateProductImageResponse = zod.object({
  id: zod.string(),
  productId: zod.string(),
  tenantId: zod.string(),
  url: zod.string(),
  altText: zod.string().nullish(),
  sortOrder: zod.number().int(),
  createdAt: zod.string(),
});

/**
 * @summary Delete a product image
 */
export const DeleteProductImageParams = zod.object({
  id: zod.coerce.string(),
});

export const DeleteProductImageResponse = zod.void();

/**
 * @summary List cart items
 */
export const ListCartItemsResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  clientId: zod.string(),
  productId: zod.string(),
  quantity: zod.number().int(),
  addedAt: zod.string(),
});
export const ListCartItemsResponse = zod.array(ListCartItemsResponseItem);

/**
 * @summary Add item to cart
 */
export const CreateCartItemBody = zod.object({
  clientId: zod.string(),
  productId: zod.string(),
  quantity: zod.number().int().optional(),
});

export const CreateCartItemResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  clientId: zod.string(),
  productId: zod.string(),
  quantity: zod.number().int(),
  addedAt: zod.string(),
});

/**
 * @summary Remove item from cart
 */
export const DeleteCartItemParams = zod.object({
  id: zod.coerce.string(),
});

export const DeleteCartItemResponse = zod.void();

/**
 * @summary List automation actions
 */
export const ListAutomationActionsResponseItem = zod.object({
  id: zod.string(),
  automationId: zod.string(),
  tenantId: zod.string(),
  type: zod.string(),
  config: zod.object({}).passthrough(),
  order: zod.number().int(),
  isActive: zod.boolean(),
  createdAt: zod.string(),
});
export const ListAutomationActionsResponse = zod.array(
  ListAutomationActionsResponseItem,
);

/**
 * @summary Create an automation action
 */
export const CreateAutomationActionBody = zod.object({
  automationId: zod.string(),
  type: zod.string(),
  config: zod.object({}).passthrough().optional(),
  order: zod.number().int().optional(),
  isActive: zod.boolean().optional(),
});

export const CreateAutomationActionResponse = zod.object({
  id: zod.string(),
  automationId: zod.string(),
  tenantId: zod.string(),
  type: zod.string(),
  config: zod.object({}).passthrough(),
  order: zod.number().int(),
  isActive: zod.boolean(),
  createdAt: zod.string(),
});

/**
 * @summary Update an automation action
 */
export const UpdateAutomationActionParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateAutomationActionBody = zod.object({
  automationId: zod.string(),
  type: zod.string(),
  config: zod.object({}).passthrough().optional(),
  order: zod.number().int().optional(),
  isActive: zod.boolean().optional(),
});

export const UpdateAutomationActionResponse = zod.object({
  id: zod.string(),
  automationId: zod.string(),
  tenantId: zod.string(),
  type: zod.string(),
  config: zod.object({}).passthrough(),
  order: zod.number().int(),
  isActive: zod.boolean(),
  createdAt: zod.string(),
});

/**
 * @summary Delete an automation action
 */
export const DeleteAutomationActionParams = zod.object({
  id: zod.coerce.string(),
});

export const DeleteAutomationActionResponse = zod.void();

/**
 * @summary List automation logs
 */
export const ListAutomationLogsResponseItem = zod.object({
  id: zod.string(),
  automationId: zod.string(),
  tenantId: zod.string(),
  status: zod.string(),
  triggerData: zod.object({}).passthrough().nullish(),
  result: zod.object({}).passthrough().nullish(),
  errorMessage: zod.string().nullish(),
  executedAt: zod.string(),
});
export const ListAutomationLogsResponse = zod.array(
  ListAutomationLogsResponseItem,
);

/**
 * @summary List audit logs
 */
export const ListAuditLogsResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  userId: zod.string().nullish(),
  action: zod.string(),
  entityType: zod.string(),
  entityId: zod.string(),
  before: zod.object({}).passthrough().nullish(),
  after: zod.object({}).passthrough().nullish(),
  ipAddress: zod.string().nullish(),
  userAgent: zod.string().nullish(),
  createdAt: zod.string(),
});
export const ListAuditLogsResponse = zod.array(ListAuditLogsResponseItem);

/**
 * @summary List system configs
 */
export const ListSystemConfigsResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  key: zod.string(),
  value: zod.object({}).passthrough().nullish(),
  updatedById: zod.string().nullish(),
  updatedAt: zod.string(),
});
export const ListSystemConfigsResponse = zod.array(
  ListSystemConfigsResponseItem,
);

/**
 * @summary Upsert a system config
 */
export const UpsertSystemConfigBody = zod.object({
  key: zod.string(),
  value: zod.unknown().optional(),
});

export const UpsertSystemConfigResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  key: zod.string(),
  value: zod.object({}).passthrough().nullish(),
  updatedById: zod.string().nullish(),
  updatedAt: zod.string(),
});

/**
 * @summary Get computed alert notifications
 */
export const GetNotificationsResponse = zod.object({
  alerts: zod.array(
    zod.object({
      type: zod.string(),
      severity: zod.string(),
      title: zod.string(),
      message: zod.string(),
      link: zod.string(),
      entityId: zod.string().nullish(),
    }),
  ),
  total: zod.number().int(),
});

/**
 * @summary Get Google OAuth URL to connect Google Calendar
 */
export const GetCalendarConnectUrlResponse = zod.object({
  url: zod.string(),
});

/**
 * @summary Disconnect Google Calendar and revoke tokens
 */
export const DisconnectCalendarResponse = zod.object({
  success: zod.boolean(),
});

/**
 * @summary Get current Google Calendar connection status
 */
export const GetCalendarStatusResponse = zod.object({
  connected: zod.boolean(),
  status: zod.string().optional(),
  tokenValid: zod.boolean().optional(),
  eventsCount: zod.number().int(),
  lastSync: zod.string().nullish(),
});

/**
 * @summary Trigger manual calendar sync
 */
export const SyncCalendarBody = zod.object({
  type: zod.enum(["all", "trip", "payment", "birthday"]),
  id: zod.string().nullish(),
});

export const SyncCalendarResponse = zod.object({
  success: zod.boolean(),
  message: zod.string(),
  synced: zod.number().int(),
});

/**
 * @summary Find orphaned pre-deterministic calendar events for review
 */
export const ScanLegacyCalendarEventsBody = zod.object({
  from: zod.coerce.date().optional(),
  to: zod.coerce.date().optional(),
});

export const ScanLegacyCalendarEventsResponse = zod.object({
  success: zod.boolean(),
  scanned: zod.number().int(),
  pending: zod.array(
    zod.object({
      reconciliationId: zod.string(),
      status: zod.enum(["pending", "associated", "removed", "dismissed"]),
      googleEventId: zod.string(),
      calendarId: zod.string(),
      eventType: zod.enum(["trip", "payment", "birthday"]),
      eventSummary: zod.string(),
      eventDescription: zod.string().nullable(),
      eventLocation: zod.string().nullable(),
      eventStartDate: zod.coerce.date(),
      eventEndDate: zod.coerce.date().nullable(),
      candidateMatches: zod.array(
        zod.object({
          id: zod.string(),
          type: zod.enum(["trip", "payment", "birthday"]),
          label: zod.string(),
        }),
      ),
    }),
  ),
  alreadyReconciled: zod.array(
    zod.object({
      reconciliationId: zod.string(),
      status: zod.enum(["pending", "associated", "removed", "dismissed"]),
      googleEventId: zod.string(),
      calendarId: zod.string(),
      eventType: zod.enum(["trip", "payment", "birthday"]),
      eventSummary: zod.string(),
      eventDescription: zod.string().nullable(),
      eventLocation: zod.string().nullable(),
      eventStartDate: zod.coerce.date(),
      eventEndDate: zod.coerce.date().nullable(),
      candidateMatches: zod.array(
        zod.object({
          id: zod.string(),
          type: zod.enum(["trip", "payment", "birthday"]),
          label: zod.string(),
        }),
      ),
    }),
  ),
});

/**
 * @summary List calendar events awaiting legacy reconciliation review
 */
export const ListCalendarReconciliationsQueryParams = zod.object({
  status: zod
    .enum(["pending", "associated", "removed", "dismissed"])
    .optional(),
});

export const ListCalendarReconciliationsResponse = zod.object({
  success: zod.boolean(),
  reconciliations: zod.array(
    zod.object({
      reconciliationId: zod.string(),
      status: zod.enum(["pending", "associated", "removed", "dismissed"]),
      googleEventId: zod.string(),
      calendarId: zod.string(),
      eventType: zod.enum(["trip", "payment", "birthday"]),
      eventSummary: zod.string(),
      eventDescription: zod.string().nullable(),
      eventLocation: zod.string().nullable(),
      eventStartDate: zod.coerce.date(),
      eventEndDate: zod.coerce.date().nullable(),
      candidateMatches: zod.array(
        zod.object({
          id: zod.string(),
          type: zod.enum(["trip", "payment", "birthday"]),
          label: zod.string(),
        }),
      ),
    }),
  ),
});

/**
 * @summary Associate a reviewed legacy calendar event with a CRM record
 */
export const AssociateLegacyCalendarEventParams = zod.object({
  id: zod.coerce.string(),
});

export const AssociateLegacyCalendarEventBody = zod.object({
  candidateId: zod.string(),
});

export const AssociateLegacyCalendarEventResponse = zod.object({
  success: zod.boolean(),
  status: zod.enum(["associated", "removed", "dismissed"]),
});

/**
 * @summary Remove a reviewed legacy event from Google Calendar
 */
export const RemoveLegacyCalendarEventParams = zod.object({
  id: zod.coerce.string(),
});

export const RemoveLegacyCalendarEventResponse = zod.object({
  success: zod.boolean(),
  status: zod.enum(["associated", "removed", "dismissed"]),
});

/**
 * @summary Dismiss a legacy candidate without changing Google Calendar
 */
export const DismissLegacyCalendarEventParams = zod.object({
  id: zod.coerce.string(),
});

export const DismissLegacyCalendarEventResponse = zod.object({
  success: zod.boolean(),
  status: zod.enum(["associated", "removed", "dismissed"]),
});

/**
 * Receives the authorization code from Google after the user grants access. Verifies the HMAC-signed `state` parameter, exchanges the code for tokens, persists them in the users table, triggers an initial syncAll, and redirects back to the Configurações page with a `?gcal=connected|denied|error` query parameter.
 * @summary Google OAuth2 callback (server-side redirect handler)
 */
export const GetCalendarCallbackQueryParams = zod.object({
  code: zod.coerce
    .string()
    .optional()
    .describe("Authorization code from Google"),
  state: zod.coerce
    .string()
    .optional()
    .describe(
      "HMAC-signed state blob (base64url JSON); absent when error is present",
    ),
  error: zod.coerce
    .string()
    .optional()
    .describe("Present when the user denied access"),
});

export const GetCalendarCallbackResponse = zod.void();

/**
 * @summary Check active Stripe prices for platform plans
 */
export const GetPlansStripeHealthResponse = zod.object({
  stripeConfigured: zod.boolean(),
  plans: zod.array(
    zod.object({
      planId: zod.string(),
      slug: zod.string(),
      name: zod.string(),
      isActive: zod.boolean(),
      monthlyOk: zod.boolean(),
      annualOk: zod.boolean(),
      isFree: zod.boolean(),
      error: zod.string().optional(),
    }),
  ),
});

/**
 * @summary Get twelve-month revenue, expense, profit, and reservation comparison
 */
export const GetDashboardComparativeResponseItem = zod.object({
  month: zod.string(),
  key: zod.string(),
  revenue: zod.number(),
  expenses: zod.number(),
  profit: zod.number(),
  reservations: zod.number(),
  revenueGrowth: zod.number().nullable(),
  expensesGrowth: zod.number().nullable(),
  profitGrowth: zod.number().nullable(),
  reservationsGrowth: zod.number().nullable(),
});
export const GetDashboardComparativeResponse = zod.array(
  GetDashboardComparativeResponseItem,
);

/**
 * @summary Get the five highest-spending customers
 */
export const GetDashboardTopCustomersResponseItem = zod.object({
  id: zod.string(),
  name: zod.string(),
  email: zod.string().nullish(),
  photoUrl: zod.string().nullish(),
  totalSpent: zod.number(),
  reservationCount: zod.number().int(),
});
export const GetDashboardTopCustomersResponse = zod.array(
  GetDashboardTopCustomersResponseItem,
);

/**
 * @summary Get the strategic insights summary
 */
export const getInsightsSummaryQueryPeriodDefault = `month`;

export const GetInsightsSummaryQueryParams = zod.object({
  period: zod
    .enum(["month", "quarter", "year"])
    .default(getInsightsSummaryQueryPeriodDefault),
});

export const GetInsightsSummaryResponse = zod.object({
  executive: zod.object({
    totalRevenue: zod.number(),
    totalRevenuePrev: zod.number(),
    netProfit: zod.number(),
    netProfitPrev: zod.number(),
    totalClients: zod.number(),
    newClients: zod.number(),
    newClientsPrev: zod.number(),
    confirmedReservations: zod.number(),
    confirmedReservationsPrev: zod.number(),
    occupancyRate: zod.number(),
    conversionRate: zod.number(),
    conversionRatePrev: zod.number(),
    averageNps: zod.number().nullable(),
    averageNpsPrev: zod.number().nullable(),
    activeTrips: zod.number(),
    profitMargin: zod.number(),
    profitMarginPrev: zod.number(),
    momGrowth: zod.number().nullable(),
    yoyGrowth: zod.number().nullable(),
  }),
  commercial: zod.object({
    openDeals: zod.number(),
    openDealsPrev: zod.number(),
    wonDeals: zod.number(),
    wonDealsPrev: zod.number(),
    pipelineValue: zod.number(),
    pipelineValuePrev: zod.number(),
    avgTicket: zod.number(),
    avgTicketPrev: zod.number(),
    newReservations: zod.number(),
    newReservationsPrev: zod.number(),
    cancellations: zod.number(),
    cancellationsPrev: zod.number(),
    conversionRate: zod.number(),
    conversionRatePrev: zod.number(),
    totalLeads: zod.number(),
    totalLeadsPrev: zod.number(),
    repeatClients: zod.number(),
    repeatClientsPrev: zod.number(),
    activeClients: zod.number(),
    activeClientsPrev: zod.number(),
    ltv: zod.number(),
    ltvPrev: zod.number(),
    cac: zod.number(),
    cacPrev: zod.number(),
  }),
  marketing: zod.object({
    newClients: zod.number(),
    newClientsPrev: zod.number(),
    referrals: zod.number(),
    referralsPrev: zod.number(),
    convertedReferrals: zod.number(),
    convertedReferralsPrev: zod.number(),
    totalLeads: zod.number(),
    totalLeadsPrev: zod.number(),
    conversionRate: zod.number(),
    conversionRatePrev: zod.number(),
    activeCampaigns: zod.number(),
    newCampaigns: zod.number(),
    newCampaignsPrev: zod.number(),
    sentCampaigns: zod.number(),
    totalSentMessages: zod.number(),
    totalOpenedMessages: zod.number(),
    totalClickedMessages: zod.number(),
    totalRecipients: zod.number(),
    openRate: zod.number(),
    clickRate: zod.number(),
    campaignRoi: zod.number(),
    campaignsByType: zod.array(
      zod.object({
        type: zod.string(),
        count: zod.number(),
      }),
    ),
  }),
  financial: zod.object({
    totalRevenue: zod.number(),
    totalRevenuePrev: zod.number(),
    totalExpenses: zod.number(),
    totalExpensesPrev: zod.number(),
    commissions: zod.number(),
    commissionsPrev: zod.number(),
    netProfit: zod.number(),
    netProfitPrev: zod.number(),
    profitMargin: zod.number(),
    profitMarginPrev: zod.number(),
    receivable: zod.number(),
    payable: zod.number(),
    overdue: zod.number(),
    avgTicket: zod.number(),
    avgTicketPrev: zod.number(),
    expenseCategories: zod.array(
      zod.object({
        category: zod.string(),
        total: zod.number(),
      }),
    ),
  }),
  operational: zod.object({
    activeTrips: zod.number(),
    newTrips: zod.number(),
    newTripsPrev: zod.number(),
    occupancyRate: zod.number(),
    totalAvailableSeats: zod.number(),
    avgReservationsPerTrip: zod.number(),
    avgReservationsPerTripPrev: zod.number(),
    confirmedReservations: zod.number(),
    confirmedReservationsPrev: zod.number(),
    cancellations: zod.number(),
    cancellationsPrev: zod.number(),
    revenuePerTrip: zod.number(),
    revenuePerTripPrev: zod.number(),
    totalSuppliers: zod.number(),
    newSuppliers: zod.number(),
    newSuppliersPrev: zod.number(),
    checkedInPassengers: zod.number(),
    checkedInPassengersPrev: zod.number(),
    averageNps: zod.number().nullable(),
    averageNpsPrev: zod.number().nullable(),
  }),
  retention: zod.object({
    loyaltyMembers: zod.number(),
    loyaltyActiveMembers: zod.number(),
    loyaltyNewMembers: zod.number(),
    loyaltyNewMembersPrev: zod.number(),
    averageNps: zod.number().nullable(),
    averageNpsPrev: zod.number().nullable(),
    promoterClients: zod.number(),
    promoterClientsPrev: zod.number(),
    retentionRate: zod.number(),
    retentionRatePrev: zod.number(),
    referralRate: zod.number(),
    referralRatePrev: zod.number(),
    newClients: zod.number(),
    newClientsPrev: zod.number(),
    repeatClients: zod.number(),
    repeatClientsPrev: zod.number(),
    totalClients: zod.number(),
    convertedReferrals: zod.number(),
    convertedReferralsPrev: zod.number(),
  }),
  expansion: zod.object({
    newTrips: zod.number(),
    newTripsPrev: zod.number(),
    newDestinations90d: zod.number(),
    newDestinationsPrev90d: zod.number(),
    totalDestinations: zod.number(),
    newSuppliers: zod.number(),
    newSuppliersPrev: zod.number(),
    totalSuppliers: zod.number(),
    revenuePerTrip: zod.number(),
    revenuePerTripPrev: zod.number(),
    topDestinations: zod.array(
      zod.object({
        name: zod.string(),
        count: zod.number(),
      }),
    ),
    avgTicket: zod.number(),
    avgTicketPrev: zod.number(),
    totalRevenue: zod.number(),
    totalRevenuePrev: zod.number(),
    momGrowth: zod.number().nullable(),
    yoyGrowth: zod.number().nullable(),
  }),
});

/**
 * @summary Regenerate a trip seat map from its vehicle layout
 */
export const RegenerateTripSeatMapParams = zod.object({
  id: zod.coerce.string(),
});

export const regenerateTripSeatMapResponseFreeOrganizersMin = 0;
export const regenerateTripSeatMapResponseFreeOrganizersMax = 2;

export const regenerateTripSeatMapResponseFreeGuidesMin = 0;
export const regenerateTripSeatMapResponseFreeGuidesMax = 2;

export const RegenerateTripSeatMapResponse = zod.object({
  id: zod.string(),
  name: zod.string(),
  slug: zod.string(),
  description: zod.string().nullish(),
  destination: zod.string(),
  destinationCity: zod.string(),
  destinationState: zod.string(),
  originCity: zod.string().nullish(),
  originState: zod.string().nullish(),
  type: zod.string(),
  category: zod.string(),
  departureDate: zod.string(),
  returnDate: zod.string().nullish(),
  departureTime: zod.string().nullish(),
  returnTime: zod.string().nullish(),
  totalCapacity: zod.number().int(),
  availableSeats: zod.number().int(),
  reservedSeats: zod.number().int(),
  confirmedSeats: zod.number().int(),
  priceAdult: zod.number(),
  priceChild: zod.number().nullish(),
  priceSenior: zod.number().nullish(),
  inclusions: zod.array(zod.string()),
  exclusions: zod.array(zod.string()),
  coverImage: zod.string().nullish(),
  gallery: zod.array(zod.string()),
  status: zod.string(),
  isPublic: zod.boolean(),
  isFeatured: zod.boolean(),
  vehiclePlate: zod.string().nullish(),
  vehicleType: zod.string().nullish(),
  driverName: zod.string().nullish(),
  tourGuide: zod.string().nullish(),
  tripOrganizer: zod.string().nullish(),
  driver1Cpf: zod.string().nullish(),
  driver1Cnh: zod.string().nullish(),
  driver1CnhCategory: zod.string().nullish(),
  driver1CnhExpiry: zod.string().nullish(),
  driver2Name: zod.string().nullish(),
  driver2Cpf: zod.string().nullish(),
  driver2Cnh: zod.string().nullish(),
  driver2CnhCategory: zod.string().nullish(),
  driver2CnhExpiry: zod.string().nullish(),
  tourGuideCpf: zod.string().nullish(),
  tourGuideRegistration: zod.string().nullish(),
  manifestNumber: zod.string().nullish(),
  seatLayout: zod.string().nullish(),
  boardingPoints: zod
    .array(
      zod.object({
        id: zod.string(),
        name: zod.string(),
        time: zod.string().nullish(),
        address: zod.string().nullish(),
      }),
    )
    .optional(),
  itinerary: zod.array(zod.record(zod.string(), zod.unknown())).optional(),
  fixedCosts: zod.array(zod.unknown()).optional(),
  variableCosts: zod.array(zod.unknown()).optional(),
  freeOrganizers: zod
    .number()
    .int()
    .min(regenerateTripSeatMapResponseFreeOrganizersMin)
    .max(regenerateTripSeatMapResponseFreeOrganizersMax)
    .nullish(),
  freeGuides: zod
    .number()
    .int()
    .min(regenerateTripSeatMapResponseFreeGuidesMin)
    .max(regenerateTripSeatMapResponseFreeGuidesMax)
    .nullish(),
  freePassengers: zod
    .array(
      zod.object({
        id: zod.string(),
        name: zod.string(),
        cpf: zod.string(),
        whatsapp: zod.string(),
        role: zod.enum(["organizer", "guide"]),
        seatNumber: zod.string().nullable(),
        checkedInAt: zod.string().nullish(),
      }),
    )
    .nullish(),
  layoutId: zod.string().nullish(),
  showSeatMap: zod.boolean().nullish(),
  accommodationId: zod.string().nullish(),
  createdAt: zod.string(),
  updatedAt: zod.string(),
});

/**
 * @summary Check in a complimentary trip passenger
 */
export const CheckInFreePassengerParams = zod.object({
  id: zod.coerce.string(),
  fpId: zod.coerce.string(),
});

export const CheckInFreePassengerResponse = zod.object({
  id: zod.string(),
  checkedInAt: zod.coerce.date().nullable(),
});

/**
 * @summary Undo a complimentary passenger check-in
 */
export const UndoCheckInFreePassengerParams = zod.object({
  id: zod.coerce.string(),
  fpId: zod.coerce.string(),
});

export const UndoCheckInFreePassengerResponse = zod.object({
  id: zod.string(),
  checkedInAt: zod.coerce.date().nullable(),
});

/**
 * @summary Queue a WhatsApp broadcast for trip passengers
 */
export const BroadcastTripWhatsAppParams = zod.object({
  id: zod.coerce.string(),
});

export const broadcastTripWhatsAppBodyMessageTemplateMax = 2000;

export const BroadcastTripWhatsAppBody = zod.object({
  messageTemplate: zod
    .string()
    .min(1)
    .max(broadcastTripWhatsAppBodyMessageTemplateMax),
  filter: zod.enum(["all", "confirmed", "pending"]),
});

export const BroadcastTripWhatsAppResponse = zod.object({
  queued: zod.number().int(),
  skipped: zod.number().int(),
});

/**
 * @summary Mark a converted referral bonus as paid
 */
export const PayReferralBonusParams = zod.object({
  id: zod.coerce.string(),
});

export const PayReferralBonusResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  referrerId: zod.string(),
  referredId: zod.string().nullish(),
  referredEmail: zod.string().nullish(),
  referredName: zod.string().nullish(),
  referredPhone: zod.string().nullish(),
  referrerName: zod.string().nullish(),
  referrerEmail: zod.string().nullish(),
  referrerPhone: zod.string().nullish(),
  code: zod.string(),
  status: zod.string(),
  bonusAmount: zod.string(),
  bonusPaid: zod.boolean(),
  bonusPaidAt: zod.string().nullish(),
  discountType: zod.string(),
  discountValue: zod.string(),
  discountApplied: zod.boolean(),
  discountAmount: zod.string().nullish(),
  cookieId: zod.string().nullish(),
  ipAddress: zod.string().nullish(),
  utmSource: zod.string().nullish(),
  utmMedium: zod.string().nullish(),
  utmCampaign: zod.string().nullish(),
  visitsCount: zod.number().int(),
  firstVisit: zod.string().nullish(),
  lastVisit: zod.string().nullish(),
  expiresAt: zod.string().nullish(),
  isActive: zod.boolean(),
  reservationId: zod.string().nullish(),
  notes: zod.string().nullish(),
  convertedAt: zod.string().nullish(),
  createdAt: zod.string(),
  updatedAt: zod.string(),
  fraudFlag: zod.boolean().nullish(),
  fraudReason: zod.string().nullish(),
  expiryWarning7SentAt: zod.string().nullish(),
  expiryWarning1SentAt: zod.string().nullish(),
  bonusReleaseNotifiedAt: zod.string().nullish(),
});

/**
 * @summary Resend a referral expiry warning
 */
export const ResendExpiryWarningParams = zod.object({
  id: zod.coerce.string(),
});

export const ResendExpiryWarningQueryParams = zod.object({
  window: zod.union([zod.literal(1), zod.literal(7)]),
});

export const ResendExpiryWarningResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  referrerId: zod.string(),
  referredId: zod.string().nullish(),
  referredEmail: zod.string().nullish(),
  referredName: zod.string().nullish(),
  referredPhone: zod.string().nullish(),
  referrerName: zod.string().nullish(),
  referrerEmail: zod.string().nullish(),
  referrerPhone: zod.string().nullish(),
  code: zod.string(),
  status: zod.string(),
  bonusAmount: zod.string(),
  bonusPaid: zod.boolean(),
  bonusPaidAt: zod.string().nullish(),
  discountType: zod.string(),
  discountValue: zod.string(),
  discountApplied: zod.boolean(),
  discountAmount: zod.string().nullish(),
  cookieId: zod.string().nullish(),
  ipAddress: zod.string().nullish(),
  utmSource: zod.string().nullish(),
  utmMedium: zod.string().nullish(),
  utmCampaign: zod.string().nullish(),
  visitsCount: zod.number().int(),
  firstVisit: zod.string().nullish(),
  lastVisit: zod.string().nullish(),
  expiresAt: zod.string().nullish(),
  isActive: zod.boolean(),
  reservationId: zod.string().nullish(),
  notes: zod.string().nullish(),
  convertedAt: zod.string().nullish(),
  createdAt: zod.string(),
  updatedAt: zod.string(),
  fraudFlag: zod.boolean().nullish(),
  fraudReason: zod.string().nullish(),
  expiryWarning7SentAt: zod.string().nullish(),
  expiryWarning1SentAt: zod.string().nullish(),
  bonusReleaseNotifiedAt: zod.string().nullish(),
});

/**
 * @summary Resend a referral bonus release notification
 */
export const ResendBonusReleaseParams = zod.object({
  id: zod.coerce.string(),
});

export const ResendBonusReleaseResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  referrerId: zod.string(),
  referredId: zod.string().nullish(),
  referredEmail: zod.string().nullish(),
  referredName: zod.string().nullish(),
  referredPhone: zod.string().nullish(),
  referrerName: zod.string().nullish(),
  referrerEmail: zod.string().nullish(),
  referrerPhone: zod.string().nullish(),
  code: zod.string(),
  status: zod.string(),
  bonusAmount: zod.string(),
  bonusPaid: zod.boolean(),
  bonusPaidAt: zod.string().nullish(),
  discountType: zod.string(),
  discountValue: zod.string(),
  discountApplied: zod.boolean(),
  discountAmount: zod.string().nullish(),
  cookieId: zod.string().nullish(),
  ipAddress: zod.string().nullish(),
  utmSource: zod.string().nullish(),
  utmMedium: zod.string().nullish(),
  utmCampaign: zod.string().nullish(),
  visitsCount: zod.number().int(),
  firstVisit: zod.string().nullish(),
  lastVisit: zod.string().nullish(),
  expiresAt: zod.string().nullish(),
  isActive: zod.boolean(),
  reservationId: zod.string().nullish(),
  notes: zod.string().nullish(),
  convertedAt: zod.string().nullish(),
  createdAt: zod.string(),
  updatedAt: zod.string(),
  fraudFlag: zod.boolean().nullish(),
  fraudReason: zod.string().nullish(),
  expiryWarning7SentAt: zod.string().nullish(),
  expiryWarning1SentAt: zod.string().nullish(),
  bonusReleaseNotifiedAt: zod.string().nullish(),
});

/**
 * @summary Reverse a converted referral bonus
 */
export const ReverseReferralBonusParams = zod.object({
  id: zod.coerce.string(),
});

export const ReverseReferralBonusBody = zod.object({
  reason: zod.string().min(1),
});

export const ReverseReferralBonusResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  referrerId: zod.string(),
  referredId: zod.string().nullish(),
  referredEmail: zod.string().nullish(),
  referredName: zod.string().nullish(),
  referredPhone: zod.string().nullish(),
  referrerName: zod.string().nullish(),
  referrerEmail: zod.string().nullish(),
  referrerPhone: zod.string().nullish(),
  code: zod.string(),
  status: zod.string(),
  bonusAmount: zod.string(),
  bonusPaid: zod.boolean(),
  bonusPaidAt: zod.string().nullish(),
  discountType: zod.string(),
  discountValue: zod.string(),
  discountApplied: zod.boolean(),
  discountAmount: zod.string().nullish(),
  cookieId: zod.string().nullish(),
  ipAddress: zod.string().nullish(),
  utmSource: zod.string().nullish(),
  utmMedium: zod.string().nullish(),
  utmCampaign: zod.string().nullish(),
  visitsCount: zod.number().int(),
  firstVisit: zod.string().nullish(),
  lastVisit: zod.string().nullish(),
  expiresAt: zod.string().nullish(),
  isActive: zod.boolean(),
  reservationId: zod.string().nullish(),
  notes: zod.string().nullish(),
  convertedAt: zod.string().nullish(),
  createdAt: zod.string(),
  updatedAt: zod.string(),
  fraudFlag: zod.boolean().nullish(),
  fraudReason: zod.string().nullish(),
  expiryWarning7SentAt: zod.string().nullish(),
  expiryWarning1SentAt: zod.string().nullish(),
  bonusReleaseNotifiedAt: zod.string().nullish(),
});

/**
 * @summary Financially reverse an already paid referral bonus
 */
export const ReversePaidReferralBonusParams = zod.object({
  id: zod.coerce.string(),
});

export const reversePaidReferralBonusBodyReasonMax = 1000;

export const ReversePaidReferralBonusBody = zod.object({
  reason: zod.string().min(1).max(reversePaidReferralBonusBodyReasonMax),
  confirmed: zod.boolean(),
});

export const ReversePaidReferralBonusResponse = zod
  .object({
    id: zod.string(),
    tenantId: zod.string(),
    referrerId: zod.string(),
    referredId: zod.string().nullish(),
    referredEmail: zod.string().nullish(),
    referredName: zod.string().nullish(),
    referredPhone: zod.string().nullish(),
    referrerName: zod.string().nullish(),
    referrerEmail: zod.string().nullish(),
    referrerPhone: zod.string().nullish(),
    code: zod.string(),
    status: zod.string(),
    bonusAmount: zod.string(),
    bonusPaid: zod.boolean(),
    bonusPaidAt: zod.string().nullish(),
    discountType: zod.string(),
    discountValue: zod.string(),
    discountApplied: zod.boolean(),
    discountAmount: zod.string().nullish(),
    cookieId: zod.string().nullish(),
    ipAddress: zod.string().nullish(),
    utmSource: zod.string().nullish(),
    utmMedium: zod.string().nullish(),
    utmCampaign: zod.string().nullish(),
    visitsCount: zod.number().int(),
    firstVisit: zod.string().nullish(),
    lastVisit: zod.string().nullish(),
    expiresAt: zod.string().nullish(),
    isActive: zod.boolean(),
    reservationId: zod.string().nullish(),
    notes: zod.string().nullish(),
    convertedAt: zod.string().nullish(),
    createdAt: zod.string(),
    updatedAt: zod.string(),
    fraudFlag: zod.boolean().nullish(),
    fraudReason: zod.string().nullish(),
    expiryWarning7SentAt: zod.string().nullish(),
    expiryWarning1SentAt: zod.string().nullish(),
    bonusReleaseNotifiedAt: zod.string().nullish(),
  })
  .and(
    zod.object({
      reversal: zod.object({
        id: zod.string(),
        amount: zod.string(),
        reason: zod.string(),
        alreadyApplied: zod.boolean(),
      }),
    }),
  );

/**
 * @summary Send a referral WhatsApp test message to the configured agency number
 */
export const TestWhatsAppMessageBody = zod.object({
  type: zod.enum(["converted", "bonusPaid", "reversed", "share"]),
  message: zod.string().optional(),
});

export const TestWhatsAppMessageResponse = zod.object({
  success: zod.boolean(),
});
