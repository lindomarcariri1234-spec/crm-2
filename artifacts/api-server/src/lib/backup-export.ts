import type { Response } from "express";
import {
  usersTable,
  clientsTable,
  reservationsTable,
  passengersTable,
  reservationInstallmentsTable,
  storesTable,
  storeCategoriesTable,
  storeProductsTable,
  storeCouponsTable,
  storeOrdersTable,
  storeOrderItemsTable,
  storePagesTable,
  storeReviewsTable,
  paymentsTable,
  expensesTable,
  tenantsTable,
  vehiclesTable,
  vehicleLayoutsTable,
  boardingLocationsTable,
  commissionRulesTable,
  commissionsTable,
  pipelinesTable,
  pipelineStagesTable,
  dealsTable,
  loyaltyProgramsTable,
  loyaltyMembersTable,
  loyaltyTransactionsTable,
  referralSettingsTable,
  referralCampaignsTable,
  referralsTable,
  referralCommissionsTable,
  salesGoalsTable,
  couponsTable,
  documentsTable,
  notesTable,
  messageTemplatesTable,
  automationsTable,
  automationActionsTable,
  tripCostsTable,
  tripMediaTable,
  clientAchievementsTable,
  clientDreamDestinationsTable,
  clientFavoritesTable,
  suppliersTable,
  accommodationsTable,
  destinationsTable,
  clubConfigTable,
  clubBenefitsTable,
  settlementItemsTable,
  financialLedgerEntriesTable,
  partnersTable,
  partnerProductsTable,
  partnerAvailabilityTable,
  partnerCommissionsTable,
  campaignsTable,
  calendarEventsTable,
  productCategoriesTable,
  productImagesTable,
  productsTable,
  ordersTable,
  orderItemsTable,
  npsResponsesTable,
  clientNpsResponsesTable,
  npsInvitationsTable,
  clientScoresTable,
  priceAlertSubscriptionsTable,
  invitesTable,
  tripCheckinsTable,
} from "@workspace/db";
import { writeExportChunk } from "../routes/trips.js";

export { writeExportChunk };

// Format version for the full-agency JSON backup. Bump whenever the shape of
// any section below changes in a way a future importer needs to know about.
//
// v2 added: vehicleLayouts, boardingLocations (referenced by trips/reservations/
// store orders — required for referential integrity on a future restore),
// commissions (rules + records), pipeline (pipelines/stages/deals), loyalty
// (programs/members/transactions), referrals (settings/campaigns/records/
// commissions), salesGoals, coupons (agency-wide, distinct from store coupons).
//
// v3 added: vehicles (referenced by trips.vehicleId), store categories
// (referenced by storeProducts.categoryId), store pages, store reviews,
// and reservation installments (embedded per-reservation, like passengers) —
// closing referential-integrity gaps found by a completeness review.
//
// v4 added: documents, message templates, automations (with their actions),
// and three groups of durable per-record content nested under their parent —
// trip costs + trip media (embedded per-trip, like passengers under a
// reservation) and client notes + achievements + dream destinations +
// favorites (embedded per-client) — closing a second completeness gap: durable
// business/financial content that isn't a log, credential, or ephemeral
// tracking row still belongs in a "full agency" backup even when it wasn't
// one of the top-level entities named in the original spec.
//
// v5 added: suppliers, accommodations, destinations (standalone registration
// tables referenced by trip costs / expenses / trip planning), club
// (config + tier benefits), settlements (settlement items + the append-only
// financial ledger), and partners (marketplace partners + their products,
// availability, and commission records, password hash excluded) — closing a
// third completeness gap found by review: financial/settlement records and
// marketplace-partner data that other already-exported rows (store order
// items' partnerId/partnerProductId, settlement items' sellerId, trip
// costs'/expenses' supplierId) reference by id would otherwise be dangling.
//
// v6: formatBackupOrderItem now includes partnerId/partnerProductId/metadata
// (checkout-time seller attribution was being silently dropped, breaking the
// v5 partners/settlements completeness goal). Added: campaigns, calendar
// events, the marketing module's parallel product catalog + orders (distinct
// from the storefront's storeProducts/storeOrders, its own CRUD routes),
// e-commerce + client NPS responses/invitations, per-client RFM scores,
// store price-alert subscriptions, pending team invites, and trip check-ins —
// closing a fourth completeness gap: every durable, tenant-owned,
// non-secret, non-log table must be in the backup, not just the ones named
// explicitly in a feature spec or an earlier review pass. Deliberately still
// excluded, and expected to stay excluded barring a scope change: delivery/
// execution logs (campaign_sends, automation_logs, birthday_messages,
// chatbot/message transcripts, audit_logs, whatsapp outbox, trip import
// batches, integration logs), ephemeral tracking (guide GPS pings, referral
// attempt/tracking logs), AI-generated/derived insight feeds (gemeo alerts/
// opportunities, insights chat history), platform/billing records that
// belong to the tenant's relationship with the SaaS platform rather than its
// own tourism business (plans, invoices, feature flags, subscriptions,
// platform settings, usage tracking), and anything holding a credential or
// bearer token (AI/tenant integration secrets, guide tokens, invite/NPS
// invitation tokens — the invite/NPS invitation records themselves ARE
// exported, with only the token field stripped). Distribution/marketplace-
// sync tables (distribution offers/operations/bookings) are also deliberately
// excluded as a documented boundary: offers are a resynced cache of a third-
// party catalog and operations are an idempotency/execution log, so exporting
// bookings alone would still create a dangling offerId reference.
export const BACKUP_FORMAT_VERSION = 6;

// Same batch size used by the existing trips/reservations exports — keeps
// memory bounded regardless of tenant size.
export const BACKUP_BATCH_SIZE = 500;

/**
 * Generic cursor-paginated section writer. Streams a JSON array (without the
 * surrounding brackets — callers write those) directly to the response,
 * never materializing the full result set in memory.
 */
export async function streamArraySection<TRow, TCursor>(opts: {
  res: Response;
  fetchBatch: (cursor: TCursor | undefined) => Promise<TRow[]>;
  getCursor: (row: TRow) => TCursor;
  formatRow: (row: TRow) => unknown;
  batchSize: number;
}): Promise<number> {
  let cursor: TCursor | undefined;
  let count = 0;
  while (true) {
    const batch = await opts.fetchBatch(cursor);
    if (batch.length === 0) break;
    for (const row of batch) {
      const formatted = opts.formatRow(row);
      await writeExportChunk(opts.res, `${count > 0 ? "," : ""}${JSON.stringify(formatted)}`);
      count++;
    }
    cursor = opts.getCursor(batch[batch.length - 1]);
    if (batch.length < opts.batchSize) break;
  }
  return count;
}

