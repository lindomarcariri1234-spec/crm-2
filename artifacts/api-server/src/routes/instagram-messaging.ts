import { randomBytes } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import {
  db,
  instagramOAuthStatesTable,
  tenantIntegrationsTable,
  tenantIntegrationLogsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { ADMIN_ROLES, requireAuth, type AuthedUser } from "../lib/tenant";
import { ForbiddenError } from "../lib/errors";
import { encryptCredential } from "../lib/crypto";
import { generateId } from "../lib/id";
import { logger } from "../lib/logger";
import {
  createInstagramAuthorizationUrl,
  createInstagramDeletionConfirmationCode,
  deleteInstagramAccountData,
  disconnectInstagramAccountFromMeta,
  exchangeInstagramOAuthCode,
  getInstagramDataDeletionStatus,
  getInstagramMetaConfig,
  hashInstagramOAuthState,
  instagramOAuthStateTtlMs,
  INSTAGRAM_MESSAGING_TYPE,
  processInstagramWebhook,
  subscribeInstagramAccount,
  type InstagramOAuthResult,
  verifyInstagramSignedRequest,
  verifyInstagramWebhookSignature,
} from "../services/instagram-messaging";

const router = Router();

async function requireInstagramAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<AuthedUser | null> {
  const me = await requireAuth(req, res);
  if (!me) return null;
  if (!ADMIN_ROLES.includes(me.role) || !me.tenantId) {
    next(new ForbiddenError("Forbidden", "FORBIDDEN_ROLE"));
    return null;
  }
  return me;
}

function settingsRedirect(status: string): string | null {
  const base = getInstagramMetaConfig().settingsUrl;
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set("instagram", status);
  return url.toString();
}

function redirectFromOAuth(res: Response, status: string): void {
  const target = settingsRedirect(status);
  if (target) {
    res.redirect(303, target);
    return;
  }
  res.status(503).type("text/plain").send("Não foi possível retornar às configurações da agência.");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "23505";
}

async function writeIntegrationLog(
  me: { tenantId: string; id: string; name: string | null },
  event: "connect" | "disconnect" | "error",
  level: "info" | "warn",
  message: string,
): Promise<void> {
  try {
    await db.insert(tenantIntegrationLogsTable).values({
      id: generateId(),
      tenantId: me.tenantId,
      type: INSTAGRAM_MESSAGING_TYPE,
      event,
      level,
      message,
      actorId: me.id,
      actorName: me.name,
    });
  } catch {
    logger.warn({ tenantId: me.tenantId, event }, "[instagram] Integration audit log could not be recorded");
  }
}

async function savePendingInstagramConnection(
  tenantId: string,
  result: InstagramOAuthResult,
): Promise<string> {
  const now = new Date();
  const config = {
    instagramUserId: result.instagramUserId,
    username: result.username ?? "",
    tokenIssuedAt: result.tokenIssuedAt.toISOString(),
    tokenExpiresAt: result.tokenExpiresAt.toISOString(),
  };
  const secretsEncrypted = encryptCredential(JSON.stringify({ accessToken: result.accessToken }));

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`instagram-connect:${tenantId}`}, 0)
      )
    `);
    const [existing] = await tx.select().from(tenantIntegrationsTable)
      .where(and(
        eq(tenantIntegrationsTable.tenantId, tenantId),
        eq(tenantIntegrationsTable.type, INSTAGRAM_MESSAGING_TYPE),
      ))
      .limit(1);
    if (existing) {
      const [updated] = await tx.update(tenantIntegrationsTable)
        .set({
          name: result.username ? `Instagram @${result.username}` : "Instagram Direct",
          config,
          secretsEncrypted,
          enabled: false,
          status: "pending",
          lastError: null,
          lastSyncAt: now,
        })
        .where(and(
          eq(tenantIntegrationsTable.id, existing.id),
          eq(tenantIntegrationsTable.tenantId, tenantId),
        ))
        .returning({ id: tenantIntegrationsTable.id });
      if (!updated) throw new Error("Instagram connection update failed");
      return updated.id;
    }
    const id = generateId();
    await tx.insert(tenantIntegrationsTable).values({
      id,
      tenantId,
      type: INSTAGRAM_MESSAGING_TYPE,
      name: result.username ? `Instagram @${result.username}` : "Instagram Direct",
      config,
      secretsEncrypted,
      enabled: false,
      isDefault: false,
      status: "pending",
      lastSyncAt: now,
    });
    return id;
  });
}

async function completeInstagramConnection(
  tenantId: string,
  integrationId: string,
  connected: boolean,
): Promise<void> {
  await db.update(tenantIntegrationsTable)
    .set({
      enabled: connected,
      status: connected ? "connected" : "error",
      lastError: connected
        ? null
        : "Não foi possível ativar o webhook de mensagens da Meta. Reconecte a conta após revisar as permissões.",
      lastSyncAt: new Date(),
    })
    .where(and(
      eq(tenantIntegrationsTable.id, integrationId),
      eq(tenantIntegrationsTable.tenantId, tenantId),
    ));
}

router.get("/instagram-messaging/status", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireInstagramAdmin(req, res, next);
    if (!me) return;
    const [integration] = await db.select().from(tenantIntegrationsTable)
      .where(and(
        eq(tenantIntegrationsTable.tenantId, me.tenantId),
        eq(tenantIntegrationsTable.type, INSTAGRAM_MESSAGING_TYPE),
      ))
      .limit(1);
    const config = integration?.config && typeof integration.config === "object"
      ? integration.config as Record<string, unknown>
      : {};
    const meta = getInstagramMetaConfig();
    res.json({
      appConfigured: meta.appConfigured,
      connected: integration?.enabled === true && integration.status === "connected",
      status: integration?.status ?? (meta.appConfigured ? "disconnected" : "not_configured"),
      accountUsername: typeof config["username"] === "string" && config["username"]
        ? config["username"]
        : null,
      tokenExpiresAt: typeof config["tokenExpiresAt"] === "string" ? config["tokenExpiresAt"] : null,
      lastError: integration?.lastError ?? null,
      oauthRedirectUri: meta.redirectUri,
      webhookUrl: meta.webhookUrl,
      deauthorizationUrl: meta.deauthorizationUrl,
      dataDeletionUrl: meta.dataDeletionUrl,
      requiredPermissions: ["instagram_business_basic", "instagram_business_manage_messages"],
    });
  } catch (error) {
    next(error);
  }
});

router.get("/instagram-messaging/connect", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireInstagramAdmin(req, res, next);
    if (!me) return;
    const meta = getInstagramMetaConfig();
    if (!meta.appConfigured) {
      res.status(503).json({
        code: "INSTAGRAM_APP_NOT_CONFIGURED",
        error: "O app Meta do VisiteCRM ainda não está configurado para o Instagram Direct.",
      });
      return;
    }
    const state = randomBytes(32).toString("hex");
    const now = new Date();
    await db.delete(instagramOAuthStatesTable)
      .where(lt(instagramOAuthStatesTable.expiresAt, now));
    await db.insert(instagramOAuthStatesTable).values({
      stateHash: hashInstagramOAuthState(state),
      tenantId: me.tenantId,
      actorUserId: me.id,
      expiresAt: new Date(now.getTime() + instagramOAuthStateTtlMs),
    });
    const authorizationUrl = createInstagramAuthorizationUrl(meta, state);
    if (!authorizationUrl) {
      res.status(503).json({
        code: "INSTAGRAM_APP_NOT_CONFIGURED",
        error: "O app Meta do VisiteCRM ainda não está configurado para o Instagram Direct.",
      });
      return;
    }
    res.redirect(302, authorizationUrl);
  } catch (error) {
    next(error);
  }
});

router.get("/instagram-messaging/callback", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const state = typeof req.query["state"] === "string" ? req.query["state"] : "";
    if (!/^[a-f0-9]{64}$/i.test(state)) {
      redirectFromOAuth(res, "invalid_state");
      return;
    }
    const now = new Date();
    const [oauthState] = await db.update(instagramOAuthStatesTable)
      .set({ consumedAt: now })
      .where(and(
        eq(instagramOAuthStatesTable.stateHash, hashInstagramOAuthState(state)),
        isNull(instagramOAuthStatesTable.consumedAt),
        gt(instagramOAuthStatesTable.expiresAt, now),
      ))
      .returning({
        tenantId: instagramOAuthStatesTable.tenantId,
        actorUserId: instagramOAuthStatesTable.actorUserId,
      });
    if (!oauthState) {
      redirectFromOAuth(res, "invalid_state");
      return;
    }
    const [actor] = await db.select({
      id: usersTable.id,
      tenantId: usersTable.tenantId,
      role: usersTable.role,
      isActive: usersTable.isActive,
      name: usersTable.name,
    }).from(usersTable)
      .where(eq(usersTable.id, oauthState.actorUserId))
      .limit(1);
    if (
      !actor
      || !actor.isActive
      || actor.tenantId !== oauthState.tenantId
      || !ADMIN_ROLES.includes(actor.role)
    ) {
      redirectFromOAuth(res, "authorization_denied");
      return;
    }
    if (req.query["error"]) {
      redirectFromOAuth(res, "authorization_denied");
      return;
    }
    const code = typeof req.query["code"] === "string" ? req.query["code"] : "";
    const meta = getInstagramMetaConfig();
    if (!code || !meta.appConfigured) {
      redirectFromOAuth(res, "connect_error");
      return;
    }

    const account = await exchangeInstagramOAuthCode(code, meta);
    let integrationId: string;
    try {
      integrationId = await savePendingInstagramConnection(oauthState.tenantId, account);
    } catch (error) {
      if (isUniqueViolation(error)) {
        logger.warn("[instagram] OAuth rejected because the account is connected to another agency");
        redirectFromOAuth(res, "already_connected");
        return;
      }
      throw error;
    }
    try {
      await subscribeInstagramAccount(meta, account.accessToken);
      await completeInstagramConnection(oauthState.tenantId, integrationId, true);
      const logActor = { ...actor, tenantId: oauthState.tenantId };
      await writeIntegrationLog(logActor, "connect", "info", "A agência conectou uma conta do Instagram Direct.");
      redirectFromOAuth(res, "connected");
    } catch (error) {
      await completeInstagramConnection(oauthState.tenantId, integrationId, false);
      const logActor = { ...actor, tenantId: oauthState.tenantId };
      await writeIntegrationLog(logActor, "error", "warn", "A Meta não ativou o webhook de mensagens do Instagram.");
      logger.warn({
        tenantId: oauthState.tenantId,
        integrationId,
        providerStatus: error instanceof Error && "httpStatus" in error
          ? (error as { httpStatus?: number }).httpStatus ?? null
          : null,
      }, "[instagram] Webhook subscription failed after OAuth");
      redirectFromOAuth(res, "connect_error");
    }
  } catch (error) {
    next(error);
  }
});

router.post("/instagram-messaging/disconnect", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const me = await requireInstagramAdmin(req, res, next);
    if (!me) return;
    const [integration] = await db.update(tenantIntegrationsTable)
      .set({
        config: {},
        secretsEncrypted: null,
        enabled: false,
        status: "disconnected",
        lastError: null,
        lastSyncAt: new Date(),
      })
      .where(and(
        eq(tenantIntegrationsTable.tenantId, me.tenantId),
        eq(tenantIntegrationsTable.type, INSTAGRAM_MESSAGING_TYPE),
      ))
      .returning({ id: tenantIntegrationsTable.id });
    if (integration) {
      await writeIntegrationLog(me, "disconnect", "info", "A agência removeu o acesso local ao Instagram Direct.");
    }
    res.json({ disconnected: true });
  } catch (error) {
    next(error);
  }
});

router.post("/instagram-messaging/deauthorize", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const meta = getInstagramMetaConfig();
    if (!meta.appSecret) {
      res.status(503).json({ success: false });
      return;
    }
    const signedRequest = typeof req.body === "object" && req.body !== null
      ? (req.body as Record<string, unknown>)["signed_request"]
      : undefined;
    const instagramUserId = verifyInstagramSignedRequest(signedRequest, meta.appSecret);
    if (!instagramUserId) {
      res.status(401).json({ success: false });
      return;
    }
    await disconnectInstagramAccountFromMeta(instagramUserId);
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.post("/instagram-messaging/data-deletion", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const meta = getInstagramMetaConfig();
    if (!meta.appSecret || !meta.dataDeletionStatusUrl) {
      res.status(503).json({ error: "Instagram data deletion is not configured" });
      return;
    }
    const signedRequest = typeof req.body === "object" && req.body !== null
      ? (req.body as Record<string, unknown>)["signed_request"]
      : undefined;
    const instagramUserId = verifyInstagramSignedRequest(signedRequest, meta.appSecret);
    if (!instagramUserId) {
      res.status(401).json({ error: "Invalid signed request" });
      return;
    }
    const confirmationCode = createInstagramDeletionConfirmationCode();
    await deleteInstagramAccountData(instagramUserId, confirmationCode);
    res.status(200).json({
      url: `${meta.dataDeletionStatusUrl}/${confirmationCode}`,
      confirmation_code: confirmationCode,
    });
  } catch (error) {
    next(error);
  }
});

router.get(
  "/instagram-messaging/data-deletion-status/:confirmationCode",
  async (req, res, next: NextFunction): Promise<void> => {
    try {
      const confirmationCode = typeof req.params["confirmationCode"] === "string"
        ? req.params["confirmationCode"]
        : "";
      if (!/^[A-F0-9]{32}$/.test(confirmationCode)) {
        res.status(404).type("text/html").send("<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><title>Solicitação não encontrada</title><p>Solicitação de exclusão não encontrada.</p></html>");
        return;
      }
      const completedAt = await getInstagramDataDeletionStatus(confirmationCode);
      if (!completedAt) {
        res.status(404).type("text/html").send("<!doctype html><html lang=\"pt-BR\"><meta charset=\"utf-8\"><title>Solicitação não encontrada</title><p>Solicitação de exclusão não encontrada.</p></html>");
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.type("text/html").send(
        `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Status da exclusão de dados</title></head><body><main><h1>Solicitação de exclusão concluída</h1><p>As credenciais e os dados de conversas armazenados pelo Instagram foram removidos. Cadastros de clientes e históricos de outros canais foram preservados.</p><p>Código de confirmação: <strong>${confirmationCode}</strong></p><p>Concluída em: <time datetime="${completedAt.toISOString()}">${completedAt.toISOString()}</time></p></main></body></html>`,
      );
    } catch (error) {
      next(error);
    }
  },
);

router.get("/webhooks/instagram", (req, res): void => {
  const meta = getInstagramMetaConfig();
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (
    mode === "subscribe"
    && typeof token === "string"
    && token === meta.webhookVerifyToken
    && typeof challenge === "string"
  ) {
    res.status(200).type("text/plain").send(challenge);
    return;
  }
  res.status(403).type("text/plain").send("Forbidden");
});

router.post("/webhooks/instagram", async (req, res, next: NextFunction): Promise<void> => {
  try {
    const meta = getInstagramMetaConfig();
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!verifyInstagramWebhookSignature(rawBody, req.get("x-hub-signature-256"), meta.appSecret)) {
      res.status(401).json({ received: false });
      return;
    }
    const stored = await processInstagramWebhook(req.body);
    res.status(200).json({ received: true, stored });
  } catch (error) {
    next(error);
  }
});

export default router;
