/
export const ListProductsQueryParams = zod.object({
  search: zod.coerce.string().nullish(),
  active: zod.coerce.boolean().nullish(),
});

export const ListProductsResponseItem = zod.object({
  id: zod.string(),
  name: zod.string(),
  slug: zod.string(),
  description: zod.string().nullish(),
  type: zod.string(),
  price: zod.number(),
  promotionalPrice: zod.number().nullish(),
  stock: zod.number().nullish(),
  active: zod.boolean(),
  featured: zod.boolean(),
  createdAt: zod.string(),
});
export const ListProductsResponse = zod.array(ListProductsResponseItem);

/**
 * @summary Create a product
 */
export const CreateProductBody = zod.object({
  name: zod.string(),
  description: zod.string().nullish(),
  type: zod.string(),
  price: zod.number(),
  promotionalPrice: zod.number().nullish(),
  stock: zod.number().nullish(),
});

/**
 * @summary Update a product
 */
export const UpdateProductParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateProductBody = zod.object({
  name: zod.string().nullish(),
  price: zod.number().nullish(),
  promotionalPrice: zod.number().nullish(),
  active: zod.boolean().nullish(),
  featured: zod.boolean().nullish(),
  stock: zod.number().nullish(),
});

export const UpdateProductResponse = zod.object({
  id: zod.string(),
  name: zod.string(),
  slug: zod.string(),
  description: zod.string().nullish(),
  type: zod.string(),
  price: zod.number(),
  promotionalPrice: zod.number().nullish(),
  stock: zod.number().nullish(),
  active: zod.boolean(),
  featured: zod.boolean(),
  createdAt: zod.string(),
});

/**
 * @summary Delete a product
 */
export const DeleteProductParams = zod.object({
  id: zod.coerce.string(),
});

export const DeleteProductResponse = zod.object({
  success: zod.boolean(),
});

/**
 * @summary List orders
 */
export const listOrdersQueryPageDefault = 1;
export const listOrdersQueryLimitDefault = 20;

export const ListOrdersQueryParams = zod.object({
  status: zod.coerce.string().nullish(),
  page: zod.coerce.number().default(listOrdersQueryPageDefault),
  limit: zod.coerce.number().default(listOrdersQueryLimitDefault),
});

export const ListOrdersResponseItem = zod.object({
  id: zod.string(),
  userId: zod.string(),
  totalAmount: zod.number(),
  finalAmount: zod.number(),
  status: zod.string(),
  paymentStatus: zod.string(),
  createdAt: zod.string(),
  items: zod.array(
    zod.object({
      id: zod.string(),
      productId: zod.string(),
      quantity: zod.number(),
      price: zod.number(),
      productName: zod.string().nullish(),
    }),
  ),
});
export const ListOrdersResponse = zod.array(ListOrdersResponseItem);

/**
 * @summary Get an order
 */
export const GetOrderParams = zod.object({
  id: zod.coerce.string(),
});

export const GetOrderResponse = zod.object({
  id: zod.string(),
  userId: zod.string(),
  totalAmount: zod.number(),
  finalAmount: zod.number(),
  status: zod.string(),
  paymentStatus: zod.string(),
  createdAt: zod.string(),
  items: zod.array(
    zod.object({
      id: zod.string(),
      productId: zod.string(),
      quantity: zod.number(),
      price: zod.number(),
      productName: zod.string().nullish(),
    }),
  ),
});

/**
 * @summary Update order status
 */
export const UpdateOrderParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateOrderBody = zod.object({
  status: zod.string().nullish(),
  paymentStatus: zod.string().nullish(),
});

export const UpdateOrderResponse = zod.object({
  id: zod.string(),
  userId: zod.string(),
  totalAmount: zod.number(),
  finalAmount: zod.number(),
  status: zod.string(),
  paymentStatus: zod.string(),
  createdAt: zod.string(),
  items: zod.array(
    zod.object({
      id: zod.string(),
      productId: zod.string(),
      quantity: zod.number(),
      price: zod.number(),
      productName: zod.string().nullish(),
    }),
  ),
});

/**
 * @summary List marketing campaigns
 */
export const ListCampaignsResponseItem = zod.object({
  id: zod.string(),
  name: zod.string(),
  type: zod.string(),
  status: zod.string(),
  subject: zod.string().nullish(),
  content: zod.string(),
  scheduledAt: zod.string().nullish(),
  sentAt: zod.string().nullish(),
  recipientsCount: zod.number(),
  sentCount: zod.number(),
  openedCount: zod.number(),
  clickedCount: zod.number(),
  createdAt: zod.string(),
});
export const ListCampaignsResponse = zod.array(ListCampaignsResponseItem);

