const CLERK_BYPASS_PATHS = new Set([
  "/api",
  "/api/health",
  "/api/healthz",
  "/api/health/auth",
]);

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
    || isPathWithin(pathname, "/api/public")
    || isPathWithin(pathname, "/loja");
}