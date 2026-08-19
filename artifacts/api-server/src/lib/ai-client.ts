import OpenAI from "openai";
import { db, aiIntegrationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { decryptCredential } from "./crypto";
import { assertSafeUrl, isPrivateIp, ssrfSafeFetch } from "./ssrf";
import { openai as managedClient } from "@workspace/integrations-openai-ai-server";

export type AIProvider = "openai" | "anthropic" | "gemini" | "custom";

// SSRF validation now lives in ./ssrf and is shared with the generic tenant
// integrations. Re-exported here because the AI integration route imports it
// from this module.
export { assertSafeUrl, isPrivateIp };

// Maps provider/network errors to short, non-sensitive messages. Avoids echoing
// raw response bodies from arbitrary endpoints back to the client or audit log.
export function sanitizeProviderError(err: unknown): string {
  const status = (err as { status?: number } | null)?.status;
  if (typeof status === "number") {
    if (status === 401 || status === 403)
      return `Credenciais inválidas ou sem permissão (HTTP ${status}).`;
    if (status === 404) return "Endpoint ou modelo não encontrado (HTTP 404).";
    if (status === 429) return "Limite de requisições excedido (HTTP 429).";
    if (status >= 500) return `O provedor retornou um erro (HTTP ${status}).`;
    return `Falha na requisição ao provedor (HTTP ${status}).`;
  }
  const name = (err as { name?: string } | null)?.name;
  if (name === "APIConnectionTimeoutError") return "Tempo de conexão esgotado.";
  if (name === "APIConnectionError")
    return "Não foi possível conectar ao provedor.";
  // Our own validation/SSRF messages are safe and short — surface them as-is.
  if (
    err instanceof Error &&
    err.message.length < 120 &&
    /(HTTPS|host|URL|permitido|resolver)/i.test(err.message)
  ) {
    return err.message;
  }
  return "Falha ao conectar ao provedor de IA.";
}

// Default OpenAI-compatible endpoint + a sensible default model per provider.
// Anthropic and Gemini both expose OpenAI-compatible REST endpoints, so a single
// OpenAI SDK code path serves every provider.
export const AI_PROVIDER_DEFAULTS: Record<
  AIProvider,
  { baseUrl: string; model: string; label: string }
> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o", label: "OpenAI" },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    model: "claude-3-5-sonnet-latest",
    label: "Anthropic",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
    label: "Google Gemini",
  },
  custom: { baseUrl: "", model: "", label: "Compatível (OpenAI API)" },
};

// Model used by the platform-managed proxy fallback.
const MANAGED_MODEL = "gpt-5.4";

export interface ResolvedAIClient {
  client: OpenAI;
  model: string;
  source: "tenant" | "managed";
  provider: AIProvider;
}

export function normalizeProvider(p: string | null | undefined): AIProvider {
  if (p === "openai" || p === "anthropic" || p === "gemini" || p === "custom") return p;
  return "openai";
}

export function resolveBaseUrl(
  provider: AIProvider,
  baseUrl: string | null | undefined,
): string | undefined {
  const trimmed = (baseUrl ?? "").trim();
  if (trimmed) return trimmed;
  const def = AI_PROVIDER_DEFAULTS[provider].baseUrl;
  return def || undefined;
}

export function resolveModel(provider: AIProvider, model: string | null | undefined): string {
  const trimmed = (model ?? "").trim();
  if (trimmed) return trimmed;
  return AI_PROVIDER_DEFAULTS[provider].model || "gpt-4o";
}

export interface BuildClientOpts {
  provider: AIProvider;
  apiKey: string;
  baseUrl?: string | null;
  model?: string | null;
  timeout?: number;
  maxRetries?: number;
}

// Builds an OpenAI-compatible client from explicit config. Used both by the
// per-tenant resolver and the Test Connection flow (which tests credentials
// before they are persisted).
export function buildClientFromConfig(opts: BuildClientOpts): ResolvedAIClient {
  const baseURL = resolveBaseUrl(opts.provider, opts.baseUrl);
  // Central guard for every call site (test endpoint included): a compatible
  // ("custom") provider has no default endpoint. Without a base URL the OpenAI
  // SDK silently targets OpenAI's API and would send the tenant's key to the
  // wrong provider, so refuse to build the client.
  if (opts.provider === "custom" && !baseURL) {
    throw new Error("Informe a Base URL para um provedor compatível (OpenAI API).");
  }
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL,
    fetch: ssrfSafeFetch,
    ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
  });
  return {
    client,
    model: resolveModel(opts.provider, opts.model),
    source: "tenant",
    provider: opts.provider,
  };
}

// Resolves the AI client for a tenant: the per-tenant configured provider when
// it is enabled and has a stored key, otherwise the platform-managed proxy.
export async function getAIClientForTenant(tenantId: string): Promise<ResolvedAIClient> {
  if (tenantId) {
    const [cfg] = await db
      .select()
      .from(aiIntegrationsTable)
      .where(eq(aiIntegrationsTable.tenantId, tenantId))
      .limit(1);
    if (cfg && cfg.enabled && cfg.apiKeyEncrypted) {
      try {
        const apiKey = decryptCredential(cfg.apiKeyEncrypted);
        const provider = normalizeProvider(cfg.provider);
        // A custom provider with no base URL would let the SDK default to
        // OpenAI's endpoint and send the tenant's key to the wrong provider —
        // fall through to the managed proxy instead of leaking the key.
        if (provider !== "custom" || resolveBaseUrl(provider, cfg.baseUrl)) {
          return buildClientFromConfig({
            provider,
            apiKey,
            baseUrl: cfg.baseUrl,
            model: cfg.defaultModel,
          });
        }
      } catch {
        // Decryption failed (e.g. rotated key) — fall back to managed proxy.
      }
    }
  }
  return { client: managedClient as unknown as OpenAI, model: MANAGED_MODEL, source: "managed", provider: "openai" };
}