/**
 * @summary Create a campaign
 */
export const CreateCampaignBody = zod.object({
  name: zod.string(),
  type: zod.string(),
  subject: zod.string().nullish(),
  content: zod.string(),
  targetSegment: zod.record(zod.string(), zod.unknown()),
  scheduledAt: zod.string().nullish(),
  triggerType: zod.string().optional(),
  triggerConfig: zod.record(zod.string(), zod.unknown()).nullish(),
  autoEnabled: zod.boolean().optional(),
});

/**
 * @summary Update a campaign
 */
export const UpdateCampaignParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateCampaignBody = zod.object({
  name: zod.string().nullish(),
  status: zod.string().nullish(),
  scheduledAt: zod.string().nullish(),
  content: zod.string().nullish(),
});

export const UpdateCampaignResponse = zod.object({
  id: zod.string(),
  name: zod.string(),
  type: zod.string(),
  status: zod.string(),
  subject: zod.string().nullish(),
  content: zod.string(),
  scheduledAt: zod.string().nullish(),
  sentAt: zod.string().nullish(),
  recipientsCount: zod.number(),
  sentCount: zod.number(),
  openedCount: zod.number(),
  clickedCount: zod.number(),
  createdAt: zod.string(),
});

/**
 * @summary Delete a campaign
 */
export const DeleteCampaignParams = zod.object({
  id: zod.coerce.string(),
});

export const DeleteCampaignResponse = zod.object({
  success: zod.boolean(),
});

/**
 * @summary List NPS responses
 */
export const listNpsResponsesQueryPageDefault = 1;
export const listNpsResponsesQueryLimitDefault = 20;

export const ListNpsResponsesQueryParams = zod.object({
  classification: zod.coerce.string().nullish(),
  tripId: zod.coerce.string().nullish(),
  dateFrom: zod.coerce.string().nullish(),
  dateTo: zod.coerce.string().nullish(),
  page: zod.coerce.number().default(listNpsResponsesQueryPageDefault),
  limit: zod.coerce.number().default(listNpsResponsesQueryLimitDefault),
});

export const ListNpsResponsesResponseItem = zod.object({
  id: zod.string(),
  userId: zod.string(),
  score: zod.number(),
  classification: zod.string(),
  feedback: zod.string().nullish(),
  clientName: zod.string().nullish(),
  createdAt: zod.string(),
});
export const ListNpsResponsesResponse = zod.array(ListNpsResponsesResponseItem);

/**
 * @summary Generate NPS survey links for trip passengers
 */
export const SendNpsSurveyBody = zod.object({
  tripId: zod.string(),
  clientIds: zod.array(zod.string()).optional(),
});

export const SendNpsSurveyResponse = zod.object({
  links: zod.array(
    zod.object({
      clientId: zod.string(),
      clientName: zod.string(),
      surveyUrl: zod.string(),
    }),
  ),
});

/**
 * @summary Get NPS summary and score
 */
export const GetNpsSummaryQueryParams = zod.object({
  tripId: zod.coerce.string().nullish(),
  dateFrom: zod.coerce.string().nullish(),
  dateTo: zod.coerce.string().nullish(),
});

export const GetNpsSummaryResponse = zod.object({
  averageScore: zod.number(),
  npsScore: zod.number(),
  promoters: zod.number(),
  passives: zod.number(),
  detractors: zod.number(),
  total: zod.number(),
  avgTransport: zod.number().nullable().optional(),
  avgService: zod.number().nullable().optional(),
  avgOrganization: zod.number().nullable().optional(),
  avgGuide: zod.number().nullable().optional(),
});

/**
 * @summary Get current user profile
 */
export const GetMeResponse = zod.object({
  id: zod.string(),
  clerkId: zod.string(),
  name: zod.string(),
  email: zod.string(),
  role: zod.enum([
    "superadmin",
    "agencia",
    "gerente",
    "vendedor",
    "suporte",
    "cliente",
  ]),
  avatarUrl: zod.string().nullish(),
  isActive: zod.boolean(),
  tenantId: zod.string().nullish(),
  referralCode: zod.string(),
  referralBalance: zod.number(),
  commissionType: zod.string().optional(),
  commissionRate: zod.number().optional(),
  commissionFixed: zod.number().optional(),
  monthlyGoal: zod.number().nullish(),
  createdAt: zod.string(),
  /** Days remaining in trial (only present when status=trial and within 7 days of expiry) */
  trialDaysLeft: zod.number().nullish(),
  tenant: zod
    .object({
      id: zod.string(),
      name: zod.string(),
      slug: zod.string(),
      logoUrl: zod.string().nullish(),
      primaryColor: zod.string().nullish(),
      secondaryColor: zod.string().nullish(),
      status: zod.string(),
      planId: zod.string(),
      website: zod.string().nullish(),
    })
    .nullish(),
});

