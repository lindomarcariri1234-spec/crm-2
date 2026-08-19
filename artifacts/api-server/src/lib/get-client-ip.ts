import type { Request } from "express";

/**
 * Returns the real client IP for an Express request.
 *
 * Express is already configured with `app.set("trust proxy", 1)` in app.ts,
 * which means the framework handles XFF parsing and trusted-proxy validation
 * internally. `req.ip` is therefore the authoritative, spoofing-resistant
 * source: Express strips untrusted leftmost XFF entries before exposing it.
 *
 * We intentionally do NOT re-parse `x-forwarded-for` here — doing so would
 * bypass Express's trust-proxy logic and re-introduce spoofability.
 */
export function getClientIp(req: Request): string | null {
  return req.ip ?? req.socket?.remoteAddress ?? null;
}
