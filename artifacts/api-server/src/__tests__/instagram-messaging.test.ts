import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  chatbotConversationsTable: {},
  chatbotMessagesTable: {},
  instagramDataDeletionRequestsTable: {},
  instagramOAuthStatesTable: {},
  tenantIntegrationsTable: {},
}));
vi.mock("../lib/crypto.js", () => ({
  decryptCredential: vi.fn(),
  encryptCredential: vi.fn(),
}));
vi.mock("../lib/id.js", () => ({ generateId: vi.fn(() => "instagram-test-id") }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createInstagramDeletionConfirmationCode,
  createInstagramAuthorizationUrl,
  exchangeInstagramOAuthCode,
  getInstagramMetaConfig,
  isInstagramReplyWindowOpen,
  parseInstagramWebhook,
  sendInstagramText,
  verifyInstagramSignedRequest,
  verifyInstagramWebhookSignature,
  type InstagramMetaConfig,
} from "../services/instagram-messaging.js";
import * as instagramMessagingService from "../services/instagram-messaging.js";
import instagramMessagingRouter from "../routes/instagram-messaging.js";

const config: InstagramMetaConfig = {
  appId: "instagram-app-id",
  appSecret: "instagram-app-secret",
  webhookVerifyToken: "verify-token",
  redirectUri: "https://crm.example.com/api/instagram-messaging/callback",
  webhookUrl: "https://crm.example.com/api/webhooks/instagram",
  deauthorizationUrl: "https://crm.example.com/api/instagram-messaging/deauthorize",
  dataDeletionUrl: "https://crm.example.com/api/instagram-messaging/data-deletion",
  dataDeletionStatusUrl: "https://crm.example.com/api/instagram-messaging/data-deletion-status",
  settingsUrl: "https://crm.example.com/configuracoes",
  graphVersion: "v26.0",
  appConfigured: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Instagram Direct integration", () => {
  it("builds the Instagram Business Login URL with the current message permissions", () => {
    const authorizationUrl = createInstagramAuthorizationUrl(config, "state-value");
    expect(authorizationUrl).not.toBeNull();

    const url = new URL(authorizationUrl!);
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(config.appId);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_manage_messages",
    );
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("enable_fb_login")).toBe("false");
  });

  it("verifies the exact raw webhook body with a timing-safe HMAC signature", () => {
    const body = Buffer.from('{"object":"instagram","entry":[]}');
    const signature = createHmac("sha256", config.appSecret!)
      .update(body)
      .digest("hex");

    expect(verifyInstagramWebhookSignature(body, `sha256=${signature}`, config.appSecret)).toBe(true);
    expect(verifyInstagramWebhookSignature(body, `sha256=${signature}`, "wrong-secret")).toBe(false);
    expect(verifyInstagramWebhookSignature(body, `sha1=${signature}`, config.appSecret)).toBe(false);
    expect(verifyInstagramWebhookSignature(undefined, `sha256=${signature}`, config.appSecret)).toBe(false);
  });

  it("verifies Meta signed requests before returning the app-scoped user ID", () => {
    const payload = Buffer.from(JSON.stringify({
      algorithm: "HMAC-SHA256",
      user_id: "meta-account-123",
    })).toString("base64url");
    const signature = createHmac("sha256", config.appSecret!)
      .update(payload)
      .digest("base64url");
    const signedRequest = `${signature}.${payload}`;

    expect(verifyInstagramSignedRequest(signedRequest, config.appSecret)).toBe("meta-account-123");
    expect(verifyInstagramSignedRequest(signedRequest, "wrong-secret")).toBeNull();
    expect(verifyInstagramSignedRequest(`${signature}.${payload}x`, config.appSecret)).toBeNull();
    expect(verifyInstagramSignedRequest("bad.payload.extra", config.appSecret)).toBeNull();
    expect(verifyInstagramSignedRequest(null, config.appSecret)).toBeNull();
    expect(verifyInstagramSignedRequest(signedRequest, null)).toBeNull();
  });

  it("exposes the exact public Meta setup callback URLs from the configured base URL", () => {
    vi.stubEnv("INSTAGRAM_APP_ID", "app-id");
    vi.stubEnv("INSTAGRAM_APP_SECRET", "app-secret");
    vi.stubEnv("INSTAGRAM_WEBHOOK_VERIFY_TOKEN", "verify-token");
    vi.stubEnv("INSTAGRAM_OAUTH_REDIRECT_URI", "");
    vi.stubEnv("API_BASE_URL", "https://api.example.com/api");
    vi.stubEnv("FRONTEND_URL", "https://crm.example.com");
    vi.stubEnv("NODE_ENV", "production");

    const meta = getInstagramMetaConfig();

    expect(meta).toMatchObject({
      appConfigured: true,
      redirectUri: "https://api.example.com/api/instagram-messaging/callback",
      webhookUrl: "https://api.example.com/api/webhooks/instagram",
      deauthorizationUrl: "https://api.example.com/api/instagram-messaging/deauthorize",
      dataDeletionUrl: "https://api.example.com/api/instagram-messaging/data-deletion",
      dataDeletionStatusUrl: "https://api.example.com/api/instagram-messaging/data-deletion-status",
      settingsUrl: "https://crm.example.com/configuracoes",
    });
  });

  it("creates high-entropy alphanumeric data-deletion confirmation codes", () => {
    const code = createInstagramDeletionConfirmationCode();
    expect(code).toMatch(/^[A-F0-9]{32}$/);
  });

  it("rejects unsigned data-deletion callbacks before calling the deletion service", async () => {
    vi.stubEnv("INSTAGRAM_APP_SECRET", config.appSecret!);
    vi.stubEnv("API_BASE_URL", "https://api.example.com");
    vi.stubEnv("NODE_ENV", "production");
    const deleteData = vi.spyOn(instagramMessagingService, "deleteInstagramAccountData");
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(instagramMessagingRouter);

    const response = await request(app)
      .post("/instagram-messaging/data-deletion")
      .type("form")
      .send({ signed_request: "not-a-valid-signed-request" });

    expect(response.status).toBe(401);
    expect(deleteData).not.toHaveBeenCalled();
  });

  it("disconnects only the Instagram connection for a valid Meta deauthorization callback", async () => {
    vi.stubEnv("INSTAGRAM_APP_SECRET", config.appSecret!);
    vi.stubEnv("API_BASE_URL", "https://api.example.com");
    vi.stubEnv("NODE_ENV", "production");
    const disconnect = vi.spyOn(instagramMessagingService, "disconnectInstagramAccountFromMeta")
      .mockResolvedValue();
    const payload = Buffer.from(JSON.stringify({
      algorithm: "HMAC-SHA256",
      user_id: "meta-account-123",
    })).toString("base64url");
    const signature = createHmac("sha256", config.appSecret!)
      .update(payload)
      .digest("base64url");
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(instagramMessagingRouter);

    const response = await request(app)
      .post("/instagram-messaging/deauthorize")
      .type("form")
      .send({ signed_request: `${signature}.${payload}` });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(disconnect).toHaveBeenCalledWith("meta-account-123");
  });

  it("deletes Instagram data only for a valid Meta signature and returns a status URL", async () => {
    const confirmationCode = "A".repeat(32);
    const completedAt = new Date("2026-10-06T12:00:00.000Z");
    vi.stubEnv("INSTAGRAM_APP_SECRET", config.appSecret!);
    vi.stubEnv("API_BASE_URL", "https://api.example.com");
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(instagramMessagingService, "createInstagramDeletionConfirmationCode")
      .mockReturnValue(confirmationCode);
    const deleteData = vi.spyOn(instagramMessagingService, "deleteInstagramAccountData")
      .mockResolvedValue(completedAt);
    const getStatus = vi.spyOn(instagramMessagingService, "getInstagramDataDeletionStatus")
      .mockResolvedValue(completedAt);
    const payload = Buffer.from(JSON.stringify({
      algorithm: "HMAC-SHA256",
      user_id: "meta-account-123",
    })).toString("base64url");
    const signature = createHmac("sha256", config.appSecret!)
      .update(payload)
      .digest("base64url");
    const signedRequest = `${signature}.${payload}`;
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(instagramMessagingRouter);

    const response = await request(app)
      .post("/instagram-messaging/data-deletion")
      .type("form")
      .send({ signed_request: signedRequest });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      url: `https://api.example.com/api/instagram-messaging/data-deletion-status/${confirmationCode}`,
      confirmation_code: confirmationCode,
    });
    expect(deleteData).toHaveBeenCalledWith("meta-account-123", confirmationCode);

    const statusResponse = await request(app)
      .get(`/instagram-messaging/data-deletion-status/${confirmationCode}`);
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.text).toContain("Solicitação de exclusão concluída");
    expect(statusResponse.text).toContain(confirmationCode);
    expect(statusResponse.text).toContain(completedAt.toISOString());
    expect(getStatus).toHaveBeenCalledWith(confirmationCode);
  });

  it("parses inbound messages, represents attachments, and ignores echoes or unrelated events", () => {
    const messages = parseInstagramWebhook({
      object: "instagram",
      entry: [{
        id: "agency-instagram-id",
        messaging: [
          {
            sender: { id: "customer-1" },
            timestamp: 1_730_000_000_000,
            message: { mid: "message-1", text: "Olá, gostaria de viajar." },
          },
          {
            sender: { id: "customer-2" },
            timestamp: 1_730_000_001_000,
            message: { mid: "message-2", attachments: [{ type: "image" }] },
          },
          {
            sender: { id: "agency-instagram-id" },
            timestamp: 1_730_000_002_000,
            message: { mid: "message-3", text: "Resposta", is_echo: true },
          },
          { sender: { id: "customer-3" }, read: { mid: "message-4" } },
        ],
      }],
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      instagramUserId: "agency-instagram-id",
      senderId: "customer-1",
      messageId: "message-1",
      content: "Olá, gostaria de viajar.",
      sentAt: new Date(1_730_000_000_000),
    });
    expect(messages[1]).toMatchObject({
      senderId: "customer-2",
      messageId: "message-2",
      content: "Mídia recebida pelo Instagram",
    });
  });

  it("enforces the 24-hour reply window and rejects provider timestamp skew", () => {
    const now = 1_730_000_000_000;
    expect(isInstagramReplyWindowOpen(null, now)).toBe(false);
    expect(isInstagramReplyWindowOpen(new Date(Number.NaN), now)).toBe(false);
    expect(isInstagramReplyWindowOpen(new Date(now - 24 * 60 * 60 * 1000 + 1), now)).toBe(true);
    expect(isInstagramReplyWindowOpen(new Date(now - 24 * 60 * 60 * 1000), now)).toBe(false);
    expect(isInstagramReplyWindowOpen(new Date(now - 5 * 60 * 1000), now)).toBe(true);
    expect(isInstagramReplyWindowOpen(new Date(now + 5 * 60 * 1000 + 1), now)).toBe(false);
  });

  it("rejects text that exceeds Instagram's UTF-8 byte limit before making a provider request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendInstagramText(config, "access-token", "agency-id", "recipient-id", "á".repeat(501)),
    ).rejects.toMatchObject({ name: "InstagramProviderError", kind: "rejected", httpStatus: 413 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("unwraps Meta's data-array token and profile responses before exchanging the code", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        data: [{ access_token: "short-lived-token", user_id: "instagram-user-id" }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: "long-lived-token",
        user_id: "instagram-user-id",
        expires_in: 5_184_000,
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: [{ user_id: "instagram-user-id", username: "agencia" }],
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await exchangeInstagramOAuthCode("one-time-code", config);

    expect(result).toMatchObject({
      instagramUserId: "instagram-user-id",
      username: "agencia",
      accessToken: "long-lived-token",
    });
    expect(result.tokenExpiresAt.getTime() - result.tokenIssuedAt.getTime()).toBe(5_184_000_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const firstCall = fetchMock.mock.calls[0] as unknown[] | undefined;
    expect(String(firstCall?.[0])).toBe("https://api.instagram.com/oauth/access_token");
    const form = new URLSearchParams(String((firstCall?.[1] as RequestInit | undefined)?.body));
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("redirect_uri")).toBe(config.redirectUri);
    expect(form.get("code")).toBe("one-time-code");

    const secondUrl = new URL(String(fetchMock.mock.calls[1]?.[0]));
    expect(secondUrl.pathname).toBe("/v26.0/access_token");
    expect(secondUrl.searchParams.get("grant_type")).toBe("ig_exchange_token");
    const thirdUrl = new URL(String(fetchMock.mock.calls[2]?.[0]));
    expect(thirdUrl.pathname).toBe("/v26.0/me");
    expect(thirdUrl.searchParams.get("fields")).toBe("user_id,username");
  });
});
