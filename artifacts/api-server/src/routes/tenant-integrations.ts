import { Router, type NextFunction } from "express";
import { logger } from "../lib/logger";
import { db, tenantIntegrationsTable, tenantIntegrationLogsTable } from "@workspace/db";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, ADMIN_ROLES } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import type { AuthedUser } from "../lib/tenant";
import { generateId } from "../lib/id";
import { encryptCredential, decryptCredential } from "../lib/crypto";
import { assertSafeUrl, ssrfSafeFetchBounded } from "../lib/ssrf";
import {
  importZernioInstagramHistoryChunk,
  INSTAGRAM_ZERNIO_TYPE,
} from "../services/instagram-zernio.js";

const router = Router();

// Sentinel the frontend echoes back when the user did not change a secret field.
const MASK = "••••••••";

// ─── Crypto helpers ───────────────────────────────────────────────────────────

function encryptSecrets(secrets: Record<string, string>): string {
  return encryptCredential(JSON.stringify(secrets));
}

function decryptSecrets(encrypted: string): Record<string, string> {
  const plain = decryptCredential(encrypted);
  const parsed: unknown = JSON.parse(plain);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("invalid secrets blob");
  }
  return parsed as Record<string, string>;
}

function maskSecret(value: string): string {
  if (value.length <= 4) return MASK;
  return `${MASK}${value.slice(-4)}`;
}

// ─── External-error sanitiser ─────────────────────────────────────────────────
// Never echo raw provider responses, Authorization values, or error stacks.

function sanitizeExternalError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === "AbortError" || name === "TimeoutError") return "Tempo de conexão esgotado.";
  if (
    err instanceof Error &&
    err.message.length < 120 &&
    /(HTTPS|URL|permitido|resolver|inválid|host)/i.test(err.message)
  ) {
    return err.message;
  }
  return "Falha ao conectar ao serviço externo.";
}

function resolvePublicWebhookBaseUrl(): string | null {
  const firstReplitDomain = (process.env["REPLIT_DOMAINS"] ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .find(Boolean);
  const candidates = [
    process.env["API_BASE_URL"],
    ...(process.env["NODE_ENV"] === "development" ? [process.env["REPLIT_DEV_DOMAIN"]] : []),
    firstReplitDomain,
    process.env["FRONTEND_URL"],
    ...(process.env["NODE_ENV"] !== "development" ? [process.env["REPLIT_DEV_DOMAIN"]] : []),
  ];

  for (const rawCandidate of candidates) {
    const candidate = rawCandidate?.trim();
    if (!candidate) continue;
    try {
      const normalized = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)
        ? candidate
        : `https://${candidate}`;
      const url = new URL(normalized);
      if (
        url.protocol !== "https:"
        || !url.hostname
        || url.username
        || url.password
        || url.search
        || url.hash
        || url.hostname === "localhost"
        || url.hostname.endsWith(".localhost")
      ) {
        continue;
      }
      const basePath = url.pathname.replace(/\/+$/, "").replace(/\/api$/i, "");
      return `${url.origin}${basePath}`;
    } catch {
      // Try the next trusted environment-provided public origin.
    }
  }
  return null;
}

