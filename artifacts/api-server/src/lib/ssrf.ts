import { lookup } from "node:dns/promises";
import { lookup as dnsLookupCb } from "node:dns";
import type { LookupAddress, LookupOptions } from "node:dns";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

// ─── SSRF protection ──────────────────────────────────────────────────────────
// Tenant admins supply their own provider/instance base URLs (AI providers,
// WhatsApp Evolution instances, ...). Without validation a server-side request
// could be pointed at internal services or the cloud metadata endpoint
// (169.254.169.254). We require HTTPS, block private/reserved IP ranges (checked
// against the resolved address, not just the hostname), and refuse redirects
// that could bypass the check.

// Parses any textual IPv6 form to its 16 bytes, or null if invalid. Handles
// "::" zero-compression and a trailing embedded dotted-quad IPv4
// (e.g. ::ffff:127.0.0.1) by first folding it into two hex groups.
function ipv6ToBytes(input: string): number[] | null {
  let s = input.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone); // drop scope/zone id
  const lastColon = s.lastIndexOf(":");
  if (lastColon >= 0) {
    const tail = s.slice(lastColon + 1);
    if (tail.includes(".")) {
      if (!net.isIPv4(tail)) return null;
      const p = tail.split(".").map(Number) as [number, number, number, number];
      s =
        s.slice(0, lastColon + 1) +
        (((p[0] << 8) | p[1]) >>> 0).toString(16) +
        ":" +
        (((p[2] << 8) | p[3]) >>> 0).toString(16);
    }
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const tailGroups = halves[1] ? halves[1].split(":") : [];
    const missing = 8 - head.length - tailGroups.length;
    if (missing < 0) return null;
    groups = [...head, ...Array(missing).fill("0"), ...tailGroups];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push((v >> 8) & 0xff, v & 0xff);
  }
  return bytes;
}

// True when an IP literal is loopback/private/link-local/reserved and therefore
// must not be reachable from a server-side request. Handles IPv4, IPv6, and
// EVERY textual encoding of IPv4-in-IPv6 — mapped (::ffff:0:0/96), compatible
// (::/96, incl. ::1 and ::), and NAT64 (64:ff9b::/96) — so a hex form such as
// ::ffff:7f00:1 cannot smuggle 127.0.0.1 past the check. Surrounding brackets
// (from a URL host) are tolerated.
export function isPrivateIp(ipRaw: string): boolean {
  const ip = ipRaw.replace(/^\[|\]$/g, "");
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number) as [number, number, number, number];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const bytes = ipv6ToBytes(ip);
    if (!bytes) return true; // unparseable → unsafe
    const allZero = (from: number, to: number): boolean =>
      bytes.slice(from, to).every((x) => x === 0);
    const embeddedV4 = `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
    // IPv4-mapped ::ffff:0:0/96
    if (allZero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return isPrivateIp(embeddedV4);
    // IPv4-compatible ::/96 (covers ::1 loopback and :: unspecified too)
    if (allZero(0, 12)) return isPrivateIp(embeddedV4);
    // NAT64 64:ff9b::/96
    if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && allZero(4, 12))
      return isPrivateIp(embeddedV4);
    if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // link-local fe80::/10
    if ((bytes[0] & 0xfe) === 0xfc) return true; // unique-local fc00::/7
    return false;
  }
  return true; // not a recognizable IP → treat as unsafe
}

// Validates a URL is HTTPS and resolves only to public addresses. Throws a
// user-safe (Portuguese) message when the URL is not allowed.
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("URL inválida.");
  }
  if (url.protocol !== "https:") {
    throw new Error("A URL deve usar HTTPS.");
  }
  // url.hostname keeps the brackets for IPv6 literals ("[::1]"); strip them so
  // net.isIP recognizes the literal and we classify it instead of (incorrectly)
  // sending a bracketed string to DNS resolution.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (net.isIP(host)) {
    addresses = [host];
  } else {
    const results = await lookup(host, { all: true }).catch(() => []);
    addresses = results.map((r) => r.address);
  }
  if (addresses.length === 0) {
    throw new Error("Não foi possível resolver o host.");
  }
  for (const addr of addresses) {
    if (isPrivateIp(addr)) {
      throw new Error("Endpoint não permitido.");
    }
  }
}

// Connection-time SSRF guard. assertSafeUrl validates the URL up front, but a
// hostname can rebind to a private address between validation and the actual
// socket connect (DNS rebinding / TOCTOU). This custom lookup is invoked by
// undici at connect time and rejects any hostname whose resolved address is
// private/reserved, binding the check to the real connection rather than a
// throwaway pre-flight resolution. (Literal private IPs in the URL are still
// caught earlier by assertSafeUrl, since undici skips lookup for literal IPs.)
function ssrfLookup(
  hostname: string,
  options: LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  dnsLookupCb(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "");
    for (const a of addresses) {
      if (isPrivateIp(a.address)) {
        return callback(new Error("Endpoint não permitido."), "");
      }
    }
    if (options.all) {
      callback(null, addresses);
    } else {
      const first = addresses[0]!;
      callback(null, first.address, first.family);
    }
  });
}

const ssrfDispatcher = new Agent({ connect: { lookup: ssrfLookup as never } });

// Drop-in `fetch` that pre-validates the URL (HTTPS + no literal private IPs),
// refuses redirects, and routes the request through the SSRF-aware undici
// dispatcher. Used as the OpenAI SDK's `fetch` and by ssrfSafeFetchBounded.
// undici's own fetch is used (not Node's global fetch) so the dispatcher and
// fetch come from the same undici instance.
export const ssrfSafeFetch = (async (input: unknown, init?: unknown) => {
  const urlStr =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as { url: string }).url;
  await assertSafeUrl(urlStr);
  return undiciFetch(input as never, {
    ...(init as object),
    redirect: "error",
    // Agent satisfies undici's Dispatcher at runtime; the ambient module
    // declaration in vendor.d.ts cannot extend the globally-loaded Dispatcher
    // class (bundler resolution loads undici globals before our module surface),
    // so a minimal cast is required here – consistent with `ssrfLookup as never`
    // and `input as never` already present in this file.
    dispatcher: ssrfDispatcher as never,
  });
}) as unknown as typeof fetch;

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  text: string;
}

// SSRF-safe fetch with an enforced timeout and a hard cap on how much of the
// response body is read. Use this for connectivity probes against tenant-
// controlled endpoints (e.g. WhatsApp Evolution instances): it prevents a
// hostile endpoint from hanging the request or streaming an unbounded body.
export async function ssrfSafeFetchBounded(
  url: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const { method = "GET", headers = {}, body, timeoutMs = 12000, maxBytes = 64 * 1024 } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await ssrfSafeFetch(url, {
      method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: controller.signal,
    } as RequestInit);

    let text = "";
    const reader = (res.body as ReadableStream<Uint8Array> | null)?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          received += value.byteLength;
          if (received > maxBytes) {
            void reader.cancel();
            break;
          }
          text += decoder.decode(value, { stream: true });
        }
      }
      text += decoder.decode();
    }
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}
