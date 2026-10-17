/**
 * Tenant-integrations endpoint tests
 *
 * Covers: GET /integrations, GET /integrations/:type, PUT /integrations/:type,
 *         POST /integrations/:type/test, POST /integrations/:type/revoke,
 *         GET /integrations/:type/logs
 *
 * Key security properties verified:
 *   - Secrets never appear as plaintext in API responses
 *   - POST /test never persists status to the DB (only PUT /save does)
 *   - POST /revoke zeros secretsEncrypted and disables the integration
 *   - SSRF-check config fields are validated before storage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import pino from "pino";

// ---------------------------------------------------------------------------
// vi.hoisted: shared mock factories (must exist before any vi.mock factory)
// ---------------------------------------------------------------------------

const {
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockRequireAuth,
  mockUpdate,
  mockUpdateSet,
  mockUpdateWhere,
  mockInsert,
  mockInsertValues,
  mockTransaction,
  mockAssertSafeUrl,
  mockSsrfFetch,
  mockImportZernioInstagramHistoryChunk,
} = vi.hoisted(() => {
  const mockUpdateWhere = vi.fn();
  const mockUpdateSet = vi.fn();
  const mockUpdate = vi.fn();
  const mockInsertValues = vi.fn();
  const mockInsert = vi.fn();
  const mockTransaction = vi.fn();
  const mockLimit = vi.fn();
  const mockWhere = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockRequireAuth = vi.fn();
  const mockAssertSafeUrl = vi.fn();
  const mockSsrfFetch = vi.fn();
  const mockImportZernioInstagramHistoryChunk = vi.fn();

  return {
    mockLimit,
    mockWhere,
    mockFrom,
    mockSelect,
    mockRequireAuth,
    mockUpdate,
    mockUpdateSet,
    mockUpdateWhere,
    mockInsert,
    mockInsertValues,
    mockTransaction,
    mockAssertSafeUrl,
    mockSsrfFetch,
    mockImportZernioInstagramHistoryChunk,
  };
});

// ---------------------------------------------------------------------------
// Module mocks (must appear before router import)
// ---------------------------------------------------------------------------

vi.mock("@workspace/db", () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
    transaction: mockTransaction,
  },
  tenantIntegrationsTable: {},
  tenantIntegrationLogsTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(() => "eq"),
  and: vi.fn((...a: unknown[]) => a),
  desc: vi.fn(() => "desc"),
  asc: vi.fn(() => "asc"),
}));

vi.mock("@clerk/express", () => ({
  clerkClient: vi.fn(),
  getAuth: vi.fn(() => ({ userId: "user_test" })),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/tenant.js", () => ({
  requireAuth: mockRequireAuth,
  ADMIN_ROLES: ["admin"],
}));

vi.mock("../lib/id.js", () => ({
  generateId: vi.fn(() => "gen-id"),
}));

// Identity crypto mocks — encryptCredential is a pass-through, so
// encryptSecrets(obj) = JSON.stringify(obj).  decryptSecrets(stored) = JSON.parse(stored).
// DB fixtures therefore store secrets as JSON.stringify(secretsObj).
vi.mock("../lib/crypto.js", () => ({
  encryptCredential: vi.fn((s: string) => s),
  decryptCredential: vi.fn((s: string) => s),
}));

vi.mock("../lib/ssrf.js", () => ({
  assertSafeUrl: mockAssertSafeUrl,
  ssrfSafeFetchBounded: mockSsrfFetch,
}));

vi.mock("../services/instagram-zernio.js", () => ({
  INSTAGRAM_ZERNIO_TYPE: "instagram_zernio",
  importZernioInstagramHistoryChunk: mockImportZernioInstagramHistoryChunk,
}));

// ---------------------------------------------------------------------------
// Import router AFTER mocks
// ---------------------------------------------------------------------------

import integrationsRouter from "../routes/tenant-integrations.js";
import { errorHandler } from "../middlewares/errorHandler.js";

// ---------------------------------------------------------------------------
// Minimal Express app
// ---------------------------------------------------------------------------

function stubLogger(
  req: express.Request & { log?: unknown },
  _res: express.Response,
  next: express.NextFunction,
) {
  req.log = pino({ level: "silent" });
  next();
}

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(stubLogger);
  app.use("/api", integrationsRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = "tenant-abc";
const MASK = "••••••••";

// Identity crypto: secretsEncrypted stored in DB = JSON.stringify(secrets object)
const STRIPE_SECRETS = {
  secretKey: "sk_test_realSecretKey1234",
  webhookSecret: "whsec_hookSecret5678",
};
const STRIPE_SECRETS_ENC = JSON.stringify(STRIPE_SECRETS);

const GA_SECRETS = {
  serviceAccountJson: JSON.stringify({ type: "service_account", project_id: "my-proj" }),
};
const GA_SECRETS_ENC = JSON.stringify(GA_SECRETS);

const WA_SECRETS = { apiKey: "wapi_key_abcd5678" };
const WA_SECRETS_ENC = JSON.stringify(WA_SECRETS);

const STRIPE_ROW = {
  id: "row-stripe",
  tenantId: TENANT_ID,
  type: "stripe_account",
  name: "Stripe da Agência",
  config: { publishableKey: "pk_test_pub" },
  secretsEncrypted: STRIPE_SECRETS_ENC,
  environment: "production",
  enabled: true,
  status: "connected",
  lastError: null,
  lastSyncAt: new Date("2024-01-01"),
};

const GA_ROW = {
  id: "row-ga",
  tenantId: TENANT_ID,
  type: "google_analytics",
  name: "GA4",
  config: { measurementId: "G-ABCDEF1234", propertyId: "1234567890" },
  secretsEncrypted: GA_SECRETS_ENC,
  environment: "production",
  enabled: true,
  status: "connected",
  lastError: null,
  lastSyncAt: new Date("2024-01-01"),
};

const WHATSAPP_ROW = {
  id: "row-wa",
  tenantId: TENANT_ID,
  type: "whatsapp_evolution",
  name: "WhatsApp",
  config: { baseUrl: "https://evo.example.com", instanceName: "my-instance" },
  secretsEncrypted: WA_SECRETS_ENC,
  environment: "production",
  enabled: true,
  status: "connected",
  lastError: null,
  lastSyncAt: new Date("2024-01-01"),
};

const LOG_ROW = {
  id: "log-001",
  tenantId: TENANT_ID,
  type: "stripe_account",
  event: "save",
  level: "info",
  message: "Configuração salva",
  actorId: "user-001",
  actorName: "Admin User",
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
};

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function asAdmin() {
  mockRequireAuth.mockResolvedValue({
    id: "user-001",
    tenantId: TENANT_ID,
    role: "admin",
    name: "Admin",
  });
}

function asNonAdmin() {
  // Manager is not in ADMIN_ROLES → should receive 403
  mockRequireAuth.mockResolvedValue({
    id: "user-002",
    tenantId: TENANT_ID,
    role: "manager",
    name: "Manager",
  });
}

function setWebhookTestEnvironment(frontendUrl: string) {
  const keys = ["API_BASE_URL", "REPLIT_DOMAINS", "FRONTEND_URL", "REPLIT_DEV_DOMAIN"] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env["API_BASE_URL"] = "";
  process.env["REPLIT_DOMAINS"] = "";
  process.env["FRONTEND_URL"] = frontendUrl;
  process.env["REPLIT_DEV_DOMAIN"] = "";
  return () => {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

// ---------------------------------------------------------------------------
// beforeEach: reset mocks and rebuild all DB call chains
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockLimit.mockReset();

  // Rebuild update chain (clearAllMocks wipes implementations)
  mockUpdateWhere.mockImplementation(() => Object.assign(Promise.resolve([]), {
    returning: vi.fn().mockResolvedValue([{ id: "row-wa" }]),
  }));
  mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdate.mockReturnValue({ set: mockUpdateSet });

  // Rebuild insert chain
  mockInsertValues.mockResolvedValue([]);
  mockInsert.mockReturnValue({ values: mockInsertValues });
  mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
    await callback({ update: mockUpdate, insert: mockInsert }),
  );

  // Rebuild select chain. mockWhere returns a thenable (awaitable directly) AND
  // exposes .limit() and .orderBy() for chained queries.
  const mockOrderBy = vi.fn(() => Object.assign(Promise.resolve([]), { limit: mockLimit, orderBy: mockOrderBy }));
  mockWhere.mockReturnValue(
    Object.assign(Promise.resolve([]), { limit: mockLimit, orderBy: mockOrderBy }),
  );
  mockFrom.mockReturnValue({ where: mockWhere, limit: mockLimit, orderBy: mockOrderBy });
  mockSelect.mockReturnValue({ from: mockFrom });

  // SSRF mocks: safe by default
  mockAssertSafeUrl.mockResolvedValue(undefined);
  mockSsrfFetch.mockResolvedValue({
    ok: true,
    status: 200,
    text: JSON.stringify({ instance: { state: "open" } }),
  });
});

// ─── GET /api/integrations ────────────────────────────────────────────────────

describe("GET /api/integrations — list all integration types", () => {
  it("returns 200 with all registered integration types", async () => {
    asAdmin();
    // mockWhere resolves to [] by default; route fills gaps from REGISTRY

    const res = await request(buildApp()).get("/api/integrations");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(6);

    const types = res.body.map((r: { type: string }) => r.type);
    expect(types).toContain("whatsapp_evolution");
    expect(types).toContain("stripe_account");
    expect(types).toContain("mercadopago");
    expect(types).toContain("google_analytics");
    expect(types).toContain("distribution_reference");
    expect(types).toContain("instagram_zernio");
  });

  it("response items include type, label, status, and enabled — no secret fields", async () => {
    asAdmin();

    const res = await request(buildApp()).get("/api/integrations");

    expect(res.status).toBe(200);
    for (const item of res.body) {
      expect(item).toHaveProperty("type");
      expect(item).toHaveProperty("label");
      expect(item).toHaveProperty("status");
      expect(item).toHaveProperty("enabled");
      // List endpoint must never expose secrets
      expect(item).not.toHaveProperty("secretsEncrypted");
      expect(item).not.toHaveProperty("maskedSecrets");
    }
  });

  it("exposes both identifiers needed to map an Instagram Zernio account", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/api/integrations/instagram_zernio");

    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.fieldDefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "accountId",
        label: "Account ID da Zernio",
        secret: false,
      }),
      expect.objectContaining({
        key: "profileId",
        label: "Profile ID da Zernio",
        secret: false,
      }),
    ]));
  });

  it("reflects stored status for a connected integration", async () => {
    asAdmin();
    // Simulate one integration row in DB
    const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
    mockWhere.mockReturnValueOnce(
      Object.assign(
        Promise.resolve([{ type: "stripe_account", status: "connected", enabled: true }]),
        { limit: mockLimit, orderBy: mockOrderBy },
      ),
    );

    const res = await request(buildApp()).get("/api/integrations");

    expect(res.status).toBe(200);
    const stripe = res.body.find((r: { type: string }) => r.type === "stripe_account");
    expect(stripe?.status).toBe("connected");
    expect(stripe?.enabled).toBe(true);
  });

  it("returns 403 for non-admin roles", async () => {
    asNonAdmin();

    const res = await request(buildApp()).get("/api/integrations");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN_ROLE");
  });
});

// ─── GET /api/integrations/:type ─────────────────────────────────────────────

describe("GET /api/integrations/:type — single integration detail", () => {
  it("returns 404 for unknown integration type", async () => {
    asAdmin();

    const res = await request(buildApp()).get("/api/integrations/unknown_type");

    expect(res.status).toBe(404);
  });

  it("masks secret fields — plaintext secrets never appear in the response body", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([STRIPE_ROW]);

    const res = await request(buildApp()).get("/api/integrations/stripe_account");

    expect(res.status).toBe(200);
    const bodyStr = JSON.stringify(res.body);

    // Real secret values must NOT appear anywhere in the response
    expect(bodyStr).not.toContain(STRIPE_SECRETS.secretKey);
    expect(bodyStr).not.toContain(STRIPE_SECRETS.webhookSecret);
    // secretsEncrypted must not be exposed
    expect(bodyStr).not.toContain("secretsEncrypted");

    // maskedSecrets present and masked
    expect(res.body.maskedSecrets).toBeDefined();
    expect(res.body.maskedSecrets.secretKey).not.toBe(STRIPE_SECRETS.secretKey);
    expect(res.body.maskedSecrets.secretKey).toContain("••••••••");
    expect(res.body.maskedSecrets.webhookSecret).not.toBe(STRIPE_SECRETS.webhookSecret);
    expect(res.body.maskedSecrets.webhookSecret).toContain("••••••••");
  });

  it("masked value shows sentinel + last 4 chars of secret", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([STRIPE_ROW]);

    const res = await request(buildApp()).get("/api/integrations/stripe_account");

    expect(res.status).toBe(200);
    // "sk_test_realSecretKey1234" → last 4 = "1234"
    expect(res.body.maskedSecrets.secretKey).toMatch(/1234$/);
    // "whsec_hookSecret5678" → last 4 = "5678"
    expect(res.body.maskedSecrets.webhookSecret).toMatch(/5678$/);
  });

  it("returns null maskedSecrets when no row exists (integration not configured)", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([]); // no existing row

    const res = await request(buildApp()).get("/api/integrations/stripe_account");

    expect(res.status).toBe(200);
    expect(res.body.maskedSecrets.secretKey).toBeNull();
    expect(res.body.maskedSecrets.webhookSecret).toBeNull();
    expect(res.body.status).toBe("disconnected");
    expect(res.body.enabled).toBe(false);
  });

  it("returns fieldDefs with secret flag set correctly", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([]);

    const res = await request(buildApp()).get("/api/integrations/stripe_account");

    expect(res.status).toBe(200);
    const secretField = res.body.fieldDefs.find(
      (f: { key: string; secret: boolean }) => f.key === "secretKey",
    );
    const configField = res.body.fieldDefs.find(
      (f: { key: string; secret: boolean }) => f.key === "publishableKey",
    );
    expect(secretField?.secret).toBe(true);
    expect(configField?.secret).toBe(false);
  });

  it("returns 403 for non-admin roles", async () => {
    asNonAdmin();

    const res = await request(buildApp()).get("/api/integrations/stripe_account");

    expect(res.status).toBe(403);
  });

  it("imports Zernio history only from the authenticated agency's connected integration", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([{
      id: "zernio-integration-1",
      tenantId: TENANT_ID,
      type: "instagram_zernio",
      config: { accountId: "account-1", profileId: "profile-1" },
      secretsEncrypted: JSON.stringify({ apiKey: "private-api-key" }),
      enabled: true,
      status: "connected",
    }]);
    mockImportZernioInstagramHistoryChunk.mockResolvedValueOnce({
      done: true,
      cursor: null,
      progress: {
      conversationsFound: 2,
      conversationsProcessed: 2,
      messagesImported: 8,
      messagesAlreadyPresent: 3,
        messagesSkipped: 2,
      },
    });

    const res = await request(buildApp())
      .post("/api/integrations/instagram_zernio/import-history")
      .send({ integrationId: "zernio-integration-1" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      done: true,
      cursor: null,
      progress: { messagesImported: 8, conversationsProcessed: 2, messagesSkipped: 2 },
    });
    expect(JSON.stringify(res.body)).not.toContain("private-api-key");
    expect(mockImportZernioInstagramHistoryChunk).toHaveBeenCalledWith(
      "private-api-key",
      "account-1",
      "profile-1",
      "zernio-integration-1",
      undefined,
    );
    expect(mockWhere).toHaveBeenCalled();
  });

  it("validates and returns an encrypted, integration-bound continuation cursor", async () => {
    asAdmin();
    const integration = {
      id: "zernio-integration-1",
      tenantId: TENANT_ID,
      type: "instagram_zernio",
      config: { accountId: "account-1", profileId: "profile-1" },
      secretsEncrypted: JSON.stringify({ apiKey: "private-api-key" }),
      enabled: true,
      status: "connected",
    };
    mockLimit.mockResolvedValueOnce([integration]);
    const checkpoint = {
      integrationId: integration.id,
      accountId: "account-1",
      cursor: { status: "active", conversationCursor: "page-2" },
    };
    mockImportZernioInstagramHistoryChunk.mockResolvedValueOnce({
      done: false,
      cursor: { status: "active", conversationCursor: "page-3" },
      progress: {
        conversationsFound: 100,
        conversationsProcessed: 4,
        messagesImported: 12,
        messagesAlreadyPresent: 1,
        messagesSkipped: 0,
      },
    });

    const res = await request(buildApp())
      .post("/api/integrations/instagram_zernio/import-history")
      .send({ integrationId: integration.id, cursor: JSON.stringify(checkpoint) });

    expect(res.status).toBe(200);
    expect(mockImportZernioInstagramHistoryChunk).toHaveBeenCalledWith(
      "private-api-key",
      "account-1",
      "profile-1",
      integration.id,
      checkpoint.cursor,
    );
    expect(JSON.parse(res.body.cursor)).toMatchObject({
      integrationId: integration.id,
      accountId: "account-1",
      cursor: { conversationCursor: "page-3" },
    });
    expect(JSON.stringify(res.body)).not.toContain("private-api-key");
  });
});

describe("GET /api/integrations/whatsapp_evolution/connections", () => {
  it("returns legacy default flags so duplicate defaults can be corrected in settings", async () => {
    asAdmin();
    const rows = [
      { ...WHATSAPP_ROW, id: "wa-old", isDefault: true, status: "disconnected", enabled: false },
      { ...WHATSAPP_ROW, id: "wa-live", isDefault: true, status: "connected", enabled: true },
    ];
    mockWhere.mockReturnValueOnce(Object.assign(Promise.resolve(rows), {
      orderBy: vi.fn().mockResolvedValue(rows),
    }));

    const res = await request(buildApp()).get("/api/integrations/whatsapp_evolution/connections");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "wa-old", isDefault: true, enabled: false, status: "disconnected" }),
      expect.objectContaining({ id: "wa-live", isDefault: true, enabled: true, status: "connected" }),
    ]));
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("POST /api/integrations/whatsapp_evolution/connections/:id/qr", () => {
  it("reports a DNS validation failure without attempting a provider request", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([WHATSAPP_ROW]);
    mockAssertSafeUrl.mockRejectedValueOnce(new Error("Não foi possível resolver o host."));

    const res = await request(buildApp())
      .post("/api/integrations/whatsapp_evolution/connections/row-wa/qr");

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/Não foi possível resolver o host/);
    expect(mockSsrfFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["UND_ERR_CONNECT_TIMEOUT", /Tempo de conexão esgotado/],
    ["ENOTFOUND", /resolver o endereço/],
    ["ECONNREFUSED", /recusou ou interrompeu/],
    ["CERT_HAS_EXPIRED", /certificado HTTPS/],
  ])("reports a safe provider error instead of HTTP 500 for %s", async (code, message) => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([WHATSAPP_ROW]);
    mockSsrfFetch.mockRejectedValueOnce(Object.assign(
      new TypeError(`fetch failed; apikey=${WA_SECRETS.apiKey}`),
      { cause: { code } },
    ));

    const res = await request(buildApp())
      .post("/api/integrations/whatsapp_evolution/connections/row-wa/qr");

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(message);
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      event: "qr_connect",
      level: "warn",
      message: res.body.message,
    }));
    expect(JSON.stringify(res.body)).not.toContain(WA_SECRETS.apiKey);
    expect(JSON.stringify(mockInsertValues.mock.calls)).not.toContain(WA_SECRETS.apiKey);
  });

  it("treats a non-JSON provider success as an invalid QR rather than an internal error", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([WHATSAPP_ROW]);
    mockSsrfFetch.mockResolvedValueOnce({ ok: true, status: 200, text: "<html>unavailable</html>" });

    const res = await request(buildApp())
      .post("/api/integrations/whatsapp_evolution/connections/row-wa/qr");

    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/não retornou um QR Code/);
    expect(JSON.stringify(res.body)).not.toContain("<html>");
  });

  it("returns only a validated QR image and sends the saved API key to the encoded instance endpoint", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([WHATSAPP_ROW]);
    mockSsrfFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: JSON.stringify({ base64: "data:image/png;base64,aGVsbG8=" }),
    });

    const res = await request(buildApp())
      .post("/api/integrations/whatsapp_evolution/connections/row-wa/qr");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ qrCodeDataUrl: "data:image/png;base64,aGVsbG8=" });
    expect(mockSsrfFetch).toHaveBeenCalledWith(
      "https://evo.example.com/instance/connect/my-instance",
      expect.objectContaining({ headers: { apikey: WA_SECRETS.apiKey } }),
    );
    expect(JSON.stringify(res.body)).not.toContain(WA_SECRETS.apiKey);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(JSON.stringify(mockInsertValues.mock.calls)).not.toContain("aGVsbG8=");
  });
});

describe("POST /api/integrations/whatsapp_evolution/connections/refresh", () => {
  it("clears the default only when Evolution confirms the instance is closed", async () => {
    asAdmin();
    mockWhere.mockResolvedValueOnce([{ ...WHATSAPP_ROW, isDefault: true }]);
    mockSsrfFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: JSON.stringify({ instance: { state: "close" } }),
    });

    const res = await request(buildApp())
      .post("/api/integrations/whatsapp_evolution/connections/refresh");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, unverified: 0, disconnectedDefaults: 1 });
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      status: "disconnected",
      isDefault: false,
    }));
    expect(mockUpdateWhere).toHaveBeenCalledOnce();
  });

  it("keeps the current status and default after a temporary provider failure", async () => {
    asAdmin();
    mockWhere.mockResolvedValueOnce([{ ...WHATSAPP_ROW, isDefault: true }]);
    mockSsrfFetch.mockResolvedValueOnce({ ok: false, status: 503, text: "temporarily unavailable" });

    const res = await request(buildApp())
      .post("/api/integrations/whatsapp_evolution/connections/refresh");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, unverified: 1, disconnectedDefaults: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain("temporarily unavailable");
  });

  it("does not interpret a missing Evolution instance as a disconnected session", async () => {
    asAdmin();
    mockWhere.mockResolvedValueOnce([{ ...WHATSAPP_ROW, isDefault: true }]);
    mockSsrfFetch.mockResolvedValueOnce({ ok: false, status: 404, text: "" });

    const res = await request(buildApp())
      .post("/api/integrations/whatsapp_evolution/connections/refresh");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, unverified: 1, disconnectedDefaults: 0 });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ─── PUT /api/integrations/:type ─────────────────────────────────────────────

describe("PUT /api/integrations/:type — save configuration", () => {
  it("atomically replaces the default only after the selected Evolution connection verifies", async () => {
    asAdmin();
    const currentDefault = { ...WHATSAPP_ROW, id: "wa-current", isDefault: true };
    const selected = { ...WHATSAPP_ROW, id: "wa-selected", isDefault: false };
    mockLimit.mockResolvedValueOnce([currentDefault]).mockResolvedValueOnce([selected]);

    const res = await request(buildApp())
      .put("/api/integrations/whatsapp_evolution")
      .send({ integrationId: selected.id, isDefault: true });

    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(true);
    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockUpdateSet.mock.calls.map(([values]) => values)).toEqual(expect.arrayContaining([
      { isDefault: false },
      { isDefault: true },
    ]));
  });

  it("leaves one default and gives the losing concurrent admin a safe refresh instruction", async () => {
    const adminA = { id: "admin-a", tenantId: TENANT_ID, role: "admin", name: "Admin A" };
    const adminB = { id: "admin-b", tenantId: TENANT_ID, role: "admin", name: "Admin B" };
    mockRequireAuth.mockResolvedValueOnce(adminA).mockResolvedValueOnce(adminB);
    const currentDefault = { ...WHATSAPP_ROW, id: "wa-current", isDefault: true };
    const selectedA = { ...WHATSAPP_ROW, id: "wa-a", isDefault: false };
    const selectedB = { ...WHATSAPP_ROW, id: "wa-b", isDefault: false };
    mockLimit
      .mockResolvedValueOnce([currentDefault])
      .mockResolvedValueOnce([currentDefault])
      .mockResolvedValueOnce([selectedA])
      .mockResolvedValueOnce([selectedB]);

    let transactionNumber = 0;
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => unknown) => {
      transactionNumber += 1;
      if (transactionNumber === 1) {
        await callback({ update: mockUpdate, insert: mockInsert });
        return;
      }
      throw { code: "23505", constraint: "tenant_integrations_whatsapp_default_uq" };
    });

    const [responseA, responseB] = await Promise.all([
      request(buildApp())
        .put("/api/integrations/whatsapp_evolution")
        .send({ integrationId: selectedA.id, isDefault: true }),
      request(buildApp())
        .put("/api/integrations/whatsapp_evolution")
        .send({ integrationId: selectedB.id, isDefault: true }),
    ]);

    expect(mockTransaction).toHaveBeenCalledTimes(2);
    const bodies = [responseA.body, responseB.body];
    expect(bodies.filter((body) => body.isDefault)).toHaveLength(1);
    const losingResponse = bodies.find((body) => !body.isDefault);
    expect(losingResponse?.message).toBe(
      "Outro administrador definiu o número padrão ao mesmo tempo. Atualize a lista e tente novamente.",
    );
    expect(JSON.stringify(losingResponse)).not.toContain("23505");
  });

  it("rejects selecting a disabled Evolution connection as default", async () => {
    asAdmin();
    const selected = { ...WHATSAPP_ROW, enabled: false, isDefault: false };
    mockLimit.mockResolvedValueOnce([selected]).mockResolvedValueOnce([selected]);

    const res = await request(buildApp())
      .put("/api/integrations/whatsapp_evolution")
      .send({ integrationId: selected.id, enabled: false, isDefault: true });

    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does not promote a disconnected connection when its reconnect check fails", async () => {
    asAdmin();
    const selected = { ...WHATSAPP_ROW, status: "disconnected", isDefault: false };
    mockLimit.mockResolvedValueOnce([selected]).mockResolvedValueOnce([selected]);
    mockSsrfFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const res = await request(buildApp())
      .put("/api/integrations/whatsapp_evolution")
      .send({ integrationId: selected.id, enabled: true, isDefault: true });

    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(false);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("clears a stale default flag when a previously connected number fails verification", async () => {
    asAdmin();
    const selected = { ...WHATSAPP_ROW, isDefault: true };
    mockLimit.mockResolvedValueOnce([selected]).mockResolvedValueOnce([selected]);
    mockSsrfFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const res = await request(buildApp())
      .put("/api/integrations/whatsapp_evolution")
      .send({ integrationId: selected.id, enabled: true });

    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(false);
    expect(mockUpdateSet.mock.calls.map(([values]) => values)).toContainEqual(
      expect.objectContaining({ status: "error", isDefault: false }),
    );
  });

  it("allows a disconnected connection to become default after a successful reconnect check", async () => {
    asAdmin();
    const selected = { ...WHATSAPP_ROW, status: "disconnected", isDefault: false };
    mockLimit.mockResolvedValueOnce([selected]).mockResolvedValueOnce([selected]);

    const res = await request(buildApp())
      .put("/api/integrations/whatsapp_evolution")
      .send({ integrationId: selected.id, enabled: true, isDefault: true });

    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(true);
    expect(mockTransaction).toHaveBeenCalledOnce();
  });

  it("returns 404 for unknown integration type", async () => {
    asAdmin();

    const res = await request(buildApp())
      .put("/api/integrations/unknown_type")
      .send({ enabled: true });

    expect(res.status).toBe(404);
  });

  it("inserts a new row when no existing row is found", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([]); // no existing row

    const res = await request(buildApp())
      .put("/api/integrations/mercadopago")
      .send({ enabled: false, secrets: { accessToken: "MP-token-9999" } });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockInsert).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: undefined }),
    );
  });

  it("updates the existing row when one already exists", async () => {
    asAdmin();
    const MP_ROW = {
      ...STRIPE_ROW,
      type: "mercadopago",
      config: {},
      secretsEncrypted: JSON.stringify({ accessToken: "MP-old-token" }),
    };
    mockLimit.mockResolvedValueOnce([MP_ROW]);

    const res = await request(buildApp())
      .put("/api/integrations/mercadopago")
      .send({ enabled: false, secrets: { accessToken: "MP-new-token-1111" } });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("carries over stored secret when MASK sentinel is submitted", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([STRIPE_ROW]);

    const res = await request(buildApp())
      .put("/api/integrations/stripe_account")
      .send({
        enabled: false, // disabled → skip auto-test
        secrets: { secretKey: MASK, webhookSecret: MASK },
      });

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalled();

    const setArgs = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    // Resolved secrets = existing secrets (mask kept them); encryptSecrets = JSON.stringify(existingSecrets)
    expect(setArgs.secretsEncrypted).toBe(STRIPE_SECRETS_ENC);
  });

  it("replaces stored secret when a non-mask value is submitted", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([STRIPE_ROW]);

    const newSecretKey = "sk_test_brandNewKey9999";
    await request(buildApp())
      .put("/api/integrations/stripe_account")
      .send({
        enabled: false,
        secrets: { secretKey: newSecretKey, webhookSecret: MASK },
      });

    const setArgs = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    // secretsEncrypted should now reflect the new secretKey and carried-over webhookSecret
    const stored = JSON.parse(setArgs.secretsEncrypted as string) as Record<string, string>;
    expect(stored.secretKey).toBe(newSecretKey);
    expect(stored.webhookSecret).toBe(STRIPE_SECRETS.webhookSecret);
  });

  it("resets status to disconnected when a new secret value is submitted", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([STRIPE_ROW]);

    await request(buildApp())
      .put("/api/integrations/stripe_account")
      .send({
        enabled: false,
        secrets: { secretKey: "sk_new_value_1234", webhookSecret: MASK },
      });

    const setArgs = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe("disconnected");
  });

  it("validates SSRF for whatsapp_evolution baseUrl and returns 400 for private URLs", async () => {
    asAdmin();
    mockAssertSafeUrl.mockRejectedValueOnce(
      new Error("URL não permitida: host interno."),
    );

    const res = await request(buildApp())
      .put("/api/integrations/whatsapp_evolution")
      .send({
        config: { baseUrl: "http://localhost:8080", instanceName: "test" },
        secrets: { apiKey: "key-abc" },
      });

    expect(res.status).toBe(400);
    expect(mockAssertSafeUrl).toHaveBeenCalledWith("http://localhost:8080");
  });

  it("auto-tests after save and persists status=connected when testConnection succeeds", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([]); // no existing row → insert path

    // GA with valid measurementId and valid serviceAccountJson → testConnection is pure
    // validation with no network calls; it will return ok:true
    const res = await request(buildApp())
      .put("/api/integrations/google_analytics")
      .send({
        enabled: true,
        config: { measurementId: "G-ABCDEF1234" },
        secrets: {
          serviceAccountJson: JSON.stringify({ type: "service_account" }),
        },
      });

    expect(res.status).toBe(200);

    // db.update must have been called to persist status=connected after auto-test
    const statusUpdate = mockUpdateSet.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).status === "connected",
    );
    expect(statusUpdate).toBeDefined();
  });

  it("saves and activates an Instagram Zernio account mapping", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .put("/api/integrations/instagram_zernio")
      .send({
        name: "Instagram Zernio",
        enabled: true,
        config: {
          accountId: "zernio-account-123",
          profileId: "zernio-profile-456",
        },
      });

    expect(res.status).toBe(200);
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      type: "instagram_zernio",
      tenantId: TENANT_ID,
      enabled: true,
      config: {
        accountId: "zernio-account-123",
        profileId: "zernio-profile-456",
      },
    }));
    expect(mockUpdateSet.mock.calls.some(
      (call: unknown[]) => (call[0] as Record<string, unknown>).status === "connected",
    )).toBe(true);
  });

  it("does not mark an incomplete Instagram Zernio mapping connected", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .put("/api/integrations/instagram_zernio")
      .send({
        enabled: true,
        config: { accountId: "zernio-account-123" },
      });

    expect(res.status).toBe(200);
    expect(mockUpdateSet.mock.calls.some(
      (call: unknown[]) => (call[0] as Record<string, unknown>).status === "error",
    )).toBe(true);
  });

  it("configures authenticated Evolution receive events when the integration is saved", async () => {
    const restoreEnv = setWebhookTestEnvironment("https://app.example.com/api");
    try {
      asAdmin();
      mockLimit.mockResolvedValueOnce([]);
      mockSsrfFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: JSON.stringify({ instance: { state: "open" } }),
        })
        .mockResolvedValueOnce({ ok: true, status: 201 });

      const res = await request(buildApp())
        .put("/api/integrations/whatsapp_evolution")
        .send({
          enabled: true,
          config: { baseUrl: "https://evo.example.com", instanceName: "my-instance" },
          secrets: { apiKey: WA_SECRETS.apiKey },
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.webhook).toEqual({
        ok: true,
        message: "Webhook de recebimento do WhatsApp configurado.",
      });
      expect(mockSsrfFetch).toHaveBeenCalledTimes(2);
      const [url, options] = mockSsrfFetch.mock.calls[1] as [
        string,
        { method: string; headers: Record<string, string>; body: string },
      ];
      expect(url).toBe("https://evo.example.com/webhook/set/my-instance");
      expect(options.method).toBe("POST");
      expect(options.headers.apikey).toBe(WA_SECRETS.apiKey);
      const body = JSON.parse(options.body) as {
        webhook: {
          enabled: boolean;
          url: string;
          events: string[];
          base64: boolean;
          byEvents: boolean;
        };
      };
      expect(body).toEqual({
        webhook: {
          enabled: true,
          url: "https://app.example.com/api/webhooks/whatsapp/evolution/my-instance",
          events: ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"],
          base64: false,
          byEvents: false,
        },
      });
      expect(res.text).not.toContain(WA_SECRETS.apiKey);
    } finally {
      restoreEnv();
    }
  });

  it("configures the receive webhook even when the WhatsApp session is disconnected", async () => {
    const restoreEnv = setWebhookTestEnvironment("https://app.example.com");
    try {
      asAdmin();
      mockLimit.mockResolvedValueOnce([]);
      mockSsrfFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: JSON.stringify({ instance: { state: "close" } }),
        })
        .mockResolvedValueOnce({ ok: true, status: 201 });

      const res = await request(buildApp())
        .put("/api/integrations/whatsapp_evolution")
        .send({
          enabled: true,
          config: { baseUrl: "https://evo.example.com", instanceName: "my-instance" },
          secrets: { apiKey: WA_SECRETS.apiKey },
        });

      expect(res.status).toBe(200);
      expect(res.body.webhook).toEqual({
        ok: true,
        message: "Webhook de recebimento do WhatsApp configurado.",
      });
      expect(mockSsrfFetch).toHaveBeenCalledTimes(2);
      expect(mockUpdateSet.mock.calls.map(([values]) => values)).toContainEqual(
        expect.objectContaining({ status: "error", isDefault: false }),
      );
    } finally {
      restoreEnv();
    }
  });

  it("keeps the Evolution integration connected if webhook setup is rejected", async () => {
    const restoreEnv = setWebhookTestEnvironment("https://app.example.com");
    try {
      asAdmin();
      mockLimit.mockResolvedValueOnce([]);
      mockSsrfFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: JSON.stringify({ instance: { state: "open" } }),
        })
        .mockResolvedValueOnce({ ok: false, status: 401 });

      const res = await request(buildApp())
        .put("/api/integrations/whatsapp_evolution")
        .send({
          enabled: true,
          config: { baseUrl: "https://evo.example.com", instanceName: "my-instance" },
          secrets: { apiKey: WA_SECRETS.apiKey },
        });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.webhook.ok).toBe(false);
      expect(res.body.webhook.message).toContain("HTTP 401");
      expect(mockUpdateSet.mock.calls.some(
        (call: unknown[]) => (call[0] as Record<string, unknown>).status === "connected",
      )).toBe(true);
    } finally {
      restoreEnv();
    }
  });

  it("auto-tests after save and persists status=error when testConnection fails", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([]); // no existing row

    // Invalid measurementId → testConnection returns ok:false
    const res = await request(buildApp())
      .put("/api/integrations/google_analytics")
      .send({
        enabled: true,
        config: { measurementId: "INVALID_FORMAT" },
        secrets: {
          serviceAccountJson: JSON.stringify({ type: "service_account" }),
        },
      });

    expect(res.status).toBe(200);

    const statusUpdate = mockUpdateSet.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).status === "error",
    );
    expect(statusUpdate).toBeDefined();
  });

  it("skips auto-test when integration is disabled", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([]); // no existing row

    await request(buildApp())
      .put("/api/integrations/google_analytics")
      .send({
        enabled: false, // disabled → no auto-test
        secrets: { serviceAccountJson: JSON.stringify({ type: "service_account" }) },
      });

    // db.update should NOT be called for status (only insert + log)
    const statusUpdate = mockUpdateSet.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as Record<string, unknown>).status === "connected" ||
        (c[0] as Record<string, unknown>).status === "error",
    );
    expect(statusUpdate).toBeUndefined();
  });

  it("returns 403 for non-admin roles", async () => {
    asNonAdmin();

    const res = await request(buildApp())
      .put("/api/integrations/stripe_account")
      .send({ enabled: false });

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/integrations/:type/test ───────────────────────────────────────
// Critical: this endpoint MUST NOT persist status to the DB.

describe("POST /api/integrations/:type/test — transient probe, never persists status", () => {
  it("returns 404 for unknown integration type", async () => {
    asAdmin();

    const res = await request(buildApp())
      .post("/api/integrations/unknown_type/test")
      .send({});

    expect(res.status).toBe(404);
  });

  it("returns response with ok, status, and message fields", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([GA_ROW]); // provides stored serviceAccountJson

    const res = await request(buildApp())
      .post("/api/integrations/google_analytics/test")
      .send({
        config: { measurementId: "G-ABCDEF1234" },
        secrets: { serviceAccountJson: MASK }, // use stored secret
      });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("ok");
    expect(res.body).toHaveProperty("status");
    expect(res.body).toHaveProperty("message");
  });

  it("CRITICAL: db.update is never called — status is not persisted", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([GA_ROW]);

    await request(buildApp())
      .post("/api/integrations/google_analytics/test")
      .send({
        config: { measurementId: "G-ABCDEF1234" },
        secrets: { serviceAccountJson: MASK },
      });

    // The /test endpoint must never write status back to the DB
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("writes an audit log (db.insert) even when not persisting status", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([GA_ROW]);

    await request(buildApp())
      .post("/api/integrations/google_analytics/test")
      .send({
        config: { measurementId: "G-ABCDEF1234" },
        secrets: { serviceAccountJson: MASK },
      });

    // Audit log must be written via db.insert
    expect(mockInsert).toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalled();
    // And db.update must still not be called
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns ok=false when secret is MASK and no stored secret exists", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([]); // no existing row → no stored secrets

    const res = await request(buildApp())
      .post("/api/integrations/stripe_account/test")
      .send({ secrets: { secretKey: MASK } });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/Informe/i);
    // No DB status update even on error path
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("google_analytics: valid measurementId + serviceAccountJson → ok=true, no db.update", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([GA_ROW]); // provides stored secret

    const res = await request(buildApp())
      .post("/api/integrations/google_analytics/test")
      .send({
        config: { measurementId: "G-ABCDEF1234" },
        secrets: { serviceAccountJson: MASK },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("google_analytics: invalid measurementId format → ok=false, no db.update", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([GA_ROW]);

    const res = await request(buildApp())
      .post("/api/integrations/google_analytics/test")
      .send({
        config: { measurementId: "INVALID" },
        secrets: { serviceAccountJson: MASK },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/inválido/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("google_analytics: invalid serviceAccountJson (not valid JSON) → ok=false, no db.update", async () => {
    asAdmin();
    // Provide bad JSON directly in request (not MASK so stored secret is NOT used)
    mockLimit.mockResolvedValueOnce([]); // no existing row

    const res = await request(buildApp())
      .post("/api/integrations/google_analytics/test")
      .send({
        config: {},
        secrets: { serviceAccountJson: "not-valid-json{{{" },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/JSON/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("google_analytics: JSON missing type=service_account → ok=false", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([]);

    const res = await request(buildApp())
      .post("/api/integrations/google_analytics/test")
      .send({
        config: {},
        secrets: { serviceAccountJson: JSON.stringify({ type: "oauth_client" }) },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/service_account/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("whatsapp_evolution: ok response from provider → ok=true, no db.update", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([WHATSAPP_ROW]);
    mockAssertSafeUrl.mockResolvedValueOnce(undefined);
    mockSsrfFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: JSON.stringify({ instance: { state: "open" } }),
    });

    const res = await request(buildApp())
      .post("/api/integrations/whatsapp_evolution/test")
      .send({
        config: { baseUrl: "https://evo.example.com", instanceName: "my-instance" },
        secrets: { apiKey: MASK },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("whatsapp_evolution: a 200 response with a closed session is not reported as connected", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([WHATSAPP_ROW]);
    mockAssertSafeUrl.mockResolvedValueOnce(undefined);
    mockSsrfFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: JSON.stringify({ instance: { state: "close" } }),
    });

    const res = await request(buildApp())
      .post("/api/integrations/whatsapp_evolution/test")
      .send({
        config: { baseUrl: "https://evo.example.com", instanceName: "my-instance" },
        secrets: { apiKey: MASK },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/sessão do WhatsApp está desconectada/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("whatsapp_evolution: 401 from provider → ok=false with message, no db.update", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([WHATSAPP_ROW]);
    mockAssertSafeUrl.mockResolvedValueOnce(undefined);
    mockSsrfFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const res = await request(buildApp())
      .post("/api/integrations/whatsapp_evolution/test")
      .send({
        config: { baseUrl: "https://evo.example.com", instanceName: "my-instance" },
        secrets: { apiKey: MASK },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.message).toMatch(/401/);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("whatsapp_evolution: 404 identifies the base URL and instance-name mismatch", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([WHATSAPP_ROW]);
    mockAssertSafeUrl.mockResolvedValueOnce(undefined);
    mockSsrfFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const res = await request(buildApp())
      .post("/api/integrations/whatsapp_evolution/test")
      .send({
        config: { baseUrl: "https://evo.example.com", instanceName: "my-instance" },
        secrets: { apiKey: MASK },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: false,
      status: "error",
      message: "Instância não encontrada neste servidor (HTTP 404). Confirme a URL Base e o Nome da Instância exatos na mesma instalação Evolution.",
    });
    expect(mockSsrfFetch).toHaveBeenCalledWith(
      "https://evo.example.com/instance/connectionState/my-instance",
      expect.any(Object),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("whatsapp_evolution: SSRF block during test → ok=false, no db.update", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([WHATSAPP_ROW]);
    mockAssertSafeUrl.mockRejectedValueOnce(new Error("URL não permitida: host interno."));

    const res = await request(buildApp())
      .post("/api/integrations/whatsapp_evolution/test")
      .send({
        config: { baseUrl: "http://192.168.1.1", instanceName: "x" },
        secrets: { apiKey: MASK },
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 for non-admin roles", async () => {
    asNonAdmin();

    const res = await request(buildApp())
      .post("/api/integrations/google_analytics/test")
      .send({});

    expect(res.status).toBe(403);
  });
});

// ─── POST /api/integrations/:type/revoke ─────────────────────────────────────

describe("POST /api/integrations/:type/revoke — clear credentials", () => {
  it("returns {ok: true}", async () => {
    asAdmin();

    const res = await request(buildApp()).post("/api/integrations/stripe_account/revoke");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("zeros secretsEncrypted in the DB update", async () => {
    asAdmin();

    await request(buildApp()).post("/api/integrations/stripe_account/revoke");

    expect(mockUpdate).toHaveBeenCalled();
    const setArgs = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.secretsEncrypted).toBeNull();
  });

  it("sets enabled=false in the DB update", async () => {
    asAdmin();

    await request(buildApp()).post("/api/integrations/mercadopago/revoke");

    const setArgs = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.enabled).toBe(false);
  });

  it("sets status=disconnected in the DB update", async () => {
    asAdmin();

    await request(buildApp()).post("/api/integrations/google_analytics/revoke");

    const setArgs = mockUpdateSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArgs.status).toBe("disconnected");
  });

  it("clears the default flag when revoking an Evolution connection", async () => {
    asAdmin();

    await request(buildApp())
      .post("/api/integrations/whatsapp_evolution/revoke")
      .send({ integrationId: "wa-default" });

    expect(mockUpdateSet.mock.calls[0]?.[0]).toMatchObject({
      enabled: false,
      status: "disconnected",
      isDefault: false,
    });
  });

  it("writes an audit log with event=revoke", async () => {
    asAdmin();

    await request(buildApp()).post("/api/integrations/stripe_account/revoke");

    expect(mockInsert).toHaveBeenCalled();
    const logValues = mockInsertValues.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).event === "revoke",
    );
    expect(logValues).toBeDefined();
  });

  it("works for all registered integration types", async () => {
    const types = [
      "whatsapp_evolution",
      "stripe_account",
      "mercadopago",
      "google_analytics",
      "distribution_reference",
      "instagram_zernio",
    ];

    for (const type of types) {
      vi.clearAllMocks();
      mockUpdateWhere.mockResolvedValue([]);
      mockUpdateSet.mockReturnValue({ where: mockUpdateWhere });
      mockUpdate.mockReturnValue({ set: mockUpdateSet });
      mockInsertValues.mockResolvedValue([]);
      mockInsert.mockReturnValue({ values: mockInsertValues });

      asAdmin();

      const res = await request(buildApp()).post(`/api/integrations/${type}/revoke`);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    }
  });

  it("returns 404 for unknown type", async () => {
    asAdmin();

    const res = await request(buildApp()).post("/api/integrations/nonexistent/revoke");

    expect(res.status).toBe(404);
  });

  it("returns 403 for non-admin roles", async () => {
    asNonAdmin();

    const res = await request(buildApp()).post("/api/integrations/stripe_account/revoke");

    expect(res.status).toBe(403);
  });
});

// ─── GET /api/integrations/:type/logs ────────────────────────────────────────

describe("GET /api/integrations/:type/logs — audit log entries", () => {
  it("returns 200 with a JSON array of log entries", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([LOG_ROW]);

    const res = await request(buildApp()).get("/api/integrations/stripe_account/logs");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const [entry] = res.body;
    expect(entry.id).toBe(LOG_ROW.id);
    expect(entry.event).toBe("save");
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("Configuração salva");
    expect(entry.actorName).toBe("Admin User");
    expect(typeof entry.createdAt).toBe("string");
  });

  it("log entries never expose secretsEncrypted or raw secret values", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([
      { ...LOG_ROW, message: "Credenciais revogadas e integração desativada (Stripe (conta da agência))." },
    ]);

    const res = await request(buildApp()).get("/api/integrations/stripe_account/logs");

    expect(res.status).toBe(200);
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain("secretsEncrypted");
    expect(bodyStr).not.toContain("sk_test");
    expect(bodyStr).not.toContain("whsec_");
  });

  it("log entries do not include tenantId or internal DB fields", async () => {
    asAdmin();
    mockLimit.mockResolvedValueOnce([LOG_ROW]);

    const res = await request(buildApp()).get("/api/integrations/stripe_account/logs");

    expect(res.status).toBe(200);
    const [entry] = res.body;
    expect(entry).not.toHaveProperty("tenantId");
    expect(entry).not.toHaveProperty("actorId");
  });

  it("returns 404 for unknown integration type", async () => {
    asAdmin();

    const res = await request(buildApp()).get("/api/integrations/unknown_type/logs");

    expect(res.status).toBe(404);
  });

  it("returns 403 for non-admin roles", async () => {
    asNonAdmin();

    const res = await request(buildApp()).get("/api/integrations/stripe_account/logs");

    expect(res.status).toBe(403);
  });
});