async function configureEvolutionInboundWebhook(
  config: Record<string, string>,
  apiKey: string,
): Promise<{ ok: boolean; message: string }> {
  const instanceName = config["instanceName"]?.trim();
  const baseUrl = config["baseUrl"]?.trim();
  const publicBaseUrl = resolvePublicWebhookBaseUrl();
  if (!instanceName || !baseUrl || !publicBaseUrl) {
    return {
      ok: false,
      message: "Não foi possível determinar a URL pública para receber mensagens. Configure API_BASE_URL ou FRONTEND_URL.",
    };
  }

  const callbackUrl = `${publicBaseUrl}/api/webhooks/whatsapp/evolution/${encodeURIComponent(instanceName)}`;
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/webhook/set/${encodeURIComponent(instanceName)}`;
  try {
    const result = await ssrfSafeFetchBounded(endpoint, {
      method: "POST",
      headers: {
        apikey: apiKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: callbackUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE"],
          headers: { apikey: apiKey },
        },
      }),
      timeoutMs: 12000,
      maxBytes: 16 * 1024,
    });
    if (!result.ok) {
      return {
        ok: false,
        message: `A Evolution recusou a configuração do webhook de recebimento (HTTP ${result.status}).`,
      };
    }
    return { ok: true, message: "Webhook de recebimento do WhatsApp configurado." };
  } catch (err) {
    return { ok: false, message: sanitizeExternalError(err) };
  }
}

// ─── Audit log ────────────────────────────────────────────────────────────────

async function writeLog(
  me: AuthedUser,
  type: string,
  event: string,
  level: "info" | "warn" | "error",
  message: string,
): Promise<void> {
  try {
    await db.insert(tenantIntegrationLogsTable).values({
      id: generateId(),
      tenantId: me.tenantId,
      type,
      event,
      level,
      message,
      actorId: me.id,
      actorName: me.name,
    });
  } catch (err) {
    logger.error({ err }, "[tenant-integrations] failed to write audit log");
  }
}

// ─── Auth guard ───────────────────────────────────────────────────────────────

async function requireIntegrationAdmin(
  req: import("express").Request,
  res: import("express").Response,
  next: import("express").NextFunction,
): Promise<AuthedUser | null> {
  const me = await requireAuth(req, res);
  if (!me) return null;
  if (!ADMIN_ROLES.includes(me.role) || !me.tenantId) {
    next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
    return null;
  }
  return me;
}

async function promoteConnectedEvolutionDefault(
  tenantId: string,
  integrationId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(tenantIntegrationsTable)
      .set({ isDefault: false })
      .where(and(
        eq(tenantIntegrationsTable.tenantId, tenantId),
        eq(tenantIntegrationsTable.type, "whatsapp_evolution"),
        eq(tenantIntegrationsTable.isDefault, true),
      ));
    const [promoted] = await tx.update(tenantIntegrationsTable)
      .set({ isDefault: true })
      .where(and(
        eq(tenantIntegrationsTable.tenantId, tenantId),
        eq(tenantIntegrationsTable.type, "whatsapp_evolution"),
        eq(tenantIntegrationsTable.id, integrationId),
        eq(tenantIntegrationsTable.enabled, true),
        eq(tenantIntegrationsTable.status, "connected"),
      ))
      .returning({ id: tenantIntegrationsTable.id });
    if (!promoted) throw new Error("evolution_default_requires_connected_integration");
  });
}

// ─── Registry ─────────────────────────────────────────────────────────────────
// Each entry declares the fields (config = non-secret, secrets = encrypted),
// which config fields need SSRF validation, and how to test the connection.
// The generic route handlers are driven entirely by this registry — no logic
// is duplicated per integration type.

interface FieldDef {
  key: string;
  label: string;
  description?: string;
  secret: boolean;
  ssrfCheck?: boolean; // must pass assertSafeUrl before being stored
  optional?: boolean;
}

interface TestResult {
  ok: boolean;
  message: string;
}

interface RegistryEntry {
  label: string;
  fields: FieldDef[];
  testConnection: (
    config: Record<string, string>,
    secrets: Record<string, string>,
  ) => Promise<TestResult>;
}

const REGISTRY: Record<string, RegistryEntry> = {
  // ── Reference tourism distribution adapter ─────────────────────────────────
  // This adapter never calls a real supplier. It exists to validate the
  // normalized distribution contract before a tenant adds commercial credentials.
  distribution_reference: {
    label: "Distribuição turística (referência)",
    fields: [
      {
        key: "rateLimitPerMinute",
        label: "Limite de operações por minuto",
        secret: false,
        optional: true,
      },
    ],
    async testConnection(config) {
      const rate = config.rateLimitPerMinute?.trim();
      if (rate && (!/^\d+$/.test(rate) || Number(rate) < 1 || Number(rate) > 120)) {
        return { ok: false, message: "O limite deve ser um número entre 1 e 120." };
      }
      return {
        ok: true,
        message: "Adaptador de referência pronto para o ambiente de teste. Nenhuma API externa será chamada.",
      };
    },
  },

  // ── WhatsApp via Evolution API ──────────────────────────────────────────────
  whatsapp_evolution: {
    label: "WhatsApp (Evolution API)",
    fields: [
      { key: "baseUrl", label: "URL Base", secret: false, ssrfCheck: true },
      { key: "instanceName", label: "Nome da Instância", secret: false },
      { key: "apiKey", label: "API Key", secret: true },
    ],
    async testConnection(config, secrets) {
      const baseUrl = config.baseUrl?.trim();
      const instanceName = config.instanceName?.trim();
      const apiKey = secrets.apiKey?.trim();

      if (!baseUrl || !instanceName || !apiKey) {
        return {
          ok: false,
          message: "Informe a URL Base, Nome da Instância e API Key.",
        };
      }

      // Re-validate the URL at test time (mirrors PUT guard, and re-checks at
      // the connect layer via ssrfSafeFetchBounded's SSRF dispatcher).
      try {
        await assertSafeUrl(baseUrl);
      } catch (err) {
        return {
          ok: false,
          message: err instanceof Error ? err.message : "URL Base inválida.",
        };
      }

      // Path-encode instanceName so any slash or special character cannot escape
      // the intended URL segment.
      const encodedInstance = encodeURIComponent(instanceName);
      const testUrl = `${baseUrl.replace(/\/$/, "")}/instance/connectionState/${encodedInstance}`;

      try {
        const result = await ssrfSafeFetchBounded(testUrl, {
          headers: { apikey: apiKey },
          timeoutMs: 12000,
          maxBytes: 16 * 1024,
        });

        if (result.ok) {
          return { ok: true, message: "Instância WhatsApp conectada." };
        }
        if (result.status === 401 || result.status === 403) {
          return {
            ok: false,
            message: `API Key inválida ou sem permissão (HTTP ${result.status}).`,
          };
        }
        if (result.status === 404) {
          return {
            ok: false,
            message: "Instância não encontrada (HTTP 404). Verifique o Nome da Instância.",
          };
        }
        return { ok: false, message: `Falha na conexão (HTTP ${result.status}).` };
      } catch (err) {
        return { ok: false, message: sanitizeExternalError(err) };
      }
    },
  },

  // ── Stripe (agency's own account) ──────────────────────────────────────────
  // Calls the Stripe API on a fixed host — no SSRF risk.
  // publishableKey (pk_…) goes to config (non-secret — safe to embed in frontend).
  // secretKey + webhookSecret are encrypted secrets.
  stripe_account: {
    label: "Stripe (conta da agência)",
    fields: [
      { key: "publishableKey", label: "Chave Publicável (pk_…)", secret: false, optional: true },
      { key: "secretKey", label: "Chave Secreta (sk_…)", secret: true },
      {
        key: "webhookSecret",
        label: "Webhook Secret (whsec_…)",
        secret: true,
        optional: true,
      },
    ],
    async testConnection(_config, secrets) {
      const secretKey = secrets.secretKey?.trim();
      if (!secretKey) {
        return { ok: false, message: "Informe a Chave Secreta do Stripe." };
      }

      try {
        const res = await fetch("https://api.stripe.com/v1/balance", {
          headers: { Authorization: `Bearer ${secretKey}` },
          signal: AbortSignal.timeout(12000),
        });

        if (res.ok) return { ok: true, message: "Conta Stripe autenticada com sucesso." };
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            message: `Chave inválida ou sem permissão (HTTP ${res.status}).`,
          };
        }
        return { ok: false, message: `Falha na conexão com o Stripe (HTTP ${res.status}).` };
      } catch (err) {
        const name = (err as { name?: string } | null)?.name;
        if (name === "AbortError" || name === "TimeoutError") {
          return { ok: false, message: "Tempo de conexão esgotado." };
        }
        return { ok: false, message: "Não foi possível conectar ao Stripe." };
      }
    },
  },

  // ── MercadoPago ─────────────────────────────────────────────────────────────
  // Fixed host (api.mercadopago.com) — no SSRF risk.
  // publicKey (APP_USR-…) is non-secret (safe to embed in frontend JS).
  // accessToken is a secret and is stored encrypted.
  mercadopago: {
    label: "MercadoPago",
    fields: [
      { key: "publicKey", label: "Public Key (APP_USR-…)", secret: false, optional: true },
      { key: "accessToken", label: "Access Token", secret: true },
    ],
    async testConnection(_config, secrets) {
      const accessToken = secrets.accessToken?.trim();
      if (!accessToken) {
        return { ok: false, message: "Informe o Access Token do MercadoPago." };
      }

      try {
        const res = await fetch("https://api.mercadopago.com/v1/payment_methods", {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(12000),
        });

        if (res.ok) {
          return { ok: true, message: "Conta MercadoPago autenticada com sucesso." };
        }
        if (res.status === 401) {
          return {
            ok: false,
            message: "Access Token inválido ou expirado (HTTP 401).",
          };
        }
        if (res.status === 403) {
          return {
            ok: false,
            message: "Access Token sem permissão para acessar a API (HTTP 403).",
          };
        }
        return { ok: false, message: `Falha na conexão com MercadoPago (HTTP ${res.status}).` };
      } catch (err) {
        const name = (err as { name?: string } | null)?.name;
        if (name === "AbortError" || name === "TimeoutError") {
          return { ok: false, message: "Tempo de conexão esgotado." };
        }
        return { ok: false, message: "Não foi possível conectar ao MercadoPago." };
      }
    },
  },

  // ── Google Analytics ────────────────────────────────────────────────────────
  // Real GA Data API calls require OAuth / service-account token exchange which
  // is impractical in a lightweight ping. We do structural / format validation
  // so the admin knows immediately if the credentials are malformed.
  google_analytics: {
    label: "Google Analytics",
    fields: [
      { key: "measurementId", label: "Measurement ID (G-XXXXXX)", secret: false, optional: true },
      { key: "propertyId", label: "Property ID (numérico)", secret: false, optional: true },
      {
        key: "serviceAccountJson",
        label: "Credenciais da Conta de Serviço (JSON)",
        secret: true,
        optional: true,
      },
    ],
    async testConnection(config, secrets) {
      const measurementId = config.measurementId?.trim();
      const propertyId = config.propertyId?.trim();
      const saJson = secrets.serviceAccountJson?.trim();

      if (!measurementId && !propertyId && !saJson) {
        return { ok: false, message: "Informe ao menos um campo para validar." };
      }

      if (measurementId && !/^G-[A-Z0-9]{6,12}$/i.test(measurementId)) {
        return {
          ok: false,
          message: "Measurement ID inválido. Use o formato G-XXXXXXXXXX.",
        };
      }
      if (propertyId && !/^\d+$/.test(propertyId)) {
        return { ok: false, message: "Property ID deve ser numérico." };
      }
      if (saJson) {
        try {
          const parsed: unknown = JSON.parse(saJson);
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed) ||
            (parsed as { type?: unknown }).type !== "service_account"
          ) {
            return {
              ok: false,
              message:
                'JSON de Conta de Serviço inválido (campo "type" deve ser "service_account").',
            };
          }
        } catch {
          return { ok: false, message: "JSON de Conta de Serviço inválido (não é um JSON válido)." };
        }
      }

      return { ok: true, message: "Configuração do Google Analytics válida." };
    },
  },

  instagram_zernio: {
    label: "Instagram Direct (Zernio)",
    fields: [
      {
        key: "accountId",
        label: "Account ID da Zernio",
        description: "ID exato recebido em account.accountId no evento do webhook; não use o @ do Instagram.",
        secret: false,
      },
      {
        key: "profileId",
        label: "Profile ID da Zernio",
        description: "ID exato recebido em account.profileId. Necessário para associar eventos ao perfil correto.",
        secret: false,
      },
      {
        key: "apiKey",
        label: "Chave de API da Zernio",
        description: "Necessária para enviar respostas do CRM. A chave precisa ter permissão para mensagens (messages).",
        secret: true,
        optional: true,
      },
    ],
    async testConnection(config) {
      const accountId = config.accountId?.trim();
      const profileId = config.profileId?.trim();
      if (!accountId || !profileId) {
        return {
          ok: false,
          message: "Informe o Account ID e o Profile ID da conta Zernio.",
        };
      }
      return {
        ok: true,
        message: "Mapeamento da conta e do perfil Zernio validado.",
      };
    },
  },
};

const ALLOWED_TYPES = Object.keys(REGISTRY);

// ─── GET /integrations (list) ────────────────────────────────────────────────
// Returns the status of every known integration type for the tenant.
// Never returns secrets.

router.get("/integrations", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireIntegrationAdmin(req, res, next);
    if (!me) return;

    const rows = await db
      .select({
        id: tenantIntegrationsTable.id,
        type: tenantIntegrationsTable.type,
        name: tenantIntegrationsTable.name,
        config: tenantIntegrationsTable.config,
        status: tenantIntegrationsTable.status,
        enabled: tenantIntegrationsTable.enabled,
        isDefault: tenantIntegrationsTable.isDefault,
        createdAt: tenantIntegrationsTable.createdAt,
      })
      .from(tenantIntegrationsTable)
      .where(eq(tenantIntegrationsTable.tenantId, me.tenantId));

    const rowsByType = new Map<string, typeof rows>();
    for (const row of rows) {
      rowsByType.set(row.type, [...(rowsByType.get(row.type) ?? []), row]);
    }

    res.json(
      ALLOWED_TYPES.map((type) => {
        const typeRows = rowsByType.get(type) ?? [];
        const selected = typeRows.find((row) => row.isDefault) ?? typeRows[0];
        return {
          type,
          label: REGISTRY[type]!.label,
          status: selected?.status ?? "disconnected",
          enabled: type === "whatsapp_evolution"
            ? typeRows.some((row) => row.enabled)
            : selected?.enabled ?? false,
          ...(type === "whatsapp_evolution" ? {
            connections: typeRows.map((row) => {
              const config = (row.config ?? {}) as Record<string, string>;
              return {
                id: row.id,
                name: row.name ?? "",
                instanceName: config.instanceName ?? "",
                isDefault: row.isDefault,
                status: row.status,
                enabled: row.enabled,
              };
            }),
          } : {}),
        };
      }),
    );
  } catch (err) {
    next(err);
  }
});

// ─── GET /integrations/whatsapp_evolution/connections ─────────────────────────
// Lists connection labels only; encrypted credentials are never returned.

router.get("/integrations/whatsapp_evolution/connections", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireIntegrationAdmin(req, res, next);
    if (!me) return;
    const rows = await db.select({
      id: tenantIntegrationsTable.id,
      name: tenantIntegrationsTable.name,
      config: tenantIntegrationsTable.config,
      enabled: tenantIntegrationsTable.enabled,
      status: tenantIntegrationsTable.status,
      isDefault: tenantIntegrationsTable.isDefault,
      createdAt: tenantIntegrationsTable.createdAt,
    }).from(tenantIntegrationsTable)
      .where(and(
        eq(tenantIntegrationsTable.tenantId, me.tenantId),
        eq(tenantIntegrationsTable.type, "whatsapp_evolution"),
      ))
      .orderBy(desc(tenantIntegrationsTable.isDefault), asc(tenantIntegrationsTable.createdAt));
    res.json(rows.map((row) => {
      const config = (row.config ?? {}) as Record<string, string>;
      return {
        id: row.id,
        name: row.name ?? "",
        instanceName: config.instanceName ?? "",
        enabled: row.enabled,
        status: row.status,
        isDefault: row.isDefault,
      };
    }));
  } catch (err) {
    next(err);
  }
});

// Refreshes only provider-confirmed Evolution connection states. Network errors,
// auth failures, malformed payloads, and transitional states leave stored flags
// untouched so a temporary outage cannot remove a usable default.
router.post("/integrations/whatsapp_evolution/connections/refresh", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireIntegrationAdmin(req, res, next);
    if (!me) return;

    const rows = await db.select({
      id: tenantIntegrationsTable.id,
      config: tenantIntegrationsTable.config,
      secretsEncrypted: tenantIntegrationsTable.secretsEncrypted,
      enabled: tenantIntegrationsTable.enabled,
      status: tenantIntegrationsTable.status,
      isDefault: tenantIntegrationsTable.isDefault,
    }).from(tenantIntegrationsTable)
      .where(and(
        eq(tenantIntegrationsTable.tenantId, me.tenantId),
        eq(tenantIntegrationsTable.type, "whatsapp_evolution"),
      ));

    let unverified = 0;
    let disconnectedDefaults = 0;
    await Promise.all(rows.filter((row) => row.enabled || row.isDefault).map(async (row) => {
      try {
        const config = (row.config ?? {}) as Record<string, string>;
        const baseUrl = config.baseUrl?.trim();
        const instanceName = config.instanceName?.trim();
        if (!baseUrl || !instanceName || !row.secretsEncrypted) {
          unverified += 1;
          return;
        }
        const secrets = decryptSecrets(row.secretsEncrypted);
        const apiKey = secrets.apiKey?.trim();
        if (!apiKey) {
          unverified += 1;
          return;
        }
        await assertSafeUrl(baseUrl);
        const result = await ssrfSafeFetchBounded(
          `${baseUrl.replace(/\/+$/, "")}/instance/connectionState/${encodeURIComponent(instanceName)}`,
          { headers: { apikey: apiKey }, timeoutMs: 8000, maxBytes: 16 * 1024 },
        );

        let nextStatus: "connected" | "disconnected" | null = result.status === 404
          ? "disconnected"
          : null;
        if (result.ok) {
          try {
            const payload: unknown = JSON.parse(result.text);
            const root = typeof payload === "object" && payload !== null
              ? payload as Record<string, unknown>
              : {};
            const instance = typeof root.instance === "object" && root.instance !== null
              ? root.instance as Record<string, unknown>
              : {};
            const state = String(instance.state ?? root.state ?? root.connectionState ?? "").toLowerCase();
            if (state === "open" || state === "connected") nextStatus = "connected";
            else if (state === "close" || state === "closed" || state === "disconnected") {
              nextStatus = "disconnected";
            }
          } catch {
            // A 200 response without a recognized state is not proof of disconnection.
          }
        }
        if (!nextStatus) {
          unverified += 1;
          return;
        }

        const updated = await db.update(tenantIntegrationsTable)
          .set({
            status: nextStatus,
            lastSyncAt: new Date(),
            lastError: nextStatus === "connected" ? null : "A Evolution confirmou que esta instância está desconectada.",
            ...(nextStatus === "disconnected" ? { isDefault: false } : {}),
          })
          .where(and(
            eq(tenantIntegrationsTable.id, row.id),
            eq(tenantIntegrationsTable.tenantId, me.tenantId),
            eq(tenantIntegrationsTable.type, "whatsapp_evolution"),
            eq(tenantIntegrationsTable.enabled, row.enabled),
            eq(tenantIntegrationsTable.status, row.status),
            eq(tenantIntegrationsTable.isDefault, row.isDefault),
            eq(tenantIntegrationsTable.config, row.config),
            eq(tenantIntegrationsTable.secretsEncrypted, row.secretsEncrypted),
          ))
          .returning({ id: tenantIntegrationsTable.id });
        if (updated.length === 0) {
          unverified += 1;
          return;
        }
        if (nextStatus === "disconnected" && row.isDefault && updated.length > 0) {
          disconnectedDefaults += 1;
        }
      } catch {
        unverified += 1;
      }
    }));

    res.json({ ok: true, unverified, disconnectedDefaults });
  } catch (err) {
    next(err);
  }
});

// ─── GET /integrations/:type ──────────────────────────────────────────────────
// Returns the current config with all secret fields masked. Never returns
// plaintext secrets.

router.get("/integrations/:type", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const { type } = req.params;
    if (!ALLOWED_TYPES.includes(type)) {
      next(new NotFoundError("Integração não encontrada.", "NOT_FOUND"));
      return;
    }
    const entry = REGISTRY[type]!;

    const me = await requireIntegrationAdmin(req, res, next);
    if (!me) return;

    const integrationId = typeof req.query["integrationId"] === "string"
      ? req.query["integrationId"]
      : null;
    const [row] = integrationId
      ? await db.select().from(tenantIntegrationsTable)
        .where(and(
          eq(tenantIntegrationsTable.tenantId, me.tenantId),
          eq(tenantIntegrationsTable.type, type),
          eq(tenantIntegrationsTable.id, integrationId),
        ))
        .limit(1)
      : await db.select().from(tenantIntegrationsTable)
        .where(and(
          eq(tenantIntegrationsTable.tenantId, me.tenantId),
          eq(tenantIntegrationsTable.type, type),
        ))
        .orderBy(desc(tenantIntegrationsTable.isDefault), asc(tenantIntegrationsTable.createdAt))
        .limit(1);
    if (integrationId && !row) {
      next(new NotFoundError("Integração não encontrada.", "NOT_FOUND"));
      return;
    }

    // Decrypt and mask each secret field.
    const maskedSecrets: Record<string, string | null> = {};
    const secretFields = entry.fields.filter((f) => f.secret);
    if (row?.secretsEncrypted) {
      try {
        const secrets = decryptSecrets(row.secretsEncrypted);
        for (const f of secretFields) {
          const v = secrets[f.key];
          maskedSecrets[f.key] = v ? maskSecret(v) : null;
        }
      } catch {
        for (const f of secretFields) maskedSecrets[f.key] = null;
      }
    } else {
      for (const f of secretFields) maskedSecrets[f.key] = null;
    }

    res.json({
      type,
      integrationId: row?.id ?? null,
      label: entry.label,
      name: row?.name ?? "",
      config: (row?.config as Record<string, string>) ?? {},
      maskedSecrets,
      environment: row?.environment ?? "production",
      enabled: row?.enabled ?? false,
      isDefault: row?.isDefault ?? false,
      status: row?.status ?? "disconnected",
      lastError: row?.lastError ?? null,
      lastSyncAt: row?.lastSyncAt ? row.lastSyncAt.toISOString() : null,
      fieldDefs: entry.fields.map((f) => ({
        key: f.key,
        label: f.label,
        ...(f.description ? { description: f.description } : {}),
        secret: f.secret,
        optional: f.optional ?? false,
      })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/integrations/instagram_zernio/import-history", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireIntegrationAdmin(req, res, next);
    if (!me) return;
    const body = z.object({
      integrationId: z.string().min(1).max(200),
      cursor: z.string().max(80_000).nullable().optional(),
    }).safeParse(req.body);
    if (!body.success) {
      next(new ValidationError("Selecione uma integração Zernio válida.", "VALIDATION_ERROR"));
      return;
    }
    const [integration] = await db.select().from(tenantIntegrationsTable)
      .where(and(
        eq(tenantIntegrationsTable.id, body.data.integrationId),
        eq(tenantIntegrationsTable.tenantId, me.tenantId),
        eq(tenantIntegrationsTable.type, INSTAGRAM_ZERNIO_TYPE),
        eq(tenantIntegrationsTable.enabled, true),
        eq(tenantIntegrationsTable.status, "connected"),
      ))
      .limit(1);
    if (!integration) {
      next(new NotFoundError("Integração Zernio ativa não encontrada.", "NOT_FOUND"));
      return;
    }
    const config = (integration.config ?? {}) as Record<string, string>;
    const accountId = config["accountId"]?.trim();
    const profileId = config["profileId"]?.trim();
    const apiKey = integration.secretsEncrypted
      ? decryptSecrets(integration.secretsEncrypted)["apiKey"]?.trim()
      : null;
    if (!accountId || !profileId || !apiKey) {
      next(new ValidationError("Configure Account ID, Profile ID e chave de API antes de importar.", "VALIDATION_ERROR"));
      return;
    }
    let resumeCursor: unknown;
    if (body.data.cursor) {
      try {
        const checkpoint: unknown = JSON.parse(decryptCredential(body.data.cursor));
        if (
          typeof checkpoint !== "object" ||
          checkpoint === null ||
          !("cursor" in checkpoint) ||
          !("integrationId" in checkpoint) ||
          !("accountId" in checkpoint) ||
          checkpoint.integrationId !== integration.id ||
          checkpoint.accountId !== accountId
        ) {
          throw new Error("invalid checkpoint");
        }
        resumeCursor = checkpoint.cursor;
      } catch {
        next(new ValidationError("O ponto de retomada da importação é inválido. Inicie novamente.", "VALIDATION_ERROR"));
        return;
      }
    }
    try {
      const result = await importZernioInstagramHistoryChunk(
        apiKey,
        accountId,
        profileId,
        integration.id,
        resumeCursor,
      );
      if (result.done) {
        await writeLog(
          me,
          INSTAGRAM_ZERNIO_TYPE,
          "history_import",
          "info",
          `Histórico importado: ${result.progress.conversationsProcessed} conversas, ${result.progress.messagesImported} mensagens novas, ${result.progress.messagesAlreadyPresent} já existentes e ${result.progress.messagesSkipped} não importadas.`,
        );
      }
      res.json({
        done: result.done,
        progress: result.progress,
        cursor: result.cursor
          ? encryptCredential(JSON.stringify({
              integrationId: integration.id,
              accountId,
              cursor: result.cursor,
            }))
          : null,
      });
    } catch {
      await writeLog(
        me,
        INSTAGRAM_ZERNIO_TYPE,
        "history_import",
        "error",
        "Falha ao importar o histórico da Zernio; os itens já importados podem ser mantidos. Tente novamente.",
      );
      res.status(502).json({
        message: "Não foi possível concluir esta etapa. O progresso salvo foi preservado; tente continuar a importação.",
        cursor: body.data.cursor ?? null,
      });
    }
  } catch (err) {
    next(err);
  }
});

// ─── PUT /integrations/:type ──────────────────────────────────────────────────
// Save config + credentials. Secrets sent as MASK are kept as-is. After save,
// auto-tests server-side and persists status (connected / error). Only Save
// ever mutates the stored status; the transient /test endpoint never does.

const putSchema = z.object({
  integrationId: z.string().min(1).max(200).optional(),
  createNew: z.boolean().optional(),
  name: z.string().optional(),
  config: z.record(z.string(), z.string()).optional(),
  secrets: z.record(z.string(), z.string()).optional(),
  environment: z.enum(["production", "test"]).optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

router.put("/integrations/:type", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const { type } = req.params;
    if (!ALLOWED_TYPES.includes(type)) {
      next(new NotFoundError("Integração não encontrada.", "NOT_FOUND"));
      return;
    }
    const entry = REGISTRY[type]!;

    const me = await requireIntegrationAdmin(req, res, next);
    if (!me) return;

    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError("Dados inválidos.", "VALIDATION_ERROR"));
      return;
    }
    const body = parsed.data;
    if (
      type !== "whatsapp_evolution"
      && (body.integrationId || body.createNew !== undefined || body.isDefault !== undefined)
    ) {
      next(new ValidationError("Essas opções só estão disponíveis para conexões WhatsApp.", "VALIDATION_ERROR"));
      return;
    }

    // SSRF-check any config fields marked ssrfCheck before storing them.
    const incomingConfig = body.config ?? {};
    for (const f of entry.fields) {
      if (!f.secret && f.ssrfCheck) {
        const v = incomingConfig[f.key]?.trim();
        if (v) {
          try {
            await assertSafeUrl(v);
          } catch (urlErr) {
            next(new ValidationError("URL inválida.", "VALIDATION_ERROR"));
            return;
          }
        }
      }
    }

    // Load the existing row to carry over secrets that were not re-submitted.
    const [firstConnection] = await db
      .select()
      .from(tenantIntegrationsTable)
      .where(
        and(
          eq(tenantIntegrationsTable.tenantId, me.tenantId),
          eq(tenantIntegrationsTable.type, type),
        ),
      )
      .orderBy(desc(tenantIntegrationsTable.isDefault), asc(tenantIntegrationsTable.createdAt))
      .limit(1);
    let existing: typeof firstConnection | undefined = firstConnection;
    if (body.integrationId) {
      const [selected] = await db.select().from(tenantIntegrationsTable)
        .where(and(
          eq(tenantIntegrationsTable.tenantId, me.tenantId),
          eq(tenantIntegrationsTable.type, type),
          eq(tenantIntegrationsTable.id, body.integrationId),
        ))
        .limit(1);
      if (!selected) {
        next(new NotFoundError("Integração não encontrada.", "NOT_FOUND"));
        return;
      }
      existing = selected;
    } else if (body.createNew) {
      existing = undefined;
    }

    // Resolve final secrets: incoming non-mask values replace stored ones;
    // masked / absent values carry over from storage.
    let existingSecrets: Record<string, string> = {};
    if (existing?.secretsEncrypted) {
      try {
        existingSecrets = decryptSecrets(existing.secretsEncrypted);
      } catch {
        // Decryption failure — start fresh; admin must re-enter secrets.
      }
    }

    const incomingSecrets = body.secrets ?? {};
    const secretFields = entry.fields.filter((f) => f.secret);
    let secretsChanged = false;
    const resolvedSecrets: Record<string, string> = { ...existingSecrets };
    for (const f of secretFields) {
      const v = (incomingSecrets[f.key] ?? "").trim();
      const isNew = v.length > 0 && !v.startsWith(MASK);
      if (isNew) {
        resolvedSecrets[f.key] = v;
        secretsChanged = true;
      }
    }

    const hasSecrets = secretFields.some((f) => !!resolvedSecrets[f.key]);
    const newSecretsEncrypted = hasSecrets ? encryptSecrets(resolvedSecrets) : null;

    const enabled = body.enabled ?? existing?.enabled ?? false;
    const environment = body.environment ?? existing?.environment ?? "production";
    const name = body.name ?? existing?.name ?? null;
    const requestedIsDefault = type === "whatsapp_evolution"
      ? body.isDefault ?? (enabled ? existing?.isDefault ?? !firstConnection : false)
      : false;
    if (type === "whatsapp_evolution" && requestedIsDefault && !enabled) {
      next(new ValidationError("Ative e conecte a integração antes de defini-la como padrão.", "VALIDATION_ERROR"));
      return;
    }
    if (type === "distribution_reference" && enabled && environment !== "test") {
      next(new ValidationError(
        "O adaptador de referência só pode ser ativado no ambiente de teste.",
        "REFERENCE_ADAPTER_TEST_ONLY",
      ));
      return;
    }

    // Merge non-secret config fields with existing config.
    const configFields = entry.fields.filter((f) => !f.secret);
    const existingConfig = (existing?.config as Record<string, string>) ?? {};
    const resolvedConfig: Record<string, string> = { ...existingConfig };
    for (const f of configFields) {
      const v = incomingConfig[f.key]?.trim();
      if (v !== undefined) resolvedConfig[f.key] = v;
    }
    if (type === "whatsapp_evolution" && !resolvedConfig["instanceName"]?.trim()) {
      next(new ValidationError("Informe o nome da instância Evolution.", "VALIDATION_ERROR"));
      return;
    }

    // Reset status when credentials, config, or environment change so the stored
    // status always reflects what is actually stored.
    const configChanged =
      JSON.stringify(resolvedConfig) !== JSON.stringify(existingConfig) ||
      environment !== (existing?.environment ?? "production");
    const resetStatus = !existing || secretsChanged || configChanged || !enabled;
    const status = resetStatus ? "disconnected" : existing?.status ?? "disconnected";
    let isDefault = type === "whatsapp_evolution"
      && body.isDefault === undefined
      && !!existing?.isDefault
      && enabled
      && status === "connected";
    const integrationId = existing?.id ?? generateId();

    const savedValues = {
      name,
      config: resolvedConfig,
      secretsEncrypted: newSecretsEncrypted,
      environment,
      enabled,
      isDefault,
      status,
      ...(resetStatus ? { lastError: null } : {}),
    };
    if (existing) {
      await db.update(tenantIntegrationsTable)
        .set(savedValues)
        .where(and(
          eq(tenantIntegrationsTable.tenantId, me.tenantId),
          eq(tenantIntegrationsTable.type, type),
          eq(tenantIntegrationsTable.id, integrationId),
        ));
    } else {
      await db.insert(tenantIntegrationsTable).values({
        id: integrationId,
        tenantId: me.tenantId,
        type,
        ...savedValues,
      });
    }

    await writeLog(
      me,
      type,
      "save",
      "info",
      `Configuração salva (${entry.label}, ativo: ${enabled ? "sim" : "não"}${secretsChanged ? ", credenciais atualizadas" : ""}).`,
    );

    let webhookSetup: { ok: boolean; message: string } | undefined;

    // Auto-verify the saved config so the persisted status always reflects the
    // stored credentials. Never auto-test disabled integrations (stale status).
    if (
      enabled &&
      (newSecretsEncrypted || secretFields.length === 0 || type === INSTAGRAM_ZERNIO_TYPE)
    ) {
      try {
        const secrets = newSecretsEncrypted ? decryptSecrets(newSecretsEncrypted) : {};
        const testResult = await entry.testConnection(resolvedConfig, secrets);
        if (testResult.ok) {
          await db
            .update(tenantIntegrationsTable)
            .set({ status: "connected", lastSyncAt: new Date(), lastError: null })
            .where(
              and(
                eq(tenantIntegrationsTable.tenantId, me.tenantId),
                eq(tenantIntegrationsTable.id, integrationId),
              ),
            );
          await writeLog(me, type, "test", "info", `Conexão verificada após salvar: ${testResult.message}`);
          if (type === "whatsapp_evolution" && requestedIsDefault) {
            try {
              await promoteConnectedEvolutionDefault(me.tenantId, integrationId);
              isDefault = true;
            } catch {
              isDefault = false;
              await writeLog(
                me,
                type,
                "default_selection",
                "warn",
                "O número não foi definido como padrão porque não está mais ativo e conectado.",
              );
            }
          }
        } else {
          if (type === "whatsapp_evolution") isDefault = false;
          await db
            .update(tenantIntegrationsTable)
            .set({
              status: "error",
              lastError: testResult.message,
              ...(type === "whatsapp_evolution" ? { isDefault: false } : {}),
            })
            .where(
              and(
                eq(tenantIntegrationsTable.tenantId, me.tenantId),
                eq(tenantIntegrationsTable.id, integrationId),
              ),
            );
          await writeLog(me, type, "test", "error", `Falha ao verificar após salvar: ${testResult.message}`);
        }

        if (type === "whatsapp_evolution") {
          webhookSetup = testResult.ok
            ? await configureEvolutionInboundWebhook(resolvedConfig, secrets["apiKey"] ?? "")
            : {
                ok: false,
                message: "O webhook de recebimento não foi configurado porque o teste da conexão Evolution falhou.",
              };
          await writeLog(
            me,
            type,
            "webhook_setup",
            webhookSetup.ok ? "info" : "warn",
            webhookSetup.message,
          );
        }
      } catch (testErr) {
        const msg = sanitizeExternalError(testErr);
        if (type === "whatsapp_evolution") isDefault = false;
        await db
          .update(tenantIntegrationsTable)
          .set({
            status: "error",
            lastError: msg,
            ...(type === "whatsapp_evolution" ? { isDefault: false } : {}),
          })
          .where(
            and(
              eq(tenantIntegrationsTable.tenantId, me.tenantId),
              eq(tenantIntegrationsTable.id, integrationId),
            ),
          );
        await writeLog(me, type, "test", "error", `Falha ao verificar após salvar: ${msg}`);
        if (type === "whatsapp_evolution") {
          webhookSetup = {
            ok: false,
            message: "O webhook de recebimento não foi configurado porque o teste da conexão Evolution falhou.",
          };
          await writeLog(me, type, "webhook_setup", "warn", webhookSetup.message);
        }
      }
    } else if (enabled && type === "whatsapp_evolution") {
      webhookSetup = {
        ok: false,
        message: "O webhook de recebimento não foi configurado porque as credenciais não puderam ser verificadas.",
      };
      await writeLog(me, type, "webhook_setup", "warn", webhookSetup.message);
    }

    res.json({
      ok: true,
      integrationId,
      isDefault,
      ...(type === "whatsapp_evolution" && requestedIsDefault && !isDefault
        ? { message: "O número só pode ser padrão depois de uma verificação bem-sucedida." }
        : {}),
      ...(webhookSetup ? { webhook: webhookSetup } : {}),
    });
  } catch (err) {
    next(err);
  }
});

// ─── POST /integrations/:type/test ───────────────────────────────────────────
// Transient connectivity probe — tests the values in the request (which may
// differ from what is stored) and NEVER persists status. Only an audit log
// entry is written. This lets the admin validate credentials before saving.

const testSchema = z.object({
  integrationId: z.string().min(1).max(200).optional(),
  config: z.record(z.string(), z.string()).optional(),
  secrets: z.record(z.string(), z.string()).optional(),
});

router.post("/integrations/:type/test", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const { type } = req.params;
    if (!ALLOWED_TYPES.includes(type)) {
      next(new NotFoundError("Integração não encontrada.", "NOT_FOUND"));
      return;
    }
    const entry = REGISTRY[type]!;

    const me = await requireIntegrationAdmin(req, res, next);
    if (!me) return;

    const parsed = testSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError("error", "VALIDATION_ERROR"));
      return;
    }

    // Load existing row to resolve secrets not re-submitted (MASK sentinel).
    const [existing] = parsed.data.integrationId
      ? await db.select().from(tenantIntegrationsTable)
        .where(and(
          eq(tenantIntegrationsTable.tenantId, me.tenantId),
          eq(tenantIntegrationsTable.type, type),
          eq(tenantIntegrationsTable.id, parsed.data.integrationId),
        ))
        .limit(1)
      : await db.select().from(tenantIntegrationsTable)
        .where(and(
          eq(tenantIntegrationsTable.tenantId, me.tenantId),
          eq(tenantIntegrationsTable.type, type),
        ))
        .orderBy(desc(tenantIntegrationsTable.isDefault), asc(tenantIntegrationsTable.createdAt))
        .limit(1);
    if (parsed.data.integrationId && !existing) {
      next(new NotFoundError("Integração não encontrada.", "NOT_FOUND"));
      return;
    }

    let existingSecrets: Record<string, string> = {};
    if (existing?.secretsEncrypted) {
      try {
        existingSecrets = decryptSecrets(existing.secretsEncrypted);
      } catch {
        // ignore decryption errors here — the admin will supply fresh values
      }
    }

    const incomingSecrets = parsed.data.secrets ?? {};
    const secretFields = entry.fields.filter((f) => f.secret);
    const resolvedSecrets: Record<string, string> = {};
    for (const f of secretFields) {
      const v = (incomingSecrets[f.key] ?? "").trim();
      const useSaved = v.length === 0 || v.startsWith(MASK);
      if (useSaved) {
        if (!existingSecrets[f.key]) {
          res.json({
            ok: false,
            status: "error",
            message: `Informe ${f.label} para testar a conexão.`,
          });
          return;
        }
        resolvedSecrets[f.key] = existingSecrets[f.key]!;
      } else {
        resolvedSecrets[f.key] = v;
      }
    }

    // Merge config: incoming overrides existing.
    const incomingConfig = parsed.data.config ?? {};
    const existingConfig = (existing?.config as Record<string, string>) ?? {};
    const configFields = entry.fields.filter((f) => !f.secret);
    const resolvedConfig: Record<string, string> = { ...existingConfig };
    for (const f of configFields) {
      const v = incomingConfig[f.key]?.trim();
      if (v !== undefined) resolvedConfig[f.key] = v;
    }

    let testResult: TestResult;
    try {
      testResult = await entry.testConnection(resolvedConfig, resolvedSecrets);
    } catch (testErr) {
      testResult = { ok: false, message: sanitizeExternalError(testErr) };
    }

    await writeLog(
      me,
      type,
      "test",
      testResult.ok ? "info" : "error",
      testResult.ok
        ? `Teste de conexão bem-sucedido: ${testResult.message}`
        : `Falha no teste de conexão: ${testResult.message}`,
    );

    res.json({ ok: testResult.ok, status: testResult.ok ? "connected" : "error", message: testResult.message });
  } catch (err) {
    next(err);
  }
});

// ─── POST /integrations/:type/revoke ─────────────────────────────────────────
// Irrevocably clears the stored secrets and marks the integration as
// disconnected. The admin must re-enter credentials to reconnect.

router.post("/integrations/:type/revoke", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const { type } = req.params;
    if (!ALLOWED_TYPES.includes(type)) {
      next(new NotFoundError("Integração não encontrada.", "NOT_FOUND"));
      return;
    }
    const entry = REGISTRY[type]!;

    const me = await requireIntegrationAdmin(req, res, next);
    if (!me) return;

    const parsed = z.object({ integrationId: z.string().min(1).max(200).optional() })
      .safeParse(req.body ?? {});
    if (!parsed.success) {
      next(new ValidationError("Dados inválidos.", "VALIDATION_ERROR"));
      return;
    }
    const integrationId = parsed.data.integrationId;
    const rowConditions = [
      eq(tenantIntegrationsTable.tenantId, me.tenantId),
      eq(tenantIntegrationsTable.type, type),
      ...(integrationId
        ? [eq(tenantIntegrationsTable.id, integrationId)]
        : type === "whatsapp_evolution" ? [eq(tenantIntegrationsTable.isDefault, true)] : []),
    ];

    await db
      .update(tenantIntegrationsTable)
      .set({
        secretsEncrypted: null,
        enabled: false,
        status: "disconnected",
        lastError: null,
        ...(type === "whatsapp_evolution" ? { isDefault: false } : {}),
      })
      .where(and(...rowConditions));

    await writeLog(
      me,
      type,
      "revoke",
      "warn",
      `Credenciais revogadas e integração desativada (${entry.label}).`,
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── GET /integrations/:type/logs ────────────────────────────────────────────

router.get("/integrations/:type/logs", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const { type } = req.params;
    if (!ALLOWED_TYPES.includes(type)) {
      next(new NotFoundError("Integração não encontrada.", "NOT_FOUND"));
      return;
    }

    const me = await requireIntegrationAdmin(req, res, next);
    if (!me) return;

    const rows = await db
      .select()
      .from(tenantIntegrationLogsTable)
      .where(
        and(
          eq(tenantIntegrationLogsTable.tenantId, me.tenantId),
          eq(tenantIntegrationLogsTable.type, type),
        ),
      )
      .orderBy(desc(tenantIntegrationLogsTable.createdAt))
      .limit(50);

    res.json(
      rows.map((r) => ({
        id: r.id,
        event: r.event,
        level: r.level,
        message: r.message,
        actorName: r.actorName,
        createdAt: r.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
