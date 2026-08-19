import { Router, type NextFunction } from "express";
import { logger } from "../lib/logger";
import { db, tenantIntegrationsTable, tenantIntegrationLogsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, ADMIN_ROLES } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import type { AuthedUser } from "../lib/tenant";
import { generateId } from "../lib/id";
import { encryptCredential, decryptCredential } from "../lib/crypto";
import { assertSafeUrl, ssrfSafeFetchBounded } from "../lib/ssrf";

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

// ─── Registry ─────────────────────────────────────────────────────────────────
// Each entry declares the fields (config = non-secret, secrets = encrypted),
// which config fields need SSRF validation, and how to test the connection.
// The generic route handlers are driven entirely by this registry — no logic
// is duplicated per integration type.

interface FieldDef {
  key: string;
  label: string;
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
        type: tenantIntegrationsTable.type,
        status: tenantIntegrationsTable.status,
        enabled: tenantIntegrationsTable.enabled,
      })
      .from(tenantIntegrationsTable)
      .where(eq(tenantIntegrationsTable.tenantId, me.tenantId));

    const rowMap = new Map(rows.map((r) => [r.type, r]));

    res.json(
      ALLOWED_TYPES.map((type) => ({
        type,
        label: REGISTRY[type]!.label,
        status: rowMap.get(type)?.status ?? "disconnected",
        enabled: rowMap.get(type)?.enabled ?? false,
      })),
    );
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

    const [row] = await db
      .select()
      .from(tenantIntegrationsTable)
      .where(
        and(
          eq(tenantIntegrationsTable.tenantId, me.tenantId),
          eq(tenantIntegrationsTable.type, type),
        ),
      )
      .limit(1);

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
      label: entry.label,
      name: row?.name ?? "",
      config: (row?.config as Record<string, string>) ?? {},
      maskedSecrets,
      environment: row?.environment ?? "production",
      enabled: row?.enabled ?? false,
      status: row?.status ?? "disconnected",
      lastError: row?.lastError ?? null,
      lastSyncAt: row?.lastSyncAt ? row.lastSyncAt.toISOString() : null,
      fieldDefs: entry.fields.map((f) => ({
        key: f.key,
        label: f.label,
        secret: f.secret,
        optional: f.optional ?? false,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ─── PUT /integrations/:type ──────────────────────────────────────────────────
// Save config + credentials. Secrets sent as MASK are kept as-is. After save,
// auto-tests server-side and persists status (connected / error). Only Save
// ever mutates the stored status; the transient /test endpoint never does.

const putSchema = z.object({
  name: z.string().optional(),
  config: z.record(z.string(), z.string()).optional(),
  secrets: z.record(z.string(), z.string()).optional(),
  environment: z.enum(["production", "test"]).optional(),
  enabled: z.boolean().optional(),
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
    const [existing] = await db
      .select()
      .from(tenantIntegrationsTable)
      .where(
        and(
          eq(tenantIntegrationsTable.tenantId, me.tenantId),
          eq(tenantIntegrationsTable.type, type),
        ),
      )
      .limit(1);

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

    // Merge non-secret config fields with existing config.
    const configFields = entry.fields.filter((f) => !f.secret);
    const existingConfig = (existing?.config as Record<string, string>) ?? {};
    const resolvedConfig: Record<string, string> = { ...existingConfig };
    for (const f of configFields) {
      const v = incomingConfig[f.key]?.trim();
      if (v !== undefined) resolvedConfig[f.key] = v;
    }

    // Reset status when credentials, config, or environment change so the stored
    // status always reflects what is actually stored.
    const configChanged =
      JSON.stringify(resolvedConfig) !== JSON.stringify(existingConfig) ||
      environment !== (existing?.environment ?? "production");
    const resetStatus = !existing || secretsChanged || configChanged || !enabled;
    const status = resetStatus ? "disconnected" : existing.status;

    if (existing) {
      await db
        .update(tenantIntegrationsTable)
        .set({
          name,
          config: resolvedConfig,
          secretsEncrypted: newSecretsEncrypted,
          environment,
          enabled,
          status,
          ...(resetStatus ? { lastError: null } : {}),
        })
        .where(
          and(
            eq(tenantIntegrationsTable.tenantId, me.tenantId),
            eq(tenantIntegrationsTable.type, type),
          ),
        );
    } else {
      await db.insert(tenantIntegrationsTable).values({
        id: generateId(),
        tenantId: me.tenantId,
        type,
        name,
        config: resolvedConfig,
        secretsEncrypted: newSecretsEncrypted,
        environment,
        enabled,
        status,
      });
    }

    await writeLog(
      me,
      type,
      "save",
      "info",
      `Configuração salva (${entry.label}, ativo: ${enabled ? "sim" : "não"}${secretsChanged ? ", credenciais atualizadas" : ""}).`,
    );

    // Auto-verify the saved config so the persisted status always reflects the
    // stored credentials. Never auto-test disabled integrations (stale status).
    if (enabled && newSecretsEncrypted) {
      try {
        const secrets = decryptSecrets(newSecretsEncrypted);
        const testResult = await entry.testConnection(resolvedConfig, secrets);
        if (testResult.ok) {
          await db
            .update(tenantIntegrationsTable)
            .set({ status: "connected", lastSyncAt: new Date(), lastError: null })
            .where(
              and(
                eq(tenantIntegrationsTable.tenantId, me.tenantId),
                eq(tenantIntegrationsTable.type, type),
              ),
            );
          await writeLog(me, type, "test", "info", `Conexão verificada após salvar: ${testResult.message}`);
        } else {
          await db
            .update(tenantIntegrationsTable)
            .set({ status: "error", lastError: testResult.message })
            .where(
              and(
                eq(tenantIntegrationsTable.tenantId, me.tenantId),
                eq(tenantIntegrationsTable.type, type),
              ),
            );
          await writeLog(me, type, "test", "error", `Falha ao verificar após salvar: ${testResult.message}`);
        }
      } catch (testErr) {
        const msg = sanitizeExternalError(testErr);
        await db
          .update(tenantIntegrationsTable)
          .set({ status: "error", lastError: msg })
          .where(
            and(
              eq(tenantIntegrationsTable.tenantId, me.tenantId),
              eq(tenantIntegrationsTable.type, type),
            ),
          );
        await writeLog(me, type, "test", "error", `Falha ao verificar após salvar: ${msg}`);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /integrations/:type/test ───────────────────────────────────────────
// Transient connectivity probe — tests the values in the request (which may
// differ from what is stored) and NEVER persists status. Only an audit log
// entry is written. This lets the admin validate credentials before saving.

const testSchema = z.object({
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
    const [existing] = await db
      .select()
      .from(tenantIntegrationsTable)
      .where(
        and(
          eq(tenantIntegrationsTable.tenantId, me.tenantId),
          eq(tenantIntegrationsTable.type, type),
        ),
      )
      .limit(1);

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

    await db
      .update(tenantIntegrationsTable)
      .set({
        secretsEncrypted: null,
        enabled: false,
        status: "disconnected",
        lastError: null,
      })
      .where(
        and(
          eq(tenantIntegrationsTable.tenantId, me.tenantId),
          eq(tenantIntegrationsTable.type, type),
        ),
      );

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