// ── Formatters ────────────────────────────────────────────────────────────
// Every formatter below explicitly excludes authentication secrets and
// payment-gateway credentials, per the backup's non-negotiable requirement:
// no Clerk IDs, no Google OAuth tokens, no gateway secret/access keys.

export function formatBackupTenant(t: typeof tenantsTable.$inferSelect) {
  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    email: t.email,
    cnpj: t.cnpj,
    address: t.address,
    city: t.city,
    state: t.state,
    zipCode: t.zipCode,
    whatsapp: t.whatsapp,
    phone: t.phone,
    logoUrl: t.logoUrl,
    primaryColor: t.primaryColor,
    secondaryColor: t.secondaryColor,
    planId: t.planId,
    status: t.status,
    trialEndsAt: t.trialEndsAt?.toISOString() ?? null,
    limits: t.limits ?? {},
    settings: t.settings ?? {},
    website: t.website,
    reservationPrefix: t.reservationPrefix,
    prefixLocked: t.prefixLocked,
    lastClientSeq: t.lastClientSeq,
    maxUsersOverride: t.maxUsersOverride,
    maxClientsOverride: t.maxClientsOverride,
    maxTripsOverride: t.maxTripsOverride,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// Excludes: clerkId (auth), googleAccessToken/googleRefreshToken/googleTokenExpiry (OAuth secrets)
export function formatBackupUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    cpf: u.cpf,
    avatarUrl: u.avatarUrl,
    role: u.role,
    isActive: u.isActive,
    referralCode: u.referralCode,
    referralBalance: Number(u.referralBalance),
    commissionType: u.commissionType,
    commissionRate: Number(u.commissionRate ?? 0),
    commissionFixed: Number(u.commissionFixed ?? 0),
    monthlyGoal: u.monthlyGoal != null ? Number(u.monthlyGoal) : null,
    googleCalendarEnabled: u.googleCalendarEnabled,
    googleCalendarStatus: u.googleCalendarStatus,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}

export function formatBackupClient(c: typeof clientsTable.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    email: c.email,
    whatsapp: c.whatsapp,
    phone: c.phone,
    cpf: c.cpf,
    rg: c.rg,
    birthDate: c.birthDate?.toISOString() ?? null,
    gender: c.gender,
    maritalStatus: c.maritalStatus,
    photoUrl: c.photoUrl,
    instagram: c.instagram,
    origin: c.origin,
    addressZipcode: c.addressZipcode,
    addressStreet: c.addressStreet,
    addressNumber: c.addressNumber,
    addressComplement: c.addressComplement,
    addressNeighborhood: c.addressNeighborhood,
    addressCity: c.addressCity,
    addressState: c.addressState,
    addressCountry: c.addressCountry,
    totalSpent: Number(c.totalSpent),
    outstandingBalance: Number(c.outstandingBalance),
    observations: c.observations,
    npsScore: c.npsScore,
    companyFeedback: c.companyFeedback,
    dreamDestinations: c.dreamDestinations ?? [],
    professionalArea: c.professionalArea,
    favoriteDrink: c.favoriteDrink,
    numberOfChildren: c.numberOfChildren,
    travelPreference: c.travelPreference,
    musicalPreferences: c.musicalPreferences,
    foodPreferences: c.foodPreferences,
    travelInterests: c.travelInterests ?? [],
    likesPhotosVideos: c.likesPhotosVideos,
    preferredDestinationTypes: c.preferredDestinationTypes ?? [],
    internalRating: c.internalRating,
    companyNps: c.companyNps,
    classification: c.classification,
    status: c.status,
    tags: c.tags ?? [],
    pipelineStage: c.pipelineStage,
    createdById: c.createdById,
    userId: c.userId,
    referralCode: c.referralCode,
    referralCodeStatus: c.referralCodeStatus,
    referredById: c.referredById,
    totalReferrals: c.totalReferrals,
    successfulReferrals: c.successfulReferrals,
    referralEarnings: Number(c.referralEarnings),
    whatsappOptIn: c.whatsappOptIn,
    emailOptIn: c.emailOptIn,
    ambassadorOptIn: c.ambassadorOptIn,
    customerCode: c.customerCode,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    lastContactAt: c.lastContactAt?.toISOString() ?? null,
  };
}

export function formatBackupPassenger(p: typeof passengersTable.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    cpf: p.cpf,
    rg: p.rg,
    birthDate: p.birthDate?.toISOString() ?? null,
    ageCategory: p.ageCategory,
    seatNumber: p.seatNumber,
    isChildUnder7: p.isChildUnder7,
    isPrimary: p.isPrimary,
    checkedInAt: p.checkedInAt?.toISOString() ?? null,
    boardingLocationId: p.boardingLocationId,
    disembarkLocationId: p.disembarkLocationId,
    phone: p.phone,
    observations: p.observations,
    specialNeeds: p.specialNeeds,
    documentType: p.documentType,
  };
}

