import { Router, type NextFunction } from "express";
import { db } from "@workspace/db";
import {
  storesTable,
  storeCategoriesTable,
  storeProductsTable,
  storeOrdersTable,
  storeOrderItemsTable,
  storeCouponsTable,
  storeReviewsTable,
  pipelineStagesTable,
  dealsTable,
  reservationsTable,
  partnerProductsTable,
  priceAlertSubscriptionsTable,
} from "@workspace/db";
import { eq, and, desc, asc, count, ilike, or, sql, ne } from "drizzle-orm";
import { z } from "zod/v4";
import { randomBytes, createHash } from "crypto";
import { generateId } from "../lib/id";
import { requireAuth } from "../lib/tenant";
import { createReservationsForOrder, confirmReservationsForOrder } from "../services/checkout/create-reservations";
import { broadcastSeatUpdate } from "../lib/realtime";
import { runPostPaymentSideEffects } from "../services/checkout/post-booking";
import { enqueueNewBookingNotificationEmail } from "../queues/email-helpers";
import { applyOrderInventoryEffects } from "../services/checkout/persist-order";
import { cancelPartnerOrderItems } from "../services/checkout/cancel-partner-items";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import { deleteOrphanedFile, deleteOrphanedImages } from "../lib/uploadthing";
import { ADMIN_ROLES } from '../lib/tenant';
import { STORE_ORDER_STATUS, STORE_PAYMENT_STATUS } from "@workspace/permissions";
import { reverseProductOnlyOrderReferral, reverseTripOrderReferrals } from "../services/checkout/order-referral-reversal";
import { encryptCredential } from "../lib/crypto";
import { sendPriceDropAlertEmail } from "../queues/email-helpers";

// Storefront public base for links inside price-drop alert e-mails. Product
// links point at the Vitrine; the unsubscribe link points at the public API,
// which is served from the same origin in production.
const STORE_PUBLIC_BASE = (process.env["STORE_PUBLIC_URL"] ?? `https://${process.env["REPLIT_DEV_DOMAIN"] ?? "visitecrm.com"}`).replace(/\/$/, "");

function productEffectivePrice(p: { price: unknown; onSale: unknown; salePrice: unknown }): number {
  const base = Number(p.price ?? 0);
  if (p.onSale && p.salePrice != null) {
    const sale = Number(p.salePrice);
    if (isFinite(sale) && sale > 0) return sale;
  }
  return isFinite(base) ? base : 0;
}

// Best-effort, fail-safe notifier for confirmed price-drop subscribers. Never
// throws — any DB/email failure is logged and swallowed so a product update is
// never blocked. Each e-mail rotates the recipient's unsubscribe token (kept
// hashed at rest) and advances priceAtSubscribe so they are only re-alerted on
// a further drop.
async function notifyPriceDropSubscribers(args: {
  store: { id: string; tenantId: string; name: string; slug: string };
  product: { id: string; name: string; slug: string };
  oldPrice: number;
  newPrice: number;
  log: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };
}): Promise<void> {
  const { store, product, oldPrice, newPrice, log } = args;
  try {
    const subs = await db.select({
      id: priceAlertSubscriptionsTable.id,
      email: priceAlertSubscriptionsTable.email,
    })
      .from(priceAlertSubscriptionsTable)
      .where(and(
        eq(priceAlertSubscriptionsTable.productId, product.id),
        eq(priceAlertSubscriptionsTable.status, "active"),
        sql`CAST(${priceAlertSubscriptionsTable.priceAtSubscribe} AS NUMERIC) > ${newPrice}`,
      ));
    if (subs.length === 0) return;
    const productUrl = `${STORE_PUBLIC_BASE}/loja/${encodeURIComponent(store.slug)}/produtos/${encodeURIComponent(product.slug)}`;
    for (const sub of subs) {
      const unsubToken = randomBytes(32).toString("hex");
      const unsubHash = createHash("sha256").update(unsubToken).digest("hex");
      await db.update(priceAlertSubscriptionsTable)
        .set({ unsubscribeTokenHash: unsubHash, lastNotifiedAt: new Date(), priceAtSubscribe: newPrice.toFixed(2) })
        .where(eq(priceAlertSubscriptionsTable.id, sub.id));
      const unsubscribeUrl = `${STORE_PUBLIC_BASE}/api/public/store/${encodeURIComponent(store.slug)}/price-alerts/unsubscribe?token=${unsubToken}`;
      await sendPriceDropAlertEmail({
        tenantId: store.tenantId,
        to: sub.email,
        storeName: store.name,
        productName: product.name,
        oldPrice,
        newPrice,
        productUrl,
        unsubscribeUrl,
      });
    }
    log.info({ productId: product.id, count: subs.length }, "[price-alert] Price-drop notifications dispatched");
  } catch (err) {
    log.warn({ productId: product.id, err }, "[price-alert] Failed to dispatch price-drop notifications");
  }
}

// Fields that hold gateway secrets. They are encrypted at rest, never
// returned by GET endpoints, and only updated when the request body
// supplies a non-empty value (so saving the form without retyping a
// credential leaves the stored value intact).
const SENSITIVE_CREDENTIAL_FIELDS = ["stripeSecretKey", "stripeWebhookSecret", "mpAccessToken", "pixKey"] as const;
type SensitiveField = typeof SENSITIVE_CREDENTIAL_FIELDS[number];

