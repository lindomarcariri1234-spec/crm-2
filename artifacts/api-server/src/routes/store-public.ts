import 
{
 Router, type NextFunction 
}
 from "express"
;

import 
{
 logger 
}
 from "../lib/logger"
;

import 
{
 getAuth 
}
 from "@clerk/express"
;

import 
{
 db 
}
 from "@workspace/db"
;

import 
{
 tryAddSeatClient, removeSeatClient, emitSeatUpdate 
}
 from "../lib/seat-sse"
;

import 
{
 broadcastSeatUpdate 
}
 from "../lib/realtime"
;

import 
{
  RESERVATION_STATUS, ACTIVE_RESERVATION_STATUSES
}
 from "@workspace/permissions"
;

import 
{
 AppError, NotFoundError, ValidationError, ConflictError 
}
 from "../lib/errors"
;

import 
{
 normalizeOrderEmail, roundMoney 
}
 from "../lib/pricing"
;

import 
{
 localToday 
}
 from "@workspace/shared"
;

import 
{
 getTenantUser 
}
 from "../lib/tenant"
;

import 
{

  storesTable,
  storeProductsTable,
  storeCategoriesTable,
  storeOrdersTable,
  storeOrderItemsTable,
  storeCouponsTable,
  storeReviewsTable,
  reservationsTable,
  paymentsTable,
  tripsTable,
  clientsTable,
  referralTrackingTable,
  referralSettingsTable,
  referralsTable,
  tenantsTable,
  vehicleLayoutsTable,
  partnerProductsTable,
  partnerAvailabilityTable,
  partnersTable,
  priceAlertSubscriptionsTable,
  referralAttemptLogsTable,
  passengersTable,
  boardingLocationsTable,
}
 from "@workspace/db"
;

import 
{
 eq, and, desc, asc, ilike, or, sql, inArray, ne 
}
 from "drizzle-orm"
;

import 
{
 z 
}
 from "zod/v4"
;

import 
{
 generateId 
}
 from "../lib/id"
;

import 
{
 randomBytes, createHash 
}
 from "crypto"
;

import 
{
 getAIClientForTenant 
}
 from "../lib/ai-client"
;

import 
{
 sendPriceAlertConfirmationEmail, enqueuePixOrderAlertEmail, enqueuePixOrderQr
}
 from "../queues/email-helpers"
;

import 
{
 decryptOrPassthrough 
}
 from "../lib/crypto"
;

import 
{
 generatePixEMV, generatePixQrCodeUrl 
}
 from "../lib/pix"
;

import 
{
 getClientIp 
}
 from "../lib/get-client-ip"
;

import 
{
 resolveCheckoutDiscounts 
}
 from "../services/checkout/discounts"
;

import 
{
 prepareCheckoutItems 
}
 from "../services/checkout/items"
;

import 
{
 persistCheckoutOrder 
}
 from "../services/checkout/persist-order"
;

import 
{
 createReservationsForOrder 
}
 from "../services/checkout/create-reservations"
;

import { calculateReceivedAmount, orderFinancialSummary } from "../lib/linked-data";

import 
{
 ensurePortalAccount 
}
 from "../services/checkout/portal-account"
;

import 
{
 enqueueNewBookingNotificationEmail 
}
 from "../queues/email-helpers"
;

import 
{
 insertClientNotification 
}
 from "../lib/client-notifications"
;
import { recordReferralVisit } from "../services/referral-tracking";



const router = Router()
;

const PIX_QR_DELIVERY_MODES = ["screen", "email", "whatsapp", "all"] as const;
type PixQrDeliveryMode = typeof PIX_QR_DELIVERY_MODES[number];

async function getPixQrDeliveryMode(tenantId: string): Promise<PixQrDeliveryMode> {
  const [tenant] = await db.select({ settings: tenantsTable.settings })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, tenantId))
    .limit(1);
  const value = (tenant?.settings as Record<string, unknown> | null | undefined)?.pixQrDeliveryMode;
  return PIX_QR_DELIVERY_MODES.includes(value as PixQrDeliveryMode)
    ? value as PixQrDeliveryMode
    : "screen";
}

async function ensureOrderPixQr(
  store: typeof storesTable.$inferSelect,
  order: typeof storeOrdersTable.$inferSelect,
): Promise<typeof storeOrdersTable.$inferSelect> {
  if (order.paymentMethod !== "pix" || !store.pixEnabled || !store.pixKey) return order;
  if (order.pixQrCode && order.pixQrCodeUrl && order.pixCopyPaste) return order;

  try {
    const decryptedPixKey = decryptOrPassthrough(store.pixKey);
    if (!decryptedPixKey) return order;

    const pixAmount = Number(order.depositAmount ?? order.totalAmount);
    const pixCode = generatePixEMV({
      key: decryptedPixKey,
      name: store.name,
      city: store.city ?? "BRASIL",
      amount: pixAmount,
      txid: order.id.slice(0, 25),
      description: `Reserva ${order.orderNumber}`.slice(0, 40),
    });
    const pixQrCodeUrl = generatePixQrCodeUrl(pixCode);

    await db.update(storeOrdersTable).set({
      pixQrCode: pixCode,
      pixQrCodeUrl,
      pixCopyPaste: pixCode,
    }).where(and(
      eq(storeOrdersTable.id, order.id),
      eq(storeOrdersTable.storeId, store.id),
      eq(storeOrdersTable.tenantId, store.tenantId),
    ));

    return {
      ...order,
      pixQrCode: pixCode,
      pixQrCodeUrl,
      pixCopyPaste: pixCode,
    };
  } catch (pixErr) {
    logger.warn({ pixErr, orderId: order.id }, "[store/orders] Failed to reconcile PIX QR code");
    return order;
  }
}

async function reconcileOrderPostCommitEffects(
  store: typeof storesTable.$inferSelect,
  order: typeof storeOrdersTable.$inferSelect,
  reservationIds: string[],
): Promise<void> {
  const pixQrCodeUrl = order.pixQrCodeUrl;
  const pixCopyPaste = order.pixCopyPaste ?? order.pixQrCode;
  if (order.paymentMethod === "pix" && pixQrCodeUrl && pixCopyPaste) {
    try {
      const pixQrDeliveryMode = await getPixQrDeliveryMode(store.tenantId);
      if (pixQrDeliveryMode !== "screen") {
        await enqueuePixOrderQr({
          tenantId: store.tenantId,
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          customerPhone: order.customerPhone ?? null,
          storeName: store.name,
          amount: Number(order.depositAmount ?? order.totalAmount),
          pixQrCodeUrl,
          pixCopyPaste,
          deliveryMode: pixQrDeliveryMode,
        });
      }
    } catch (err) {
      logger.warn({ err, orderId: order.id }, "[store/orders] Failed to reconcile PIX QR delivery");
    }
  }

  if (reservationIds.length === 0) return;

  await Promise.all(reservationIds.map(async (reservationId) => {
    try {
      await enqueueNewBookingNotificationEmail(reservationId, store.tenantId);
    } catch (err) {
      logger.warn({ err, reservationId }, "[store/orders] Failed to reconcile new-booking notification");
    }
  }));

  const storePublicBase = (process.env["STORE_PUBLIC_URL"] ?? "https://visitecrm.com").replace(/\/$/, "");
  const storeBase = store.customDomain
    ? `https://${store.customDomain}`
    : `${storePublicBase}/loja/${store.slug}`;
  const loginUrl = `${storeBase}/entrar`;
  try {
    await ensurePortalAccount({
      email: order.customerEmail,
      name: order.customerName,
      cpf: order.customerCpf,
      tenantId: store.tenantId,
      storeBase,
      loginUrl,
      agencyName: store.name,
      agencyLogo: store.logo ?? "",
    });
  } catch (err) {
    logger.error({ err, orderId: order.id }, "[store/orders] Failed to reconcile portal account");
  }
}


async function getActiveStore(slug: string) 
{

  const [store] = await db.select().from(storesTable)
    .where(and(
      eq(storesTable.slug, slug),
      eq(storesTable.isActive, true),
    )).limit(1)
;

  return store
;

}


async function getStoreForPublicPage(slug: string)
{

  const [store] = await db.select().from(storesTable)
    .where(eq(storesTable.slug, slug)).limit(1)
;

  return store
;

}


router.get("/public/store/:slug", async (req, res, next: NextFunction): Promise<void> => 
{

  try 
{

    const store = await getStoreForPublicPage(req.params.slug)
;

    if (!store) 
{
 next(new NotFoundError("Store not found", "NOT_FOUND"))
;
 return
;
 
}


    const [tenant] = await db.select(
{
 settings: tenantsTable.settings 
}
)
      .from(tenantsTable)
      .where(eq(tenantsTable.id, store.tenantId))
      .limit(1)
;

    const tenantSettings = (tenant?.settings ?? 
{
}
) as Record<string, unknown>
;

    const couponsEnabled = tenantSettings.couponsEnabled !== false
;

    const referralsEnabled = tenantSettings.referralsEnabled !== false
;

    const seatMapEnabled = tenantSettings.seatMapEnabled !== false
;


    const publicData = 
{

      id: store.id,
      name: store.name,
      slug: store.slug,
      tagline: store.tagline,
      description: store.description,
      logo: store.logo,
      favicon: store.favicon,
      bannerHome: store.bannerHome,
      bannerMobile: store.bannerMobile,
      primaryColor: store.primaryColor,
      secondaryColor: store.secondaryColor,
      accentColor: store.accentColor,
      email: store.email,
      phone: store.phone,
      whatsapp: store.whatsapp,
      address: store.address,
      city: store.city,
      state: store.state,
      facebookUrl: store.facebookUrl,
      instagramUrl: store.instagramUrl,
      twitterUrl: store.twitterUrl,
      youtubeUrl: store.youtubeUrl,
      linkedinUrl: store.linkedinUrl,
      tiktokUrl: store.tiktokUrl,
      metaTitle: store.metaTitle,
      metaDescription: store.metaDescription,
      metaKeywords: store.metaKeywords,
      googleAnalyticsId: store.googleAnalyticsId,
      facebookPixelId: store.facebookPixelId,
      googleTagManagerId: store.googleTagManagerId,
      requireLogin: store.requireLogin,
      guestCheckout: store.guestCheckout,
      minInstallments: store.minInstallments,
      maxInstallments: store.maxInstallments,
      installmentFee: store.installmentFee,
      minOrderValue: store.minOrderValue,
      minDepositAmount: store.minDepositAmount,
      pixQrDeliveryMode: ["screen", "email", "whatsapp", "all"].includes(
        (tenantSettings.pixQrDeliveryMode as string) ?? "",
      )
        ? tenantSettings.pixQrDeliveryMode
        : "screen",
      paymentMethods: Array.isArray(store.paymentMethods) ? store.paymentMethods : [],
      pixEnabled: store.pixEnabled,
      boletoEnabled: store.boletoEnabled,
      stripeEnabled: store.stripeEnabled,
      stripePublicKey: store.stripePublicKey,
      mpEnabled: store.mpEnabled,
      termsOfService: store.termsOfService,
      privacyPolicy: store.privacyPolicy,
      refundPolicy: store.refundPolicy,
      cancellationPolicy: store.cancellationPolicy,
      termsUrl: store.termsUrl,
      privacyUrl: store.privacyUrl,
      isActive: store.isActive,
      maintenanceMode: store.maintenanceMode,
      maintenanceMessage: store.maintenanceMessage,
      couponsEnabled,
      referralsEnabled,
      seatMapEnabled,
    
}
;

    await db.update(storesTable).set(
{
 totalVisits: store.totalVisits + 1 
}
)
      .where(eq(storesTable.id, store.id))
;

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json(publicData)
;

  
}
 catch (err) 
{

    next(err)
;

  
}

}
)
;


router.get("/public/store/:slug/categories", async (req, res, next: NextFunction): Promise<void> => 
{

  try 
{

    const store = await getActiveStore(req.params.slug)
;

    if (!store) 
{
 next(new NotFoundError("Store not found", "NOT_FOUND"))
;
 return
;
 
}

    const categories = await db.select().from(storeCategoriesTable)
      .where(and(
        eq(storeCategoriesTable.storeId, store.id),
        eq(storeCategoriesTable.isActive, true),
      ))
      .orderBy(asc(storeCategoriesTable.order))
;

    res.json(categories)
;

  
}
 catch (err) 
{

    next(err)
;

  
}

}
)
;


