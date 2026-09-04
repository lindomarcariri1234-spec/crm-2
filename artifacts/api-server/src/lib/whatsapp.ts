import { logger } from "./logger";
import { db, tenantIntegrationsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { decryptCredential } from "./crypto";
import { ssrfSafeFetchBounded } from "./ssrf";
import { normalizeBrazilPhone } from "@workspace/shared";

export interface WhatsAppSendResult {
  success: boolean;
  error?: string;
  provider?: "evolution" | "z-api";
  externalId?: string;
  /** The provider may have accepted the message even though the response was lost. */
  outcome?: "unknown";
}

export type WhatsAppReconciliationOutcome = "accepted" | "not_found" | "unsupported" | "inconclusive";

export interface WhatsAppReconciliationResult {
  outcome: WhatsAppReconciliationOutcome;
  provider: "evolution" | "z-api" | "whatsapp";
  externalId: string;
  providerStatus?: string;
  detail?: string;
}

/**
 * Sends a text message via Z-API.
 *
 * Returns gracefully (success: false) when credentials are absent so the
 * caller can decide whether to log or silently skip.
 */
export async function sendWhatsAppMessage(
  phone: string,
  message: string,
): Promise<WhatsAppSendResult> {
  const instanceId = process.env["ZAPI_INSTANCE_ID"];
  const token = process.env["ZAPI_TOKEN"];

  if (!instanceId || !token) {
    logger.debug("[whatsapp] Credentials not configured — skipping send");
    return { success: false, error: "credentials_not_configured", provider: "z-api" };
  }

  const e164 = normalizeBrazilPhone(phone);
  if (!e164) {
    logger.warn({ phone }, "[whatsapp] Invalid Brazilian phone number — skipping send");
    return { success: false, error: "invalid_phone", provider: "z-api" };
  }
  const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: e164, message }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      logger.warn({ phone: e164, status: resp.status, body }, "[whatsapp] Z-API error");
      return { success: false, error: `zapi_${resp.status}`, provider: "z-api" };
    }

    const parsedBody = await resp.json().catch(() => ({}));
    const responseBody = parsedBody && typeof parsedBody === "object"
      ? parsedBody as Record<string, unknown>
      : {};
    const externalId = typeof responseBody.messageId === "string"
      ? responseBody.messageId
      : typeof responseBody.id === "string" ? responseBody.id : undefined;
    logger.info({ phone: e164 }, "[whatsapp] Message sent");
    return { success: true, provider: "z-api", externalId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ phone: e164, err: msg }, "[whatsapp] Network error");
    // Z-API's send-text endpoint does not document a native idempotency key.
    // A timeout therefore cannot be retried safely: the provider may have
    // accepted the message before the response was lost.
    return { success: false, error: msg, provider: "z-api", outcome: "unknown" };
  }
}

/**
 * Sends a WhatsApp message using the tenant's configured Evolution API
 * integration when available (connected + enabled). Falls back to the global
 * Z-API credentials otherwise.
 */