function redactStore<T extends Record<string, unknown>>(store: T | undefined): (T & { stripeSecretKeyConfigured: boolean; stripeWebhookSecretConfigured: boolean; mpAccessTokenConfigured: boolean; pixKeyConfigured: boolean }) | undefined {
  if (!store) return store as undefined;
  const out: Record<string, unknown> = { ...store };
  out["stripeSecretKeyConfigured"] = !!store["stripeSecretKey"];
  out["stripeWebhookSecretConfigured"] = !!store["stripeWebhookSecret"];
  out["mpAccessTokenConfigured"] = !!store["mpAccessToken"];
  out["pixKeyConfigured"] = !!store["pixKey"];
  for (const f of SENSITIVE_CREDENTIAL_FIELDS) delete out[f];
  return out as T & { stripeSecretKeyConfigured: boolean; stripeWebhookSecretConfigured: boolean; mpAccessTokenConfigured: boolean; pixKeyConfigured: boolean };
}

// Replace each sensitive field with its encrypted form when present and
// non-empty; drop the field entirely otherwise so the existing stored
// value is preserved.
function applyCredentialEncryption(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  for (const f of SENSITIVE_CREDENTIAL_FIELDS) {
    const v = out[f];
    if (typeof v === "string" && v.trim().length > 0) {
      out[f] = encryptCredential(v.trim());
    } else {
      delete out[f as SensitiveField];
    }
  }
  return out;
}

const router = Router();

const StoreSettingsBody = z.object({
  name: z.string().min(1).nullish(),
  slug: z.string().min(1).nullish(),
  tagline: z.string().nullish(),
  description: z.string().nullish(),
  logo: z.string().nullish(),
  logoDark: z.string().nullish(),
  favicon: z.string().nullish(),
  bannerHome: z.string().nullish(),
  bannerMobile: z.string().nullish(),
  primaryColor: z.string().nullish(),
  secondaryColor: z.string().nullish(),
  accentColor: z.string().nullish(),
  customDomain: z.string().nullish(),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  whatsapp: z.string().nullish(),
  address: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  zipCode: z.string().nullish(),
  facebookUrl: z.string().nullish(),
  instagramUrl: z.string().nullish(),
  twitterUrl: z.string().nullish(),
  youtubeUrl: z.string().nullish(),
  linkedinUrl: z.string().nullish(),
  tiktokUrl: z.string().nullish(),
  metaTitle: z.string().nullish(),
  metaDescription: z.string().nullish(),
  metaKeywords: z.string().nullish(),
  googleAnalyticsId: z.string().nullish(),
  facebookPixelId: z.string().nullish(),
  googleTagManagerId: z.string().nullish(),
  requireLogin: z.boolean().optional(),
  guestCheckout: z.boolean().optional(),
  minInstallments: z.number().int().optional(),
  maxInstallments: z.number().int().optional(),
  installmentFee: z.string().nullish(),
  minOrderValue: z.string().nullish(),
  minDepositAmount: z.string().nullish(),
  paymentMethods: z.array(z.string()).optional(),
  stripeEnabled: z.boolean().optional(),
  stripePublicKey: z.string().nullish(),
  stripeSecretKey: z.string().nullish(),
  stripeWebhookSecret: z.string().nullish(),
  mpEnabled: z.boolean().optional(),
  mpPublicKey: z.string().nullish(),
  mpAccessToken: z.string().nullish(),
  pixEnabled: z.boolean().optional(),
  pixKey: z.string().nullish(),
  pixKeyType: z.string().nullish(),
  boletoEnabled: z.boolean().optional(),
  termsOfService: z.string().nullish(),
  privacyPolicy: z.string().nullish(),
  refundPolicy: z.string().nullish(),
  cancellationPolicy: z.string().nullish(),
  termsUrl: z.string().nullish(),
  privacyUrl: z.string().nullish(),
  notificationEmail: z.string().nullish(),
  orderNotificationEnabled: z.boolean().optional(),
  isActive: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
  maintenanceMessage: z.string().nullish(),
});

const CategoryBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  image: z.string().optional(),
  parentId: z.string().optional(),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  order: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const ProductBody = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  shortDescription: z.string().optional(),
  categoryId: z.string().optional(),
  price: z.string(),
  comparePrice: z.string().optional(),
  costPrice: z.string().optional(),
  onSale: z.boolean().optional(),
  salePrice: z.string().optional(),
  saleStartsAt: z.string().optional(),
  saleEndsAt: z.string().optional(),
  trackInventory: z.boolean().optional(),
  stockQuantity: z.number().int().optional(),
  allowBackorder: z.boolean().optional(),
  hasDates: z.boolean().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  images: z.array(z.string()).optional(),
  thumbnail: z.string().optional(),
  gallery: z.array(z.string()).optional(),
  features: z.array(z.string()).optional(),
  includes: z.array(z.string()).optional(),
  excludes: z.array(z.string()).optional(),
  requirements: z.array(z.string()).optional(),
  destination: z.string().optional(),
  durationDays: z.number().int().optional(),
  durationNights: z.number().int().optional(),
  productCity: z.string().optional(),
  productState: z.string().optional(),
  country: z.string().optional(),
  hasVariants: z.boolean().optional(),
  variants: z.array(z.record(z.string(), z.unknown())).optional(),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  metaKeywords: z.string().optional(),
  tripId: z.string().optional(),
  isFeatured: z.boolean().optional(),
  order: z.number().int().optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  partnerProductId: z.string().nullable().optional(),
});