/**
 * @summary Sync Clerk user into DB after login
 */
export const SyncMeBody = zod.object({
  clerkId: zod.string(),
  name: zod.string(),
  email: zod.string(),
  avatarUrl: zod.string().nullish(),
  /** When present on a brand-new account, links the user to the agency store as a CLIENT. Ignored for existing users. */
  storeSlug: zod.string().optional(),
});

export const SyncMeResponse = zod.object({
  id: zod.string(),
  clerkId: zod.string(),
  name: zod.string(),
  email: zod.string(),
  role: zod.enum([
    "superadmin",
    "agencia",
    "gerente",
    "vendedor",
    "suporte",
    "cliente",
  ]),
  avatarUrl: zod.string().nullish(),
  isActive: zod.boolean(),
  tenantId: zod.string().nullish(),
  referralCode: zod.string(),
  referralBalance: zod.number(),
  commissionType: zod.string().optional(),
  commissionRate: zod.number().optional(),
  commissionFixed: zod.number().optional(),
  monthlyGoal: zod.number().nullish(),
  createdAt: zod.string(),
  tenant: zod
    .object({
      id: zod.string(),
      name: zod.string(),
      slug: zod.string(),
      logoUrl: zod.string().nullish(),
      primaryColor: zod.string().nullish(),
      secondaryColor: zod.string().nullish(),
      status: zod.string(),
      planId: zod.string(),
      website: zod.string().nullish(),
    })
    .nullish(),
});

/**
 * @summary List users (sellers/team)
 */
export const ListUsersResponseItem = zod.object({
  id: zod.string(),
  clerkId: zod.string(),
  name: zod.string(),
  email: zod.string(),
  role: zod.enum([
    "superadmin",
    "agencia",
    "gerente",
    "vendedor",
    "suporte",
    "cliente",
  ]),
  avatarUrl: zod.string().nullish(),
  isActive: zod.boolean(),
  tenantId: zod.string().nullish(),
  referralCode: zod.string(),
  referralBalance: zod.number(),
  commissionType: zod.string().optional(),
  commissionRate: zod.number().optional(),
  commissionFixed: zod.number().optional(),
  monthlyGoal: zod.number().nullish(),
  createdAt: zod.string(),
  tenant: zod
    .object({
      id: zod.string(),
      name: zod.string(),
      slug: zod.string(),
      logoUrl: zod.string().nullish(),
      primaryColor: zod.string().nullish(),
      secondaryColor: zod.string().nullish(),
      status: zod.string(),
      planId: zod.string(),
      website: zod.string().nullish(),
    })
    .nullish(),
});
export const ListUsersResponse = zod.array(ListUsersResponseItem);

/**
 * @summary Create a user (invite seller)
 */
export const CreateUserBody = zod.object({
  name: zod.string(),
  email: zod.string(),
  role: zod.enum([
    "superadmin",
    "agencia",
    "gerente",
    "vendedor",
    "suporte",
    "cliente",
  ]),
});

/**
 * @summary Update a user
 */
export const UpdateUserParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateUserBody = zod.object({
  name: zod.string().nullish(),
  role: zod
    .union([
      zod.enum([
        "superadmin",
        "agencia",
        "gerente",
        "vendedor",
        "suporte",
        "cliente",
      ]),
      zod.null(),
    ])
    .optional(),
  isActive: zod.boolean().nullish(),
  commissionType: zod.string().nullish(),
  commissionRate: zod.number().nullish(),
  commissionFixed: zod.number().nullish(),
  monthlyGoal: zod.number().nullish(),
});

export const UpdateUserResponse = zod.object({
  id: zod.string(),
  clerkId: zod.string(),
  name: zod.string(),
  email: zod.string(),
  role: zod.enum([
    "superadmin",
    "agencia",
    "gerente",
    "vendedor",
    "suporte",
    "cliente",
  ]),
  avatarUrl: zod.string().nullish(),
  isActive: zod.boolean(),
  tenantId: zod.string().nullish(),
  referralCode: zod.string(),
  referralBalance: zod.number(),
  commissionType: zod.string().optional(),
  commissionRate: zod.number().optional(),
  commissionFixed: zod.number().optional(),
  monthlyGoal: zod.number().nullish(),
  createdAt: zod.string(),
  tenant: zod
    .object({
      id: zod.string(),
      name: zod.string(),
      slug: zod.string(),
      logoUrl: zod.string().nullish(),
      primaryColor: zod.string().nullish(),
      secondaryColor: zod.string().nullish(),
      status: zod.string(),
      planId: zod.string(),
      website: zod.string().nullish(),
    })
    .nullish(),
});

