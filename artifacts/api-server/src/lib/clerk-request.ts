import type { IncomingHttpHeaders } from "node:http";

const CLERK_BYPASS_PATHS = new Set([
  "/api",
  "/api/health",
  "/api/healthz",
  "/api/health/auth",
]);

// Order creation is public, but it also accepts an authenticated Clerk session
// when the customer applies referral cashback. It must pass through
// clerkMiddleware so getAuth(req) can safely read an optional session; the
// route itself remains responsible for deciding whether authentication is
// required.
const PUBLIC_ORDER_CREATION_PATH = /^\/api\/public\/store\/[^/]+\/orders$/;

function isPathWithin(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function resolveClerkPublishableKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env["CLERK_PUBLISHABLE_KEY"]?.trim()
    || env["VITE_CLERK_PUBLISHABLE_KEY"]?.trim()
    || undefined;
}

export function requireClerkAuthorizedParties(
  origins: readonly (string | undefined)[],
  isProduction: boolean,
): string[] {
  const authorizedParties = origins
    .filter((origin): origin is string => Boolean(origin))
    .map((origin) => origin.replace(/\/+$/, ""));

  if (isProduction && authorizedParties.length === 0) {
    throw new Error(
      "Missing Clerk authorized parties in production. Configure FRONTEND_URL, REPLIT_DOMAINS, or ADDITIONAL_ORIGINS.",
    );
  }

  return authorizedParties;
}

function headerHostname(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const firstValue = raw?.split(",")[0]?.trim();
  if (!firstValue) return null;
  try {
    const withScheme = firstValue.includes("://") ? firstValue : `https://${firstValue}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

/**
 * Clerk's session handshake builds redirect_url from x-forwarded-host (or Host).
 * Vercel's external API rewrite can make the Replit upstream hostname appear
 * there, even when the browser is on the canonical frontend. Normalize only the
 * Instagram connect navigation and only when one of those hosts is a configured
 * Replit deployment alias; Clerk still validates the canonical URL normally.
 */
export function canonicalizeInstagramConnectClerkRequest(
  request: { path: string; headers: IncomingHttpHeaders },
  options: {
    isProduction: boolean;
    canonicalFrontendOrigin: string;
    replitDomains: readonly string[];
  },
): boolean {
  if (!options.isProduction || request.path !== "/api/instagram-messaging/connect") {
    return false;
  }

  let canonical: URL;
  try {
    canonical = new URL(options.canonicalFrontendOrigin);
  } catch {
    return false;
  }
  if (canonical.protocol !== "https:" || canonical.username || canonical.password) {
    return false;
  }

  const aliasHosts = new Set(
    options.replitDomains
      .map((domain) => headerHostname(domain))
      .filter((hostname): hostname is string => hostname !== null),
  );
  if (aliasHosts.size === 0) return false;

  const incomingHosts = [
    headerHostname(request.headers["x-forwarded-host"]),
    headerHostname(request.headers.host),
  ];
  if (!incomingHosts.some((hostname) => hostname !== null && aliasHosts.has(hostname))) {
    return false;
  }

  request.headers["x-forwarded-host"] = canonical.host;
  request.headers["x-forwarded-proto"] = "https";
  return true;
}

export function shouldBypassClerkForPath(pathname: string): boolean {
  return CLERK_BYPASS_PATHS.has(pathname)
    || isPathWithin(pathname, "/api/cron")
    || (isPathWithin(pathname, "/api/public") && !PUBLIC_ORDER_CREATION_PATH.test(pathname))
    || isPathWithin(pathname, "/api/webhooks")
    || isPathWithin(pathname, "/loja");
}