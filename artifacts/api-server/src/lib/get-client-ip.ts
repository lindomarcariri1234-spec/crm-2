import { isIP } from "node:net";
import type { Request } from "express";

/**
 * Returns the canonical real client IP for an Express request.
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
  const ip = req.ip ?? req.socket?.remoteAddress ?? null;
  if (!ip) return null;

  // Node may expose IPv4 peers through the IPv6 socket representation on
  // hosted runners and dual-stack deployments. Keep persisted IPs stable.
  const ipv4MappedPrefix = "::ffff:";
  if (ip.toLowerCase().startsWith(ipv4MappedPrefix)) {
    const ipv4 = ip.slice(ipv4MappedPrefix.length);
    if (isIP(ipv4) === 4) return ipv4;
  }

  return ip;
}