const CouponBody = z.object({
  code: z.string().min(1),
  type: z.enum(["percentage", "fixed", "free_shipping"]).optional(),
  value: z.string(),
  description: z.string().optional(),
  minPurchaseAmount: z.string().optional(),
  maxDiscountAmount: z.string().optional(),
  usageLimit: z.number().int().optional(),
  usageLimitPerCustomer: z.number().int().optional(),
  startsAt: z.string(),
  expiresAt: z.string(),
  applicableProducts: z.array(z.string()).optional(),
  applicableCategories: z.array(z.string()).optional(),
  minimumItems: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

async function getStoreForTenant(tenantId: string) {
  const [store] = await db.select().from(storesTable)
    .where(eq(storesTable.tenantId, tenantId)).limit(1);
  return store;
}

const InitStoreBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  contactEmail: z.string().email().optional(),
  contactWhatsapp: z.string().optional(),
  paymentMethods: z.array(z.string()).optional(),
});

router.post("/store/init", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const existing = await getStoreForTenant(me.tenantId);
    if (existing) { next(new ConflictError("Store already exists", "CONFLICT")); return; }
    const parsed = InitStoreBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(storesTable).values({
      id,
      tenantId: me.tenantId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      email: parsed.data.contactEmail ?? me.email,
      ...(parsed.data.contactWhatsapp && { whatsapp: parsed.data.contactWhatsapp }),
      ...(parsed.data.paymentMethods && { paymentMethods: parsed.data.paymentMethods }),
    });
    const [store] = await db.select().from(storesTable).where(eq(storesTable.id, id)).limit(1);
    res.status(201).json(redactStore(store as unknown as Record<string, unknown>));
  } catch (err: unknown) {
    const dbErr = err as { code?: string };
    if (dbErr?.code === "23505") {
      next(new ConflictError("Slug já está em uso. Escolha outro URL para sua loja.", "CONFLICT"));
      return;
    }
    next(err);
  }
});

router.get("/store/settings", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    res.json(redactStore(store as unknown as Record<string, unknown>));
  } catch (err) {
    next(err);
  }
});

router.put("/store/settings", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const parsed = StoreSettingsBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const existingStore = await getStoreForTenant(me.tenantId);
    if (!existingStore) {
      const id = generateId();
      const data = applyCredentialEncryption(parsed.data as Record<string, unknown>);
      await db.insert(storesTable).values({
        id,
        tenantId: me.tenantId,
        name: (data["name"] as string) || "Minha Loja",
        slug: (data["slug"] as string) || me.tenantId,
        email: (data["email"] as string) || me.email,
        ...data,
      });
      const [newStore] = await db.select().from(storesTable).where(eq(storesTable.id, id)).limit(1);
      res.status(201).json(redactStore(newStore as unknown as Record<string, unknown>));
      return;
    }

    const updates = applyCredentialEncryption(parsed.data as Record<string, unknown>);
    await db.update(storesTable).set(updates)
      .where(eq(storesTable.tenantId, me.tenantId));

    const d = parsed.data;
    await Promise.all([
      d.logo !== undefined ? deleteOrphanedFile(existingStore.logo, d.logo ?? null, req.log, me.tenantId) : Promise.resolve(),
      d.logoDark !== undefined ? deleteOrphanedFile(existingStore.logoDark, d.logoDark ?? null, req.log, me.tenantId) : Promise.resolve(),
      d.favicon !== undefined ? deleteOrphanedFile(existingStore.favicon, d.favicon ?? null, req.log, me.tenantId) : Promise.resolve(),
      d.bannerHome !== undefined ? deleteOrphanedFile(existingStore.bannerHome, d.bannerHome ?? null, req.log, me.tenantId) : Promise.resolve(),
      d.bannerMobile !== undefined ? deleteOrphanedFile(existingStore.bannerMobile, d.bannerMobile ?? null, req.log, me.tenantId) : Promise.resolve(),
    ]);

    const [updated] = await db.select().from(storesTable)
      .where(eq(storesTable.tenantId, me.tenantId)).limit(1);
    res.json(redactStore(updated as unknown as Record<string, unknown>));
  } catch (err) {
    next(err);
  }
});

router.get("/store/categories", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const categories = await db.select().from(storeCategoriesTable)
      .where(eq(storeCategoriesTable.storeId, store.id))
      .orderBy(asc(storeCategoriesTable.order));
    res.json(categories);
  } catch (err) {
    next(err);
  }
});

router.post("/store/categories", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const parsed = CategoryBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    await db.insert(storeCategoriesTable).values({
      id, storeId: store.id,
      name: parsed.data.name,
      slug: parsed.data.slug,
      ...(parsed.data.description && { description: parsed.data.description }),
      ...(parsed.data.icon && { icon: parsed.data.icon }),
      ...(parsed.data.image && { image: parsed.data.image }),
      ...(parsed.data.parentId && { parentId: parsed.data.parentId }),
      ...(parsed.data.metaTitle && { metaTitle: parsed.data.metaTitle }),
      ...(parsed.data.metaDescription && { metaDescription: parsed.data.metaDescription }),
      ...(parsed.data.order != null && { order: parsed.data.order }),
      ...(parsed.data.isActive != null && { isActive: parsed.data.isActive }),
    });
    const [cat] = await db.select().from(storeCategoriesTable)
      .where(eq(storeCategoriesTable.id, id)).limit(1);
    res.status(201).json(cat);
  } catch (err) {
    next(err);
  }
});

router.put("/store/categories/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const parsed = CategoryBody.partial().safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    await db.update(storeCategoriesTable).set(parsed.data as Record<string, unknown>)
      .where(and(eq(storeCategoriesTable.id, req.params.id), eq(storeCategoriesTable.storeId, store.id)));
    const [cat] = await db.select().from(storeCategoriesTable)
      .where(and(eq(storeCategoriesTable.id, req.params.id), eq(storeCategoriesTable.storeId, store.id))).limit(1);
    if (!cat) { next(new NotFoundError("Category not found", "NOT_FOUND")); return; }
    res.json(cat);
  } catch (err) {
    next(err);
  }
});

