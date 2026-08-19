import { Router, type NextFunction } from "express";
import { logger } from "../lib/logger";
import { db, aiIntegrationsTable, aiIntegrationLogsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, ADMIN_ROLES } from "../lib/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../lib/errors";
import type { AuthedUser } from "../lib/tenant";
import { generateId } from "../lib/id";
import { encryptCredential, decryptCredential } from "../lib/crypto";
import {
  AI_PROVIDER_DEFAULTS,
  normalizeProvider,
  buildClientFromConfig,
  assertSafeUrl,
  sanitizeProviderError,
} from "../lib/ai-client";

const router = Router();

// Sentinel the frontend echoes back when the user did not change the key.
const MASK = "••••••••";

function maskKey(encrypted: string | null): string | null {
  if (!encrypted) return null;
  try {
    const plain = decryptCredential(encrypted);
    if (plain.length <= 4) return MASK;
    return `${MASK}${plain.slice(-4)}`;
  } catch {
    return MASK;
  }
}

async function writeLog(
  me: AuthedUser,
  event: string,
  level: "info" | "warn" | "error",
  message: string,
): Promise<void> {
  try {
    await db.insert(aiIntegrationLogsTable).values({
      id: generateId(),
      tenantId: me.tenantId,
      event,
      level,
      message,
      actorId: me.id,
      actorName: me.name,
    });
  } catch (err) {
    logger.error({ err }, "[ai-integration] failed to write audit log");
  }
}

// Admin/owner only, and must belong to a tenant (superadmins have no tenant).
async function requireAiAdmin(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): Promise<AuthedUser | null> {
  const me = await requireAuth(req, res);
  if (!me) return null;
  if (!ADMIN_ROLES.includes(me.role) || !me.tenantId) {
    next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
    return null;
  }
  return me;
}

