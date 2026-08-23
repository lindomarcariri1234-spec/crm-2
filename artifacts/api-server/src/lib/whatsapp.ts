import { logger } from "./logger";
import { db, tenantIntegrationsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { decryptCredential } from "./crypto";
import { ssrfSafeFetchBounded } from "./ssrf";
import { normalizeBrazilPhone } from "@workspace/shared";

export interface WhatsAppSendResult {
  success: boolean;
  error?: string;
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
    return { success: false, error: "credentials_not_configured" };
  }

  const e164 = normalizeBrazilPhone(phone);
  if (!e164) {
    logger.warn({ phone }, "[whatsapp] Invalid Brazilian phone number — skipping send");
    return { success: false, error: "invalid_phone" };
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
      return { success: false, error: `zapi_${resp.status}` };
    }

    logger.info({ phone: e164 }, "[whatsapp] Message sent");
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ phone: e164, err: msg }, "[whatsapp] Network error");
    return { success: false, error: msg };
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
          return { success: false, error: "invalid_phone" };
        }
        const encodedInstance = encodeURIComponent(instanceName);
        const url = `${baseUrl.replace(/\/$/, "")}/message/sendText/${encodedInstance}`;

        // Use ssrfSafeFetchBounded to enforce HTTPS, block private/reserved IP
        // ranges at connect time (defeating DNS rebinding), and refuse redirects.
        // This mirrors the protections applied by the save/test endpoints and
        // prevents a malicious tenant from using DNS rebinding to turn normal
        // WhatsApp sends into blind SSRF probes against internal services.
        const result = await ssrfSafeFetchBounded(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: apiKey },
          body: JSON.stringify({ number: e164, text: message }),
          timeoutMs: 15_000,
        });

        if (result.ok) {
          logger.info({ phone: e164, tenantId }, "[whatsapp] Message sent via Evolution API");
          return { success: true };
        }

        logger.warn({ phone: e164, tenantId, status: result.status }, "[whatsapp] Evolution API error");
        return { success: false, error: `evolution_${result.status}` };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ phone, tenantId, err: msg }, "[whatsapp] Evolution API send failed, falling back");
    }
  }

  // Fall back to global Z-API credentials
  return sendWhatsAppMessage(phone, message);
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