router.delete("/store/categories/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    await db.delete(storeCategoriesTable)
      .where(and(eq(storeCategoriesTable.id, req.params.id), eq(storeCategoriesTable.storeId, store.id)));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/store/products", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const products = await db.select().from(storeProductsTable)
      .where(eq(storeProductsTable.storeId, store.id))
      .orderBy(desc(storeProductsTable.createdAt));
    res.json(products);
  } catch (err) {
    next(err);
  }
});

router.post("/store/products", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const parsed = ProductBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    const data = parsed.data;
    if (data.partnerProductId) {
      const [pp] = await db.select({ id: partnerProductsTable.id })
        .from(partnerProductsTable)
        .where(and(eq(partnerProductsTable.id, data.partnerProductId), eq(partnerProductsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!pp) { next(new ValidationError(String("Produto de parceiro não encontrado" ), "VALIDATION_ERROR")); return; }
    }
    await db.insert(storeProductsTable).values({
      id,
      storeId: store.id,
      type: data.type,
      name: data.name,
      slug: data.slug,
      price: data.price,
      ...(data.description && { description: data.description }),
      ...(data.shortDescription && { shortDescription: data.shortDescription }),
      ...(data.categoryId && { categoryId: data.categoryId }),
      ...(data.comparePrice && { comparePrice: data.comparePrice }),
      ...(data.costPrice && { costPrice: data.costPrice }),
      ...(data.onSale != null && { onSale: data.onSale }),
      ...(data.salePrice && { salePrice: data.salePrice }),
      ...(data.saleStartsAt && { saleStartsAt: new Date(data.saleStartsAt) }),
      ...(data.saleEndsAt && { saleEndsAt: new Date(data.saleEndsAt) }),
      ...(data.trackInventory != null && { trackInventory: data.trackInventory }),
      ...(data.stockQuantity != null && { stockQuantity: data.stockQuantity }),
      ...(data.allowBackorder != null && { allowBackorder: data.allowBackorder }),
      ...(data.hasDates != null && { hasDates: data.hasDates }),
      ...(data.startDate && { startDate: new Date(data.startDate) }),
      ...(data.endDate && { endDate: new Date(data.endDate) }),
      ...(data.images && { images: data.images }),
      ...(data.thumbnail && { thumbnail: data.thumbnail }),
      ...(data.gallery && { gallery: data.gallery }),
      ...(data.features && { features: data.features }),
      ...(data.includes && { includes: data.includes }),
      ...(data.excludes && { excludes: data.excludes }),
      ...(data.requirements && { requirements: data.requirements }),
      ...(data.destination && { destination: data.destination }),
      ...(data.durationDays != null && { durationDays: data.durationDays }),
      ...(data.durationNights != null && { durationNights: data.durationNights }),
      ...(data.productCity && { productCity: data.productCity }),
      ...(data.productState && { productState: data.productState }),
      ...(data.country && { country: data.country }),
      ...(data.hasVariants != null && { hasVariants: data.hasVariants }),
      ...(data.variants && { variants: data.variants }),
      ...(data.metaTitle && { metaTitle: data.metaTitle }),
      ...(data.metaDescription && { metaDescription: data.metaDescription }),
      ...(data.metaKeywords && { metaKeywords: data.metaKeywords }),
      ...(data.tripId && { tripId: data.tripId }),
      ...(data.isFeatured != null && { isFeatured: data.isFeatured }),
      ...(data.order != null && { order: data.order }),
      ...(data.status && { status: data.status }),
      ...(data.partnerProductId !== undefined && { partnerProductId: data.partnerProductId ?? null }),
    });
    const [product] = await db.select().from(storeProductsTable)
      .where(eq(storeProductsTable.id, id)).limit(1);
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

router.put("/store/products/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const parsed = ProductBody.partial().safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const [existingProduct] = await db.select().from(storeProductsTable)
      .where(and(eq(storeProductsTable.id, req.params.id), eq(storeProductsTable.storeId, store.id))).limit(1);
    if (!existingProduct) { next(new NotFoundError("Product not found", "NOT_FOUND")); return; }
    if (parsed.data.partnerProductId) {
      const [pp] = await db.select({ id: partnerProductsTable.id })
        .from(partnerProductsTable)
        .where(and(eq(partnerProductsTable.id, parsed.data.partnerProductId), eq(partnerProductsTable.tenantId, me.tenantId)))
        .limit(1);
      if (!pp) { next(new ValidationError(String("Produto de parceiro não encontrado" ), "VALIDATION_ERROR")); return; }
    }
    const updates: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.saleStartsAt) updates.saleStartsAt = new Date(parsed.data.saleStartsAt);
    if (parsed.data.saleEndsAt) updates.saleEndsAt = new Date(parsed.data.saleEndsAt);
    if (parsed.data.startDate) updates.startDate = new Date(parsed.data.startDate);
    if (parsed.data.endDate) updates.endDate = new Date(parsed.data.endDate);
    await db.update(storeProductsTable).set(updates)
      .where(and(eq(storeProductsTable.id, req.params.id), eq(storeProductsTable.storeId, store.id)));

    const d = parsed.data;
    await Promise.all([
      d.images !== undefined
        ? deleteOrphanedImages(existingProduct.images as string[] | null, d.images, req.log, me.tenantId)
        : Promise.resolve(),
      d.thumbnail !== undefined
        ? deleteOrphanedFile(existingProduct.thumbnail as string | null, d.thumbnail, req.log, me.tenantId)
        : Promise.resolve(),
      d.gallery !== undefined
        ? deleteOrphanedImages(existingProduct.gallery as string[] | null, d.gallery, req.log, me.tenantId)
        : Promise.resolve(),
    ]);

    const [product] = await db.select().from(storeProductsTable)
      .where(and(eq(storeProductsTable.id, req.params.id), eq(storeProductsTable.storeId, store.id))).limit(1);
    if (!product) { next(new NotFoundError("Product not found", "NOT_FOUND")); return; }

    // Fire-and-forget price-drop alerts. Never awaited / never blocks the
    // response; the notifier swallows all its own errors.
    const oldEff = productEffectivePrice(existingProduct);
    const newEff = productEffectivePrice(product);
    if (newEff > 0 && newEff < oldEff) {
      void notifyPriceDropSubscribers({
        store: { id: store.id, tenantId: store.tenantId, name: store.name, slug: store.slug },
        product: { id: product.id, name: product.name, slug: product.slug },
        oldPrice: oldEff,
        newPrice: newEff,
        log: req.log,
      });
    }

    res.json(product);
  } catch (err) {
    next(err);
  }
});