/**
 * @summary List all tenants (superadmin only)
 */
export const ListTenantsResponseItem = zod
  .object({
    id: zod.string(),
    name: zod.string(),
    slug: zod.string(),
    email: zod.string(),
    whatsapp: zod.string().nullish(),
    phone: zod.string().nullish(),
    planId: zod.string(),
    status: zod.string(),
    logoUrl: zod.string().nullish(),
    primaryColor: zod.string().nullish(),
    secondaryColor: zod.string().nullish(),
    website: zod.string().nullish(),
    reservationPrefix: zod.string().nullish(),
    createdAt: zod.string(),
  })
  .and(
    zod.object({
      userCount: zod.number(),
    }),
  );
export const ListTenantsResponse = zod.array(ListTenantsResponseItem);

/**
 * @summary Create a tenant (superadmin only)
 */
export const CreateTenantBody = zod.object({
  name: zod.string(),
  slug: zod.string(),
  email: zod.string(),
  planId: zod.string().optional(),
  status: zod.string().optional(),
});

/**
 * @summary Get tenant by id
 */
export const GetTenantParams = zod.object({
  id: zod.coerce.string(),
});

export const GetTenantResponse = zod.object({
  id: zod.string(),
  name: zod.string(),
  slug: zod.string(),
  email: zod.string(),
  whatsapp: zod.string().nullish(),
  phone: zod.string().nullish(),
  planId: zod.string(),
  status: zod.string(),
  logoUrl: zod.string().nullish(),
  primaryColor: zod.string().nullish(),
  secondaryColor: zod.string().nullish(),
  website: zod.string().nullish(),
  reservationPrefix: zod.string().nullish(),
  prefixLocked: zod.boolean().nullish(),
  createdAt: zod.string(),
});

/**
 * @summary Update tenant
 */
export const UpdateTenantParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateTenantBody = zod.object({
  name: zod.string().optional(),
  planId: zod.string().optional(),
  status: zod.string().optional(),
  logoUrl: zod.string().optional(),
  primaryColor: zod.string().optional(),
  secondaryColor: zod.string().optional(),
  whatsapp: zod.string().optional(),
  phone: zod.string().optional(),
  cnpj: zod.string().optional(),
  address: zod.string().optional(),
  city: zod.string().optional(),
  state: zod.string().optional(),
  zipCode: zod.string().optional(),
  maxUsersOverride: zod.number().nullish(),
  maxClientsOverride: zod.number().nullish(),
  maxTripsOverride: zod.number().nullish(),
  trialEndsAt: zod.string().nullish(),
  website: zod.string().nullish(),
  reservationPrefix: zod.string().nullish(),
  birthdayMessagesEnabled: zod.boolean().nullish(),
});

export const UpdateTenantResponse = zod.object({
  id: zod.string(),
  name: zod.string(),
  slug: zod.string(),
  email: zod.string(),
  whatsapp: zod.string().nullish(),
  phone: zod.string().nullish(),
  planId: zod.string(),
  status: zod.string(),
  logoUrl: zod.string().nullish(),
  primaryColor: zod.string().nullish(),
  secondaryColor: zod.string().nullish(),
  website: zod.string().nullish(),
  reservationPrefix: zod.string().nullish(),
  prefixLocked: zod.boolean().nullish(),
  createdAt: zod.string(),
});

/**
 * @summary List boarding locations
 */
export const ListBoardingLocationsResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  name: zod.string(),
  address: zod.string(),
  city: zod.string(),
  state: zod.string(),
  reference: zod.string().nullish(),
  departureTime: zod.string().nullish(),
  createdAt: zod.string(),
});
export const ListBoardingLocationsResponse = zod.array(
  ListBoardingLocationsResponseItem,
);

/**
 * @summary Create a boarding location
 */
export const CreateBoardingLocationBody = zod.object({
  name: zod.string(),
  address: zod.string(),
  city: zod.string(),
  state: zod.string(),
  reference: zod.string().optional(),
  departureTime: zod.string().optional(),
});

/**
 * @summary Update a boarding location
 */
export const UpdateBoardingLocationParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateBoardingLocationBody = zod.object({
  name: zod.string(),
  address: zod.string(),
  city: zod.string(),
  state: zod.string(),
  reference: zod.string().optional(),
  departureTime: zod.string().optional(),
});

export const UpdateBoardingLocationResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  name: zod.string(),
  address: zod.string(),
  city: zod.string(),
  state: zod.string(),
  reference: zod.string().nullish(),
  departureTime: zod.string().nullish(),
  createdAt: zod.string(),
});