export async function sendTenantWhatsAppMessage(
  tenantId: string,
  phone: string,
  message: string,
): Promise<WhatsAppSendResult> {
  // Look up tenant's Evolution API integration
  const [integration] = await db
    .select()
    .from(tenantIntegrationsTable)
    .where(
      and(
        eq(tenantIntegrationsTable.tenantId, tenantId),
        eq(tenantIntegrationsTable.type, "whatsapp_evolution"),
      ),
    )
    .limit(1);

  if (integration?.enabled && integration.status === "connected" && integration.secretsEncrypted) {
    try {
      const secrets = JSON.parse(
        decryptCredential(integration.secretsEncrypted),
      ) as Record<string, string>;
      const config = (integration.config as Record<string, string>) ?? {};
      const baseUrl = config.baseUrl?.trim();
      const instanceName = config.instanceName?.trim();
      const apiKey = secrets.apiKey?.trim();

      if (baseUrl && instanceName && apiKey) {
        const e164 = normalizeBrazilPhone(phone);
        if (!e164) {
          logger.warn({ phone, tenantId }, "[whatsapp] Invalid Brazilian phone number — skipping Evolution send");
          return { success: false, error: "invalid_phone", provider: "evolution" };
        }
        const encodedInstance = encodeURIComponent(instanceName);
        const url = `${baseUrl.replace(/\/$/, "")}/message/sendText/${encodedInstance}`;

        // Use ssrfSafeFetchBounded to enforce HTTPS, block private/reserved IP
        // ranges at connect time (defeating DNS rebinding), and refuse redirects.
        // This mirrors the protections applied by the save/test endpoints and
        // prevents a malicious tenant from using DNS rebinding to turn normal
        // WhatsApp sends into blind SSRF probes against internal services.
        let result;
        try {
          result = await ssrfSafeFetchBounded(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: apiKey },
            body: JSON.stringify({ number: e164, text: message }),
            timeoutMs: 15_000,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn({ phone: e164, tenantId, err: msg }, "[whatsapp] Evolution API network error");
          // Evolution's sendText endpoint does not document a native
          // idempotency key. Do not fall back to Z-API after the request may
          // already have reached Evolution.
          return { success: false, error: msg, provider: "evolution", outcome: "unknown" };
        }

        if (result.ok) {
          // A successful HTTP response is an accepted provider outcome even if
          // the response body is empty or not JSON; never send through another
          // provider merely because an external ID was not returned.
          let responseBody: Record<string, unknown> = {};
          if (result.text) {
            try {
              const parsedBody = JSON.parse(result.text);
              if (parsedBody && typeof parsedBody === "object") {
                responseBody = parsedBody as Record<string, unknown>;
              }
            } catch {
              logger.warn({ phone: e164, tenantId }, "[whatsapp] Evolution API returned a non-JSON success response");
            }
          }
          const key = responseBody.key as Record<string, unknown> | undefined;
          const externalId = typeof key?.id === "string"
            ? key.id
            : typeof responseBody.messageId === "string" ? responseBody.messageId : undefined;
          logger.info({ phone: e164, tenantId }, "[whatsapp] Message sent via Evolution API");
          return { success: true, provider: "evolution", externalId };
        }

        logger.warn({ phone: e164, tenantId, status: result.status }, "[whatsapp] Evolution API error");
        return { success: false, error: `evolution_${result.status}`, provider: "evolution" };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ phone, tenantId, err: msg }, "[whatsapp] Evolution API configuration unavailable, falling back");
    }
  }

  // Fall back to global Z-API credentials
  return sendWhatsAppMessage(phone, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractEvolutionRecords(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (!isRecord(body)) return [];
  const messages = body.messages;
  if (Array.isArray(messages)) return messages;
  if (isRecord(messages) && Array.isArray(messages.records)) return messages.records;
  if (Array.isArray(body.records)) return body.records;
  return [];
}

function recordExternalId(record: unknown): string | null {
  if (!isRecord(record)) return null;
  if (typeof record.id === "string") return record.id;
  if (typeof record.messageId === "string") return record.messageId;
  if (isRecord(record.key) && typeof record.key.id === "string") return record.key.id;
  return null;
}

/**
 * Checks whether a WhatsApp provider can confirm the result of a previously
 * ambiguous send. This function never sends a message and deliberately treats
 * provider errors as inconclusive rather than as proof that the message was
 * not accepted.
 */
export async function reconcileTenantWhatsAppMessage(
  tenantId: string,
  provider: string,
  externalId: string,
  phone: string | null,
): Promise<WhatsAppReconciliationResult> {
  const normalizedExternalId = externalId.trim();
  if (!normalizedExternalId) {
    return {
      outcome: "inconclusive",
      provider: provider === "evolution" || provider === "z-api" ? provider : "whatsapp",
      externalId: normalizedExternalId,
      detail: "external_id_missing",
    };
  }

  if (provider === "z-api") {
    // Z-API documents delivery webhooks but not a message-history/status
    // lookup. Its API also states that messages are not stored for querying.
    return {
      outcome: "unsupported",
      provider: "z-api",
      externalId: normalizedExternalId,
      detail: "provider_status_lookup_unsupported",
    };
  }

  if (provider !== "evolution") {
    return {
      outcome: "unsupported",
      provider: "whatsapp",
      externalId: normalizedExternalId,
      detail: "provider_status_lookup_unsupported",
    };
  }

  const [integration] = await db
    .select()
    .from(tenantIntegrationsTable)
    .where(and(
      eq(tenantIntegrationsTable.tenantId, tenantId),
      eq(tenantIntegrationsTable.type, "whatsapp_evolution"),
    ))
    .limit(1);

  if (!integration?.enabled || integration.status !== "connected" || !integration.secretsEncrypted) {
    return {
      outcome: "inconclusive",
      provider: "evolution",
      externalId: normalizedExternalId,
      detail: "provider_credentials_unavailable",
    };
  }

  try {
    const secrets = JSON.parse(decryptCredential(integration.secretsEncrypted)) as Record<string, string>;
    const config = (integration.config as Record<string, string>) ?? {};
    const baseUrl = config.baseUrl?.trim();
    const instanceName = config.instanceName?.trim();
    const apiKey = secrets.apiKey?.trim();
    if (!baseUrl || !instanceName || !apiKey) {
      return {
        outcome: "inconclusive",
        provider: "evolution",
        externalId: normalizedExternalId,
        detail: "provider_configuration_incomplete",
      };
    }

    const normalizedPhone = phone ? normalizeBrazilPhone(phone) : null;
    const remoteJid = normalizedPhone ? `${normalizedPhone}@s.whatsapp.net` : undefined;
    const encodedInstance = encodeURIComponent(instanceName);
    const url = `${baseUrl.replace(/\/$/, "")}/chat/findMessages/${encodedInstance}`;
    const result = await ssrfSafeFetchBounded(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({
        where: {
          key: {
            id: normalizedExternalId,
            ...(remoteJid ? { remoteJid } : {}),
            fromMe: true,
          },
        },
        limit: 10,
      }),
      timeoutMs: 15_000,
    });

    if (!result.ok) {
      logger.warn({ tenantId, provider, status: result.status }, "[whatsapp] Evolution reconciliation failed");
      return {
        outcome: "inconclusive",
        provider: "evolution",
        externalId: normalizedExternalId,
        detail: `provider_http_${result.status}`,
      };
    }

    let body: unknown = {};
    try {
      body = result.text ? JSON.parse(result.text) : {};
    } catch {
      return {
        outcome: "inconclusive",
        provider: "evolution",
        externalId: normalizedExternalId,
        detail: "provider_invalid_response",
      };
    }

    const matchingRecord = extractEvolutionRecords(body).find((record) => recordExternalId(record) === normalizedExternalId);
    if (!matchingRecord) {
      return {
        outcome: "not_found",
        provider: "evolution",
        externalId: normalizedExternalId,
        detail: "provider_message_not_found",
      };
    }

    const status = isRecord(matchingRecord) && typeof matchingRecord.status === "string"
      ? matchingRecord.status
      : "message_found";
    return {
      outcome: "accepted",
      provider: "evolution",
      externalId: normalizedExternalId,
      providerStatus: status,
      detail: "provider_message_found",
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.warn({ tenantId, provider, err: detail }, "[whatsapp] Evolution reconciliation unavailable");
    return {
      outcome: "inconclusive",
      provider: "evolution",
      externalId: normalizedExternalId,
      detail: "provider_network_error",
    };
  }
}

/**
 * Replaces template variables in a message string.
 * Supports both single-brace ({nome}) and double-brace ({{nome}}) syntax.
 * Supported variables: nome, codigo, bonus, valor, agencia, link, saldo,
 *   viagem, data, referencia, saldo_restante, horario, local_saida
 */
export function interpolateWhatsAppMessage(
  template: string,
  vars: {
    nome?: string;
    codigo?: string;
    bonus?: string;
    valor?: string;
    agencia?: string;
    link?: string;
    saldo?: string;
    // Transactional notification variables
    viagem?: string;
    data?: string;
    referencia?: string;
    saldo_restante?: string;
    horario?: string;
    local_saida?: string;
  },
): string {
  const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const replace = (tpl: string, key: string, value: string) =>
    tpl
      .replace(new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, "g"), value)
      .replace(new RegExp(`\\{${escapeRegex(key)}\\}`, "g"), value);

  let result = template;
  result = replace(result, "nome", vars.nome ?? "");
  result = replace(result, "codigo", vars.codigo ?? "");
  result = replace(result, "bonus", vars.bonus ?? "");
  result = replace(result, "valor", vars.valor ?? "");
  result = replace(result, "agencia", vars.agencia ?? "");
  result = replace(result, "link", vars.link ?? "");
  result = replace(result, "saldo", vars.saldo ?? "");
  // Transactional variables
  result = replace(result, "viagem", vars.viagem ?? "");
  result = replace(result, "data", vars.data ?? "");
  result = replace(result, "referencia", vars.referencia ?? "");
  result = replace(result, "saldo_restante", vars.saldo_restante ?? "");
  result = replace(result, "horario", vars.horario ?? "");
  result = replace(result, "local_saida", vars.local_saida ?? "");
  return result;
}