router.delete("/store/products/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const [existing] = await db.select({ images: storeProductsTable.images, gallery: storeProductsTable.gallery })
      .from(storeProductsTable)
      .where(and(eq(storeProductsTable.id, req.params.id), eq(storeProductsTable.storeId, store.id)))
      .limit(1);
    await db.delete(storeProductsTable)
      .where(and(eq(storeProductsTable.id, req.params.id), eq(storeProductsTable.storeId, store.id)));
    if (existing) {
      await deleteOrphanedImages(existing.images as string[] ?? [], [], req.log, me.tenantId);
      await deleteOrphanedImages(existing.gallery as string[] ?? [], [], req.log, me.tenantId);
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/store/orders", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }

    const { status, paymentStatus, search, dateFrom, dateTo, page: pageStr, limit: limitStr } = req.query;
    const page = pageStr ? Math.max(1, parseInt(pageStr as string)) : 1;
    const limit = limitStr ? Math.min(100, parseInt(limitStr as string)) : 50;
    const offset = (page - 1) * limit;

    const conditions = [eq(storeOrdersTable.storeId, store.id)];
    if (status && status !== "all") conditions.push(eq(storeOrdersTable.status, status as string));
    if (paymentStatus && paymentStatus !== "all") conditions.push(eq(storeOrdersTable.paymentStatus, paymentStatus as string));
    if (search) {
      conditions.push(or(
        ilike(storeOrdersTable.orderNumber, `%${search}%`),
        ilike(storeOrdersTable.customerName, `%${search}%`),
        ilike(storeOrdersTable.customerEmail, `%${search}%`),
      )!);
    }
    if (dateFrom) conditions.push(sql`${storeOrdersTable.createdAt} >= ${dateFrom}`);
    if (dateTo) conditions.push(sql`${storeOrdersTable.createdAt} <= ${dateTo}::date + interval '1 day'`);

    const whereClause = and(...conditions);

    const [{ total }] = await db.select({ total: count() }).from(storeOrdersTable).where(whereClause);

    const itemCountSq = db.select({
      orderId: storeOrderItemsTable.orderId,
      cnt: count().as("cnt"),
    }).from(storeOrderItemsTable).groupBy(storeOrderItemsTable.orderId).as("item_counts");

    const orders = await db
      .select({
        id: storeOrdersTable.id,
        storeId: storeOrdersTable.storeId,
        tenantId: storeOrdersTable.tenantId,
        orderNumber: storeOrdersTable.orderNumber,
        clientId: storeOrdersTable.clientId,
        customerName: storeOrdersTable.customerName,
        customerEmail: storeOrdersTable.customerEmail,
        customerPhone: storeOrdersTable.customerPhone,
        customerCpf: storeOrdersTable.customerCpf,
        customerAddress: storeOrdersTable.customerAddress,
        subtotal: storeOrdersTable.subtotal,
        discountAmount: storeOrdersTable.discountAmount,
        taxAmount: storeOrdersTable.taxAmount,
        shippingAmount: storeOrdersTable.shippingAmount,
        totalAmount: storeOrdersTable.totalAmount,
        couponId: storeOrdersTable.couponId,
        couponCode: storeOrdersTable.couponCode,
        paymentMethod: storeOrdersTable.paymentMethod,
        paymentProvider: storeOrdersTable.paymentProvider,
        paymentStatus: storeOrdersTable.paymentStatus,
        installments: storeOrdersTable.installments,
        installmentAmount: storeOrdersTable.installmentAmount,
        pixQrCode: storeOrdersTable.pixQrCode,
        pixQrCodeUrl: storeOrdersTable.pixQrCodeUrl,
        pixCopyPaste: storeOrdersTable.pixCopyPaste,
        boletoUrl: storeOrdersTable.boletoUrl,
        boletoBarcode: storeOrdersTable.boletoBarcode,
        status: storeOrdersTable.status,
        fulfillmentStatus: storeOrdersTable.fulfillmentStatus,
        customerNotes: storeOrdersTable.customerNotes,
        internalNotes: storeOrdersTable.internalNotes,
        paidAt: storeOrdersTable.paidAt,
        confirmedAt: storeOrdersTable.confirmedAt,
        completedAt: storeOrdersTable.completedAt,
        cancelledAt: storeOrdersTable.cancelledAt,
        refundedAt: storeOrdersTable.refundedAt,
        createdAt: storeOrdersTable.createdAt,
        updatedAt: storeOrdersTable.updatedAt,
        itemCount: sql<number>`coalesce(${itemCountSq.cnt}, 0)`,
        items: sql<unknown[]>`'[]'::json`,
      })
      .from(storeOrdersTable)
      .leftJoin(itemCountSq, eq(storeOrdersTable.id, itemCountSq.orderId))
      .where(whereClause)
      .orderBy(desc(storeOrdersTable.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: orders, total, page, limit });
  } catch (err) {
    next(err);
  }
});