/**
 * @summary Delete a boarding location
 */
export const DeleteBoardingLocationParams = zod.object({
  id: zod.coerce.string(),
});

/**
 * @summary List commission rules
 */
export const ListCommissionRulesResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  name: zod.string(),
  type: zod.string(),
  value: zod.string(),
  appliesTo: zod.string(),
  tripId: zod.string().nullish(),
  isActive: zod.boolean(),
  createdAt: zod.string(),
});
export const ListCommissionRulesResponse = zod.array(
  ListCommissionRulesResponseItem,
);

/**
 * @summary Create a commission rule
 */
export const CreateCommissionRuleBody = zod.object({
  name: zod.string(),
  type: zod.enum(["percentage", "fixed"]).optional(),
  value: zod.string(),
  appliesTo: zod.string().optional(),
  tripId: zod.string().optional(),
  isActive: zod.boolean().optional(),
});

/**
 * @summary Update a commission rule
 */
export const UpdateCommissionRuleParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateCommissionRuleBody = zod.object({
  name: zod.string(),
  type: zod.enum(["percentage", "fixed"]).optional(),
  value: zod.string(),
  appliesTo: zod.string().optional(),
  tripId: zod.string().optional(),
  isActive: zod.boolean().optional(),
});

export const UpdateCommissionRuleResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  name: zod.string(),
  type: zod.string(),
  value: zod.string(),
  appliesTo: zod.string(),
  tripId: zod.string().nullish(),
  isActive: zod.boolean(),
  createdAt: zod.string(),
});

/**
 * @summary Delete a commission rule
 */
export const DeleteCommissionRuleParams = zod.object({
  id: zod.coerce.string(),
});

/**
 * @summary List commissions
 */
export const ListCommissionsResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  ruleId: zod.string().nullish(),
  userId: zod.string(),
  reservationId: zod.string().nullish(),
  baseAmount: zod.string(),
  commissionAmount: zod.string(),
  commissionRate: zod.string().nullish(),
  commissionType: zod.string().nullish(),
  status: zod.string(),
  paidAt: zod.string().nullish(),
  createdAt: zod.string(),
  sellerName: zod.string().nullish(),
});
export const ListCommissionsResponse = zod.array(ListCommissionsResponseItem);

/**
 * @summary Get the authenticated seller's ranking position for the current month
 */
export const GetMyCommissionRankResponse = zod.object({
  rank: zod.number().nullish(),
  totalSellers: zod.number(),
  monthlyCommission: zod.number(),
  month: zod.string(),
});

/**
 * @summary Preview commission for a sale
 */
export const CalculateCommissionQueryParams = zod.object({
  sellerId: zod.coerce.string(),
  saleAmount: zod.coerce.number(),
  tripId: zod.coerce.string().optional(),
});

export const CalculateCommissionResponse = zod.object({
  commissionAmount: zod.number(),
  commissionRate: zod.number().nullish(),
  commissionType: zod.string(),
  source: zod.string(),
  saleAmount: zod.number(),
});

/**
 * @summary List sales goals
 */
export const ListSalesGoalsQueryParams = zod.object({
  userId: zod.coerce.string().optional(),
  month: zod.coerce.string().optional(),
});

export const ListSalesGoalsResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  userId: zod.string(),
  periodType: zod.string(),
  year: zod.number().nullish(),
  month: zod.string(),
  monthInt: zod.number().nullish(),
  quarter: zod.number().nullish(),
  goalAmount: zod.number(),
  achievedAmount: zod.number(),
  goalQuantity: zod.number().nullish(),
  achievedQuantity: zod.number().nullish(),
  progressPercentage: zod.number().nullish(),
  bonusAmount: zod.number().nullish(),
  bonusPaid: zod.boolean(),
  status: zod.string(),
  createdAt: zod.string(),
  updatedAt: zod.string(),
});
export const ListSalesGoalsResponse = zod.array(ListSalesGoalsResponseItem);

/**
 * @summary Create a sales goal
 */
export const CreateSalesGoalBody = zod.object({
  userId: zod.string(),
  periodType: zod.string().optional(),
  year: zod.number().optional(),
  month: zod.string(),
  monthInt: zod.number().optional(),
  quarter: zod.number().optional(),
  goalAmount: zod.number(),
  goalQuantity: zod.number().optional(),
  bonusAmount: zod.number().optional(),
});

/**
 * @summary Update a sales goal
 */
export const UpdateSalesGoalParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateSalesGoalBody = zod.object({
  goalAmount: zod.number().nullish(),
  achievedAmount: zod.number().nullish(),
  goalQuantity: zod.number().nullish(),
  achievedQuantity: zod.number().nullish(),
  progressPercentage: zod.number().nullish(),
  bonusAmount: zod.number().nullish(),
  bonusPaid: zod.boolean().nullish(),
  status: zod.string().nullish(),
});

