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

export function configureEvolutionWebhook(
  baseUrl: string,
  apiKey: string,
  instanceName: string,
  callbackUrl: string,
): Promise<EvolutionApiResponse> {
  // Evolution API's documented Set Webhook contract uses a flat body.
  return evolutionApiRequest(
    baseUrl,
    apiKey,
    instancePath("webhook/set", instanceName),
    {
      method: "POST",
      body: {
        enabled: true,
        url: callbackUrl,
        events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
        base64: false,
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
      body: { number, textMessage: { text } },
      timeoutMs: 15_000,
      maxBytes: 64 * 1024,
    },
  );
}