router.get("/public/store/:slug/products", async (req, res, next: NextFunction): Promise<void> => 
{

  try 
{

    const store = await getActiveStore(req.params.slug)
;

    if (!store) 
{
 next(new NotFoundError("Store not found", "NOT_FOUND"))
;
 return
;
 
}

    if (store.maintenanceMode) 
{

      next(new AppError("Store is under maintenance", 503, "STORE_MAINTENANCE", 
{
 maintenanceMessage: store.maintenanceMessage 
}
))
;

      return
;

    
}

    const 
{

      category, categoryId, type, featured, search, sort = "newest",
      destination, minPrice, maxPrice, departureFrom, minSeats,
      page: pageStr, limit: limitStr,
    
}
 = req.query
;

    const conditions = [
      eq(storeProductsTable.storeId, store.id),
      eq(storeProductsTable.status, "active"),
    ]
;

    const categoryFilter = (categoryId ?? category) as string | undefined
;

    if (categoryFilter) conditions.push(eq(storeProductsTable.categoryId, categoryFilter))
;

    if (type) conditions.push(eq(storeProductsTable.type, type as string))
;

    if (featured === "true") conditions.push(eq(storeProductsTable.isFeatured, true))
;

    if (search) 
{

      conditions.push(or(
        ilike(storeProductsTable.name, `%${search}%`),
        ilike(storeProductsTable.description, `%${search}%`),
      )!)
;

    
}

    if (destination && destination !== "all") 
{

      conditions.push(eq(storeProductsTable.destination, destination as string))
;

    
}

    const minPriceNum = minPrice ? Number(minPrice) : NaN
;

    const maxPriceNum = maxPrice ? Number(maxPrice) : NaN
;

    if (!isNaN(minPriceNum) && isFinite(minPriceNum)) conditions.push(sql`CAST(${storeProductsTable.price} AS NUMERIC) >= ${minPriceNum}`)
;

    if (!isNaN(maxPriceNum) && isFinite(maxPriceNum)) conditions.push(sql`CAST(${storeProductsTable.price} AS NUMERIC) <= ${maxPriceNum}`)
;

    // Trip-linked filters (smart search). These reference the joined trips
    // table, so the COUNT query below must also join trips. Products without a
    // linked trip have NULL trip columns and are excluded by these filters,
    // which is the intended behaviour (you can't filter a non-dated product by
    // departure date or seat availability).
    if (typeof departureFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(departureFrom)) {
      conditions.push(sql`${tripsTable.departureDate} >= ${departureFrom}`);
    }
    const minSeatsNum = minSeats ? Number(minSeats) : NaN;
    if (!isNaN(minSeatsNum) && isFinite(minSeatsNum) && minSeatsNum > 0) {
      conditions.push(sql`${tripsTable.availableSeats} >= ${Math.floor(minSeatsNum)}`);
    }
    let orderBy;
    if (sort === "price_asc") orderBy = asc(storeProductsTable.price);
    else if (sort === "price_desc") orderBy = desc(storeProductsTable.price);
    else if (sort === "popular") orderBy = desc(storeProductsTable.salesCount);
    else if (sort === "rating") orderBy = desc(storeProductsTable.ratingAverage);
    else if (sort === "newest") orderBy = desc(storeProductsTable.publishedAt);
    else orderBy = desc(storeProductsTable.order);
    const selectFields = {
      id: storeProductsTable.id,
      type: storeProductsTable.type,
      name: storeProductsTable.name,
      slug: storeProductsTable.slug,
      shortDescription: storeProductsTable.shortDescription,
      categoryId: storeProductsTable.categoryId,
      tripId: storeProductsTable.tripId,
      includes: storeProductsTable.includes,
      price: storeProductsTable.price,
      comparePrice: storeProductsTable.comparePrice,
      onSale: storeProductsTable.onSale,
      salePrice: storeProductsTable.salePrice,
      saleStartsAt: storeProductsTable.saleStartsAt,
      saleEndsAt: storeProductsTable.saleEndsAt,
      images: storeProductsTable.images,
      thumbnail: storeProductsTable.thumbnail,
      hasDates: storeProductsTable.hasDates,
      startDate: storeProductsTable.startDate,
      endDate: storeProductsTable.endDate,
      destination: storeProductsTable.destination,
      durationDays: storeProductsTable.durationDays,
      isFeatured: storeProductsTable.isFeatured,
      salesCount: storeProductsTable.salesCount,
      ratingAverage: storeProductsTable.ratingAverage,
      ratingCount: storeProductsTable.ratingCount,
      trackInventory: storeProductsTable.trackInventory,
      stockQuantity: storeProductsTable.stockQuantity,
      publishedAt: storeProductsTable.publishedAt,
      sellerName: partnersTable.name,
      availableSeats: tripsTable.availableSeats,
      totalCapacity: tripsTable.totalCapacity,
      departureDate: tripsTable.departureDate,
      returnDate: tripsTable.returnDate,
      inclusions: tripsTable.inclusions,
      tripType: tripsTable.type,
      originCity: tripsTable.originCity,
      originState: tripsTable.originState,
      destinationCity: tripsTable.destinationCity,
      destinationState: tripsTable.destinationState,
      departureTime: tripsTable.departureTime,
      returnTime: tripsTable.returnTime,
      showSeatMap: tripsTable.showSeatMap,
      boardingPoints: tripsTable.boardingPoints,
    };
    const whereClause = and(...conditions);
    const limit = limitStr ? Math.min(Number(limitStr) || 20, 200) : undefined;
    const page = limit ? Math.max(Number(pageStr) || 1, 1) : 1;
    const offset = limit ? (page - 1) * limit : 0;
    const [countResult, products] = await Promise.all([
      db.select({ count: sql<number>`COUNT(*)` }).from(storeProductsTable)
        .leftJoin(tripsTable, eq(storeProductsTable.tripId, tripsTable.id))
        .leftJoin(partnerProductsTable, eq(storeProductsTable.partnerProductId, partnerProductsTable.id))
        .leftJoin(partnersTable, eq(partnerProductsTable.partnerId, partnersTable.id))
        .where(whereClause),
      limit
        ? db.select(selectFields).from(storeProductsTable)
            .leftJoin(tripsTable, eq(storeProductsTable.tripId, tripsTable.id))
            .leftJoin(partnerProductsTable, eq(storeProductsTable.partnerProductId, partnerProductsTable.id))
            .leftJoin(partnersTable, eq(partnerProductsTable.partnerId, partnersTable.id))
            .where(whereClause).orderBy(orderBy).limit(limit).offset(offset)
        : db.select(selectFields).from(storeProductsTable)
            .leftJoin(tripsTable, eq(storeProductsTable.tripId, tripsTable.id))
            .leftJoin(partnerProductsTable, eq(storeProductsTable.partnerProductId, partnerProductsTable.id))
            .leftJoin(partnersTable, eq(partnerProductsTable.partnerId, partnersTable.id))
            .where(whereClause).orderBy(orderBy),
    ]);
    const processedProducts = products.map(p => ({
      ...p,
      departureDate: p.departureDate
        ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(p.departureDate as unknown as Date)
        : null,
      returnDate: p.returnDate
        ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(p.returnDate as unknown as Date)
        : null,
    }));
    res.json({ data: processedProducts, total: Number(countResult[0]?.count ?? 0), page, limit: limit ?? processedProducts.length });
  } catch (err) {
    next(err);
  }
});

router.get("/public/store/:slug/products/:productSlug", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const store = await getActiveStore(req.params.slug);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const [row] = await db.select({
      id: storeProductsTable.id,
      type: storeProductsTable.type,
      name: storeProductsTable.name,
      slug: storeProductsTable.slug,
      shortDescription: storeProductsTable.shortDescription,
      description: storeProductsTable.description,
      categoryId: storeProductsTable.categoryId,
      tripId: storeProductsTable.tripId,
      includes: storeProductsTable.includes,
      price: storeProductsTable.price,
      comparePrice: storeProductsTable.comparePrice,
      onSale: storeProductsTable.onSale,
      salePrice: storeProductsTable.salePrice,
      saleStartsAt: storeProductsTable.saleStartsAt,
      saleEndsAt: storeProductsTable.saleEndsAt,
      images: storeProductsTable.images,
      thumbnail: storeProductsTable.thumbnail,
      gallery: storeProductsTable.gallery,
      features: storeProductsTable.features,
      excludes: storeProductsTable.excludes,
      requirements: storeProductsTable.requirements,
      variants: storeProductsTable.variants,
      hasDates: storeProductsTable.hasDates,
      startDate: storeProductsTable.startDate,
      endDate: storeProductsTable.endDate,
      destination: storeProductsTable.destination,
      durationDays: storeProductsTable.durationDays,
      durationNights: storeProductsTable.durationNights,
      productCity: storeProductsTable.productCity,
      productState: storeProductsTable.productState,
      country: storeProductsTable.country,
      isFeatured: storeProductsTable.isFeatured,
      hasVariants: storeProductsTable.hasVariants,
      ratingAverage: storeProductsTable.ratingAverage,
      ratingCount: storeProductsTable.ratingCount,
      trackInventory: storeProductsTable.trackInventory,
      stockQuantity: storeProductsTable.stockQuantity,
      allowBackorder: storeProductsTable.allowBackorder,
      salesCount: storeProductsTable.salesCount,
      viewsCount: storeProductsTable.viewsCount,
      publishedAt: storeProductsTable.publishedAt,
      metaTitle: storeProductsTable.metaTitle,
      metaDescription: storeProductsTable.metaDescription,
      metaKeywords: storeProductsTable.metaKeywords,
      status: storeProductsTable.status,
      order: storeProductsTable.order,
      partnerProductId: storeProductsTable.partnerProductId,
      sellerName: partnersTable.name,
      createdAt: storeProductsTable.createdAt,
      updatedAt: storeProductsTable.updatedAt,
      availableSeats: tripsTable.availableSeats,
      totalCapacity: tripsTable.totalCapacity,
      departureDate: tripsTable.departureDate,
      returnDate: tripsTable.returnDate,
      inclusions: tripsTable.inclusions,
      tripType: tripsTable.type,
      originCity: tripsTable.originCity,
      originState: tripsTable.originState,
      destinationCity: tripsTable.destinationCity,
      destinationState: tripsTable.destinationState,
      departureTime: tripsTable.departureTime,
      returnTime: tripsTable.returnTime,
      showSeatMap: tripsTable.showSeatMap,
      boardingPoints: tripsTable.boardingPoints,
      tripVideos: tripsTable.videos,
    })
      .from(storeProductsTable)
      .leftJoin(tripsTable, eq(storeProductsTable.tripId, tripsTable.id))
      .leftJoin(partnerProductsTable, eq(storeProductsTable.partnerProductId, partnerProductsTable.id))
      .leftJoin(partnersTable, eq(partnerProductsTable.partnerId, partnersTable.id))
      .where(and(
        eq(storeProductsTable.storeId, store.id),
        eq(storeProductsTable.slug, req.params.productSlug),
        eq(storeProductsTable.status, "active"),
      )).limit(1);
    if (!row) { next(new NotFoundError("Product not found", "NOT_FOUND")); return; }
    await db.update(storeProductsTable)
      .set({ viewsCount: row.viewsCount + 1 })
      .where(eq(storeProductsTable.id, row.id));
    const reviews = await db.select({
      id: storeReviewsTable.id,
      reviewerName: storeReviewsTable.reviewerName,
      rating: storeReviewsTable.rating,
      title: storeReviewsTable.title,
      comment: storeReviewsTable.comment,
      images: storeReviewsTable.images,
      verifiedPurchase: storeReviewsTable.verifiedPurchase,
      isFeatured: storeReviewsTable.isFeatured,
      reply: storeReviewsTable.reply,
      repliedAt: storeReviewsTable.repliedAt,
      createdAt: storeReviewsTable.createdAt,
      updatedAt: storeReviewsTable.updatedAt,
    }).from(storeReviewsTable)
      .where(and(
        eq(storeReviewsTable.productId, row.id),
        eq(storeReviewsTable.status, "approved"),
      ))
      .orderBy(desc(storeReviewsTable.createdAt));
    res.json({
      ...row,
      departureDate: row.departureDate
        ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(row.departureDate as unknown as Date)
        : null,
      returnDate: row.returnDate
        ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(row.returnDate as unknown as Date)
        : null,
      reviews,
    });
  } catch (err) {
    next(err);
  }
});

