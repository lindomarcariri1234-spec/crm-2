import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { clerkMiddleware, getAuth } from "@clerk/express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { and, eq } from "drizzle-orm";
import { db, storeProductsTable, storesTable, tripsTable } from "@workspace/db";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
import { requestId, errorHandler } from "./middlewares/errorHandler";
import router from "./routes";
import { logger } from "./lib/logger";
import { handleStripeWebhook } from "./lib/stripeWebhookHandler";
import {
  buildStorefrontMetadata,
  injectStorefrontMetadata,
  productSlugFromStorefrontPath,
} from "./lib/storefront-metadata";

const app: Express = express();

app.set("trust proxy", 1);

// ── HTTP Security Headers ──────────────────────────────────────────────────
// helmet applies X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
// X-DNS-Prefetch-Control, X-Download-Options, HSTS and CSP.
//
// CSP notes:
//  - script-src allows Clerk (*.clerk.com, *.clerk.accounts.dev), Cloudflare
//    Turnstile (challenges.cloudflare.com), and Stripe.js (js.stripe.com).
//    No 'unsafe-inline' or 'unsafe-eval' → unauthorized inline scripts blocked.
//  - style-src includes 'unsafe-inline' because Clerk and Radix inject styles
//    at runtime without nonces. Removing it would require per-request nonce
//    injection — tracked as a future improvement.
//  - connect-src covers the Clerk backend API, UploadThing CDN (ufs.sh / utfs.io),
//    and Stripe API.
//  - frame-ancestors 'none' makes the X-Frame-Options: DENY belt-and-suspenders.
//  - crossOriginEmbedderPolicy is disabled to avoid blocking Clerk and
//    UploadThing cross-origin widgets.
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    xFrameOptions: { action: "deny" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "https://*.clerk.com",
          "https://*.clerk.accounts.dev",
          "https://challenges.cloudflare.com",
          "https://js.stripe.com",
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: [
          "'self'",
          "https://*.clerk.com",
          "https://*.clerk.accounts.dev",
          "https://uploadthing.com",
          "https://*.ufs.sh",
          "https://utfs.io",
          "https://api.stripe.com",
        ],
        frameSrc: [
          "'self'",
          "https://challenges.cloudflare.com",
          "https://www.youtube.com",
          "https://player.vimeo.com",
        ],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  }),
);

// Permissions-Policy: disable hardware sensors that this API never uses.
// Helmet 8 doesn't ship a permissionsPolicy module, so we set it manually.
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  next();
});

app.use(requestId);
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

const isDev = process.env["NODE_ENV"] !== "production";

const additionalOrigins = (process.env["ADDITIONAL_ORIGINS"] ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// REPLIT_DOMAINS is a platform-managed secret containing all domains attached to this
// deployment (custom domains + the generated .replit.app subdomain), comma-separated.
// Parsing it here ensures every domain gets CORS + Clerk authorizedParties coverage
// automatically, without having to enumerate each one manually in ADDITIONAL_ORIGINS.
const replitDomains = (process.env["REPLIT_DOMAINS"] ?? "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean)
  .map((d) => (d.startsWith("https://") || d.startsWith("http://") ? d : `https://${d}`));

const frontendUrls = (process.env["FRONTEND_URL"] ?? "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);

const ALLOWED_ORIGINS = new Set(
  [
    ...frontendUrls,
    process.env["REPLIT_DEV_DOMAIN"] ? `https://${process.env["REPLIT_DEV_DOMAIN"]}` : undefined,
    ...replitDomains,
    ...additionalOrigins,
  ].filter(Boolean) as string[]
);

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (isDev) {
    try {
      const url = new URL(origin);
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
    } catch {
      // ignore invalid origin
    }
  }
  return false;
}

if (ALLOWED_ORIGINS.size === 0 && !isDev) {
  logger.warn(
    "⚠️  CORS: No allowed origins configured. Set FRONTEND_URL or ensure REPLIT_DEV_DOMAIN is set. " +
    "Browser API calls from external origins will be blocked. " +
    "Only same-origin requests (no Origin header) will succeed."
  );
}

if (!process.env["CLERK_SECRET_KEY"]) {
  logger.error("🚨 CLERK_SECRET_KEY is not set. Clerk authentication WILL NOT WORK in production. Re-run Clerk setup to provision keys.");
}

// Canonical proxy: only active in production (NODE_ENV=production).
// In production the proxy derives its proxyUrl dynamically from the request host —
// no CLERK_PROXY_URL env var is needed.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// ── Stripe webhook — MUST be registered BEFORE express.json() ──
// The rawBody is also captured via the verify hook below, which covers
// the existing /api/webhooks/stripe route. This dedicated route uses
// express.raw() as a belt-and-suspenders approach.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  (req, res) => void handleStripeWebhook(req, res),
);

app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
}));
app.use(cookieParser());