export function formatBackupReservationInstallment(i: typeof reservationInstallmentsTable.$inferSelect) {
  return {
    id: i.id,
    installmentNumber: i.installmentNumber,
    dueDate: i.dueDate.toISOString(),
    amount: Number(i.amount),
    paidAmount: i.paidAmount != null ? Number(i.paidAmount) : null,
    paidAt: i.paidAt?.toISOString() ?? null,
    notes: i.notes,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}

export function formatBackupReservation(
  r: typeof reservationsTable.$inferSelect,
  passengers: ReturnType<typeof formatBackupPassenger>[],
  installments: ReturnType<typeof formatBackupReservationInstallment>[],
) {
  return {
    id: r.id,
    tripId: r.tripId,
    clientId: r.clientId,
    seats: r.seats ?? [],
    tripType: r.tripType,
    packageType: r.packageType,
    hasInsurance: r.hasInsurance,
    isGratuidade: r.isGratuidade,
    totalValue: Number(r.totalValue),
    paidValue: Number(r.paidValue),
    balance: Number(r.balance),
    depositAmount: r.depositAmount != null ? Number(r.depositAmount) : null,
    paymentMethod: r.paymentMethod,
    installments: r.installments,
    commissionPercentage: r.commissionPercentage != null ? Number(r.commissionPercentage) : null,
    commissionAmount: r.commissionAmount != null ? Number(r.commissionAmount) : null,
    commissionSyncStatus: r.commissionSyncStatus,
    sellerId: r.sellerId,
    status: r.status,
    voucherCode: r.voucherCode,
    reservationNumber: r.reservationNumber,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    notes: r.notes,
    boardingLocationId: r.boardingLocationId,
    storeOrderId: r.storeOrderId,
    discountCouponCode: r.discountCouponCode,
    discountCouponAmount: r.discountCouponAmount != null ? Number(r.discountCouponAmount) : null,
    discountLoyaltyPoints: r.discountLoyaltyPoints,
    discountLoyaltyAmount: r.discountLoyaltyAmount != null ? Number(r.discountLoyaltyAmount) : null,
    discountReferralCode: r.discountReferralCode,
    discountReferralAmount: r.discountReferralAmount != null ? Number(r.discountReferralAmount) : null,
    discountTotal: r.discountTotal != null ? Number(r.discountTotal) : null,
    createdById: r.createdById,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    passengers,
    // Named `installmentSchedule` (not `installments`) because the
    // reservation row already has a plain `installments` count field above.
    installmentSchedule: installments,
  };
}

// Excludes: stripeSecretKey, stripeWebhookSecret, mpAccessToken (payment-gateway secrets)
export function formatBackupStore(s: typeof storesTable.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    tagline: s.tagline,
    description: s.description,
    logo: s.logo,
    logoDark: s.logoDark,
    favicon: s.favicon,
    bannerHome: s.bannerHome,
    bannerMobile: s.bannerMobile,
    primaryColor: s.primaryColor,
    secondaryColor: s.secondaryColor,
    accentColor: s.accentColor,
    customDomain: s.customDomain,
    domainVerified: s.domainVerified,
    sslEnabled: s.sslEnabled,
    email: s.email,
    phone: s.phone,
    whatsapp: s.whatsapp,
    address: s.address,
    city: s.city,
    state: s.state,
    zipCode: s.zipCode,
    facebookUrl: s.facebookUrl,
    instagramUrl: s.instagramUrl,
    twitterUrl: s.twitterUrl,
    youtubeUrl: s.youtubeUrl,
    linkedinUrl: s.linkedinUrl,
    tiktokUrl: s.tiktokUrl,
    metaTitle: s.metaTitle,
    metaDescription: s.metaDescription,
    metaKeywords: s.metaKeywords,
    googleAnalyticsId: s.googleAnalyticsId,
    facebookPixelId: s.facebookPixelId,
    googleTagManagerId: s.googleTagManagerId,
    requireLogin: s.requireLogin,
    guestCheckout: s.guestCheckout,
    minInstallments: s.minInstallments,
    maxInstallments: s.maxInstallments,
    installmentFee: Number(s.installmentFee),
    minOrderValue: s.minOrderValue != null ? Number(s.minOrderValue) : null,
    minDepositAmount: s.minDepositAmount != null ? Number(s.minDepositAmount) : null,
    paymentMethods: s.paymentMethods ?? [],
    stripeEnabled: s.stripeEnabled,
    stripePublicKey: s.stripePublicKey,
    mpEnabled: s.mpEnabled,
    mpPublicKey: s.mpPublicKey,
    pixEnabled: s.pixEnabled,
    pixKey: s.pixKey,
    pixKeyType: s.pixKeyType,
    boletoEnabled: s.boletoEnabled,
    termsOfService: s.termsOfService,
    privacyPolicy: s.privacyPolicy,
    refundPolicy: s.refundPolicy,
    cancellationPolicy: s.cancellationPolicy,
    termsUrl: s.termsUrl,
    privacyUrl: s.privacyUrl,
    notificationEmail: s.notificationEmail,
    orderNotificationEnabled: s.orderNotificationEnabled,
    isActive: s.isActive,
    maintenanceMode: s.maintenanceMode,
    maintenanceMessage: s.maintenanceMessage,
    totalOrders: s.totalOrders,
    totalRevenue: Number(s.totalRevenue),
    totalVisits: s.totalVisits,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function formatBackupStoreCategory(c: typeof storeCategoriesTable.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    icon: c.icon,
    image: c.image,
    parentId: c.parentId,
    metaTitle: c.metaTitle,
    metaDescription: c.metaDescription,
    order: c.order,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function formatBackupStoreProduct(p: typeof storeProductsTable.$inferSelect) {
  return {
    id: p.id,
    type: p.type,
    name: p.name,
    slug: p.slug,
    description: p.description,
    shortDescription: p.shortDescription,
    categoryId: p.categoryId,
    price: Number(p.price),
    comparePrice: p.comparePrice != null ? Number(p.comparePrice) : null,
    costPrice: p.costPrice != null ? Number(p.costPrice) : null,
    onSale: p.onSale,
    salePrice: p.salePrice != null ? Number(p.salePrice) : null,
    saleStartsAt: p.saleStartsAt?.toISOString() ?? null,
    saleEndsAt: p.saleEndsAt?.toISOString() ?? null,
    trackInventory: p.trackInventory,
    stockQuantity: p.stockQuantity,
    allowBackorder: p.allowBackorder,
    hasDates: p.hasDates,
    startDate: p.startDate?.toISOString() ?? null,
    endDate: p.endDate?.toISOString() ?? null,
    images: p.images ?? [],
    thumbnail: p.thumbnail,
    gallery: p.gallery ?? [],
    features: p.features ?? [],
    includes: p.includes ?? [],
    excludes: p.excludes ?? [],
    requirements: p.requirements ?? [],
    destination: p.destination,
    durationDays: p.durationDays,
    durationNights: p.durationNights,
    productCity: p.productCity,
    productState: p.productState,
    country: p.country,
    hasVariants: p.hasVariants,
    variants: p.variants ?? [],
    metaTitle: p.metaTitle,
    metaDescription: p.metaDescription,
    metaKeywords: p.metaKeywords,
    tripId: p.tripId,
    isFeatured: p.isFeatured,
    order: p.order,
    ratingAverage: p.ratingAverage != null ? Number(p.ratingAverage) : null,
    ratingCount: p.ratingCount,
    status: p.status,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    viewsCount: p.viewsCount,
    salesCount: p.salesCount,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function formatBackupStoreCoupon(c: typeof storeCouponsTable.$inferSelect) {
  return {
    id: c.id,
    code: c.code,
    type: c.type,
    value: Number(c.value),
    description: c.description,
    minPurchaseAmount: c.minPurchaseAmount != null ? Number(c.minPurchaseAmount) : null,
    maxDiscountAmount: c.maxDiscountAmount != null ? Number(c.maxDiscountAmount) : null,
    usageLimit: c.usageLimit,
    usageLimitPerCustomer: c.usageLimitPerCustomer,
    usageCount: c.usageCount,
    startsAt: c.startsAt.toISOString(),
    expiresAt: c.expiresAt.toISOString(),
    applicableProducts: c.applicableProducts ?? [],
    applicableCategories: c.applicableCategories ?? [],
    minimumItems: c.minimumItems,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function formatBackupStorePage(p: typeof storePagesTable.$inferSelect) {
  return {
    id: p.id,
    title: p.title,
    slug: p.slug,
    content: p.content,
    metaTitle: p.metaTitle,
    metaDescription: p.metaDescription,
    isPublished: p.isPublished,
    showInMenu: p.showInMenu,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// clientId is kept (it's the reviewer's own CRM client, core business data —
// not a secret); no payment/session data exists on this table.
export function formatBackupStoreReview(r: typeof storeReviewsTable.$inferSelect) {
  return {
    id: r.id,
    productId: r.productId,
    clientId: r.clientId,
    reviewerName: r.reviewerName,
    reviewerEmail: r.reviewerEmail,
    rating: r.rating,
    title: r.title,
    comment: r.comment,
    images: r.images ?? [],
    verifiedPurchase: r.verifiedPurchase,
    status: r.status,
    isFeatured: r.isFeatured,
    reply: r.reply,
    repliedAt: r.repliedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function formatBackupOrderItem(i: typeof storeOrderItemsTable.$inferSelect) {
  return {
    id: i.id,
    productId: i.productId,
    productName: i.productName,
    productType: i.productType,
    productImage: i.productImage,
    variant: i.variant ?? null,
    price: Number(i.price),
    quantity: i.quantity,
    subtotal: Number(i.subtotal),
    discount: Number(i.discount),
    total: Number(i.total),
    metadata: i.metadata ?? null,
    // Checkout-time seller attribution snapshot — resolves against the
    // exported partners[].id / partners[].products[].id, independent of
    // whether the partner/product still exists or was later reassigned.
    partnerId: i.partnerId,
    partnerProductId: i.partnerProductId,
    sellerName: i.sellerName,
    itemStatus: i.itemStatus,
    voucherCode: i.voucherCode,
    cancellationReason: i.cancellationReason,
    cancellationRequestedAt: i.cancellationRequestedAt?.toISOString() ?? null,
    cancelledAt: i.cancelledAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
  };
}

// Excludes: paymentIntentId/paymentChargeId/paymentToken are gateway transaction
// references generated by Stripe/MP/PIX, not credentials — kept for reference,
// but no gateway API keys ever pass through this table.
export function formatBackupStoreOrder(
  o: typeof storeOrdersTable.$inferSelect,
  items: ReturnType<typeof formatBackupOrderItem>[],
) {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    clientId: o.clientId,
    customerName: o.customerName,
    customerEmail: o.customerEmail,
    customerPhone: o.customerPhone,
    customerCpf: o.customerCpf,
    customerBirthdate: o.customerBirthdate,
    customerAddress: o.customerAddress ?? null,
    subtotal: Number(o.subtotal),
    discountAmount: Number(o.discountAmount),
    taxAmount: Number(o.taxAmount),
    shippingAmount: Number(o.shippingAmount),
    totalAmount: Number(o.totalAmount),
    couponId: o.couponId,
    couponCode: o.couponCode,
    paymentMethod: o.paymentMethod,
    paymentProvider: o.paymentProvider,
    paymentStatus: o.paymentStatus,
    installments: o.installments,
    installmentAmount: o.installmentAmount != null ? Number(o.installmentAmount) : null,
    depositAmount: o.depositAmount != null ? Number(o.depositAmount) : null,
    amountRemaining: o.amountRemaining != null ? Number(o.amountRemaining) : null,
    status: o.status,
    fulfillmentStatus: o.fulfillmentStatus,
    customerNotes: o.customerNotes,
    internalNotes: o.internalNotes,
    boardingLocationId: o.boardingLocationId,
    seats: o.seats ?? [],
    coPassengers: o.coPassengers ?? [],
    paidAt: o.paidAt?.toISOString() ?? null,
    confirmedAt: o.confirmedAt?.toISOString() ?? null,
    completedAt: o.completedAt?.toISOString() ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    refundedAt: o.refundedAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    items,
  };
}

export function formatBackupPayment(p: typeof paymentsTable.$inferSelect) {
  return {
    id: p.id,
    reservationId: p.reservationId,
    clientId: p.clientId,
    orderId: p.orderId,
    type: p.type,
    category: p.category,
    amount: Number(p.amount),
    paymentMethod: p.paymentMethod,
    installmentNumber: p.installmentNumber,
    totalInstallments: p.totalInstallments,
    dueDate: p.dueDate.toISOString(),
    paidAt: p.paidAt?.toISOString() ?? null,
    status: p.status,
    receiptUrl: p.receiptUrl,
    gateway: p.gateway,
    transactionId: p.transactionId,
    description: p.description,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function formatBackupExpense(e: typeof expensesTable.$inferSelect) {
  return {
    id: e.id,
    tripId: e.tripId,
    category: e.category,
    description: e.description,
    amount: Number(e.amount),
    supplierId: e.supplierId,
    paymentMethod: e.paymentMethod,
    paymentDate: e.paymentDate?.toISOString() ?? null,
    dueDate: e.dueDate.toISOString(),
    receiptUrl: e.receiptUrl,
    status: e.status,
    notes: e.notes,
    createdById: e.createdById,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

// Referenced by trips.layoutId (seat map used to render a trip's vehicle).
export function formatBackupVehicleLayout(l: typeof vehicleLayoutsTable.$inferSelect) {
  return {
    id: l.id,
    name: l.name,
    description: l.description,
    vehicleType: l.vehicleType,
    rows: l.rows,
    cols: l.cols,
    floors: l.floors,
    numberingType: l.numberingType,
    cells: l.cells ?? [],
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

// Referenced by reservations.boardingLocationId and storeOrders.boardingLocationId.
export function formatBackupBoardingLocation(b: typeof boardingLocationsTable.$inferSelect) {
  return {
    id: b.id,
    name: b.name,
    address: b.address,
    city: b.city,
    state: b.state,
    reference: b.reference,
    departureTime: b.departureTime,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

// Referenced by trips.vehicleId (fleet registration — separate from the
// free-text vehiclePlate/vehicleType fields already carried on the trip).
export function formatBackupVehicle(v: typeof vehiclesTable.$inferSelect) {
  return {
    id: v.id,
    name: v.name,
    type: v.type,
    plate: v.plate,
    capacity: v.capacity,
    model: v.model,
    year: v.year,
    amenities: v.amenities ?? [],
    dailyRate: v.dailyRate != null ? Number(v.dailyRate) : null,
    ratePerKm: v.ratePerKm != null ? Number(v.ratePerKm) : null,
    photoUrl: v.photoUrl,
    driverName: v.driverName,
    driverPhone: v.driverPhone,
    seatLayout: v.seatLayout,
    notes: v.notes,
    status: v.status,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

export function formatBackupCommissionRule(r: typeof commissionRulesTable.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    value: Number(r.value),
    appliesTo: r.appliesTo,
    tripId: r.tripId,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function formatBackupCommission(c: typeof commissionsTable.$inferSelect) {
  return {
    id: c.id,
    ruleId: c.ruleId,
    userId: c.userId,
    reservationId: c.reservationId,
    baseAmount: Number(c.baseAmount),
    commissionAmount: Number(c.commissionAmount),
    commissionRate: c.commissionRate != null ? Number(c.commissionRate) : null,
    commissionType: c.commissionType,
    status: c.status,
    paidAt: c.paidAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

export function formatBackupPipeline(p: typeof pipelinesTable.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    isDefault: p.isDefault,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function formatBackupPipelineStage(s: typeof pipelineStagesTable.$inferSelect) {
  return {
    id: s.id,
    pipelineId: s.pipelineId,
    name: s.name,
    color: s.color,
    order: s.order,
    isFinal: s.isFinal,
    isDefaultWeb: s.isDefaultWeb,
    createdAt: s.createdAt.toISOString(),
  };
}

export function formatBackupDeal(d: typeof dealsTable.$inferSelect) {
  return {
    id: d.id,
    stageId: d.stageId,
    title: d.title,
    description: d.description,
    value: Number(d.value),
    clientId: d.clientId,
    leadName: d.leadName,
    leadEmail: d.leadEmail,
    leadWhatsapp: d.leadWhatsapp,
    tripId: d.tripId,
    ownerId: d.ownerId,
    expectedCloseDate: d.expectedCloseDate?.toISOString() ?? null,
    closedAt: d.closedAt?.toISOString() ?? null,
    status: d.status,
    lostReason: d.lostReason,
    travelReason: d.travelReason,
    followUpNote: d.followUpNote,
    reservationId: d.reservationId,
    source: d.source,
    autoCreated: d.autoCreated,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function formatBackupLoyaltyProgram(p: typeof loyaltyProgramsTable.$inferSelect) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    pointsPerReal: Number(p.pointsPerReal),
    realPerPoint: Number(p.realPerPoint),
    minRedeemPoints: p.minRedeemPoints,
    isActive: p.isActive,
    tierBenefits: p.tierBenefits ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function formatBackupLoyaltyMember(m: typeof loyaltyMembersTable.$inferSelect) {
  return {
    id: m.id,
    programId: m.programId,
    clientId: m.clientId,
    totalPoints: m.totalPoints,
    availablePoints: m.availablePoints,
    tier: m.tier,
    joinedAt: m.joinedAt.toISOString(),
    lastActivityAt: m.lastActivityAt?.toISOString() ?? null,
  };
}

export function formatBackupLoyaltyTransaction(t: typeof loyaltyTransactionsTable.$inferSelect) {
  return {
    id: t.id,
    memberId: t.memberId,
    type: t.type,
    points: t.points,
    description: t.description,
    referenceId: t.referenceId,
    referenceType: t.referenceType,
    createdAt: t.createdAt.toISOString(),
  };
}

// Excludes: nothing sensitive here — agency-level referral program policy config.
export function formatBackupReferralSettings(s: typeof referralSettingsTable.$inferSelect) {
  return {
    id: s.id,
    isEnabled: s.isEnabled,
    discountType: s.discountType,
    discountValue: Number(s.discountValue),
    bonusType: s.bonusType,
    bonusValue: Number(s.bonusValue),
    expirationDays: s.expirationDays,
    allowSelfReferral: s.allowSelfReferral,
    requireFirstPurchase: s.requireFirstPurchase,
    shareMessage: s.shareMessage,
    tiersConfig: s.tiersConfig ?? null,
    whatsappEnabled: s.whatsappEnabled,
    whatsappPhoneNumber: s.whatsappPhoneNumber,
    whatsappConvertedMessage: s.whatsappConvertedMessage,
    whatsappBonusPaidMessage: s.whatsappBonusPaidMessage,
    whatsappReversedMessage: s.whatsappReversedMessage,
    expiryWarning7DaysEnabled: s.expiryWarning7DaysEnabled,
    expiryWarning1DayEnabled: s.expiryWarning1DayEnabled,
    bonusReleaseEmailEnabled: s.bonusReleaseEmailEnabled,
    pointsPerReferral: s.pointsPerReferral,
    loyaltyPointsEmailEnabled: s.loyaltyPointsEmailEnabled,
    gracePeriodDays: s.gracePeriodDays,
    bonusValidityDays: s.bonusValidityDays,
    discountExpirationDays: s.discountExpirationDays,
    minPurchaseAmount: s.minPurchaseAmount != null ? Number(s.minPurchaseAmount) : null,
    maxReferralsPerUser: s.maxReferralsPerUser,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function formatBackupReferralCampaign(c: typeof referralCampaignsTable.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    bonusType: c.bonusType,
    bonusValue: Number(c.bonusValue),
    bannerText: c.bannerText,
    eligibleStoreProductIds: c.eligibleStoreProductIds ?? [],
    eligibleTierLevels: c.eligibleTierLevels ?? [],
    conversionCap: c.conversionCap,
    budgetAmount: c.budgetAmount != null ? Number(c.budgetAmount) : null,
    shareMessage: c.shareMessage,
    materialUrl: c.materialUrl,
    publicRanking: c.publicRanking,
    eligibleActivitySegments: c.eligibleActivitySegments ?? [],
    eligibleChannels: c.eligibleChannels ?? [],
    commissionType: c.commissionType,
    commissionValue: Number(c.commissionValue),
    commissionRecipientType: c.commissionRecipientType,
    eligiblePartnerIds: c.eligiblePartnerIds ?? [],
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

// Excludes: cookieId, ipAddress, userAgent (visitor fingerprint/tracking data,
// not needed to restore the durable referral/bonus business record).
export function formatBackupReferral(r: typeof referralsTable.$inferSelect) {
  return {
    id: r.id,
    referrerId: r.referrerId,
    referredId: r.referredId,
    referredEmail: r.referredEmail,
    referredName: r.referredName,
    referredPhone: r.referredPhone,
    referrerName: r.referrerName,
    referrerEmail: r.referrerEmail,
    referrerPhone: r.referrerPhone,
    code: r.code,
    status: r.status,
    bonusAmount: Number(r.bonusAmount),
    bonusPaid: r.bonusPaid,
    bonusPaidAt: r.bonusPaidAt?.toISOString() ?? null,
    convertedAt: r.convertedAt?.toISOString() ?? null,
    discountType: r.discountType,
    discountValue: Number(r.discountValue),
    discountApplied: r.discountApplied,
    discountAmount: r.discountAmount != null ? Number(r.discountAmount) : null,
    landingPage: r.landingPage,
    utmSource: r.utmSource,
    utmMedium: r.utmMedium,
    utmCampaign: r.utmCampaign,
    campaignId: r.campaignId,
    attributionChannel: r.attributionChannel,
    visitsCount: r.visitsCount,
    firstVisit: r.firstVisit?.toISOString() ?? null,
    lastVisit: r.lastVisit?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    isActive: r.isActive,
    reservationId: r.reservationId,
    source: r.source,
    notes: r.notes,
    fraudFlag: r.fraudFlag,
    fraudReason: r.fraudReason,
    bonusCreditUsedAt: r.bonusCreditUsedAt?.toISOString() ?? null,
    bonusCreditOrderId: r.bonusCreditOrderId,
    bonusCreditUsedAmount: r.bonusCreditUsedAmount != null ? Number(r.bonusCreditUsedAmount) : null,
    reversalReason: r.reversalReason,
    reversalAt: r.reversalAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function formatBackupReferralCommission(c: typeof referralCommissionsTable.$inferSelect) {
  return {
    id: c.id,
    referralId: c.referralId,
    referrerId: c.referrerId,
    campaignId: c.campaignId,
    recipientType: c.recipientType,
    recipientId: c.recipientId,
    amount: Number(c.amount),
    basis: c.basis,
    status: c.status,
    approvedAt: c.approvedAt?.toISOString() ?? null,
    paidAt: c.paidAt?.toISOString() ?? null,
    reversedAt: c.reversedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function formatBackupSalesGoal(g: typeof salesGoalsTable.$inferSelect) {
  return {
    id: g.id,
    userId: g.userId,
    periodType: g.periodType,
    year: g.year,
    month: g.month,
    monthInt: g.monthInt,
    quarter: g.quarter,
    goalAmount: Number(g.goalAmount),
    achievedAmount: Number(g.achievedAmount),
    goalQuantity: g.goalQuantity != null ? Number(g.goalQuantity) : null,
    achievedQuantity: g.achievedQuantity != null ? Number(g.achievedQuantity) : null,
    progressPercentage: g.progressPercentage != null ? Number(g.progressPercentage) : null,
    bonusAmount: g.bonusAmount != null ? Number(g.bonusAmount) : null,
    bonusPaid: g.bonusPaid,
    status: g.status,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}

// Uploaded business files (contracts, vouchers, ID scans attached to a client/
// trip/reservation/etc). entityType+entityId is a polymorphic pointer into
// whichever record the file was attached to; kept as-is for the importer to
// re-resolve. Excludes nothing sensitive — no credentials are stored here,
// only a CDN url/fileKey for the uploaded object itself.
export function formatBackupDocument(d: typeof documentsTable.$inferSelect) {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    url: d.url,
    fileKey: d.fileKey,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    entityType: d.entityType,
    entityId: d.entityId,
    uploadedById: d.uploadedById,
    createdAt: d.createdAt.toISOString(),
  };
}

// Embedded per-client, like passengers under a reservation — a note only
// exists in the context of the client it was written about.
export function formatBackupNote(n: typeof notesTable.$inferSelect) {
  return {
    id: n.id,
    type: n.type,
    content: n.content,
    metadata: n.metadata,
    isPrivate: n.isPrivate,
    createdById: n.createdById,
    createdAt: n.createdAt.toISOString(),
  };
}

export function formatBackupMessageTemplate(t: typeof messageTemplatesTable.$inferSelect) {
  return {
    id: t.id,
    name: t.name,
    channel: t.channel,
    subject: t.subject,
    content: t.content,
    variables: t.variables ?? [],
    category: t.category,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function formatBackupAutomationAction(a: typeof automationActionsTable.$inferSelect) {
  return {
    id: a.id,
    type: a.type,
    config: a.config ?? {},
    order: a.order,
    isActive: a.isActive,
    createdAt: a.createdAt.toISOString(),
  };
}

// Execution history (automationLogsTable) is deliberately excluded — it's a
// run log, not source-of-truth configuration; only the automation definition
// and its ordered actions are restorable business content.
export function formatBackupAutomation(
  a: typeof automationsTable.$inferSelect,
  actions: ReturnType<typeof formatBackupAutomationAction>[],
) {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    triggerType: a.triggerType,
    triggerConfig: a.triggerConfig ?? {},
    conditions: a.conditions ?? null,
    isActive: a.isActive,
    executionsCount: a.executionsCount,
    lastExecutedAt: a.lastExecutedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    actions,
  };
}

// Embedded per-trip, like passengers under a reservation. supplierName is
// stored inline on the row itself (denormalized), so this stays meaningful
// even though supplierId doesn't point at an exported supplier record.
export function formatBackupTripCost(c: typeof tripCostsTable.$inferSelect) {
  return {
    id: c.id,
    category: c.category,
    description: c.description,
    supplierId: c.supplierId,
    supplierName: c.supplierName,
    amount: Number(c.amount),
    status: c.status,
    dueDate: c.dueDate?.toISOString() ?? null,
    paidAt: c.paidAt?.toISOString() ?? null,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

// Embedded per-trip. Excludes: nothing sensitive — a CDN url for the uploaded
// photo/video itself, no credentials.
export function formatBackupTripMedia(m: typeof tripMediaTable.$inferSelect) {
  return {
    id: m.id,
    url: m.url,
    type: m.type,
    caption: m.caption,
    uploadedByUserId: m.uploadedByUserId,
    createdAt: m.createdAt.toISOString(),
  };
}

// Embedded per-client.
export function formatBackupClientAchievement(a: typeof clientAchievementsTable.$inferSelect) {
  return {
    id: a.id,
    badgeKey: a.badgeKey,
    earnedAt: a.earnedAt.toISOString(),
  };
}

// Embedded per-client.
export function formatBackupClientDreamDestination(d: typeof clientDreamDestinationsTable.$inferSelect) {
  return {
    id: d.id,
    destinationName: d.destinationName,
    note: d.note,
    createdAt: d.createdAt.toISOString(),
  };
}

// Embedded per-client.
export function formatBackupClientFavorite(f: typeof clientFavoritesTable.$inferSelect) {
  return {
    id: f.id,
    itemType: f.itemType,
    itemId: f.itemId,
    createdAt: f.createdAt.toISOString(),
  };
}

// Referenced by trip costs' and expenses' supplierId.
export function formatBackupSupplier(s: typeof suppliersTable.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    cnpj: s.cnpj,
    contactName: s.contactName,
    email: s.email,
    whatsapp: s.whatsapp,
    phone: s.phone,
    addressStreet: s.addressStreet,
    addressCity: s.addressCity,
    addressState: s.addressState,
    bankName: s.bankName,
    bankAgency: s.bankAgency,
    bankAccount: s.bankAccount,
    pixKey: s.pixKey,
    pixType: s.pixType,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function formatBackupAccommodation(a: typeof accommodationsTable.$inferSelect) {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    address: a.address,
    city: a.city,
    state: a.state,
    contactName: a.contactName,
    phone: a.phone,
    email: a.email,
    totalRooms: a.totalRooms,
    amenities: a.amenities ?? [],
    pricePerNight: a.pricePerNight != null ? Number(a.pricePerNight) : null,
    coverImage: a.coverImage,
    gallery: a.gallery ?? [],
    rating: a.rating != null ? Number(a.rating) : null,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function formatBackupDestination(d: typeof destinationsTable.$inferSelect) {
  return {
    id: d.id,
    name: d.name,
    city: d.city,
    state: d.state,
    country: d.country,
    description: d.description,
    mainAttractions: d.mainAttractions ?? [],
    bestSeason: d.bestSeason,
    coverImage: d.coverImage,
    gallery: d.gallery ?? [],
    rating: d.rating != null ? Number(d.rating) : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function formatBackupClubConfig(c: typeof clubConfigTable.$inferSelect) {
  return {
    id: c.id,
    clubName: c.clubName,
    description: c.description,
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function formatBackupClubBenefit(b: typeof clubBenefitsTable.$inferSelect) {
  return {
    id: b.id,
    tier: b.tier,
    benefitKey: b.benefitKey,
    label: b.label,
    description: b.description,
    value: b.value,
    sortOrder: b.sortOrder,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

// Immutable per-order-item financial snapshot (checkout-time values, not
// derived from a partner/product that could change later).
export function formatBackupSettlementItem(s: typeof settlementItemsTable.$inferSelect) {
  return {
    id: s.id,
    orderId: s.orderId,
    orderItemId: s.orderItemId,
    clientId: s.clientId,
    sellerType: s.sellerType,
    sellerId: s.sellerId,
    sellerName: s.sellerName,
    source: s.source,
    grossAmount: Number(s.grossAmount),
    discountAmount: Number(s.discountAmount),
    taxAmount: Number(s.taxAmount),
    feeAmount: Number(s.feeAmount),
    commissionRate: Number(s.commissionRate),
    commissionAmount: Number(s.commissionAmount),
    sellerNetAmount: Number(s.sellerNetAmount),
    currency: s.currency,
    settlementStatus: s.settlementStatus,
    createdAt: s.createdAt.toISOString(),
  };
}

// Append-only participant ledger — corrections are compensating entries via
// reversalOfEntryId, original rows are never mutated, so this is restorable
// business data (not a mutable log) despite reading like one.
export function formatBackupFinancialLedgerEntry(e: typeof financialLedgerEntriesTable.$inferSelect) {
  return {
    id: e.id,
    settlementItemId: e.settlementItemId,
    orderId: e.orderId,
    clientId: e.clientId,
    participantType: e.participantType,
    participantId: e.participantId,
    category: e.category,
    direction: e.direction,
    amount: Number(e.amount),
    currency: e.currency,
    settlementStatus: e.settlementStatus,
    eventType: e.eventType,
    idempotencyKey: e.idempotencyKey,
    reversalOfEntryId: e.reversalOfEntryId,
    expiresAt: e.expiresAt?.toISOString() ?? null,
    availableAt: e.availableAt?.toISOString() ?? null,
    metadata: e.metadata ?? {},
    occurredAt: e.occurredAt.toISOString(),
    createdAt: e.createdAt.toISOString(),
  };
}

// Embedded per-partner-product, like passengers under a reservation.
export function formatBackupPartnerAvailability(a: typeof partnerAvailabilityTable.$inferSelect) {
  return {
    id: a.id,
    date: a.date,
    spotsTotal: a.spotsTotal,
    spotsUsed: a.spotsUsed,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

// Embedded per-partner.
export function formatBackupPartnerProduct(
  p: typeof partnerProductsTable.$inferSelect,
  availability: ReturnType<typeof formatBackupPartnerAvailability>[],
) {
  return {
    id: p.id,
    type: p.type,
    title: p.title,
    slug: p.slug,
    description: p.description,
    origin: p.origin,
    price: Number(p.price),
    maxCapacity: p.maxCapacity,
    durationMinutes: p.durationMinutes,
    meetingPoint: p.meetingPoint,
    locationUrl: p.locationUrl,
    cancellationPolicy: p.cancellationPolicy,
    faq: p.faq ?? [],
    images: p.images ?? [],
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    availability,
  };
}

// Embedded per-partner.
export function formatBackupPartnerCommission(c: typeof partnerCommissionsTable.$inferSelect) {
  return {
    id: c.id,
    orderId: c.orderId,
    grossAmount: Number(c.grossAmount),
    partnerAmount: Number(c.partnerAmount),
    agencyAmount: Number(c.agencyAmount),
    status: c.status,
    period: c.period,
    paidAt: c.paidAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

// Marketplace partner selling through this agency's store. Excludes:
// passwordHash (auth credential for the partner's own login).
export function formatBackupPartner(
  p: typeof partnersTable.$inferSelect,
  products: ReturnType<typeof formatBackupPartnerProduct>[],
  commissions: ReturnType<typeof formatBackupPartnerCommission>[],
) {
  return {
    id: p.id,
    name: p.name,
    email: p.email,
    cnpj: p.cnpj,
    slug: p.slug,
    description: p.description,
    phone: p.phone,
    logo: p.logo,
    status: p.status,
    commissionPct: Number(p.commissionPct),
    referralCommissionEligible: p.referralCommissionEligible,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    products,
    commissions,
  };
}

// Campaign definitions (email/WhatsApp blasts to client segments). Excludes
// campaignSendsTable — that's a per-recipient delivery log, not authored
// content.
export function formatBackupCampaign(c: typeof campaignsTable.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    type: c.type,
    status: c.status,
    targetSegment: c.targetSegment,
    subject: c.subject,
    content: c.content,
    mediaUrl: c.mediaUrl,
    scheduledAt: c.scheduledAt?.toISOString() ?? null,
    sentAt: c.sentAt?.toISOString() ?? null,
    recipientsCount: c.recipientsCount,
    sentCount: c.sentCount,
    deliveredCount: c.deliveredCount,
    openedCount: c.openedCount,
    clickedCount: c.clickedCount,
    triggerType: c.triggerType,
    triggerConfig: c.triggerConfig,
    autoEnabled: c.autoEnabled,
    createdById: c.createdById,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

// Google Calendar sync mirror rows — googleEventId is an external event
// reference, not a credential (the OAuth tokens themselves live in
// tenantIntegrationsTable, which is excluded entirely).
export function formatBackupCalendarEvent(e: typeof calendarEventsTable.$inferSelect) {
  return {
    id: e.id,
    userId: e.userId,
    clientId: e.clientId,
    tripId: e.tripId,
    paymentId: e.paymentId,
    googleEventId: e.googleEventId,
    calendarId: e.calendarId,
    eventType: e.eventType,
    title: e.title,
    description: e.description,
    startDate: e.startDate.toISOString(),
    endDate: e.endDate?.toISOString() ?? null,
    location: e.location,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

// ── Marketing module's parallel product catalog + orders (distinct from the
// storefront's storeProducts/storeOrders — this is a separate CRUD-managed
// commerce dataset under /marketing). ───────────────────────────────────────
export function formatBackupProductCategory(c: typeof productCategoriesTable.$inferSelect) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    parentId: c.parentId,
    imageUrl: c.imageUrl,
    isActive: c.isActive,
    sortOrder: c.sortOrder,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function formatBackupProductImage(i: typeof productImagesTable.$inferSelect) {
  return {
    id: i.id,
    url: i.url,
    altText: i.altText,
    sortOrder: i.sortOrder,
    createdAt: i.createdAt.toISOString(),
  };
}

export function formatBackupMarketingProduct(
  p: typeof productsTable.$inferSelect,
  images: ReturnType<typeof formatBackupProductImage>[],
) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    shortDescription: p.shortDescription,
    type: p.type,
    price: Number(p.price),
    promotionalPrice: p.promotionalPrice !== null ? Number(p.promotionalPrice) : null,
    cost: p.cost !== null ? Number(p.cost) : null,
    stock: p.stock,
    trackStock: p.trackStock,
    active: p.active,
    featured: p.featured,
    metaTitle: p.metaTitle,
    metaDescription: p.metaDescription,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    images,
  };
}

export function formatBackupMarketingOrderItem(i: typeof orderItemsTable.$inferSelect) {
  return {
    id: i.id,
    productId: i.productId,
    quantity: i.quantity,
    price: Number(i.price),
  };
}

export function formatBackupMarketingOrder(
  o: typeof ordersTable.$inferSelect,
  items: ReturnType<typeof formatBackupMarketingOrderItem>[],
) {
  return {
    id: o.id,
    userId: o.userId,
    totalAmount: Number(o.totalAmount),
    discountApplied: Number(o.discountApplied),
    bonusUsed: Number(o.bonusUsed),
    shippingCost: Number(o.shippingCost),
    finalAmount: Number(o.finalAmount),
    status: o.status,
    paymentStatus: o.paymentStatus,
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
    shippedAt: o.shippedAt?.toISOString() ?? null,
    deliveredAt: o.deliveredAt?.toISOString() ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    completedAt: o.completedAt?.toISOString() ?? null,
    items,
  };
}

// E-commerce NPS (marketing module's npsResponsesTable) — feedback content
// tied to an order, analogous to already-exported store reviews.
export function formatBackupNpsResponse(n: typeof npsResponsesTable.$inferSelect) {
  return {
    id: n.id,
    userId: n.userId,
    orderId: n.orderId,
    score: n.score,
    classification: n.classification,
    feedback: n.feedback,
    createdAt: n.createdAt.toISOString(),
  };
}

// Client-facing trip NPS survey responses (distinct table/feature from the
// e-commerce npsResponsesTable above — see clientNpsResponsesTable doc).
export function formatBackupClientNpsResponse(n: typeof clientNpsResponsesTable.$inferSelect) {
  return {
    id: n.id,
    clientId: n.clientId,
    reservationId: n.reservationId,
    tripId: n.tripId,
    score: n.score,
    scoreTransport: n.scoreTransport,
    scoreService: n.scoreService,
    scoreOrganization: n.scoreOrganization,
    scoreGuide: n.scoreGuide,
    comment: n.comment,
    createdAt: n.createdAt.toISOString(),
  };
}

// NPS survey invitation record — the `token` field is a single-use bearer
// credential that lets its holder submit a response as the client, so it is
// stripped like any other auth secret; the invitation record itself (who was
// invited, when, whether they responded) is kept.
export function formatBackupNpsInvitation(i: typeof npsInvitationsTable.$inferSelect) {
  return {
    id: i.id,
    clientId: i.clientId,
    reservationId: i.reservationId,
    tripId: i.tripId,
    invitedAt: i.invitedAt.toISOString(),
    respondedAt: i.respondedAt?.toISOString() ?? null,
  };
}

// Per-client RFM/next-best-offer scores — computed business analytics, not a
// log (recalculated periodically, but the latest snapshot is restorable
// business content like club tier or loyalty balance).
export function formatBackupClientScore(s: typeof clientScoresTable.$inferSelect) {
  return {
    id: s.id,
    purchaseScore: s.purchaseScore,
    recompraScore: s.recompraScore,
    churnScore: s.churnScore,
    nboTripId: s.nboTripId,
    nboReasoning: s.nboReasoning,
    rfmR: s.rfmR,
    rfmF: s.rfmF,
    rfmM: s.rfmM !== null ? Number(s.rfmM) : null,
    calculatedAt: s.calculatedAt.toISOString(),
  };
}

// Store price-alert subscriptions — confirmation/unsubscribe token hashes are
// one-way hashes (not the bearer secret itself) but serve no restore purpose,
// so they're stripped along with genuine secrets.
export function formatBackupPriceAlertSubscription(p: typeof priceAlertSubscriptionsTable.$inferSelect) {
  return {
    id: p.id,
    productId: p.productId,
    email: p.email,
    priceAtSubscribe: Number(p.priceAtSubscribe),
    status: p.status,
    confirmedAt: p.confirmedAt?.toISOString() ?? null,
    lastNotifiedAt: p.lastNotifiedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

// Pending team invites — `token` is the single-use acceptance credential and
// is stripped, same reasoning as formatBackupNpsInvitation above.
export function formatBackupInvite(i: typeof invitesTable.$inferSelect) {
  return {
    id: i.id,
    email: i.email,
    role: i.role,
    invitedBy: i.invitedBy,
    accepted: i.accepted,
    acceptedAt: i.acceptedAt?.toISOString() ?? null,
    expiresAt: i.expiresAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
  };
}

// Trip check-ins (embedded per-trip, like costs/media) — durable attendance
// record of which passengers boarded, distinct from tripGuideLocationsTable
// (excluded: ephemeral live GPS pings) and tripGuideTokensTable (excluded:
// bearer credential for the guide app).
export function formatBackupTripCheckin(c: typeof tripCheckinsTable.$inferSelect) {
  return {
    id: c.id,
    passengerId: c.passengerId,
    reservationId: c.reservationId,
    checkedInByUserRef: c.checkedInByUserRef,
    checkedInAt: c.checkedInAt.toISOString(),
    notes: c.notes,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
  };
}

// Agency-wide client coupons — distinct from per-store storeCouponsTable above.
export function formatBackupCoupon(c: typeof couponsTable.$inferSelect) {
  return {
    id: c.id,
    code: c.code,
    type: c.type,
    value: Number(c.value),
    minOrderValue: c.minOrderValue != null ? Number(c.minOrderValue) : null,
    maxUses: c.maxUses,
    usedCount: c.usedCount,
    isActive: c.isActive,
    validFrom: c.validFrom?.toISOString() ?? null,
    validUntil: c.validUntil?.toISOString() ?? null,
    clientId: c.clientId,
    isBirthday: c.isBirthday,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