// GET /public/store/:slug/products/:productSlug/partner-info  — public, no auth required
router.get("/public/store/:slug/products/:productSlug/partner-info", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const store = await getActiveStore(req.params.slug);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }

    const [product] = await db.select({
      id: storeProductsTable.id,
      partnerProductId: storeProductsTable.partnerProductId,
    }).from(storeProductsTable)
      .where(and(
        eq(storeProductsTable.storeId, store.id),
        eq(storeProductsTable.slug, req.params.productSlug!),
        eq(storeProductsTable.status, "active"),
      )).limit(1);

    if (!product?.partnerProductId) { res.json({ hasPartner: false }); return; }

    const [pp] = await db.select({
      id: partnerProductsTable.id,
      type: partnerProductsTable.type,
      title: partnerProductsTable.title,
      meetingPoint: partnerProductsTable.meetingPoint,
      origin: partnerProductsTable.origin,
      locationUrl: partnerProductsTable.locationUrl,
      durationMinutes: partnerProductsTable.durationMinutes,
      maxCapacity: partnerProductsTable.maxCapacity,
      cancellationPolicy: partnerProductsTable.cancellationPolicy,
      faq: partnerProductsTable.faq,
      sellerName: partnersTable.name,
      sellerSlug: partnersTable.slug,
      sellerDescription: partnersTable.description,
      sellerLogo: partnersTable.logo,
    }).from(partnerProductsTable)
      .innerJoin(partnersTable, eq(partnersTable.id, partnerProductsTable.partnerId))
      .where(and(
        eq(partnerProductsTable.id, product.partnerProductId),
        eq(partnerProductsTable.status, "active"),
        eq(partnerProductsTable.tenantId, store.tenantId),
        eq(partnersTable.status, "active"),
      )).limit(1);

    if (!pp) { res.json({ hasPartner: false }); return; }

    const today = localToday();
    const availability = await db.select({
      date: partnerAvailabilityTable.date,
      spotsTotal: partnerAvailabilityTable.spotsTotal,
      spotsUsed: partnerAvailabilityTable.spotsUsed,
    }).from(partnerAvailabilityTable)
      .where(and(
        eq(partnerAvailabilityTable.productId, pp.id),
        sql`${partnerAvailabilityTable.date} >= ${today}`,
      ))
      .orderBy(asc(partnerAvailabilityTable.date));

    res.json({
      hasPartner: true,
      ...pp,
      seller: {
        name: pp.sellerName,
        slug: pp.sellerSlug,
        description: pp.sellerDescription,
        logo: pp.sellerLogo,
      },
      availability: availability.filter((a) => a.spotsTotal - a.spotsUsed > 0),
    });
  } catch (err) {
    next(err);
  }
});

// ── AI-assisted "Você também pode gostar" recommendations ─────────────────────
// Best-effort: a deterministic heuristic always produces an answer; an optional
// per-tenant AI call only *reorders* the heuristic candidates. Any AI failure or
// timeout silently falls back to the heuristic order. Results are cached briefly
// in memory keyed by store/product/effective-price so the AI is not hit on every
// page view. Never blocks or fails the product page.
const RECS_TTL_MS = 5 * 60 * 1000;
const RECS_AI_TIMEOUT_MS = 2000;
const recsCache = new Map<string, { at: number; orderedIds: string[] }>();

function effectivePrice(p: { price: string | number | null; onSale?: boolean | null; salePrice?: string | number | null }): number {
  const base = Number(p.price ?? 0);
  if (p.onSale && p.salePrice != null) {
    const sale = Number(p.salePrice);
    if (isFinite(sale) && sale > 0) return sale;
  }
  return isFinite(base) ? base : 0;
}

async function rankCandidatesWithAI(
  tenantId: string,
  current: { name: string; destination: string | null; price: number },
  candidates: { id: string; name: string; destination: string | null; price: number }[],
): Promise<string[] | null> {
  try {
    const ai = await getAIClientForTenant(tenantId);
    const list = candidates
      .map((c, i) => `${i + 1}. id=${c.id} | ${c.name} | destino=${c.destination ?? "-"} | preço=${c.price}`)
      .join("\n");
    const prompt = `Produto atual: ${current.name} | destino=${current.destination ?? "-"} | preço=${current.price}\n\nCandidatos:\n${list}\n\nOrdene os IDs dos candidatos do mais para o menos relevante para quem está vendo o produto atual. Responda APENAS com um array JSON de strings de IDs, sem texto extra.`;
    const completion = await ai.client.chat.completions.create(
      {
        model: ai.model,
        messages: [
          { role: "system", content: "Você recomenda viagens/produtos turísticos. Responda somente com JSON válido." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 300,
      },
      { timeout: RECS_AI_TIMEOUT_MS, maxRetries: 0 },
    );
    const raw = completion.choices?.[0]?.message?.content?.trim() ?? "";
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return null;
    const validIds = new Set(candidates.map((c) => c.id));
    const ordered = parsed.filter((x): x is string => typeof x === "string" && validIds.has(x));
    return ordered.length > 0 ? ordered : null;
  } catch {
    return null;
  }
}

router.get("/public/store/:slug/products/:productSlug/recommendations", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const store = await getActiveStore(req.params.slug);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }

    const limitRaw = Number(req.query["limit"]);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 4, 1), 8);

    const [current] = await db.select({
      id: storeProductsTable.id,
      categoryId: storeProductsTable.categoryId,
      destination: storeProductsTable.destination,
      price: storeProductsTable.price,
      onSale: storeProductsTable.onSale,
      salePrice: storeProductsTable.salePrice,
      name: storeProductsTable.name,
    })
      .from(storeProductsTable)
      .where(and(
        eq(storeProductsTable.storeId, store.id),
        eq(storeProductsTable.slug, req.params.productSlug),
        eq(storeProductsTable.status, "active"),
      )).limit(1);
    // Best-effort: an unknown product yields an empty list rather than a 404.
    if (!current) { res.json({ data: [] }); return; }

    const currentPrice = effectivePrice(current);

    const cardFields = {
      id: storeProductsTable.id,
      type: storeProductsTable.type,
      name: storeProductsTable.name,
      slug: storeProductsTable.slug,
      shortDescription: storeProductsTable.shortDescription,
      categoryId: storeProductsTable.categoryId,
      tripId: storeProductsTable.tripId,
      includes: storeProductsTable.includes,
      price: storeProductsTable.price,
      comparePrice: storeProductsTable.comparePrice,
      onSale: storeProductsTable.onSale,
      salePrice: storeProductsTable.salePrice,
      images: storeProductsTable.images,
      thumbnail: storeProductsTable.thumbnail,
      hasDates: storeProductsTable.hasDates,
      startDate: storeProductsTable.startDate,
      destination: storeProductsTable.destination,
      durationDays: storeProductsTable.durationDays,
      isFeatured: storeProductsTable.isFeatured,
      salesCount: storeProductsTable.salesCount,
      ratingAverage: storeProductsTable.ratingAverage,
      ratingCount: storeProductsTable.ratingCount,
      availableSeats: tripsTable.availableSeats,
      totalCapacity: tripsTable.totalCapacity,
      departureDate: tripsTable.departureDate,
      returnDate: tripsTable.returnDate,
    };

    // Bounded candidate pool from the same store (popular first).
    const pool = await db.select(cardFields)
      .from(storeProductsTable)
      .leftJoin(tripsTable, eq(storeProductsTable.tripId, tripsTable.id))
      .where(and(
        eq(storeProductsTable.storeId, store.id),
        eq(storeProductsTable.status, "active"),
        ne(storeProductsTable.id, current.id),
      ))
      .orderBy(desc(storeProductsTable.salesCount))
      .limit(24);

    if (pool.length === 0) { res.json({ data: [] }); return; }

    // Deterministic heuristic score: same category / destination / price band.
    const scored = pool.map((p) => {
      let score = 0;
      if (current.categoryId && p.categoryId === current.categoryId) score += 3;
      if (current.destination && p.destination && p.destination === current.destination) score += 3;
      const pPrice = effectivePrice(p);
      if (currentPrice > 0 && pPrice > 0) {
        const rel = Math.abs(pPrice - currentPrice) / currentPrice;
        score += Math.max(0, 2 - rel * 2);
      }
      if (p.isFeatured) score += 0.5;
      return { p, score, pPrice };
    });
    scored.sort((a, b) => b.score - a.score || (b.p.salesCount ?? 0) - (a.p.salesCount ?? 0));

    const heuristicTop = scored.slice(0, Math.min(12, scored.length));

    // Optional AI re-ranking over the heuristic shortlist (cached, best-effort).
    const cacheKey = `${store.id}:${current.id}:${currentPrice}`;
    const cached = recsCache.get(cacheKey);
    let orderedIds: string[];
    if (cached && Date.now() - cached.at < RECS_TTL_MS) {
      orderedIds = cached.orderedIds;
    } else {
      const aiOrder = await rankCandidatesWithAI(
        store.tenantId,
        { name: current.name, destination: current.destination, price: currentPrice },
        heuristicTop.map((s) => ({ id: s.p.id, name: s.p.name, destination: s.p.destination, price: s.pPrice })),
      );
      orderedIds = aiOrder ?? heuristicTop.map((s) => s.p.id);
      recsCache.set(cacheKey, { at: Date.now(), orderedIds });
      if (recsCache.size > 500) {
        const firstKey = recsCache.keys().next().value;
        if (firstKey) recsCache.delete(firstKey);
      }
    }

    // Materialise ordered products (AI/heuristic order first, heuristic remainder appended).
    const byId = new Map(heuristicTop.map((s) => [s.p.id, s.p]));
    const orderedProducts: typeof pool = [];
    for (const id of orderedIds) {
      const found = byId.get(id);
      if (found) { orderedProducts.push(found); byId.delete(id); }
    }
    for (const s of heuristicTop) {
      const remaining = byId.get(s.p.id);
      if (remaining) { orderedProducts.push(remaining); byId.delete(s.p.id); }
    }

    const data = orderedProducts.slice(0, limit).map((p) => ({
      ...p,
      departureDate: p.departureDate
        ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(p.departureDate as unknown as Date)
        : null,
      returnDate: p.returnDate
        ? new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(p.returnDate as unknown as Date)
        : null,
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get("/public/store/:slug/trips/:tripId/seat-map", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const store = await getActiveStore(req.params.slug);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }

    const [trip] = await db.select({
      id: tripsTable.id,
      seatMap: tripsTable.seatMap,
      seatLayout: tripsTable.seatLayout,
      totalCapacity: tripsTable.totalCapacity,
      tenantId: tripsTable.tenantId,
      layoutId: tripsTable.layoutId,
      freePassengers: tripsTable.freePassengers,
    }).from(tripsTable)
      .where(and(
        eq(tripsTable.id, req.params.tripId),
        eq(tripsTable.tenantId, store.tenantId),
      )).limit(1);

    if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

    let numberingType = "sequential";
    if (trip.layoutId) {
      const [layout] = await db.select({ numberingType: vehicleLayoutsTable.numberingType })
        .from(vehicleLayoutsTable)
        .where(and(eq(vehicleLayoutsTable.id, trip.layoutId), eq(vehicleLayoutsTable.tenantId, store.tenantId)))
        .limit(1);
      if (layout) numberingType = layout.numberingType;
    }

    const reservations = await db.select({ seats: reservationsTable.seats, status: reservationsTable.status })
      .from(reservationsTable)
      .where(and(
        eq(reservationsTable.tripId, trip.id),
        eq(reservationsTable.tenantId, store.tenantId),
        inArray(reservationsTable.status, ACTIVE_RESERVATION_STATUSES),
      ));

    const occupiedSeats: Record<string, string> = {};
    for (const r of reservations) {
      const seatStatus = r.status === RESERVATION_STATUS.CONFIRMED ? "confirmed" : "reserved";
      for (const seat of r.seats) occupiedSeats[seat] = seatStatus;
    }

    // Mark free-passenger (gratuidade) seats as occupied so vitrine customers
    // cannot select them.
    const freePassengers = Array.isArray(trip.freePassengers)
      ? (trip.freePassengers as Array<{ seatNumber?: string | null }>)
      : [];
    for (const fp of freePassengers) {
      if (fp.seatNumber) occupiedSeats[fp.seatNumber] = "free";
    }

    const seatMap = trip.seatMap as Record<string, { row: number; col: number; floor?: number; status: string; type?: string }>;
    const seats = Object.entries(seatMap).map(([num, data]) => ({
      number: num,
      row: data.row,
      col: data.col,
      floor: data.floor ?? 1,
      type: data.type ?? "seat",
      status: occupiedSeats[num]
        ?? (data.type && !["seat", "vip", "accessible"].includes(data.type) ? data.type : "available"),
    }));

    const maxCol = Math.max(...seats.map(s => s.col), 4);
    const maxFloor = Math.max(...seats.map(s => s.floor ?? 1), 1);
    res.json({
      tripId: trip.id,
      layout: trip.seatLayout ?? "2x2",
      numberingType,
      floors: maxFloor,
      totalSeats: trip.totalCapacity,
      cols: maxCol,
      seats,
    });
  } catch (err) {
    next(err);
  }
});