export const UpdateSalesGoalResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  userId: zod.string(),
  periodType: zod.string(),
  year: zod.number().nullish(),
  month: zod.string(),
  monthInt: zod.number().nullish(),
  quarter: zod.number().nullish(),
  goalAmount: zod.number(),
  achievedAmount: zod.number(),
  goalQuantity: zod.number().nullish(),
  achievedQuantity: zod.number().nullish(),
  progressPercentage: zod.number().nullish(),
  bonusAmount: zod.number().nullish(),
  bonusPaid: zod.boolean(),
  status: zod.string(),
  createdAt: zod.string(),
  updatedAt: zod.string(),
});

/**
 * @summary Delete a sales goal
 */
export const DeleteSalesGoalParams = zod.object({
  id: zod.coerce.string(),
});

/**
 * @summary Update commission status
 */
export const UpdateCommissionParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateCommissionBody = zod.object({
  status: zod.string().optional(),
  paidAt: zod.string().optional(),
});

export const UpdateCommissionResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  ruleId: zod.string().nullish(),
  userId: zod.string(),
  reservationId: zod.string().nullish(),
  baseAmount: zod.string(),
  commissionAmount: zod.string(),
  commissionRate: zod.string().nullish(),
  commissionType: zod.string().nullish(),
  status: zod.string(),
  paidAt: zod.string().nullish(),
  createdAt: zod.string(),
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
  page: zod.coerce.number().default(listReferralsQueryPageDefault),
  limit: zod.coerce.number().default(listReferralsQueryLimitDefault),
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
      visitsCount: zod.number(),
      firstVisit: zod.string().nullish(),
      lastVisit: zod.string().nullish(),
      expiresAt: zod.string().nullish(),
      isActive: zod.boolean(),
      reservationId: zod.string().nullish(),
      notes: zod.string().nullish(),
      convertedAt: zod.string().nullish(),
      reversalReason: zod.string().nullish(),
      reversalAt: zod.string().nullish(),
      bonusReleasesAt: zod.string().nullish(),
      bonusBlocked: zod.boolean().optional(),
      referrerWhatsapp: zod.string().nullish(),
      referrerSuccessfulReferrals: zod.number().optional(),
      createdAt: zod.string(),
      updatedAt: zod.string(),
    }),
  ),
  pagination: zod.object({
    page: zod.number(),
    limit: zod.number(),
    total: zod.number(),
    totalPages: zod.number(),
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

/**
 * @summary Get referral statistics for the tenant
 */
export const GetReferralStatsResponse = zod.object({
  total: zod.number(),
  pending: zod.number(),
  completed: zod.number(),
  expired: zod.number(),
  conversionRate: zod.number(),
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

export const ReverseReferralBonusBody = zod.object({
  reason: zod.string().min(1),
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
  visitsCount: zod.number(),
  firstVisit: zod.string().nullish(),
  lastVisit: zod.string().nullish(),
  expiresAt: zod.string().nullish(),
  isActive: zod.boolean(),
  reservationId: zod.string().nullish(),
  notes: zod.string().nullish(),
  convertedAt: zod.string().nullish(),
  createdAt: zod.string(),
  updatedAt: zod.string(),
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
  maxUses: zod.number().nullish(),
  usedCount: zod.number(),
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
  maxUses: zod.number().optional(),
  isActive: zod.boolean().optional(),
  validFrom: zod.string().optional(),
  validUntil: zod.string().optional(),
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
  maxUses: zod.number().optional(),
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
  maxUses: zod.number().nullish(),
  usedCount: zod.number(),
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
  daysUntil: zod.number().nullish(),
  birthdayMessage: zod
    .union([
      zod.object({
        id: zod.string(),
        tenantId: zod.string(),
        clientId: zod.string(),
        birthdayYear: zod.number(),
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
  daysUntil: zod.number().nullish(),
  birthdayMessage: zod
    .union([
      zod.object({
        id: zod.string(),
        tenantId: zod.string(),
        clientId: zod.string(),
        birthdayYear: zod.number(),
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
  limit: zod.coerce.number().optional(),
  year: zod.coerce.number().optional(),
});

export const GetBirthdayHistoryResponseItem = zod
  .object({
    id: zod.string(),
    tenantId: zod.string(),
    clientId: zod.string(),
    birthdayYear: zod.number(),
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
            daysUntil: zod.number().nullish(),
            birthdayMessage: zod
              .union([
                zod.object({
                  id: zod.string(),
                  tenantId: zod.string(),
                  clientId: zod.string(),
                  birthdayYear: zod.number(),
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
  totalSentYear: zod.number(),
  sentThisMonth: zod.number(),
  whatsappSent: zod.number(),
  emailSent: zod.number(),
  emailOpened: zod.number(),
  converted: zod.number(),
  conversionRate: zod.number(),
  todayCount: zod.number(),
  upcomingWeek: zod.number(),
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
  discountPercent: zod.number(),
  validDays: zod.number(),
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
  discountPercent: zod.number(),
  validDays: zod.number(),
  sendWhatsapp: zod.boolean(),
  sendEmail: zod.boolean(),
  whatsappMessage: zod.string().nullish(),
  emailSubject: zod.string().nullish(),
  emailMessage: zod.string().nullish(),
  senderName: zod.string().nullish(),
});

export const UpdateBirthdaySettingsResponse = zod.object({
  enabled: zod.boolean(),
  discountPercent: zod.number(),
  validDays: zod.number(),
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
  sizeBytes: zod.number().nullish(),
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
  sizeBytes: zod.number().optional(),
  entityType: zod.string().optional(),
  entityId: zod.string().optional(),
});

/**
 * @summary Delete a document
 */
export const DeleteDocumentParams = zod.object({
  id: zod.coerce.string(),
});

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
  minRedeemPoints: zod.number(),
  isActive: zod.boolean(),
  createdAt: zod.string(),
});
export const ListLoyaltyProgramsResponse = zod.array(
  ListLoyaltyProgramsResponseItem,
);

/**
 * @summary Create a loyalty program
 */
export const CreateLoyaltyProgramBody = zod.object({
  name: zod.string(),
  description: zod.string().optional(),
  pointsPerReal: zod.string().optional(),
  realPerPoint: zod.string().optional(),
  minRedeemPoints: zod.number().optional(),
});

/**
 * @summary Update a loyalty program
 */
export const UpdateLoyaltyProgramParams = zod.object({
  id: zod.coerce.string(),
});

export const UpdateLoyaltyProgramBody = zod.object({
  name: zod.string().optional(),
  description: zod.string().optional(),
  pointsPerReal: zod.string().optional(),
  realPerPoint: zod.string().optional(),
  minRedeemPoints: zod.number().optional(),
  tierBenefits: zod.record(zod.string(), zod.array(zod.string())).nullable().optional(),
});

export const UpdateLoyaltyProgramResponse = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  name: zod.string(),
  description: zod.string().nullish(),
  pointsPerReal: zod.string(),
  realPerPoint: zod.string(),
  minRedeemPoints: zod.number(),
  isActive: zod.boolean(),
  tierBenefits: zod.record(zod.string(), zod.array(zod.string())).nullish(),
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
  totalPoints: zod.number(),
  availablePoints: zod.number(),
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

/**
 * @summary List loyalty transactions
 */
export const ListLoyaltyTransactionsResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  memberId: zod.string(),
  programId: zod.string(),
  type: zod.string(),
  points: zod.number(),
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
  points: zod.number(),
  description: zod.string().optional(),
  referenceId: zod.string().optional(),
  referenceType: zod.string().optional(),
});

/**
 * @summary Sync loyalty points from paid payments
 */
export const SyncLoyaltyPointsResponse = zod.object({
  membersUpdated: zod.number(),
  transactionsCreated: zod.number(),
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
  sortOrder: zod.number(),
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
  sortOrder: zod.number().optional(),
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
  sortOrder: zod.number().optional(),
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
  sortOrder: zod.number(),
  createdAt: zod.string(),
});

/**
 * @summary Delete a product category
 */
export const DeleteProductCategoryParams = zod.object({
  id: zod.coerce.string(),
});

/**
 * @summary List product images
 */
export const ListProductImagesResponseItem = zod.object({
  id: zod.string(),
  productId: zod.string(),
  tenantId: zod.string(),
  url: zod.string(),
  altText: zod.string().nullish(),
  sortOrder: zod.number(),
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
  sortOrder: zod.number().optional(),
});

/**
 * @summary Delete a product image
 */
export const DeleteProductImageParams = zod.object({
  id: zod.coerce.string(),
});

/**
 * @summary List cart items
 */
export const ListCartItemsResponseItem = zod.object({
  id: zod.string(),
  tenantId: zod.string(),
  clientId: zod.string(),
  productId: zod.string(),
  quantity: zod.number(),
  addedAt: zod.string(),
});
export const ListCartItemsResponse = zod.array(ListCartItemsResponseItem);

/**
 * @summary Add item to cart
 */
export const CreateCartItemBody = zod.object({
  clientId: zod.string(),
  productId: zod.string(),
  quantity: zod.number().optional(),
});

/**
 * @summary Remove item from cart
 */
export const DeleteCartItemParams = zod.object({
  id: zod.coerce.string(),
});

/**
 * @summary List automation actions
 */
export const ListAutomationActionsResponseItem = zod.object({
  id: zod.string(),
  automationId: zod.string(),
  tenantId: zod.string(),
  type: zod.string(),
  config: zod.object({}).passthrough(),
  order: zod.number(),
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
  order: zod.number().optional(),
  isActive: zod.boolean().optional(),
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
  order: zod.number().optional(),
  isActive: zod.boolean().optional(),
});

export const UpdateAutomationActionResponse = zod.object({
  id: zod.string(),
  automationId: zod.string(),
  tenantId: zod.string(),
  type: zod.string(),
  config: zod.object({}).passthrough(),
  order: zod.number(),
  isActive: zod.boolean(),
  createdAt: zod.string(),
});

/**
 * @summary Delete an automation action
 */
export const DeleteAutomationActionParams = zod.object({
  id: zod.coerce.string(),
});

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
  total: zod.number(),
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
  status: zod.string().nullish(),
  tokenValid: zod.boolean().optional(),
  eventsCount: zod.number(),
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
  synced: zod.number(),
});

/**
 * Receives the authorization code from Google after the user grants access. Verifies the HMAC-signed `state` parameter, exchanges the code for tokens, persists them in the users table, triggers an initial syncAll, and redirects back to the Configurações page with a `?gcal=connected|denied|error` query parameter.

 * @summary Google OAuth2 callback (server-side redirect handler)
 */
export const RepairSystemHealthResponse = zod.object({
  orphansFixed: zod.number(),
});
export type RepairSystemHealthResponse = zod.infer<typeof RepairSystemHealthResponse>;

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

/**
 * @summary Get insights summary for all 7 strategic pillars
 */
export const GetInsightsSummaryQueryParams = zod.object({
  period: zod.enum(["month", "quarter", "year"]).optional(),
});

export const GetInsightsSummaryResponse = zod.object({
  period: zod.string(),
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
    campaignsByType: zod.array(zod.object({ type: zod.string(), count: zod.number() })),
  }),
  financial: zod.object({
    totalRevenue: zod.number(),
    totalRevenuePrev: zod.number(),
    totalExpenses: zod.number(),
    totalExpensesPrev: zod.number(),
    netProfit: zod.number(),
    netProfitPrev: zod.number(),
    profitMargin: zod.number(),
    profitMarginPrev: zod.number(),
    commissions: zod.number(),
    commissionsPrev: zod.number(),
    receivable: zod.number(),
    payable: zod.number(),
    overdue: zod.number(),
    avgTicket: zod.number(),
    avgTicketPrev: zod.number(),
    expenseCategories: zod.array(zod.object({ category: zod.string(), total: zod.number() })),
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
    topDestinations: zod.array(zod.object({ name: zod.string(), count: zod.number() })),
    avgTicket: zod.number(),
    avgTicketPrev: zod.number(),
    totalRevenue: zod.number(),
    totalRevenuePrev: zod.number(),
    momGrowth: zod.number().nullable(),
    yoyGrowth: zod.number().nullable(),
  }),
});

/**
 * @summary Get sales cycle metrics (avg days from registration to payment/trip)
 */
export const GetSalesCycleQueryParams = zod.object({
  period: zod.enum(["30d", "90d", "12m"]).optional(),
  channel: zod.string().optional(),
  seller: zod.string().optional(),
});

export const GetSalesCycleResponse = zod.object({
  period: zod.string(),
  avgDaysToPayment: zod.number().nullable(),
  medianDaysToPayment: zod.number().nullable(),
  p25DaysToPayment: zod.number().nullable(),
  p75DaysToPayment: zod.number().nullable(),
  avgDaysToTrip: zod.number().nullable(),
  medianDaysToTrip: zod.number().nullable(),
  totalClients: zod.number(),
  clientsWithPayment: zod.number(),
  clientsWithTrip: zod.number(),
  byChannel: zod.array(zod.object({
    origin: zod.string(),
    clients: zod.number(),
    avgDaysToPayment: zod.number().nullable(),
    avgDaysToTrip: zod.number().nullable(),
    conversionRate: zod.number(),
  })),
  bySeller: zod.array(zod.object({
    sellerId: zod.string(),
    sellerName: zod.string(),
    clients: zod.number(),
    avgDaysToPayment: zod.number().nullable(),
    conversionRate: zod.number(),
  })),
  trend: zod.array(zod.object({
    month: zod.string(),
    avgDaysToPayment: zod.number().nullable(),
    avgDaysToTrip: zod.number().nullable(),
  })),
});
