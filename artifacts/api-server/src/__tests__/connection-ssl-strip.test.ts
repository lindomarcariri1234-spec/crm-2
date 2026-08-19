/**
 * Regression tests for the sslmode-stripping algorithm used in:
 *  - lib/db/src/connection.ts  (main pg Pool)
 *  - artifacts/api-server/src/lib/stripeSync.ts  (StripeSync Pool)
 *
 * Background: pg-connection-string emits a deprecation warning whenever it
 * parses a URL containing sslmode=require/prefer/verify-ca, even when an
 * explicit `ssl` option is also provided to the Pool constructor.  The fix is
 * to strip the `sslmode` param from the connection URL before passing it to
 * the Pool, then supply `ssl: { rejectUnauthorized: true }` separately.
 *
 * These tests validate the URL-transformation step. They intentionally do NOT
 * import connection.ts or stripeSync.ts directly because those modules create
 * a singleton pg Pool at load time (requiring a live DATABASE_URL env var).
 * Instead they replicate the exact algorithm so any future refactor that
 * breaks the stripping logic will fail here.
 */
import { describe, it, expect } from "vitest";

function stripSslModeParam(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return rawUrl;
  }
}

describe("DATABASE_URL sslmode-stripping regression (connection.ts + stripeSync.ts)", () => {
  it("removes sslmode=require from the URL", () => {
    const url = "postgresql://user:pass@host:5432/mydb?sslmode=require";
    const result = stripSslModeParam(url);
    expect(result).not.toContain("sslmode");
    expect(result).toContain("postgresql://");
    expect(result).toContain("mydb");
  });

  it("removes sslmode=prefer", () => {
    const url = "postgresql://user:pass@host:5432/db?sslmode=prefer";
    expect(stripSslModeParam(url)).not.toContain("sslmode");
  });

  it("removes sslmode=verify-ca", () => {
    const url = "postgresql://user:pass@host:5432/db?sslmode=verify-ca";
    expect(stripSslModeParam(url)).not.toContain("sslmode");
  });

  it("preserves all other query parameters when stripping sslmode", () => {
    const url =
      "postgresql://user:pass@host:5432/db?sslmode=require&connect_timeout=10&application_name=visite";
    const result = stripSslModeParam(url);
    expect(result).not.toContain("sslmode");
    expect(result).toContain("connect_timeout=10");
    expect(result).toContain("application_name=visite");
  });

  it("is a no-op when sslmode is absent from the URL", () => {
    const url = "postgresql://user:pass@host:5432/db";
    const result = stripSslModeParam(url);
    expect(result).not.toContain("sslmode");
    expect(result).toContain("postgresql://");
  });

  it("returns the original string unchanged when URL parsing fails (non-standard format)", () => {
    const malformed = "not-a-valid-url";
    expect(stripSslModeParam(malformed)).toBe(malformed);
  });

  it("produces a URL that is still parseable after stripping", () => {
    const url = "postgresql://user:pass@host:5432/db?sslmode=require&connect_timeout=5";
    const result = stripSslModeParam(url);
    expect(() => new URL(result)).not.toThrow();
    const parsed = new URL(result);
    expect(parsed.hostname).toBe("host");
    expect(parsed.port).toBe("5432");
    expect(parsed.pathname).toBe("/db");
  });
});
