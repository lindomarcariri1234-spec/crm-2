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

export function shouldBypassClerkForPath(pathname: string): boolean {
  return CLERK_BYPASS_PATHS.has(pathname)
    || isPathWithin(pathname, "/api/cron")
    || (isPathWithin(pathname, "/api/public") && !PUBLIC_ORDER_CREATION_PATH.test(pathname))
    || isPathWithin(pathname, "/api/webhooks")
    || isPathWithin(pathname, "/loja");
}