// Backup restore uploads can be a large JSON file (potentially years of
// agency data). Registered BEFORE the global express.json() below with a
// higher limit, scoped to this one route only; body-parser marks the
// request body as already parsed, so the global parser skips it.
app.use("/api/backup/import", express.json({ limit: "25mb" }));

app.use(
  express.json({
    limit: "1mb",
    verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (
    err !== null &&
    typeof err === "object" &&
    "type" in err &&
    (err as { type: string }).type === "entity.too.large"
  ) {
    res.status(413).json({
      error: "Payload too large",
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body exceeds the 1 MB limit",
    });
    return;
  }
  next(err);
});

const authorizedParties = [
  ...frontendUrls,
  process.env["REPLIT_DEV_DOMAIN"] ? `https://${process.env["REPLIT_DEV_DOMAIN"]}` : undefined,
  ...replitDomains,
  ...additionalOrigins,
].filter((s): s is string => Boolean(s))
  .map((s) => s.replace(/\/+$/, ""));

// Log at startup so production logs confirm which parties are allowed
if (authorizedParties.length > 0) {
  logger.info({ authorizedParties }, "[clerk] authorizedParties configured");
} else {
  logger.info("[clerk] authorizedParties is empty — all Clerk azp values are accepted");
}

const clerkAuth = clerkMiddleware(authorizedParties.length > 0 ? { authorizedParties } : {});

const CLERK_BYPASS_PATHS = new Set([
  "/api",
  "/api/health",
  "/api/healthz",
  "/api/health/auth",
]);

app.use((req, res, next) => {
  // UploadThing CDN posts completion callbacks here without a user session.
  // The SDK verifies the request via x-uploadthing-signature internally.
  // Only bypass Clerk for CDN callbacks (actionType=callback), not for
  // regular authenticated upload requests.
  if (req.path === "/api/uploadthing" && req.query["actionType"] === "callback") {
    return next();
  }
  if (CLERK_BYPASS_PATHS.has(req.path)) {
    return next();
  }
  return clerkAuth(req, res, next);
});

const rateLimitHandler = (_req: Request, res: Response) => {
  res.status(429).json({
    error: "TOO_MANY_REQUESTS",
    code: "TOO_MANY_REQUESTS",
    message: "Muitas requisições. Aguarde um momento e tente novamente.",
  });
};

function parseRateLimitEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn(`⚠️  ${name} has invalid value "${raw}"; falling back to default ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

const RATE_LIMIT_WINDOW_MS = parseRateLimitEnv("RATE_LIMIT_WINDOW_MS", 60_000);
const RATE_LIMIT_PUBLIC_MAX = parseRateLimitEnv("RATE_LIMIT_PUBLIC_MAX", 60);
const RATE_LIMIT_ORDERS_MAX = parseRateLimitEnv("RATE_LIMIT_ORDERS_MAX", 5);

const publicGeneralLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_PUBLIC_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

const publicOrderLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: RATE_LIMIT_ORDERS_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

const referralValidateLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

// Separate instance from referralValidateLimiter so a legitimate landing-page
// /referral/info lookup does not consume the customer's /validate budget (and
// vice-versa). Bounds anonymous brute-forcing of referral codes via /info.
const referralInfoLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

const priceAlertSubscribeLimiter = rateLimit({
  windowMs: 60_000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

const orderLookupLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: parseRateLimitEnv("RATE_LIMIT_ORDER_LOOKUP_MAX", 10),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

// Dedicated limiter for the referral visit-tracking write endpoint. It is more
// generous than /validate and /info (it fires per storefront page view) but
// still bounds anonymous write amplification against referral_tracking, which
// the shared publicGeneralLimiter alone does not isolate.
const referralTrackLimiter = rateLimit({
  windowMs: 60_000,
  max: parseRateLimitEnv("RATE_LIMIT_REFERRAL_TRACK_MAX", 30),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

app.use("/api/public", publicGeneralLimiter);
app.post("/api/public/store/:slug/orders", publicOrderLimiter);
app.get("/api/public/store/:slug/orders/:orderNumber", orderLookupLimiter);
app.post("/api/public/store/:slug/referral/validate", referralValidateLimiter);
app.post("/api/public/store/:slug/referral/track", referralTrackLimiter);
app.get("/api/public/store/:slug/referral/info", referralInfoLimiter);
app.post("/api/public/store/:slug/price-alerts", priceAlertSubscribeLimiter);

// ── AUTHENTICATED RATE LIMITERS ──────────────────────────────────────────────
// Keys use tenantId from Clerk session claims so the quota is shared across
// every user of the same agency (not per-IP, which breaks multi-user tenants).
// Superadmins (no tenantId) fall back to their Clerk userId.

const rateLimitWarnCooldownMs = 30_000;
const rateLimitWarnSeen = new Map<string, number>();

function warnRateLimit(req: Request, label: string): void {
  try {
    const auth = getAuth(req);
    const tenantId = (auth.sessionClaims?.["tenantId"] as string | undefined) ?? null;
    const userId = auth.userId ?? null;
    const cacheKey = `${userId ?? "anon"}:${req.method}:${req.path}`;
    const now = Date.now();
    const last = rateLimitWarnSeen.get(cacheKey) ?? 0;
    if (now - last >= rateLimitWarnCooldownMs) {
      rateLimitWarnSeen.set(cacheKey, now);
      req.log?.warn({ tenantId, userId, path: req.path, method: req.method, limiter: label }, "[rate-limit] authenticated limit exceeded");
    }
  } catch {
    // non-fatal — logging must never disrupt the 429 response
  }
}

function makeAuthRateLimitHandler(label: string) {
  return (req: Request, res: Response): void => {
    warnRateLimit(req, label);
    const retryAfter = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      error: "TOO_MANY_REQUESTS",
      code: "TOO_MANY_REQUESTS",
      message: "Limite de requisições atingido. Aguarde um momento e tente novamente.",
    });
  };
}

const tenantKeyGenerator = (req: Request): string => {
  const auth = getAuth(req);
  return (auth.sessionClaims?.["tenantId"] as string | undefined) ?? auth.userId ?? ipKeyGenerator(req.ip ?? "unknown");
};

const userKeyGenerator = (req: Request): string => {
  const auth = getAuth(req);
  return auth.userId ?? ipKeyGenerator(req.ip ?? "unknown");
};

// AI / LLM endpoints: 20 req/min per tenant
const aiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: parseRateLimitEnv("RATE_LIMIT_AI_MAX", 20),
  keyGenerator: tenantKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeAuthRateLimitHandler("ai"),
});

// Export endpoints (PDF/XLSX/CSV): 10 req/min per tenant
const exportLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: parseRateLimitEnv("RATE_LIMIT_EXPORT_MAX", 10),
  keyGenerator: tenantKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeAuthRateLimitHandler("export"),
});

// Email-send endpoints: 30 req/min per tenant
const emailSendLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: parseRateLimitEnv("RATE_LIMIT_EMAIL_SEND_MAX", 30),
  keyGenerator: tenantKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeAuthRateLimitHandler("email-send"),
});

// Admin bulk / destructive operations: 10 req/min per user (superadmins have no tenantId)
const adminBulkLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: parseRateLimitEnv("RATE_LIMIT_ADMIN_BULK_MAX", 10),
  keyGenerator: userKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeAuthRateLimitHandler("admin-bulk"),
});

// Apply AI limiter
app.post("/api/ai-integration/test", aiLimiter);
app.post("/api/ai-integration/revoke", aiLimiter);
app.post("/api/chatbot-conversations", aiLimiter);
app.post("/api/chatbot-messages", aiLimiter);
app.post("/api/ai-content", aiLimiter);
app.post("/api/insights/chat", aiLimiter);
app.post("/api/insights/simulator", aiLimiter);
app.post("/api/insights/ask", aiLimiter);

// Apply export limiter
app.post("/api/reports/export", exportLimiter);
app.get("/api/reservations/export", exportLimiter);
app.get("/api/trips/:id/manifest/pdf", exportLimiter);
app.get("/api/trips/:id/passengers/export", exportLimiter);
app.get("/api/referrals/export", exportLimiter);
app.get("/api/referrals/analytics/export", exportLimiter);
app.get("/api/tenants/backup/export", exportLimiter);

// Apply email-send limiter
app.post("/api/trips/:id/manifest/send", emailSendLimiter);
app.post("/api/email-logs/:id/resend", emailSendLimiter);
app.post("/api/referrals/:id/resend-expiry-warning", emailSendLimiter);
app.post("/api/referrals/:id/resend-bonus-release", emailSendLimiter);

// Apply admin bulk limiter to ALL POST and DELETE under /api/admin
// Using a prefix middleware ensures complete coverage including future routes.
app.use("/api/admin", (req: Request, res: Response, next: express.NextFunction): void => {
  if (req.method === "POST" || req.method === "DELETE") {
    adminBulkLimiter(req, res, next);
    return;
  }
  next();
});

app.use("/api", router);

if (!isDev) {
  const frontendDist = path.join(process.cwd(), "artifacts/visitecrm/dist/public");
  const storefrontIndexPath = path.join(frontendDist, "index.html");
  let storefrontIndexHtml: Promise<string> | null = null;

  const getStorefrontIndexHtml = (): Promise<string> => {
    storefrontIndexHtml ??= readFile(storefrontIndexPath, "utf8");
    return storefrontIndexHtml;
  };

  const serveStorefront = async (req: Request, res: Response, next: express.NextFunction): Promise<void> => {
    try {
      const slug = req.params["slug"];
      if (typeof slug !== "string") {
        res.sendFile(storefrontIndexPath);
        return;
      }

      const [store] = await db
        .select({
          id: storesTable.id,
          name: storesTable.name,
          slug: storesTable.slug,
          tagline: storesTable.tagline,
          description: storesTable.description,
          logo: storesTable.logo,
          favicon: storesTable.favicon,
          bannerHome: storesTable.bannerHome,
          bannerMobile: storesTable.bannerMobile,
          metaTitle: storesTable.metaTitle,
          metaDescription: storesTable.metaDescription,
          metaKeywords: storesTable.metaKeywords,
          customDomain: storesTable.customDomain,
          domainVerified: storesTable.domainVerified,
        })
        .from(storesTable)
        .where(and(eq(storesTable.slug, slug), eq(storesTable.isActive, true)))
        .limit(1);

      if (!store) {
        res.sendFile(storefrontIndexPath);
        return;
      }

      const productSlug = productSlugFromStorefrontPath(req.path, slug);
      const [product] = productSlug
        ? await db
          .select({
            name: storeProductsTable.name,
            description: storeProductsTable.description,
            shortDescription: storeProductsTable.shortDescription,
            thumbnail: storeProductsTable.thumbnail,
            images: storeProductsTable.images,
            gallery: storeProductsTable.gallery,
            metaTitle: storeProductsTable.metaTitle,
            metaDescription: storeProductsTable.metaDescription,
            metaKeywords: storeProductsTable.metaKeywords,
            price: storeProductsTable.price,
            onSale: storeProductsTable.onSale,
            salePrice: storeProductsTable.salePrice,
            saleStartsAt: storeProductsTable.saleStartsAt,
            saleEndsAt: storeProductsTable.saleEndsAt,
            startDate: storeProductsTable.startDate,
            departureDate: tripsTable.departureDate,
          })
          .from(storeProductsTable)
          .leftJoin(tripsTable, eq(storeProductsTable.tripId, tripsTable.id))
          .where(and(
            eq(storeProductsTable.storeId, store.id),
            eq(storeProductsTable.slug, productSlug),
            eq(storeProductsTable.status, "active"),
          ))
          .limit(1)
        : [];
      const metadata = buildStorefrontMetadata(store, req.path, req.get("host"), product);
      const html = injectStorefrontMetadata(await getStorefrontIndexHtml(), metadata);
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      res.type("html").send(html);
    } catch (error) {
      next(error);
    }
  };

  app.use(express.static(frontendDist));
  app.get("/loja/:slug", serveStorefront);
  app.get("/loja/:slug/{*splat}", serveStorefront);
  app.get("/{*splat}", (req: Request, res: Response, next: express.NextFunction) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(storefrontIndexPath);
  });
}

app.use(errorHandler);

export default app;