router.get("/store/orders/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const [order] = await db.select().from(storeOrdersTable)
      .where(and(eq(storeOrdersTable.id, req.params.id), eq(storeOrdersTable.storeId, store.id))).limit(1);
    if (!order) { next(new NotFoundError("Order not found", "NOT_FOUND")); return; }
    const rawItems = await db.select().from(storeOrderItemsTable)
      .where(eq(storeOrderItemsTable.orderId, order.id));
    const items = rawItems.map((item) => {
      const variantObj = item.variant as Record<string, unknown> | null;
      const variantLabel = variantObj
        ? Object.values(variantObj).join(" / ")
        : null;
      return {
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        productType: item.productType,
        productImage: item.productImage,
        unitPrice: parseFloat(item.price ?? "0"),
        quantity: item.quantity,
        variantLabel,
        subtotal: item.subtotal,
        total: item.total,
        partnerId: item.partnerId,
        partnerProductId: item.partnerProductId,
        sellerName: item.sellerName,
        itemStatus: item.itemStatus,
        voucherCode: item.voucherCode,
        cancellationReason: item.cancellationReason,
        cancellationRequestedAt: item.cancellationRequestedAt,
        cancelledAt: item.cancelledAt,
        metadata: item.metadata,
      };
    });
    res.json({ ...order, items });
  } catch (err) {
    next(err);
  }
});