router.get("/public/store/:slug/trips/:tripId/seats/stream", async (req, res, next: NextFunction): Promise<void> => {
  const store = await getActiveStore(req.params.slug).catch(() => null);
  if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }

  const [trip] = await db.select({ id: tripsTable.id })
    .from(tripsTable)
    .where(and(
      eq(tripsTable.id, req.params.tripId),
      eq(tripsTable.tenantId, store.tenantId),
    ))
    .limit(1);
  if (!trip) { next(new NotFoundError("Trip not found", "NOT_FOUND")); return; }

  const tripId = trip.id;
  const clientIp = getClientIp(req);
  if (!tryAddSeatClient(tripId, res, clientIp)) {
    next(new AppError("Too many concurrent seat stream connections", 429, "TOO_MANY_REQUESTS"));
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const ping = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(ping); }
  }, 30000);
  req.on("close", () => {
    clearInterval(ping);
    removeSeatClient(tripId, res);
  });
});

const CreateOrderBody = z.object({
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  customerPhone: z.string().optional(),
  customerCpf: z.string().optional(),
  customerBirthdate: z.string().optional(),
  customerAddress: z.record(z.string(), z.unknown()).optional(),
  items: z.array(z.object({
    productId: z.string(),
    productName: z.string().optional(),
    quantity: z.number().int().min(1),
    unitPrice: z.number().nonnegative().optional(),
    variantLabel: z.string().optional(),
    variantData: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })).min(1),
  couponCode: z.string().optional(),
  referralCode: z.string().optional(),
  referralCookieId: z.string().optional(),
  referralCreditUsed: z.number().nonnegative().optional(),
  paymentMethod: z.string().optional(),
  paymentProvider: z.string().optional(),
  notes: z.string().optional(),
  customerNotes: z.string().optional(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  seats: z.array(z.string()).optional(),
  boardingLocationId: z.string().optional(),
  coPassengers: z.array(z.object({
    name: z.string().min(1),
    cpf: z.string().optional(),
    phone: z.string().optional(),
  })).optional(),
  depositAmount: z.number().nonnegative().optional(),
  // Client-generated key, one per checkout attempt. Lets a browser retry /
  // double-submit of the same attempt (slow network, accidental double-click
  // that bypasses the button's disabled state, back-button resubmission)
  // reuse the original order instead of creating a duplicate and
  // double-reserving seats. See store_orders_store_idempotency_key_unique.
  idempotencyKey: z.string().min(1).max(128).optional(),
}
)
;


/**
 * If a prior order already exists for this store + idempotencyKey, replay its
 * success response instead of letting the caller create a duplicate order.
 * Also finishes creating reservations for it (idempotent, no-op if already
 * done or if the order has no trip-linked items) in case a prior attempt
 * crashed after persisting the order but before reservations were created.
 *
 * Returns true if a replay response was sent (caller must return immediately
 * without falling through to normal order creation), false otherwise.
 */
async function handleIdempotentOrderReplay(
  store: typeof storesTable.$inferSelect,
  idempotencyKey: string,
  res: import("express").Response,
  next: NextFunction,
): Promise<boolean> 
{

  const [existingOrder] = await db
    .select()
    .from(storeOrdersTable)
    .where(and(eq(storeOrdersTable.storeId, store.id), eq(storeOrdersTable.idempotencyKey, idempotencyKey)))
    .limit(1)
;

  if (!existingOrder) return false
;


  let replayOrder = await ensureOrderPixQr(store, existingOrder);
  let reservationExpiresAt: Date | null = null
;
  let reservationIds: string[] = [];
  try 
{

    const reservationResult = await createReservationsForOrder(existingOrder.id)
;
    reservationIds = reservationResult.reservationIds;
    reservationExpiresAt = reservationResult.reservationExpiresAt ?? null
;

  
}
 catch (reservationErr) 
{

    logger.error(
      
{
 err: reservationErr, orderId: existingOrder.id, orderNumber: existingOrder.orderNumber 
}
,
      "[store/orders] Idempotent replay: failed to finish creating reservations",
    )
;

    next(new AppError(
      "Não foi possível confirmar sua reserva. Por favor, tente novamente ou contate a agência.",
      502,
      "RESERVATION_SYNC_FAILED",
      
{
 orderId: existingOrder.id, orderNumber: existingOrder.orderNumber 
}
,
    ))
;

    return true
;

  
}


  const items = await db
    .select()
    .from(storeOrderItemsTable)
    .where(eq(storeOrderItemsTable.orderId, existingOrder.id))
;
  const replayReservations = reservationIds.length
    ? await db.select({
      id: reservationsTable.id,
      status: reservationsTable.status,
      totalValue: reservationsTable.totalValue,
      paidValue: reservationsTable.paidValue,
      balance: reservationsTable.balance,
    }).from(reservationsTable).where(and(
      eq(reservationsTable.tenantId, store.tenantId),
      inArray(reservationsTable.id, reservationIds),
    ))
    : [];

  const paymentRows = await db.select({
    orderId: paymentsTable.orderId,
    reservationId: paymentsTable.reservationId,
    amount: paymentsTable.amount,
    status: paymentsTable.status,
    type: paymentsTable.type,
  }).from(paymentsTable).where(and(
    eq(paymentsTable.tenantId, store.tenantId),
    or(
      eq(paymentsTable.orderId, replayOrder.id),
      ...(reservationIds.length ? [inArray(paymentsTable.reservationId, reservationIds)] : []),
    ),
  ));
  const paidAmount = calculateReceivedAmount(replayOrder.id, reservationIds, paymentRows);

  // A retry may arrive after the order transaction committed but before one or
  // more fire-and-forget effects completed. Each downstream operation is
  // idempotent: the booking notification and PIX QR use durable outbox keys,
  // while portal provisioning reuses the existing tenant-scoped account.
  void reconcileOrderPostCommitEffects(store, replayOrder, reservationIds).catch((err) => {
    logger.warn({ err, orderId: replayOrder.id }, "[store/orders] Idempotent replay effect reconciliation failed");
  });

  res.status(200).json(
{

    ...replayOrder,
    orderId: replayOrder.id,
    items,
    paymentToken: replayOrder.paymentToken,
    paidAmount,
    amountRemaining: Math.max(0, Number(replayOrder.totalAmount) - paidAmount).toFixed(2),
    financialSummary: orderFinancialSummary(
      replayOrder,
      paidAmount,
      paymentRows,
      replayReservations.length === 1 ? replayReservations[0] : null,
      reservationIds,
    ),
    reservationExpiresAt,
  
}
)
;

  return true
;

}


router.post("/public/store/:slug/orders", async (req, res, next: NextFunction): Promise<void> => 
{

  try 
{

    const store = await getActiveStore(req.params.slug)
;

    if (!store) 
{
 next(new NotFoundError("Store not found", "NOT_FOUND"))
;
 return
;
 
}

    if (store.maintenanceMode) 
{

      next(new AppError("Store is under maintenance", 503, "SERVICE_UNAVAILABLE"))
;

      return
;

    
}

    const parsed = CreateOrderBody.safeParse(req.body)
;

    if (!parsed.success) 
{
 next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR"))
;
 return
;
 
}

    const data = 
{
 ...parsed.data, ipAddress: getClientIp(req) ?? parsed.data.ipAddress 
}
;


    // Idempotency: a browser retry / accidental double-submit of the same
    // checkout attempt carries the same client-generated key. Reuse the
    // original order (and finish creating reservations for it if a prior
    // attempt crashed partway) instead of creating a duplicate order and
    // double-reserving seats.
    if (data.idempotencyKey) 
{

      const existing = await handleIdempotentOrderReplay(store, data.idempotencyKey, res, next)
;

      if (existing) return
;

    
}


    const 
{
 subtotal, orderItemsData, fetchedProducts, quantityByProductId, tripLinkedProducts 
}
 =
      await prepareCheckoutItems(
{
 storeId: store.id, tenantId: store.tenantId, items: data.items 
}
)
;


    const discounts = await resolveCheckoutDiscounts(
{

      storeId: store.id,
      tenantId: store.tenantId,
      subtotal,
      couponCode: data.couponCode,
      referralCode: data.referralCode,
      customerEmail: data.customerEmail,
    
}
)
;


    // Resolve referral credit spend — requires authenticated Clerk user whose email matches the order
    let appliedCreditAmount = 0
;

    let creditSpend: Array<
{
 id: string
;
 consumedAmount: number 
}
> = []
;

    if (data.referralCreditUsed && data.referralCreditUsed > 0) 
{

      // Must have a valid Clerk session AND that user's email must match the order's customerEmail
      const authedUser = await getTenantUser(req)
;

      if (!authedUser) 
{

        next(new ValidationError("Autenticação necessária para usar cashback de indicação", "UNAUTHENTICATED_CREDIT"))
;

        return
;

      
}

      // Bind authenticated identity to the order email — prevent IDOR spend
      if (authedUser.email.toLowerCase() !== data.customerEmail.toLowerCase()) 
{

        next(new ValidationError("E-mail da conta não corresponde ao e-mail do pedido", "CREDIT_EMAIL_MISMATCH"))
;

        return
;

      
}

      // Verify a client record exists for this email in this store's tenant
      const [creditClient] = await db
        .select({ id: clientsTable.id })
        .from(clientsTable)
        .where(and(
          eq(clientsTable.tenantId, store.tenantId),
          eq(clientsTable.email, data.customerEmail.toLowerCase()),
        ))
        .limit(1);
      if (creditClient) {
        const afterDiscount = roundMoney(Math.max(0, subtotal - discounts.discountAmount));
        // Select rows with remaining balance (including partially consumed ones)
        const creditRows = await db
          .select({
            id: referralsTable.id,
            bonusAmount: referralsTable.bonusAmount,
            bonusCreditUsedAmount: referralsTable.bonusCreditUsedAmount,
          })
          .from(referralsTable)
          .where(and(
            eq(referralsTable.tenantId, store.tenantId),
            eq(referralsTable.referrerId, creditClient.id),
            inArray(referralsTable.status, ["completed", "converted"]),
            eq(referralsTable.bonusPaid, false),
            // Only rows that still have remaining credit
            sql`${referralsTable.bonusAmount} > COALESCE(${referralsTable.bonusCreditUsedAmount}, 0)`,
          ))
          .orderBy(asc(referralsTable.createdAt));
        const totalAvailable = creditRows.reduce(
          (s, r) => s + (Number(r.bonusAmount) - Number(r.bonusCreditUsedAmount ?? 0)), 0,
        );
        // Intentional clamp: over-requested credit is silently reduced to available balance.
        // Frontend pre-validates using the balance from GET /client/me; over-requests only
        // occur with stale clients or manual API calls — both are safely handled by capping.
        const requestedCredit = Math.min(data.referralCreditUsed, totalAvailable, afterDiscount);
        appliedCreditAmount = roundMoney(requestedCredit);
        // Build greedy spend plan — oldest rows first, partial consumption tracked per-row
        let remaining = appliedCreditAmount;
        for (const row of creditRows) {
          if (remaining <= 0) break;
          const available = Number(row.bonusAmount) - Number(row.bonusCreditUsedAmount ?? 0);
          const consume = roundMoney(Math.min(available, remaining));
          if (consume > 0) {
            creditSpend.push({ id: row.id, consumedAmount: consume });
            remaining = roundMoney(remaining - consume);
          }
        }
      }
    }

    const totalAmount = roundMoney(Math.max(0, subtotal - discounts.discountAmount - appliedCreditAmount));

    // Validate minimum deposit amount if configured.
    // Reject depositAmount entirely when the store has no minDepositAmount set.
    let depositAmount: number | undefined;
    if (data.depositAmount != null) {
      if (store.minDepositAmount == null) {
        next(new ValidationError(
          "Esta loja não aceita pagamento parcial",
          "DEPOSIT_NOT_ALLOWED",
        ));
        return;
      }
      const minDeposit = Number(store.minDepositAmount);
      if (data.depositAmount < minDeposit) {
        next(new ValidationError(
          `Valor mínimo de reserva é ${minDeposit.toFixed(2)}`,
          "DEPOSIT_BELOW_MINIMUM",
        ));
        return;
      }
      if (data.depositAmount > totalAmount) {
        next(new ValidationError(
          `Valor de reserva não pode ser maior que o total do pedido (${totalAmount.toFixed(2)})`,
          "DEPOSIT_ABOVE_TOTAL",
        ));
        return;
      }
      depositAmount = roundMoney(data.depositAmount);
    }

    const orderId = generateId();
    const orderNumber = `#${Number(localToday().slice(0, 4))}-${randomBytes(3).toString("hex").toUpperCase()}`;
    const orderPaymentToken = (await import("node:crypto")).randomBytes(32).toString("base64url");

    const parsedBirthDate: Date | null = data.customerBirthdate
      ? new Date(data.customerBirthdate.slice(0, 10) + "T12:00:00")
      : null;

    if (tripLinkedProducts.size > 0) {
      // Hard cap: prevent a single anonymous order from draining large trip capacity.
      // Reservations are created below as pending holds. They do not count as
      // paid or confirmed until a gateway/manual payment is actually recorded.
      const rawMax = parseInt(process.env["CHECKOUT_MAX_SEATS_PER_TRIP"] ?? "20", 10);
      const maxSeatsPerOrder = Number.isFinite(rawMax) && rawMax > 0 ? Math.min(rawMax, 500) : 20;
      for (const [, { totalQty }] of tripLinkedProducts) {
        if (totalQty > maxSeatsPerOrder) {
          next(new ValidationError(
            `Máximo de ${maxSeatsPerOrder} passageiros por viagem por pedido.`,
            "SEATS_PER_ORDER_EXCEEDED",
          ));
          return;
        }
      }
    }

    try {
      await persistCheckoutOrder({
        store, data, orderId, orderNumber, orderPaymentToken,
        subtotal,
        // Combined discount stored on order record for total-amount accounting
        discountAmount: discounts.discountAmount + appliedCreditAmount,
        // Promo-only discount passed separately for reservation analytics accuracy
        promoDiscountAmount: discounts.discountAmount,
        totalAmount,
        couponId: discounts.couponId,
        appliedReferralCode: discounts.appliedReferralCode,
        appliedReferralReferrerId: discounts.appliedReferralReferrerId,
        appliedReferralDiscountValue: discounts.appliedReferralDiscountValue,
        appliedReferralDiscountType: discounts.appliedReferralDiscountType,
        orderItemsData, fetchedProducts, quantityByProductId, tripLinkedProducts,
        parsedBirthDate,
        creditSpend: creditSpend.length > 0 ? creditSpend : undefined,
      });
    } catch (txErr: unknown) {
      if (txErr instanceof Error) {
        const tagged = txErr as Error & { productName?: string; available?: number; code?: string; constraint?: string };
        if (txErr.message === "insufficient_stock") {
          next(new ConflictError(`Estoque insuficiente para "${tagged.productName}". Disponível: ${tagged.available ?? 0}`, "INSUFFICIENT_STOCK")); return;
        }
        if (txErr.message === "no_seats") {
          next(new ConflictError(`Sem vagas suficientes para "${tagged.productName ?? ""}". Disponível: ${tagged.available ?? 0} vaga(s)`, "INSUFFICIENT_SEATS")); return;
        }
        if (txErr.message === "trip_not_found") {
          next(new NotFoundError(`Viagem vinculada ao produto "${tagged.productName ?? ""}" não encontrada`, "TRIP_NOT_FOUND")); return;
        }
        if (txErr.message === "partner_availability_unavailable") {
          next(new ConflictError(`A data escolhida não possui mais vagas para "${tagged.productName ?? ""}".`, "PARTNER_AVAILABILITY_UNAVAILABLE")); return;
        }
        // Concurrent double-submit: two requests carrying the same
        // idempotencyKey both passed the pre-check and raced to insert. The
        // unique index rejects the loser here — replay the winner's order
        // instead of surfacing a 500 / creating a duplicate.
        if (tagged.code === "23505" && tagged.constraint === "store_orders_store_idempotency_key_unique" && data.idempotencyKey) 
{

          const replayed = await handleIdempotentOrderReplay(store, data.idempotencyKey, res, next)
;

          if (replayed) return
;

        
}

      
}

      throw txErr
;

    
}


    const [order] = await db.select().from(storeOrdersTable)
      .where(eq(storeOrdersTable.id, orderId)).limit(1)
;

    const items = await db.select().from(storeOrderItemsTable)
      .where(eq(storeOrderItemsTable.orderId, orderId))
;


    let generatedPixQrCodeUrl: string | null = null;
    let generatedPixCopyPaste: string | null = null;
    let generatedPixAmount: number | null = null;

    // Generate PIX QR code immediately when payment method is PIX and store
    // has a PIX key configured. The QR code is stored on the order so the
    // customer can scan it right after checkout (confirmation page + tracking).
    if (data.paymentMethod === "pix" && store.pixEnabled && store.pixKey) 
{

      try 
{

        const decryptedPixKey = decryptOrPassthrough(store.pixKey)
;

        if (decryptedPixKey) 
{

          const pixAmount = depositAmount ?? totalAmount
;

          const pixCode = generatePixEMV(
{

            key: decryptedPixKey,
            name: store.name,
            city: store.city ?? "BRASIL",
            amount: pixAmount,
            txid: orderId.slice(0, 25),
            description: `Reserva ${orderNumber}`.slice(0, 40),
          
}
)
;

          const pixQrCodeUrl = generatePixQrCodeUrl(pixCode)
;

          await db.update(storeOrdersTable).set(
{

            pixQrCode: pixCode,
            pixQrCodeUrl,
            pixCopyPaste: pixCode,
          
}
).where(eq(storeOrdersTable.id, orderId))
;

          // Reflect generated PIX data in the order object returned below
          (order as Record<string, unknown>).pixQrCode = pixCode
;

          (order as Record<string, unknown>).pixQrCodeUrl = pixQrCodeUrl
;

          (order as Record<string, unknown>).pixCopyPaste = pixCode
;
          generatedPixQrCodeUrl = pixQrCodeUrl;
          generatedPixCopyPaste = pixCode;
          generatedPixAmount = pixAmount;

        
}

      
}
 catch (pixErr) 
{

        logger.warn(
{
 pixErr, orderId 
}
, "[store/orders] Failed to generate PIX QR code")
;

      
}

    
}


    // Notify agency users whenever a PIX order is placed — regardless of whether
    // the store has a PIX key configured — so they know to confirm the payment.
    if (data.paymentMethod === "pix") 
{

      enqueuePixOrderAlertEmail(
{

        tenantId: store.tenantId,
        storeName: store.name,
        orderNumber,
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        customerPhone: data.customerPhone ?? undefined,
        totalAmount,
        productName: items[0]?.productName ?? "Produto",
      
}
).catch((err) => 
{

        logger.warn(
{
 err, orderId 
}
, "[store/orders] Failed to send PIX order alert to agency")
;

      
}
)
;

    
}


    // Referral-code minting and referral conversion/credit-spend crediting are
    // intentionally NOT done here — they stay deferred to runPostPaymentSideEffects
    // (post-payment) so an anonymous, non-paying visitor cannot credit a referrer
    // or mint a code just by submitting the checkout form.

    // Create the trip reservation(s), CRM client, Pipeline deal, and decrement
    // available_seats immediately at checkout — before payment confirmation.
    // PIX/boleto/transfer payments can take minutes or days to confirm, so the
    // agency needs to see the reservation (status = pending) right away rather
    // than only after payment clears. createReservationsForOrder is idempotent,
    // so the later payment-confirmation call for this same order is a safe no-op.
    //
    // If this fails, we must NOT report checkout success: the customer would be
    // shown a confirmation/PIX code for a "reservation" that doesn't exist yet,
    // and the agency wouldn't see it in the CRM. We surface a 502 so the
    // storefront can prompt a retry. The order row itself is left in place
    // (not rolled back) — createReservationsForOrder is idempotent by orderId,
    // so a retry (either the customer resubmitting or the later
    // payment-confirmation call in webhooks.ts/store.ts) will safely pick up
    // where this left off without creating duplicates.
    let checkoutReservationIds: string[] = []
;

    let checkoutTripIds: string[] = []
;
    let reservationExpiresAt: Date | null = null
;

    if (tripLinkedProducts.size > 0) 
{

      try 
{

        const createResult = await createReservationsForOrder(orderId)
;

        checkoutReservationIds = createResult.reservationIds
;

        checkoutTripIds = createResult.tripIds
;
        reservationExpiresAt = createResult.reservationExpiresAt ?? null
;

      
}
 catch (reservationErr) 
{

        // Race condition: two simultaneous checkouts for the same client+trip
        // both passed the order-creation step and raced to insert the reservation.
        // The unique index fires a 23505 — return 409 instead of a generic 500/502.
        if (
          reservationErr != null &&
          typeof reservationErr === "object" &&
          "code" in reservationErr &&
          (reservationErr as 
{
 code: unknown 
}
).code === "23505" &&
          "constraint" in reservationErr &&
          (reservationErr as 
{
 constraint: unknown 
}
).constraint === "reservations_active_client_trip_unique"
        ) 
{

          next(new ConflictError(
            "Esta viagem já possui uma reserva ativa para este cliente. Por favor, entre em contato com a agência.",
            "DUPLICATE_RESERVATION",
          ))
;

          return
;

        
}

        logger.error(
{
 err: reservationErr, orderId, orderNumber 
}
, "[store/orders] Failed to create reservations at checkout — surfacing error instead of a false-success response")
;

        next(new AppError(
          "Não foi possível confirmar sua reserva. Por favor, tente novamente ou contate a agência.",
          502,
          "RESERVATION_SYNC_FAILED",
          
{
 orderId, orderNumber 
}
,
        ))
;

        return
;

      
}

    
}

    // Deliver the customer-facing QR only after any linked reservation has
    // been created successfully. This prevents a failed seat/capacity claim
    // from sending a payment request for a reservation that does not exist.
    if (generatedPixQrCodeUrl && generatedPixCopyPaste && generatedPixAmount !== null) {
      const pixQrDeliveryMode = await getPixQrDeliveryMode(store.tenantId);
      if (pixQrDeliveryMode !== "screen") {
        enqueuePixOrderQr({
          tenantId: store.tenantId,
          orderId,
          orderNumber,
          customerName: data.customerName,
          customerEmail: data.customerEmail,
          customerPhone: data.customerPhone ?? null,
          storeName: store.name,
          amount: generatedPixAmount,
          pixQrCodeUrl: generatedPixQrCodeUrl,
          pixCopyPaste: generatedPixCopyPaste,
          deliveryMode: pixQrDeliveryMode,
        }).catch((err) => {
          logger.warn({ err, orderId, pixQrDeliveryMode }, "[store/orders] Failed to dispatch PIX QR");
        });
      }
    }


    res.status(200).json(
{

      ...order,
      orderId: order.id,
      items,
      paymentToken: orderPaymentToken,
      paidAmount: 0,
      amountRemaining: Number(order.totalAmount).toFixed(2),
      financialSummary: orderFinancialSummary(order, 0),
      reservationExpiresAt,
    
}
)
;


    for (const [tripId] of tripLinkedProducts) 
{

      broadcastSeatUpdate(tripId, store.tenantId).catch(() => 
{
}
)
;

    
}


    // Notify the agency of the new (pending) booking and provision the customer's
    // portal account right away, only when this call actually created new
    // reservations (checkoutTripIds is empty on an idempotent re-call).
    if (checkoutTripIds.length > 0) {
      for (const reservationId of checkoutReservationIds) {
        enqueueNewBookingNotificationEmail(reservationId, store.tenantId).catch((err) => {
          logger.warn({ err, reservationId }, "[store/orders] Failed to enqueue new-booking notification at checkout");
        });
      }

      const STORE_PUBLIC_BASE = (process.env["STORE_PUBLIC_URL"] ?? "https://visitecrm.com").replace(/\/$/, "");
      const storeBase = store.customDomain
        ? `https://${store.customDomain}`
        : `${STORE_PUBLIC_BASE}/loja/${store.slug}`;
      const loginUrl = `${storeBase}/entrar`;
      ensurePortalAccount({
        email: data.customerEmail,
        name: data.customerName,
        tenantId: store.tenantId,
        storeBase,
        loginUrl,
        agencyName: store.name,
        agencyLogo: store.logo ?? "",
      }).catch((err) => {
        logger.error({ err, orderId }, "[store/orders] Failed to provision portal account at checkout");
      });
    }
  } catch (err) {
    next(err);
  }
});

// Attach a gateway payment id (Stripe paymentIntentId / MP payment id) to
// an order. Gated by the one-shot paymentToken returned at order creation.
router.post("/public/store/:slug/orders/:orderNumber/payment-intent", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const store = await getActiveStore(req.params.slug);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }

    const body = (req.body ?? {}) as { paymentIntentId?: unknown; paymentToken?: unknown; paymentChargeId?: unknown };
    const paymentIntentId = typeof body.paymentIntentId === "string" ? body.paymentIntentId.trim() : "";
    const paymentToken = typeof body.paymentToken === "string" ? body.paymentToken.trim() : "";
    const paymentChargeId = typeof body.paymentChargeId === "string" ? body.paymentChargeId.trim() : null;

    if (!paymentIntentId) {
      next(new ValidationError("paymentIntentId is required", "VALIDATION_ERROR"));
      return;
    }
    if (!paymentToken) {
      next(new ValidationError("paymentToken is required", "VALIDATION_ERROR"));
      return;
    }

    const [order] = await db
      .select({
        id: storeOrdersTable.id,
        existingPaymentIntentId: storeOrdersTable.paymentIntentId,
        storedPaymentToken: storeOrdersTable.paymentToken,
      })
      .from(storeOrdersTable)
      .where(and(
        eq(storeOrdersTable.tenantId, store.tenantId),
        eq(storeOrdersTable.storeId, store.id),
        eq(storeOrdersTable.orderNumber, req.params.orderNumber),
      ))
      .limit(1);

    if (!order) { next(new NotFoundError("Order not found", "NOT_FOUND")); return; }

    const stored = order.storedPaymentToken ?? "";
    const a = Buffer.from(paymentToken);
    const b = Buffer.from(stored);
    const tokenMatches = a.length === b.length && a.length > 0 && (await import("node:crypto")).timingSafeEqual(a, b);
    if (!tokenMatches) {
      next(new ValidationError("Invalid payment token", "INVALID_TOKEN"));
      return;
    }

    if (order.existingPaymentIntentId && order.existingPaymentIntentId !== paymentIntentId) {
      next(new ValidationError("Order already has a different paymentIntentId", "ALREADY_SET"));
      return;
    }

    await db
      .update(storeOrdersTable)
      .set({
        paymentIntentId,
        ...(paymentChargeId ? { paymentChargeId } : {}),
      })
      .where(eq(storeOrdersTable.id, order.id));

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/public/store/:slug/orders/:orderNumber", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const store = await getActiveStore(req.params.slug);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }

    // Require the high-entropy paymentToken (returned at order creation) as the
    // authenticator. The human-readable orderNumber is not secret and must not
    // be the sole access gate to private order data.
    const suppliedToken = typeof req.query.token === "string" ? req.query.token.trim() : "";
    if (!suppliedToken) {
      next(new ValidationError("token is required to look up an order", "VALIDATION_ERROR"));
      return;
    }

    const [order] = await db.select({
      id: storeOrdersTable.id,
      orderNumber: storeOrdersTable.orderNumber,
      customerName: storeOrdersTable.customerName,
      customerEmail: storeOrdersTable.customerEmail,
      subtotal: storeOrdersTable.subtotal,
      discountAmount: storeOrdersTable.discountAmount,
      taxAmount: storeOrdersTable.taxAmount,
      shippingAmount: storeOrdersTable.shippingAmount,
      totalAmount: storeOrdersTable.totalAmount,
      depositAmount: storeOrdersTable.depositAmount,
      amountRemaining: storeOrdersTable.amountRemaining,
      couponCode: storeOrdersTable.couponCode,
      paymentMethod: storeOrdersTable.paymentMethod,
      paymentStatus: storeOrdersTable.paymentStatus,
      installments: storeOrdersTable.installments,
      pixQrCode: storeOrdersTable.pixQrCode,
      pixQrCodeUrl: storeOrdersTable.pixQrCodeUrl,
      pixCopyPaste: storeOrdersTable.pixCopyPaste,
      boletoUrl: storeOrdersTable.boletoUrl,
      boletoBarcode: storeOrdersTable.boletoBarcode,
      status: storeOrdersTable.status,
      fulfillmentStatus: storeOrdersTable.fulfillmentStatus,
      customerNotes: storeOrdersTable.customerNotes,
      paidAt: storeOrdersTable.paidAt,
      confirmedAt: storeOrdersTable.confirmedAt,
      completedAt: storeOrdersTable.completedAt,
      cancelledAt: storeOrdersTable.cancelledAt,
      createdAt: storeOrdersTable.createdAt,
      pendingReferral: storeOrdersTable.pendingReferral,
      storedPaymentToken: storeOrdersTable.paymentToken,
    }).from(storeOrdersTable)
      .where(and(
        eq(storeOrdersTable.storeId, store.id),
        eq(storeOrdersTable.orderNumber, req.params.orderNumber),
      )).limit(1);
    if (!order) { next(new NotFoundError("Order not found", "NOT_FOUND")); return; }

    // Verify ownership via timing-safe comparison of the high-entropy paymentToken.
    const stored = order.storedPaymentToken ?? "";
    const a = Buffer.from(suppliedToken);
    const b = Buffer.from(stored);
    const tokenMatches = a.length === b.length && a.length > 0 &&
      (await import("node:crypto")).timingSafeEqual(a, b);
    if (!tokenMatches) {
      next(new NotFoundError("Order not found", "NOT_FOUND"));
      return;
    }
    const linkedReservations = await db.select({
      id: reservationsTable.id,
      reservationNumber: reservationsTable.reservationNumber,
      tripId: reservationsTable.tripId,
      status: reservationsTable.status,
      seats: reservationsTable.seats,
      boardingLocationId: reservationsTable.boardingLocationId,
      totalValue: reservationsTable.totalValue,
      paidValue: reservationsTable.paidValue,
      balance: reservationsTable.balance,
      depositAmount: reservationsTable.depositAmount,
      paymentMethod: reservationsTable.paymentMethod,
      voucherCode: reservationsTable.voucherCode,
      expiresAt: reservationsTable.expiresAt,
      confirmedAt: reservationsTable.confirmedAt,
      cancelledAt: reservationsTable.cancelledAt,
      tripName: tripsTable.name,
      destination: tripsTable.destination,
      departureDate: tripsTable.departureDate,
      endDate: tripsTable.returnDate,
      departureTime: tripsTable.departureTime,
      returnTime: tripsTable.returnTime,
      boardingName: boardingLocationsTable.name,
      boardingAddress: boardingLocationsTable.address,
      boardingCity: boardingLocationsTable.city,
      boardingState: boardingLocationsTable.state,
      boardingReference: boardingLocationsTable.reference,
      boardingDepartureTime: boardingLocationsTable.departureTime,
    })
      .from(reservationsTable)
      .leftJoin(tripsTable, and(
        eq(tripsTable.id, reservationsTable.tripId),
        eq(tripsTable.tenantId, store.tenantId),
      ))
      .leftJoin(boardingLocationsTable, and(
        eq(boardingLocationsTable.id, reservationsTable.boardingLocationId),
        eq(boardingLocationsTable.tenantId, store.tenantId),
      ))
      .where(and(
        eq(reservationsTable.tenantId, store.tenantId),
        eq(reservationsTable.storeOrderId, order.orderNumber),
      ));
    const linkedReservationIds = linkedReservations.map(reservation => reservation.id);
    const passengerRows = linkedReservationIds.length
      ? await db.select({
        id: passengersTable.id,
        reservationId: passengersTable.reservationId,
        name: passengersTable.name,
        cpf: passengersTable.cpf,
        birthDate: passengersTable.birthDate,
        ageCategory: passengersTable.ageCategory,
        seatNumber: passengersTable.seatNumber,
        isPrimary: passengersTable.isPrimary,
        boardingLocationId: passengersTable.boardingLocationId,
        phone: passengersTable.phone,
      }).from(passengersTable).where(inArray(passengersTable.reservationId, linkedReservationIds))
      : [];
    const paymentRows = await db.select({
      orderId: paymentsTable.orderId,
      reservationId: paymentsTable.reservationId,
      amount: paymentsTable.amount,
      status: paymentsTable.status,
      type: paymentsTable.type,
    }).from(paymentsTable).where(and(
      eq(paymentsTable.tenantId, store.tenantId),
      or(
        eq(paymentsTable.orderId, order.id),
        ...(linkedReservationIds.length
          ? [inArray(paymentsTable.reservationId, linkedReservationIds)]
          : []),
      ),
    ));
    const paidAmount = calculateReceivedAmount(order.id, linkedReservationIds, paymentRows);
    const summary = orderFinancialSummary(
      order,
      paidAmount,
      paymentRows,
      linkedReservations.length === 1 ? linkedReservations[0] : null,
      linkedReservationIds,
    );
    const rawItems = await db.select({
      id: storeOrderItemsTable.id,
      productId: storeOrderItemsTable.productId,
      productName: storeOrderItemsTable.productName,
      productType: storeOrderItemsTable.productType,
      productImage: storeOrderItemsTable.productImage,
      variant: storeOrderItemsTable.variant,
      price: storeOrderItemsTable.price,
      quantity: storeOrderItemsTable.quantity,
      subtotal: storeOrderItemsTable.subtotal,
      total: storeOrderItemsTable.total,
    }).from(storeOrderItemsTable)
      .where(eq(storeOrderItemsTable.orderId, order.id));
    const items = rawItems.map((item) => {
      const variantObj = item.variant as Record<string, string> | null;
      const variantLabel = variantObj
        ? Object.values(variantObj).join(" / ")
        : null;
      return {
        ...item,
        unitPrice: parseFloat(item.price ?? "0"),
        variantLabel,
      };
    });

    // Derive discount breakdown from pendingReferral JSON.
    // Coupon and referral code are mutually exclusive per business logic.
    const referralData = order.pendingReferral as {
      discountValue?: number;
      discountType?: string;
      code?: string;
    } | null;
    const subtotalNum = parseFloat(order.subtotal ?? "0");
    let referralDiscountAmount = 0;
    let referralDiscountType: string | null = null;
    let referralDiscountPct: number | null = null;
    if (referralData?.discountType && referralData?.discountValue != null) {
      referralDiscountType = referralData.discountType;
      if (referralData.discountType === "percentage") {
        referralDiscountPct = referralData.discountValue;
        referralDiscountAmount = Math.round(subtotalNum * (referralData.discountValue / 100) * 100) / 100;
      } else {
        referralDiscountAmount = Math.min(referralData.discountValue, subtotalNum);
      }
    }
    const totalDiscountNum = parseFloat(order.discountAmount ?? "0");
    const couponDiscountAmount = order.couponCode
      ? Math.max(0, totalDiscountNum - referralDiscountAmount)
      : 0;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { storedPaymentToken: _tok, pendingReferral: _pr, ...safeOrder } = order;
    const publicReservations = linkedReservations.map((reservation) => ({
      ...reservation,
      passengers: passengerRows
        .filter((passenger) => passenger.reservationId === reservation.id)
        .map((passenger) => ({
          ...passenger,
          // The lookup is authenticated by a high-entropy token, but CPF is
          // still unnecessary for the public tracking screen.
          cpf: undefined,
        })),
    }));
    res.json({
      ...safeOrder,
      paidAmount,
      amountRemaining: Math.max(0, Number(order.totalAmount) - paidAmount).toFixed(2),
      financialSummary: summary,
      items,
      reservations: publicReservations,
      reservationExpiresAt: publicReservations
        .map((reservation) => reservation.expiresAt)
        .filter((value): value is Date => value instanceof Date)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null,
      referralDiscountType,
      referralDiscountPct,
      referralDiscountAmount,
      couponDiscountAmount,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Records a best-effort, fire-and-forget "suspended referral attempt" signal when
 * a customer tries to use a blocked/cancelled referral code on a public storefront.
 *
 * Shared by BOTH public lookup paths (POST /referral/validate and GET /referral/info)
 * so the two abuse-tracking writes can never silently drift apart. Performs two
 * independent fire-and-forget writes and never throws:
 *  1. Bumps `referralSuspendedAttemptAt` / `referralSuspendedAttemptCount` on the client.
 *  2. Appends a per-attempt row to `referral_attempt_logs`.
 */
function recordSuspendedReferralAttempt(params: {
  clientId: string;
  tenantId: string;
  storeSlug: string;
  ipAddress: string | null;
}): void {
  const { clientId, tenantId, storeSlug, ipAddress } = params;
  db.update(clientsTable)
    .set({
      referralSuspendedAttemptAt: new Date(),
      referralSuspendedAttemptCount: sql`${clientsTable.referralSuspendedAttemptCount} + 1`,
    })
    .where(eq(clientsTable.id, clientId))
    .execute()
    .catch((err: unknown) => {
      logger.warn({ err }, "[store-public] Failed to record suspended referral attempt");
    });
  db.insert(referralAttemptLogsTable)
    .values({ id: generateId(), tenantId, clientId, storeSlug, ipAddress })
    .catch((err: unknown) => {
      logger.warn({ err }, "[store-public] Failed to log referral attempt");
    });
}

router.post("/public/store/:slug/referral/validate", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const store = await getActiveStore(req.params.slug);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const [tenantRowRef] = await db.select({ settings: tenantsTable.settings }).from(tenantsTable).where(eq(tenantsTable.id, store.tenantId)).limit(1);
    if ((tenantRowRef?.settings as Record<string, unknown> | null)?.referralsEnabled === false) {
      next(new ValidationError("Programa de indicação inativo", "REFERRAL_PROGRAM_INACTIVE", { valid: false })); return;
    }
    const parsed = z.object({
      code: z.string().min(1),
      customerEmail: z.string().optional(),
      cookieId: z.string().optional(),
      cartTotal: z.number().nonnegative().optional(),
      orderTotal: z.number().nonnegative().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const code = parsed.data.code.toUpperCase();
    const cartTotal = parsed.data.cartTotal ?? parsed.data.orderTotal ?? 0;

    // Look up by client's permanent referral code
    const [referrer] = await db.select(
{

      id: clientsTable.id,
      name: clientsTable.name,
      email: clientsTable.email,
      referralCode: clientsTable.referralCode,
      referralCodeStatus: clientsTable.referralCodeStatus,
      successfulReferrals: clientsTable.successfulReferrals,
    
}
).from(clientsTable)
      .where(and(
        eq(clientsTable.tenantId, store.tenantId),
        eq(clientsTable.referralCode, code),
      )).limit(1)
;


    if (!referrer) 
{

      next(new ValidationError("Código de indicação inválido", "REFERRAL_CODE_INVALID", 
{
 valid: false 
}
))
;
 return
;

    
}


    if (referrer.referralCodeStatus !== "active") 
{

      recordSuspendedReferralAttempt(
{

        clientId: referrer.id,
        tenantId: store.tenantId,
        storeSlug: req.params.slug,
        ipAddress: getClientIp(req) ?? null,
      
}
)
;

      next(new ValidationError("Código de indicação bloqueado ou cancelado", "REFERRAL_CODE_SUSPENDED", 
{
 valid: false 
}
))
;
 return
;

    
}


    // Get discount % from referral settings
    const [settings] = await db.select(
{

      discountValue: referralSettingsTable.discountValue,
      discountType: referralSettingsTable.discountType,
      isEnabled: referralSettingsTable.isEnabled,
      expirationDays: referralSettingsTable.expirationDays,
      allowSelfReferral: referralSettingsTable.allowSelfReferral,
      minPurchaseAmount: referralSettingsTable.minPurchaseAmount,
      maxReferralsPerUser: referralSettingsTable.maxReferralsPerUser,
    
}
).from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, store.tenantId)).limit(1)
;


    if (settings && !settings.isEnabled) 
{

      next(new ValidationError("Programa de indicação inativo", "REFERRAL_PROGRAM_INACTIVE", 
{
 valid: false 
}
))
;
 return
;

    
}


    // Self-referral check when customer email is provided
    if (!settings?.allowSelfReferral && parsed.data.customerEmail && referrer.email) 
{

      if (referrer.email.toLowerCase() === parsed.data.customerEmail.toLowerCase()) 
{

        next(new ValidationError("Você não pode usar seu próprio código de indicação", "REFERRAL_SELF_USE", 
{
 valid: false 
}
))
;
 return
;

      
}

    
}


    // NOTE: requireFirstPurchase is intentionally NOT enforced here. Probing
    // store_orders by customerEmail from this anonymous endpoint leaked whether
    // an email had ever purchased (REFERRAL_EXISTING_CUSTOMER acted as an
    // enumeration oracle). The authoritative first-purchase enforcement runs at
    // checkout in the discount-application path, which is the only place the
    // discount actually affects the order total.

    const discountType = settings?.discountType ?? "percentage"
;

    const discountValue = Number(settings?.discountValue ?? 5)
;

    const discountPercent = discountType === "percentage" ? discountValue : 0
;


    const referrerName = referrer.name ?? "um amigo"
;


    const discountLabel = discountType === "fixed"
      ? `R$ ${discountValue.toFixed(2).replace(".", ",")}`
      : `${discountValue}%`
;


    // Enforce minPurchaseAmount: reject if cart total is below the configured minimum
    const minPurchaseAmount = settings?.minPurchaseAmount != null ? Number(settings.minPurchaseAmount) : 0
;

    if (minPurchaseAmount > 0 && cartTotal > 0 && cartTotal < minPurchaseAmount) 
{

      next(new AppError(
        `Valor mínimo para indicação: R$ ${minPurchaseAmount.toFixed(2).replace(".", ",")}`,
        422,
        "REFERRAL_MINIMUM_NOT_MET",
        
{
 valid: false 
}
,
      ))
;

      return
;

    
}


    // Enforce maxReferralsPerUser: reject if referrer has already hit their limit
    const maxReferralsPerUser = settings?.maxReferralsPerUser != null ? Number(settings.maxReferralsPerUser) : 0
;

    if (maxReferralsPerUser > 0) 
{

      const [countRow] = await db
        .select(
{
 cnt: sql<string>`COALESCE(successful_referrals, 0)` 
}
)
        .from(clientsTable)
        .where(eq(clientsTable.id, referrer.id))
        .limit(1)
;

      const currentCount = countRow ? Number(countRow.cnt) : 0
;

      if (currentCount >= maxReferralsPerUser) 
{

        next(new AppError(
          "Este indicador atingiu o limite máximo de indicações",
          422,
          "REFERRAL_CODE_LIMIT_REACHED",
          
{
 valid: false 
}
,
        ))
;

        return
;

      
}

    
}


    const validatorIp = getClientIp(req)
;

    const validatorCookieId = parsed.data.cookieId
;

    if (validatorIp && validatorCookieId) 
{

      db.update(referralTrackingTable)
        .set(
{
 ipAddress: validatorIp, updatedAt: new Date() 
}
)
        .where(and(
          eq(referralTrackingTable.tenantId, store.tenantId),
          eq(referralTrackingTable.cookieId, validatorCookieId),
        ))
        .catch(() => undefined)
;

    
}


    res.json(
{

      valid: true,
      code,
      referrerName,
      discountPercent,
      discountValue,
      discountType,
      description: `Desconto de ${discountLabel} por indicação de ${referrerName}`,
    
}
)
;

  
}
 catch (err) 
{

    next(err)
;

  
}

}
)
;


router.get("/public/store/:slug/referral/info", async (req, res, next: NextFunction): Promise<void> => 
{

  try 
{

    const store = await getActiveStore(req.params.slug)
;

    if (!store) 
{
 next(new NotFoundError("Store not found", "NOT_FOUND"))
;
 return
;
 
}

    const [tenantRowRefInfo] = await db.select(
{
 settings: tenantsTable.settings 
}
).from(tenantsTable).where(eq(tenantsTable.id, store.tenantId)).limit(1)
;

    if ((tenantRowRefInfo?.settings as Record<string, unknown> | null)?.referralsEnabled === false) 
{

      next(new NotFoundError("Not found", "NOT_FOUND"))
;
 return
;

    
}

    const code = (req.query.code as string | undefined)?.toUpperCase()
;

    if (!code) 
{
 next(new ValidationError("code is required", "VALIDATION_ERROR"))
;
 return
;
 
}


    // Look up by client's permanent referral code
    const [referrer] = await db.select({
      id: clientsTable.id,
      name: clientsTable.name,
      referralCodeStatus: clientsTable.referralCodeStatus,
    }).from(clientsTable)
      .where(and(
        eq(clientsTable.tenantId, store.tenantId),
        eq(clientsTable.referralCode, code),
      )).limit(1);

    if (!referrer) {
      next(new NotFoundError("Referral not found", "NOT_FOUND"));
      return;
    }

    if (referrer.referralCodeStatus !== "active") {
      recordSuspendedReferralAttempt({
        clientId: referrer.id,
        tenantId: store.tenantId,
        storeSlug: req.params.slug,
        ipAddress: getClientIp(req) ?? null,
      });
      next(new ValidationError("Código de indicação bloqueado ou cancelado", "REFERRAL_CODE_SUSPENDED", { valid: false })); return;
    }

    // Get discount % from referral settings
    const [settings] = await db.select({
      discountValue: referralSettingsTable.discountValue,
      discountType: referralSettingsTable.discountType,
      isActive: referralSettingsTable.isEnabled,
    }).from(referralSettingsTable)
      .where(eq(referralSettingsTable.tenantId, store.tenantId)).limit(1);

    if (settings && !settings.isActive) {
      next(new AppError("Referral program is inactive", 400, "REFERRAL_PROGRAM_INACTIVE"));
      return;
    }

    const discountType = settings?.discountType ?? "percentage";
    const discountValue = Number(settings?.discountValue ?? 5);
    const discountPercent = discountType === "percentage" ? discountValue : 0;

    res.json({
      code,
      referrerName: referrer.name ?? "um amigo",
      discountPercent,
      discountValue,
      discountType,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/public/store/:slug/referral/track", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const store = await getActiveStore(req.params.slug);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const [tenantRowRefTrack] = await db.select({ settings: tenantsTable.settings }).from(tenantsTable).where(eq(tenantsTable.id, store.tenantId)).limit(1);
    if ((tenantRowRefTrack?.settings as Record<string, unknown> | null)?.referralsEnabled === false) {
      next(new NotFoundError("Not found", "NOT_FOUND")); return;
    }
    const parsed = z.object({
      code: z.string().min(1),
      serverCookieId: z.string().optional(),
      landingPage: z.string().optional(),
      utmSource: z.string().optional(),
      utmMedium: z.string().optional(),
      utmCampaign: z.string().optional(),
      utmContent: z.string().optional(),
      utmTerm: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const code = parsed.data.code.toUpperCase();
    const userAgent = req.headers["user-agent"] ?? "";
    const ipAddress = getClientIp(req) ?? "";

    const tracking = await db.transaction((tx) => recordReferralVisit(tx, {
      tenantId: store.tenantId,
      code,
      serverCookieId: parsed.data.serverCookieId,
      landingPage: parsed.data.landingPage,
      utmSource: parsed.data.utmSource,
      utmMedium: parsed.data.utmMedium,
      utmCampaign: parsed.data.utmCampaign,
      utmContent: parsed.data.utmContent,
      utmTerm: parsed.data.utmTerm,
      ipAddress,
      userAgent,
    }));

    // Notifications are deliberately outside the transaction: a provider or
    // notification failure must not roll back the already synchronized visit.
    if (tracking.firstVisit) {
      void db.select({ clientId: clientsTable.id })
        .from(clientsTable)
        .where(and(
          eq(clientsTable.tenantId, store.tenantId),
          eq(clientsTable.referralCode, tracking.referralCode),
        ))
        .limit(1)
        .then(([referrer]) => {
          if (!referrer) return;
          return insertClientNotification(referrer.clientId, store.tenantId, "referral_link_clicked", {
            referralCode: tracking.referralCode,
          });
        })
        .catch(() => undefined);
    }

    // Return the server-issued cookie ID for client persistence.
    res.setHeader("X-Referral-Cookie-Id", tracking.cookieId);
    res.json({ cookieId: tracking.cookieId, tracked: true });
  } catch (err) {
    next(err);
  }
});

router.post("/public/store/:slug/coupons/validate", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const store = await getActiveStore(req.params.slug);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const [tenantRowCpn] = await db.select({ settings: tenantsTable.settings }).from(tenantsTable).where(eq(tenantsTable.id, store.tenantId)).limit(1);
    if ((tenantRowCpn?.settings as Record<string, unknown> | null)?.couponsEnabled === false) {
      next(new ValidationError("Cupons de desconto não estão disponíveis", "COUPONS_DISABLED", { valid: false })); return;
    }
    const parsed = z.object({
      code: z.string().min(1),
      cartTotal: z.number().nonnegative().optional(),
      orderTotal: z.number().nonnegative().optional(),
      items: z.array(z.object({ productId: z.string(), quantity: z.number().int() })).optional(),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message), "VALIDATION_ERROR")); return; }
    const { code } = parsed.data;
    const cartTotal = parsed.data.cartTotal ?? parsed.data.orderTotal ?? 0;
    const [coupon] = await db.select().from(storeCouponsTable)
      .where(and(
        eq(storeCouponsTable.storeId, store.id),
        eq(storeCouponsTable.code, code),
        eq(storeCouponsTable.isActive, true),
      )).limit(1);
    if (!coupon) {
      next(new ValidationError("Cupom inválido", "COUPON_INVALID", { valid: false })); return;
    }
    const now = new Date();
    if (coupon.startsAt > now) {
      next(new ValidationError("Cupom ainda não está vigente", "COUPON_NOT_STARTED", { valid: false })); return;
    }
    if (coupon.expiresAt < now) {
      next(new ValidationError("Cupom expirado", "COUPON_EXPIRED", { valid: false })); return;
    }
    if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
      next(new ValidationError("Cupom esgotado", "COUPON_EXHAUSTED", { valid: false })); return;
    }
    if (coupon.minPurchaseAmount && cartTotal < parseFloat(coupon.minPurchaseAmount)) {
      next(new ValidationError(`Valor mínimo para este cupom: R$ ${parseFloat(coupon.minPurchaseAmount).toFixed(2)}`, "COUPON_MIN_PURCHASE", { valid: false })); return;
    }
    let discountAmount = 0;
    if (coupon.type === "percentage") {
      discountAmount = roundMoney(cartTotal * (Number(coupon.value) / 100));
    } else if (coupon.type === "fixed") {
      discountAmount = roundMoney(Number(coupon.value));
    }
    if (coupon.maxDiscountAmount) {
      discountAmount = Math.min(discountAmount, roundMoney(Number(coupon.maxDiscountAmount)));
    }
    res.json({
      valid: true,
      couponId: coupon.id,
      code: coupon.code,
      type: coupon.type,
      value: coupon.value,
      discountAmount,
      description: coupon.description,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/public/store/:slug/create-payment-intent", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const store = await getActiveStore(req.params.slug);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    if (!store.stripeEnabled) {
      next(new ValidationError("Stripe não está habilitado para esta loja", "STRIPE_NOT_ENABLED")); return;
    }
    const stripeSecretKey = decryptOrPassthrough(store.stripeSecretKey);
    if (!stripeSecretKey) {
      next(new ValidationError("Chave secreta do Stripe não configurada", "STRIPE_NOT_CONFIGURED")); return;
    }
    if (!store.stripePublicKey) {
      next(new ValidationError("Chave pública do Stripe não configurada", "STRIPE_NOT_CONFIGURED")); return;
    }

    const body = (req.body ?? {}) as { orderNumber?: unknown; paymentToken?: unknown };
    const orderNumber = typeof body.orderNumber === "string" ? body.orderNumber.trim() : "";
    const paymentToken = typeof body.paymentToken === "string" ? body.paymentToken.trim() : "";

    if (!orderNumber) {
      next(new ValidationError("orderNumber é obrigatório", "VALIDATION_ERROR")); return;
    }
    if (!paymentToken) {
      next(new ValidationError("paymentToken é obrigatório", "VALIDATION_ERROR")); return;
    }

    const [order] = await db
      .select({
        id: storeOrdersTable.id,
        orderNumber: storeOrdersTable.orderNumber,
        totalAmount: storeOrdersTable.totalAmount,
        storedPaymentToken: storeOrdersTable.paymentToken,
        existingPaymentIntentId: storeOrdersTable.paymentIntentId,
      })
      .from(storeOrdersTable)
      .where(and(
        eq(storeOrdersTable.storeId, store.id),
        eq(storeOrdersTable.tenantId, store.tenantId),
        eq(storeOrdersTable.orderNumber, orderNumber),
      ))
      .limit(1);

    if (!order) { next(new NotFoundError("Pedido não encontrado", "NOT_FOUND")); return; }

    const stored = order.storedPaymentToken ?? "";
    const a = Buffer.from(paymentToken);
    const b = Buffer.from(stored);
    const tokenMatches = a.length === b.length && a.length > 0 && (await import("node:crypto")).timingSafeEqual(a, b);
    if (!tokenMatches) {
      next(new ValidationError("Token de pagamento inválido", "INVALID_TOKEN")); return;
    }

    if (order.existingPaymentIntentId) {
      res.json({ clientSecret: null, paymentIntentId: order.existingPaymentIntentId, publishableKey: store.stripePublicKey, reused: true });
      return;
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(stripeSecretKey);
    const amountInCents = Math.round(Number(order.totalAmount) * 100);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: "brl",
      metadata: {
        orderNumber: order.orderNumber,
        storeId: store.id,
        storeName: store.name,
      },
    });

    await db
      .update(storeOrdersTable)
      .set({ paymentIntentId: paymentIntent.id })
      .where(eq(storeOrdersTable.id, order.id));

    res.json({ clientSecret: paymentIntent.client_secret, publishableKey: store.stripePublicKey });
  } catch (err) {
    next(err);
  }
});

