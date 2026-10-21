import { ssrfSafeFetchBounded } from "../lib/ssrf";

export interface EvolutionApiResponse {
  ok: boolean;
  status: number;
  text: string;
}

interface EvolutionRequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  maxBytes?: number;
}

function instancePath(resource: string, instanceName: string): string {
  return `/${resource}/${encodeURIComponent(instanceName)}`;
}

/**
 * Single outbound boundary for Evolution API requests. URL validation and
 * connect-time SSRF protection are enforced by ssrfSafeFetchBounded.
 */
export async function evolutionApiRequest(
  baseUrl: string,
  apiKey: string,
  path: string,
  options: EvolutionRequestOptions = {},
): Promise<EvolutionApiResponse> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Evolution API path must be relative to its configured base URL.");
  }
  const headers: Record<string, string> = { apikey: apiKey };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  return ssrfSafeFetchBounded(
    `${baseUrl.replace(/\/+$/, "")}${path}`,
    {
      method: options.method ?? "GET",
      headers,
      ...(body !== undefined ? { body } : {}),
      timeoutMs: options.timeoutMs ?? 12_000,
      maxBytes: options.maxBytes ?? 16 * 1024,
    },
  );
}

export function getEvolutionConnectionState(
  baseUrl: string,
  apiKey: string,
  instanceName: string,
  timeoutMs = 12_000,
): Promise<EvolutionApiResponse> {
  return evolutionApiRequest(
    baseUrl,
    apiKey,
    instancePath("instance/connectionState", instanceName),
    { timeoutMs },
  );
}

export function connectEvolutionInstance(
  baseUrl: string,
  apiKey: string,
  instanceName: string,
): Promise<EvolutionApiResponse> {
  return evolutionApiRequest(
    baseUrl,
    apiKey,
    instancePath("instance/connect", instanceName),
    { timeoutMs: 15_000, maxBytes: 24 * 1024 },
  );
}

export async function parseEvolutionQrDataUrl(responseText: string): Promise<string | null> {
  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    return null;
  }

  const root = typeof payload === "object" && payload !== null
    ? payload as Record<string, unknown>
    : {};
  const nestedQr = typeof root.qrcode === "object" && root.qrcode !== null
    ? root.qrcode as Record<string, unknown>
    : {};
  const rawBase64 = typeof root.base64 === "string"
    ? root.base64
    : typeof nestedQr.base64 === "string"
      ? nestedQr.base64
      : "";
  const dataUrlMatch = rawBase64.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
  const base64 = dataUrlMatch?.[2] ?? rawBase64;
  if (base64.length <= 20_000 && /^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return `data:image/${dataUrlMatch?.[1] ?? "png"};base64,${base64}`;
  }

  // Evolution may return the pairing QR contents in `code` without a
  // pre-rendered `base64` image. Render it transiently for the admin UI.
  const qrContents = typeof root.code === "string"
    ? root.code
    : typeof nestedQr.code === "string"
      ? nestedQr.code
      : "";
  if (
    qrContents.length === 0
    || qrContents.length > 2_048
    || /[\u0000-\u001f\u007f]/.test(qrContents)
  ) {
    return null;
  }

  try {
    const QRCode = await import("qrcode");
    const generated = await QRCode.default.toDataURL(qrContents, { margin: 2, width: 256 });
    return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(generated)
      ? generated
      : null;
  } catch {
    return null;
  }
}

export function configureEvolutionWebhook(
  baseUrl: string,
  apiKey: string,
  instanceName: string,
  callbackUrl: string,
): Promise<EvolutionApiResponse> {
  // Evolution API v2.3.7 requires the webhook settings under a `webhook`
  // property. A flat body is rejected with HTTP 400 even when the instance
  // itself is connected.
  return evolutionApiRequest(
    baseUrl,
    apiKey,
    instancePath("webhook/set", instanceName),
    {
      method: "POST",
      body: {
        webhook: {
          enabled: true,
          url: callbackUrl,
          events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
          base64: false,
          byEvents: false,
        },
      },
      timeoutMs: 12_000,
    },
  );
}

export function sendEvolutionText(
  baseUrl: string,
  apiKey: string,
  instanceName: string,
  number: string,
  text: string,
): Promise<EvolutionApiResponse> {
  return evolutionApiRequest(
    baseUrl,
    apiKey,
    instancePath("message/sendText", instanceName),
    {
      method: "POST",
      // Evolution API v2.3.7 SendTextDto requires `text` at the root.
      body: { number, text },
      timeoutMs: 15_000,
      maxBytes: 64 * 1024,
    },
  );
}