router.put("/store/orders/:id/status", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const parsed = z.object({
      status: z.string().optional(),
      paymentStatus: z.string().optional(),
      fulfillmentStatus: z.string().optional(),
      internalNotes: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const updates: Record<string, unknown> = {};
    if (parsed.data.status) updates.status = parsed.data.status;
    if (parsed.data.paymentStatus) updates.paymentStatus = parsed.data.paymentStatus;
    if (parsed.data.fulfillmentStatus) updates.fulfillmentStatus = parsed.data.fulfillmentStatus;
    if (parsed.data.internalNotes) updates.internalNotes = parsed.data.internalNotes;
    const isTransitioningToPaid = parsed.data.paymentStatus === STORE_PAYMENT_STATUS.PAID;
    const isTransitioningToCompleted = parsed.data.status === STORE_ORDER_STATUS.COMPLETED;

    if (parsed.data.status === STORE_ORDER_STATUS.COMPLETED) updates.completedAt = new Date();
    if (parsed.data.status === STORE_ORDER_STATUS.CANCELLED) updates.cancelledAt = new Date();
    if (parsed.data.paymentStatus === STORE_PAYMENT_STATUS.PAID) updates.paidAt = new Date();

    // When transitioning to PAID, add a conditional WHERE to make the inventory
    // effects idempotent under concurrency. The WHERE `paymentStatus != PAID`
    // means only one concurrent request will match and get rows returned; the
    // other sees 0 rows and skips effects — no read-then-check race condition.
    const baseWhere = and(eq(storeOrdersTable.id, req.params.id), eq(storeOrdersTable.storeId, store.id));
    const updateWhere = isTransitioningToPaid
      ? and(baseWhere, ne(storeOrdersTable.paymentStatus, STORE_PAYMENT_STATUS.PAID))
      : baseWhere;

    let didTransitionToPaid = false;
    let order: typeof storeOrdersTable.$inferSelect | undefined;
    if (isTransitioningToPaid) {
      await db.transaction(async (tx) => {
        const [lockedOrder] = await tx.select().from(storeOrdersTable)
          .where(baseWhere)
          .for("update")
          .limit(1);
        if (!lockedOrder) throw new NotFoundError("Order not found", "NOT_FOUND");
        order = lockedOrder;
        if (lockedOrder.paymentStatus === STORE_PAYMENT_STATUS.PAID) return;
        if (lockedOrder.status === STORE_ORDER_STATUS.CANCELLED) {
          throw new ConflictError("Não é possível receber pagamento de um pedido cancelado", "ORDER_CANCELLED");
        }

        // The row lock serializes competing manual confirmations. Inventory is
        // claimed first in this transaction, so a capacity failure rolls back
        // without leaving a PAID order whose effects cannot be retried.
        await applyOrderInventoryEffects(lockedOrder.id, tx as unknown as Parameters<typeof applyOrderInventoryEffects>[1]);
        await tx.update(storeOrdersTable).set(updates).where(eq(storeOrdersTable.id, lockedOrder.id));
        order = { ...lockedOrder, ...updates } as typeof storeOrdersTable.$inferSelect;
        didTransitionToPaid = true;
      });
    } else {
      await db.update(storeOrdersTable).set(updates).where(updateWhere)
        .returning({ id: storeOrdersTable.id });
      [order] = await db.select().from(storeOrdersTable)
        .where(baseWhere).limit(1);
    }
    if (!order) { next(new NotFoundError("Order not found", "NOT_FOUND")); return; }
    const currentOrder = order;

    // Payment-gated reservation: reservations are normally already created at
    // checkout time (createReservationsForOrder is idempotent, so this call is
    // typically a safe no-op that just returns the existing reservation IDs —
    // it only actually creates them for older orders placed before this
    // behavior existed). confirmReservationsForOrder then records the manual
    // payment against those reservations and syncs status to "confirmed".
    if (isTransitioningToPaid) {
      // Chain post-payment side effects (portal account + referral code) AFTER
      // reservations commit, so ensurePortalAccount sees the freshly-created
      // reservations. Both are gated behind confirmed payment.
      createReservationsForOrder(order.id)
        .then(async (createResult) => {
          // Broadcast seat-map SSE events so the admin boarding panel and seat map
          // auto-refresh without requiring a page reload. Fire-and-forget per trip.
          for (const tripId of createResult.tripIds) {
            broadcastSeatUpdate(tripId, currentOrder.tenantId).catch((err) => {
              req.log.warn({ err, tripId }, "[store/orders] Failed to broadcast seat update on manual payment confirmation");
            });
          }
          // Only notify when this call actually created the reservation
          // (tripIds non-empty) — the common case is it already exists from
          // checkout and was notified then, so don't resend here.
          if (createResult.tripIds.length > 0) {
            for (const reservationId of createResult.reservationIds) {
              enqueueNewBookingNotificationEmail(reservationId, currentOrder.tenantId).catch((err) => {
                req.log.warn({ err, reservationId }, "[store/orders] Failed to enqueue booking notification on manual payment confirmation");
              });
            }
          }
          // Record the manual payment against the (now-existing) reservations
          // and promote their status to "confirmed" once fully paid. Previously
          // this step was missing entirely, so a reservation's status never
          // advanced past "pending" on manual (Pix/boleto/transfer) confirmation.
          //
          // Gated on didTransitionToPaid (the row actually flipped UNPAID->PAID
          // in THIS request), not isTransitioningToPaid (the requested payload
          // value). If the order was already paid — e.g. confirmed earlier via
          // a Stripe/Mercado Pago webhook — and this same "paid" payload is
          // resent (retry, duplicate admin action), isTransitioningToPaid would
          // still be true even though nothing changed. confirmReservationsForOrder's
          // own dedup only checks gateway="manual" transactions, so it would not
          // recognize a prior non-manual payment and would insert a second,
          // duplicate "manual" payment for the full order amount — corrupting
          // financial totals. Restricting to didTransitionToPaid ensures this
          // only ever runs once, on the actual transition.
          if (didTransitionToPaid) {
            try {
              await confirmReservationsForOrder(currentOrder.id, Number(currentOrder.totalAmount), db);
            } catch (err) {
              req.log.warn({ err, orderId: currentOrder.id }, "[store/orders] Failed to confirm reservation payment on manual payment confirmation");
            }
            // Gated on didTransitionToPaid (not isTransitioningToPaid) so retries
            // and duplicate admin "mark as paid" actions never re-trigger portal
            // provisioning, referral code generation, client activity records, or
            // WhatsApp notifications for a payment that was already confirmed.
            await runPostPaymentSideEffects(currentOrder.id);
          }
        })
        .catch((err) => {
          req.log.warn({ err, orderId: currentOrder.id }, "[store/orders] Failed reservation/post-payment side effects on manual payment confirmation");
        });
    }

    // Auto-create CRM deal as "won" when order transitions to paid or completed (fire-and-forget).
    // Looks up linked reservation by storeOrderId to get tripId + reservationId for full linkage.
    if ((isTransitioningToPaid || isTransitioningToCompleted) && order.clientId) {
      (async () => {
        try {
          const [existingDeal] = await db.select({ id: dealsTable.id })
            .from(dealsTable)
            .where(and(
              eq(dealsTable.tenantId, me.tenantId),
              eq(dealsTable.title, `Pedido Loja ${order.orderNumber}`),
            ))
            .limit(1);
          if (!existingDeal) {
            // storeOrderId is stored as orderNumber (human-readable) in reservations.
            // Tenant-scoped to prevent cross-tenant data leakage.
            const [linkedReservation] = await db.select({
              id: reservationsTable.id,
              tripId: reservationsTable.tripId,
            })
              .from(reservationsTable)
              .where(and(
                eq(reservationsTable.tenantId, me.tenantId),
                eq(reservationsTable.storeOrderId, order.orderNumber),
              ))
              .limit(1);
            const [firstStage] = await db.select({ id: pipelineStagesTable.id })
              .from(pipelineStagesTable)
              .where(eq(pipelineStagesTable.tenantId, me.tenantId))
              .orderBy(asc(pipelineStagesTable.order))
              .limit(1);
            if (firstStage) {
              await db.insert(dealsTable).values({
                id: generateId(),
                tenantId: me.tenantId,
                title: `Pedido Loja ${order.orderNumber}`,
                clientId: order.clientId,
                ownerId: me.id,
                stageId: firstStage.id,
                value: order.totalAmount,
                status: "won",
                ...(linkedReservation?.tripId && { tripId: linkedReservation.tripId }),
                ...(linkedReservation?.id && { reservationId: linkedReservation.id }),
              });
            }
          }
        } catch (dealErr) {
          req.log.warn({ dealErr }, "Could not auto-create CRM deal on order status update");
        }
      })();
    }

    // When an admin manually cancels a paid order (referralEffectsAppliedAt set),
    // reverse any COMPLETED referral row.
    // - Product-only orders: reservationId is null on the referral row;
    //   handled by reverseProductOnlyOrderReferral.
    // - Trip-based orders: reservationId was set at deferred-credit time;
    //   handled by reverseTripOrderReferrals keyed on the linked reservation(s).
    if (parsed.data.status === STORE_ORDER_STATUS.CANCELLED && order.referralEffectsAppliedAt != null) {
      const ref = order.pendingReferral;
      if (ref?.code) {
        try {
          const linkedReservations = await db
            .select({ id: reservationsTable.id })
            .from(reservationsTable)
            .where(
              and(
                eq(reservationsTable.tenantId, me.tenantId),
                eq(reservationsTable.storeOrderId, order.orderNumber),
              ),
            );
          if (linkedReservations.length === 0) {
            await reverseProductOnlyOrderReferral(db, {
              tenantId: me.tenantId,
              orderId: order.id,
              referralCode: ref.code,
              referralId: ref.referralId,
              reversalReason: "order_cancelled",
            });
          } else {
            await reverseTripOrderReferrals(db, {
              tenantId: me.tenantId,
              orderId: order.id,
              cancellableReservationIds: linkedReservations.map((r) => r.id),
              reversalReason: "order_cancelled",
            });
          }
        } catch (err) {
          req.log.warn({ err, orderId: order.id }, "[store/orders] Failed to reverse referral on manual cancellation");
        }
      }
    }

    if (
      parsed.data.status === STORE_ORDER_STATUS.CANCELLED
      && (order.paymentStatus === STORE_PAYMENT_STATUS.PAID || parsed.data.paymentStatus === STORE_PAYMENT_STATUS.REFUNDED)
    ) {
      await db.transaction(async (tx) => {
        await cancelPartnerOrderItems(tx as unknown as Parameters<typeof cancelPartnerOrderItems>[0], {
          orderId: currentOrder.id,
          tenantId: me.tenantId,
          reason: "Pedido cancelado pela agência",
        });
      });
    }

    res.json(order);
  } catch (err) {
    next(err);
  }
});