router.get("/public/store/:slug/reviews", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const { slug } = req.params;
    const { limit: limitStr, featured } = req.query;
    const store = await db.query.storesTable.findFirst({ where: eq(storesTable.slug, slug as string) });
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const limit = limitStr ? Math.min(Number(limitStr), 50) : 20;
    const conditions = [
      eq(storeReviewsTable.storeId, store.id),
      eq(storeReviewsTable.status, "approved"),
    ];
    if (featured === "true") conditions.push(eq(storeReviewsTable.isFeatured, true));
    const reviews = await db.select({
      id: storeReviewsTable.id,
      reviewerName: storeReviewsTable.reviewerName,
      rating: storeReviewsTable.rating,
      title: storeReviewsTable.title,
      comment: storeReviewsTable.comment,
      images: storeReviewsTable.images,
      verifiedPurchase: storeReviewsTable.verifiedPurchase,
      isFeatured: storeReviewsTable.isFeatured,
      reply: storeReviewsTable.reply,
      repliedAt: storeReviewsTable.repliedAt,
      createdAt: storeReviewsTable.createdAt,
      updatedAt: storeReviewsTable.updatedAt,
    }).from(storeReviewsTable)
      .where(and(...conditions))
      .orderBy(desc(storeReviewsTable.createdAt))
      .limit(limit);
    res.json(reviews);
  } catch (err) {
    next(err);
  }
});