// ─── GET /ai-integration ──────────────────────────────────────────────────────
router.get("/ai-integration", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAiAdmin(req, res, next);
    if (!me) return;

    const [cfg] = await db
      .select()
      .from(aiIntegrationsTable)
      .where(eq(aiIntegrationsTable.tenantId, me.tenantId))
      .limit(1);

    res.json({
      name: cfg?.name ?? "",
      provider: cfg?.provider ?? "openai",
      baseUrl: cfg?.baseUrl ?? "",
      defaultModel: cfg?.defaultModel ?? "",
      environment: cfg?.environment ?? "production",
      enabled: cfg?.enabled ?? false,
      status: cfg?.status ?? "disconnected",
      lastError: cfg?.lastError ?? null,
      lastSyncAt: cfg?.lastSyncAt ? cfg.lastSyncAt.toISOString() : null,
      hasApiKey: !!cfg?.apiKeyEncrypted,
      maskedApiKey: maskKey(cfg?.apiKeyEncrypted ?? null),
      hasAccessToken: !!cfg?.accessTokenEncrypted,
      maskedAccessToken: maskKey(cfg?.accessTokenEncrypted ?? null),
      providerDefaults: AI_PROVIDER_DEFAULTS,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /ai-integration/logs ─────────────────────────────────────────────────
router.get("/ai-integration/logs", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAiAdmin(req, res, next);
    if (!me) return;

    const rows = await db
      .select()
      .from(aiIntegrationLogsTable)
      .where(eq(aiIntegrationLogsTable.tenantId, me.tenantId))
      .orderBy(desc(aiIntegrationLogsTable.createdAt))
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

const putSchema = z.object({
  name: z.string().optional(),
  provider: z.enum(["openai", "anthropic", "gemini", "custom"]),
  apiKey: z.string().optional(),
  accessToken: z.string().optional(),
  baseUrl: z.string().optional(),
  defaultModel: z.string().optional(),
  environment: z.enum(["production", "test"]).optional(),
  enabled: z.boolean().optional(),
});

// ─── PUT /ai-integration ──────────────────────────────────────────────────────
router.put("/ai-integration", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAiAdmin(req, res, next);
    if (!me) return;

    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError("Dados inválidos", "VALIDATION_ERROR"));
      return;
    }
    const body = parsed.data;
    const provider = normalizeProvider(body.provider);

    const [existing] = await db
      .select()
      .from(aiIntegrationsTable)
      .where(eq(aiIntegrationsTable.tenantId, me.tenantId))
      .limit(1);

    // Decide the key to store: a freshly typed key, or the existing one.
    const incomingKey = (body.apiKey ?? "").trim();
    const keyChanged = incomingKey.length > 0 && !incomingKey.startsWith(MASK);
    const apiKeyEncrypted = keyChanged
      ? encryptCredential(incomingKey)
      : (existing?.apiKeyEncrypted ?? null);

    // Same pattern for the optional access token (used by some providers).
    const incomingToken = (body.accessToken ?? "").trim();
    const tokenChanged = incomingToken.length > 0 && !incomingToken.startsWith(MASK);
    const accessTokenEncrypted = tokenChanged
      ? encryptCredential(incomingToken)
      : (existing?.accessTokenEncrypted ?? null);

    const name = (body.name ?? "").trim() || existing?.name || null;
    const environment = body.environment ?? existing?.environment ?? "production";

    const enabled = body.enabled ?? existing?.enabled ?? false;

    // Cannot enable a per-tenant provider with no key to use.
    if (enabled && !apiKeyEncrypted) {
      next(new ValidationError("Informe uma chave de API para ativar a configuração de IA.", "VALIDATION_ERROR"));
      return;
    }

    const baseUrl = (body.baseUrl ?? "").trim() || null;
    const defaultModel = (body.defaultModel ?? "").trim() || null;

    // A compatible ("custom") provider has no default endpoint — without a base
    // URL the SDK would silently target OpenAI and send the key to the wrong
    // provider, so require it explicitly.
    if (provider === "custom" && !baseUrl) {
      next(new ValidationError("Informe a Base URL para um provedor compatível (OpenAI API).", "VALIDATION_ERROR"));
      return;
    }

    // Reject SSRF-prone base URLs (non-HTTPS or private/reserved hosts) early so
    // the admin gets a clear error instead of a failed connection later.
    if (baseUrl) {
      try {
        await assertSafeUrl(baseUrl);
      } catch (urlErr) {
        next(new ValidationError("URL do provedor inválida.", "VALIDATION_ERROR"));
        return;
      }
    }

    // Re-testing is required after any credential/endpoint change, and a
    // disabled config should never display a stale "connected/error" badge.
    const resetStatus =
      keyChanged ||
      tokenChanged ||
      !existing ||
      !enabled ||
      existing.provider !== provider ||
      (existing.baseUrl ?? null) !== baseUrl ||
      (existing.environment ?? "production") !== environment;
    const status = resetStatus ? "disconnected" : existing.status;

    if (existing) {
      await db
        .update(aiIntegrationsTable)
        .set({
          name,
          provider,
          apiKeyEncrypted,
          accessTokenEncrypted,
          baseUrl,
          defaultModel,
          environment,
          enabled,
          status,
          ...(resetStatus ? { lastError: null } : {}),
        })
        .where(eq(aiIntegrationsTable.tenantId, me.tenantId));
    } else {
      await db.insert(aiIntegrationsTable).values({
        id: generateId(),
        tenantId: me.tenantId,
        name,
        provider,
        apiKeyEncrypted,
        accessTokenEncrypted,
        baseUrl,
        defaultModel,
        environment,
        enabled,
        status,
      });
    }

    await writeLog(
      me,
      "save",
      "info",
      `Configuração salva (provedor: ${provider}, ativo: ${enabled ? "sim" : "não"}${keyChanged ? ", chave atualizada" : ""}${tokenChanged ? ", token atualizado" : ""}).`,
    );

    // Auto-verify the saved config server-side so the persisted connection
    // status always reflects what is stored. (Test Connection itself is a
    // transient probe that never writes status — only Save does, here.) A
    // provider outage marks status as error but never blocks the save.
    if (enabled && apiKeyEncrypted) {
      try {
        const apiKey = decryptCredential(apiKeyEncrypted);
        const { client } = buildClientFromConfig({
          provider,
          apiKey,
          baseUrl,
          model: defaultModel,
          timeout: 15000,
          maxRetries: 0,
        });
        await client.models.list();
        await db
          .update(aiIntegrationsTable)
          .set({ status: "connected", lastSyncAt: new Date(), lastError: null })
          .where(eq(aiIntegrationsTable.tenantId, me.tenantId));
        await writeLog(me, "test", "info", `Conexão verificada após salvar (provedor: ${provider}).`);
      } catch (testErr) {
        const message = sanitizeProviderError(testErr);
        await db
          .update(aiIntegrationsTable)
          .set({ status: "error", lastError: message })
          .where(eq(aiIntegrationsTable.tenantId, me.tenantId));
        await writeLog(
          me,
          "test",
          "error",
          `Falha ao verificar conexão após salvar (provedor: ${provider}): ${message}`,
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ─── POST /ai-integration/test ────────────────────────────────────────────────
// Tests connectivity using the values the admin currently has in the form —
// including unsaved key / base URL / model — so credentials can be validated
// before saving. The test is transient: it NEVER persists the connection
// status (only Save does, via its own server-side auto-test), so the stored
// status always reflects the saved configuration and can't diverge from an
// ad-hoc probe of unsaved values. A test is still recorded in the audit log.
const testSchema = z.object({
  provider: z.enum(["openai", "anthropic", "gemini", "custom"]),
  apiKey: z.string().optional(),
  accessToken: z.string().optional(),
  baseUrl: z.string().optional(),
  defaultModel: z.string().optional(),
});

router.post("/ai-integration/test", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAiAdmin(req, res, next);
    if (!me) return;

    const parsed = testSchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ValidationError("error", "VALIDATION_ERROR"));
      return;
    }
    const provider = normalizeProvider(parsed.data.provider);
    const baseUrl = (parsed.data.baseUrl ?? "").trim() || null;
    const defaultModel = (parsed.data.defaultModel ?? "").trim() || null;

    // Resolve the effective Bearer credential: freshly typed apiKey takes
    // priority; then saved apiKey; then accessToken (for OAuth-style custom
    // providers that authenticate with a Bearer token rather than an API key);
    // then saved accessToken.
    const incomingKey = (parsed.data.apiKey ?? "").trim();
    const incomingToken = (parsed.data.accessToken ?? "").trim();
    const useSavedKey = incomingKey.length === 0 || incomingKey.startsWith(MASK);
    const useSavedToken = incomingToken.length === 0 || incomingToken.startsWith(MASK);

    let apiKey: string;
    if (!useSavedKey) {
      // Freshly typed API key — use directly.
      apiKey = incomingKey;
    } else {
      // Load saved row to resolve stored credentials.
      const [existing] = await db
        .select()
        .from(aiIntegrationsTable)
        .where(eq(aiIntegrationsTable.tenantId, me.tenantId))
        .limit(1);

      let resolved = "";

      // Priority 1: saved API key.
      if (!resolved && existing?.apiKeyEncrypted) {
        try {
          resolved = decryptCredential(existing.apiKeyEncrypted);
        } catch {
          // ignore — key may be malformed; fall through
        }
      }

      // Priority 2: freshly typed access token (OAuth Bearer for custom providers).
      if (!resolved && !useSavedToken) {
        resolved = incomingToken;
      }

      // Priority 3: saved access token.
      if (!resolved && existing?.accessTokenEncrypted) {
        try {
          resolved = decryptCredential(existing.accessTokenEncrypted);
        } catch {
          // ignore
        }
      }

      if (!resolved) {
        next(new ValidationError("error", "VALIDATION_ERROR"));
        return;
      }
      apiKey = resolved;
    }

    // Reject SSRF-prone base URLs early (mirrors PUT) so the admin gets a clear
    // message instead of a generic connection failure. The SDK request is also
    // guarded at connection time via ssrfSafeFetch, so this is defense-in-depth
    // plus better UX, not the sole control.
    if (baseUrl) {
      try {
        await assertSafeUrl(baseUrl);
      } catch (urlErr) {
        const message = urlErr instanceof Error ? urlErr.message : "URL do provedor inválida.";
        await writeLog(me, "test", "error", `Falha no teste de conexão (provedor: ${provider}): ${message}`);
        next(new ValidationError("error", "VALIDATION_ERROR"));
        return;
      }
    }

    try {
      // buildClientFromConfig is inside the try so a misconfigured custom
      // provider (no Base URL) throws here instead of ever constructing a
      // client that targets OpenAI by default.
      const { client } = buildClientFromConfig({
        provider,
        apiKey,
        baseUrl,
        model: defaultModel,
        timeout: 15000,
        maxRetries: 0,
      });
      // models.list() is a cheap, provider-agnostic connectivity probe across
      // all OpenAI-compatible endpoints (OpenAI, Anthropic, Gemini).
      await client.models.list();
      await writeLog(me, "test", "info", `Conexão testada com sucesso (provedor: ${provider}).`);
      res.json({
        ok: true,
        status: "connected",
        message: "Conexão estabelecida com sucesso.",
      });
    } catch (apiErr) {
      const message = sanitizeProviderError(apiErr);
      await writeLog(me, "test", "error", `Falha no teste de conexão (provedor: ${provider}): ${message}`);
      res.json({ ok: false, status: "error", message });
    }
  } catch (err) {
    next(err);
  }
});

// ─── POST /ai-integration/revoke ──────────────────────────────────────────────
// Clears all stored credentials and marks the integration as disconnected.
// The admin must re-enter credentials to reconnect.
router.post("/ai-integration/revoke", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireAiAdmin(req, res, next);
    if (!me) return;

    await db
      .update(aiIntegrationsTable)
      .set({
        apiKeyEncrypted: null,
        accessTokenEncrypted: null,
        enabled: false,
        status: "disconnected",
        lastError: null,
      })
      .where(eq(aiIntegrationsTable.tenantId, me.tenantId));

    await writeLog(me, "revoke", "warn", "Credenciais de IA revogadas e integração desativada.");

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