router.get("/store/coupons", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const coupons = await db.select().from(storeCouponsTable)
      .where(eq(storeCouponsTable.storeId, store.id))
      .orderBy(desc(storeCouponsTable.createdAt));
    res.json(coupons);
  } catch (err) {
    next(err);
  }
});

router.post("/store/coupons", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const parsed = CouponBody.safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const id = generateId();
    const data = parsed.data;
    await db.insert(storeCouponsTable).values({
      id,
      storeId: store.id,
      code: data.code,
      value: data.value,
      startsAt: new Date(data.startsAt),
      expiresAt: new Date(data.expiresAt),
      ...(data.type && { type: data.type }),
      ...(data.description && { description: data.description }),
      ...(data.minPurchaseAmount && { minPurchaseAmount: data.minPurchaseAmount }),
      ...(data.maxDiscountAmount && { maxDiscountAmount: data.maxDiscountAmount }),
      ...(data.usageLimit != null && { usageLimit: data.usageLimit }),
      ...(data.usageLimitPerCustomer != null && { usageLimitPerCustomer: data.usageLimitPerCustomer }),
      ...(data.applicableProducts && { applicableProducts: data.applicableProducts }),
      ...(data.applicableCategories && { applicableCategories: data.applicableCategories }),
      ...(data.minimumItems != null && { minimumItems: data.minimumItems }),
      ...(data.isActive != null && { isActive: data.isActive }),
    });
    const [coupon] = await db.select().from(storeCouponsTable)
      .where(eq(storeCouponsTable.id, id)).limit(1);
    res.status(201).json(coupon);
  } catch (err) {
    next(err);
  }
});

router.put("/store/coupons/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const parsed = CouponBody.partial().safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const updates: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.startsAt) updates.startsAt = new Date(parsed.data.startsAt);
    if (parsed.data.expiresAt) updates.expiresAt = new Date(parsed.data.expiresAt);
    await db.update(storeCouponsTable).set(updates)
      .where(and(eq(storeCouponsTable.id, req.params.id), eq(storeCouponsTable.storeId, store.id)));
    const [coupon] = await db.select().from(storeCouponsTable)
      .where(and(eq(storeCouponsTable.id, req.params.id), eq(storeCouponsTable.storeId, store.id))).limit(1);
    if (!coupon) { next(new NotFoundError("Coupon not found", "NOT_FOUND")); return; }
    res.json(coupon);
  } catch (err) {
    next(err);
  }
});

router.delete("/store/coupons/:id", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    await db.delete(storeCouponsTable)
      .where(and(eq(storeCouponsTable.id, req.params.id), eq(storeCouponsTable.storeId, store.id)));
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/store/reviews", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const reviews = await db.select().from(storeReviewsTable)
      .where(eq(storeReviewsTable.storeId, store.id))
      .orderBy(desc(storeReviewsTable.createdAt));
    res.json(reviews);
  } catch (err) {
    next(err);
  }
});

router.put("/store/reviews/:id/status", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAuth(req, res);
    if (!me) return;
    if (!ADMIN_ROLES.includes(me.role)) { next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE")); return; }
    const store = await getStoreForTenant(me.tenantId);
    if (!store) { next(new NotFoundError("Store not found", "NOT_FOUND")); return; }
    const parsed = z.object({
      status: z.enum(["pending", "approved", "rejected"]),
      reply: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) { next(new ValidationError(String(parsed.error.message ), "VALIDATION_ERROR")); return; }
    const updates: Record<string, unknown> = { status: parsed.data.status };
    if (parsed.data.reply) {
      updates.reply = parsed.data.reply;
      updates.repliedAt = new Date();
    }
    await db.update(storeReviewsTable).set(updates)
      .where(and(eq(storeReviewsTable.id, req.params.id), eq(storeReviewsTable.storeId, store.id)));
    const [review] = await db.select().from(storeReviewsTable)
      .where(and(eq(storeReviewsTable.id, req.params.id), eq(storeReviewsTable.storeId, store.id))).limit(1);
    if (!review) { next(new NotFoundError("Review not found", "NOT_FOUND")); return; }
    res.json(review);
  } catch (err) {
    next(err);
  }
});

export default router;
