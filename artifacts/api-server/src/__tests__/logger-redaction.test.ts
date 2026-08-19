/**
 * Logger redaction tests: verifies the shared `redactConfig` exported from
 * `lib/logger.ts` censors PII and secret fields (top-level and one level deep)
 * while leaving non-sensitive fields untouched.
 *
 * We build a fresh pino instance writing to an in-memory stream so we can read
 * back the serialized JSON and assert on the redacted payload.
 */

import { describe, it, expect } from "vitest";
import pino from "pino";
import { redactConfig, REDACT_PATHS } from "../lib/logger";

const REDACTED = "[REDACTED]";

function captureLogs(emit: (log: pino.Logger) => void): Record<string, unknown>[] {
  const lines: string[] = [];
  const destination = {
    write(chunk: string) {
      lines.push(chunk);
    },
  };
  const log = pino({ redact: redactConfig }, destination as unknown as pino.DestinationStream);
  emit(log);
  return lines
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("logger redactConfig", () => {
  it("exposes a paths array and a [REDACTED] censor", () => {
    expect(Array.isArray(redactConfig.paths)).toBe(true);
    expect(redactConfig.paths).toBe(REDACT_PATHS);
    expect(redactConfig.censor).toBe(REDACTED);
  });

  it("censors top-level PII fields (email, cpf, phone, whatsapp, birthDate)", () => {
    const [entry] = captureLogs((log) =>
      log.info({
        email: "joao@example.com",
        cpf: "123.456.789-00",
        phone: "11999998888",
        whatsapp: "5511999998888",
        birthDate: "1990-01-01",
      }, "client created"),
    );

    expect(entry.email).toBe(REDACTED);
    expect(entry.cpf).toBe(REDACTED);
    expect(entry.phone).toBe(REDACTED);
    expect(entry.whatsapp).toBe(REDACTED);
    expect(entry.birthDate).toBe(REDACTED);
  });

  it("censors top-level secret fields (token, accessToken, apiKey, password, pixKey, stripeSecretKey)", () => {
    const [entry] = captureLogs((log) =>
      log.info({
        token: "tok_live_abc",
        accessToken: "ya29.secret",
        refreshToken: "1//refresh",
        apiKey: "sk_test_123",
        password: "hunter2",
        secret: "shhh",
        pixKey: "pix-123",
        stripeSecretKey: "sk_live_xyz",
      }, "credential captured"),
    );

    expect(entry.token).toBe(REDACTED);
    expect(entry.accessToken).toBe(REDACTED);
    expect(entry.refreshToken).toBe(REDACTED);
    expect(entry.apiKey).toBe(REDACTED);
    expect(entry.password).toBe(REDACTED);
    expect(entry.secret).toBe(REDACTED);
    expect(entry.pixKey).toBe(REDACTED);
    expect(entry.stripeSecretKey).toBe(REDACTED);
  });

  it("censors sensitive fields nested one level deep (*.field)", () => {
    const [entry] = captureLogs((log) =>
      log.info({
        client: { name: "João Silva", email: "joao@example.com", cpf: "123.456.789-00" },
        config: { apiKey: "sk_test_123", baseUrl: "https://api.example.com" },
      }, "nested payload"),
    );

    const client = entry.client as Record<string, unknown>;
    const config = entry.config as Record<string, unknown>;
    expect(client.email).toBe(REDACTED);
    expect(client.cpf).toBe(REDACTED);
    expect(config.apiKey).toBe(REDACTED);
    // Non-sensitive siblings are preserved
    expect(client.name).toBe("João Silva");
    expect(config.baseUrl).toBe("https://api.example.com");
  });

  it("censors request authorization and cookie headers", () => {
    const [entry] = captureLogs((log) =>
      log.info({
        req: {
          method: "POST",
          headers: {
            authorization: "Bearer secret-token",
            cookie: "session=abc123",
            "content-type": "application/json",
          },
        },
      }, "incoming request"),
    );

    const req = entry.req as Record<string, unknown>;
    const headers = req.headers as Record<string, unknown>;
    expect(headers.authorization).toBe(REDACTED);
    expect(headers.cookie).toBe(REDACTED);
    // Non-sensitive header preserved
    expect(headers["content-type"]).toBe("application/json");
  });

  it("leaves non-sensitive fields untouched", () => {
    const [entry] = captureLogs((log) =>
      log.info({
        id: "client-001",
        name: "Maria",
        status: "active",
        tenantId: "tenant-001",
        count: 42,
      }, "no sensitive data"),
    );

    expect(entry.id).toBe("client-001");
    expect(entry.name).toBe("Maria");
    expect(entry.status).toBe("active");
    expect(entry.tenantId).toBe("tenant-001");
    expect(entry.count).toBe(42);
  });
});