// ── Price-drop alerts (public, double opt-in) ─────────────────────────────────
// Visitors subscribe to a product with their e-mail. A confirmation e-mail is
// sent (status=pending); only after they click the confirm link (status=active)
// do they receive price-drop alerts. Tokens are random 256-bit values stored
// only as sha256 hashes — the raw token lives solely in the e-mailed links.

const priceAlertSubscribeSchema = z.object({
  productId: z.string().min(1).max(64),
  email: z.string().email().max(254),
});

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Token-bearing e-mail links MUST use a trusted, server-configured origin — never
// the request Host header, which is attacker-controlled on this anonymous endpoint
// (Host-header injection → phishing / token capture). Mirrors STORE_PUBLIC_BASE in store.ts.
const STORE_PUBLIC_BASE = (
  process.env["STORE_PUBLIC_URL"] ?? `https://${process.env["REPLIT_DEV_DOMAIN"] ?? "visitecrm.com"}`
).replace(/\/$/, "");

function priceAlertResultPage(title: string, message: string): string {
  const safeTitle = title.replace(/</g, "&lt;");
  const safeMessage = message.replace(/</g, "&lt;");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${safeTitle}</title></head><body style="font-family:Arial,Helvetica,sans-serif;background:#f9fafb;margin:0;padding:0;"><div style="max-width:480px;margin:48px auto;background:#ffffff;border-radius:12px;padding:32px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,0.08);"><h1 style="color:#111827;font-size:20px;">${safeTitle}</h1><p style="color:#4b5563;font-size:15px;line-height:1.5;">${safeMessage}</p></div></body></html>`;
}

// POST subscribe — always returns a generic success to avoid e-mail enumeration.
router.post("/public/store/:slug/price-alerts", async (req, res, next: NextFunction): Promise<void> => {
  const genericSuccess = {
    success: true,
    message: "Se o produto existir, enviaremos um e-mail para você confirmar o alerta de preço.",
  };
  try {
    const store = await getActiveStore(req.params.slug);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }

    const parsed = priceAlertSubscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError("Dados inválidos", "VALIDATION_ERROR"));
      return;
    }
    const email = parsed.data.email.trim().toLowerCase();
    const { productId } = parsed.data;

    const [product] = await db.select({
      id: storeProductsTable.id,
      name: storeProductsTable.name,
      price: storeProductsTable.price,
      onSale: storeProductsTable.onSale,
      salePrice: storeProductsTable.salePrice,
    })
      .from(storeProductsTable)
      .where(and(
        eq(storeProductsTable.id, productId),
        eq(storeProductsTable.storeId, store.id),
        eq(storeProductsTable.status, "active"),
      )).limit(1);
    // Unknown product → generic success (no enumeration, no row created).
    if (!product) { res.json(genericSuccess); return; }

    // Already actively subscribed → succeed silently without re-sending.
    const [existing] = await db.select({
      id: priceAlertSubscriptionsTable.id,
      status: priceAlertSubscriptionsTable.status,
    })
      .from(priceAlertSubscriptionsTable)
      .where(and(
        eq(priceAlertSubscriptionsTable.productId, product.id),
        eq(priceAlertSubscriptionsTable.email, email),
      )).limit(1);
    if (existing && existing.status === "active") { res.json(genericSuccess); return; }

    const confirmationToken = randomBytes(32).toString("hex");
    const unsubscribeToken = randomBytes(32).toString("hex");
    const confirmationTokenHash = sha256Hex(confirmationToken);
    const unsubscribeTokenHash = sha256Hex(unsubscribeToken);
    const priceAtSubscribe = effectivePrice(product).toFixed(2);

    if (existing) {
      // Re-arm a pending / previously-unsubscribed row and resend confirmation.
      await db.update(priceAlertSubscriptionsTable)
        .set({
          status: "pending",
          confirmationTokenHash,
          unsubscribeTokenHash,
          confirmedAt: null,
          priceAtSubscribe,
        })
        .where(eq(priceAlertSubscriptionsTable.id, existing.id));
    } else {
      await db.insert(priceAlertSubscriptionsTable).values({
        id: generateId(),
        tenantId: store.tenantId,
        storeId: store.id,
        productId: product.id,
        email,
        priceAtSubscribe,
        status: "pending",
        confirmationTokenHash,
        unsubscribeTokenHash,
      });
    }

    const slug = encodeURIComponent(req.params.slug);
    const confirmUrl = `${STORE_PUBLIC_BASE}/api/public/store/${slug}/price-alerts/confirm?token=${confirmationToken}`;
    const unsubscribeUrl = `${STORE_PUBLIC_BASE}/api/public/store/${slug}/price-alerts/unsubscribe?token=${unsubscribeToken}`;

    // Never throws; failures are logged to email_logs internally.
    await sendPriceAlertConfirmationEmail({
      tenantId: store.tenantId,
      to: email,
      storeName: store.name,
      productName: product.name,
      confirmUrl,
      unsubscribeUrl,
    });

    res.json(genericSuccess);
  } catch (err) {
    next(err);
  }
});

// GET confirm — double opt-in confirmation link from the e-mail.
router.get("/public/store/:slug/price-alerts/confirm", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const store = await getActiveStore(req.params.slug);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const token = typeof req.query["token"] === "string" ? req.query["token"] : "";
    if (!token) {
      res.status(400).send(priceAlertResultPage("Link inválido", "O link de confirmação está incompleto."));
      return;
    }
    const tokenHash = sha256Hex(token);
    const [row] = await db.select({ id: priceAlertSubscriptionsTable.id, status: priceAlertSubscriptionsTable.status })
      .from(priceAlertSubscriptionsTable)
      .where(and(
        eq(priceAlertSubscriptionsTable.storeId, store.id),
        eq(priceAlertSubscriptionsTable.confirmationTokenHash, tokenHash),
      )).limit(1);
    if (!row) {
      res.status(404).send(priceAlertResultPage("Link inválido ou expirado", "Não encontramos este alerta. Ele pode já ter sido confirmado ou cancelado."));
      return;
    }
    if (row.status !== "active") {
      // Consume the confirmation token (one-time use) on activation.
      await db.update(priceAlertSubscriptionsTable)
        .set({ status: "active", confirmedAt: new Date(), confirmationTokenHash: null })
        .where(eq(priceAlertSubscriptionsTable.id, row.id));
    }
    res.status(200).send(priceAlertResultPage("Alerta confirmado! ✅", "Pronto! Avisaremos você por e-mail assim que o preço deste produto cair."));
  } catch (err) {
    next(err);
  }
});

// GET unsubscribe — one-click opt-out link from the e-mail.
router.get("/public/store/:slug/price-alerts/unsubscribe", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const store = await getActiveStore(req.params.slug);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const token = typeof req.query["token"] === "string" ? req.query["token"] : "";
    if (!token) {
      res.status(400).send(priceAlertResultPage("Link inválido", "O link de cancelamento está incompleto."));
      return;
    }
    const tokenHash = sha256Hex(token);
    const [row] = await db.select({ id: priceAlertSubscriptionsTable.id })
      .from(priceAlertSubscriptionsTable)
      .where(and(
        eq(priceAlertSubscriptionsTable.storeId, store.id),
        eq(priceAlertSubscriptionsTable.unsubscribeTokenHash, tokenHash),
      )).limit(1);
    if (row) {
      await db.update(priceAlertSubscriptionsTable)
        .set({ status: "unsubscribed" })
        .where(eq(priceAlertSubscriptionsTable.id, row.id));
    }
    // Always show a friendly confirmation, even if the row was already removed.
    res.status(200).send(priceAlertResultPage("Alerta cancelado", "Você não receberá mais alertas de preço deste produto."));
  } catch (err) {
    next(err);
  }
});

export default router;
