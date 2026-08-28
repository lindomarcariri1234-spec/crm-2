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
 * These tests validate the shared URL/SSL configuration helper. They
 * intentionally do NOT import connection.ts or stripeSync.ts directly because
 * those modules create a singleton pg Pool at load time.
 */
import { describe, it, expect } from "vitest";
import { buildDatabaseConnectionConfig } from "../../../../lib/db/src/ssl.js";

function productionConfig(rawUrl: string) {
  return buildDatabaseConnectionConfig(rawUrl, true);
}

describe("DATABASE_URL sslmode-stripping regression (connection.ts + stripeSync.ts)", () => {
  it("removes sslmode=require from the URL", () => {
    const url = "postgresql://user:pass@host:5432/mydb?sslmode=require";
    const result = productionConfig(url);
    expect(result.connectionString).not.toContain("sslmode");
    expect(result.connectionString).toContain("postgresql://");
    expect(result.connectionString).toContain("mydb");
    expect(result.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("removes sslmode=prefer", () => {
    const url = "postgresql://user:pass@host:5432/db?sslmode=prefer";
    expect(productionConfig(url).connectionString).not.toContain("sslmode");
  });

  it("removes sslmode=verify-ca", () => {
    const url = "postgresql://user:pass@host:5432/db?sslmode=verify-ca";
    expect(productionConfig(url).connectionString).not.toContain("sslmode");
  });

  it("preserves all other query parameters when stripping sslmode", () => {
    const url =
      "postgresql://user:pass@host:5432/db?sslmode=require&connect_timeout=10&application_name=visite";
    const result = productionConfig(url).connectionString;
    expect(result).not.toContain("sslmode");
    expect(result).toContain("connect_timeout=10");
    expect(result).toContain("application_name=visite");
  });

  it("is a no-op when sslmode is absent from the URL", () => {
    const url = "postgresql://user:pass@host:5432/db";
    const result = productionConfig(url).connectionString;
    expect(result).not.toContain("sslmode");
    expect(result).toContain("postgresql://");
  });

  it("keeps strict verification when URL parsing fails", () => {
    const malformed = "not-a-valid-url";
    expect(productionConfig(malformed)).toEqual({
      connectionString: malformed,
      ssl: { rejectUnauthorized: true },
    });
  });

  it("produces a URL that is still parseable after stripping", () => {
    const url = "postgresql://user:pass@host:5432/db?sslmode=require&connect_timeout=5";
    const result = productionConfig(url).connectionString;
    expect(() => new URL(result)).not.toThrow();
    const parsed = new URL(result);
    expect(parsed.hostname).toBe("host");
    expect(parsed.port).toBe("5432");
    expect(parsed.pathname).toBe("/db");
  });

  it("keeps TLS but accepts the official Supabase pooler certificate chain", () => {
    const result = productionConfig(
      "postgresql://user:pass@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require",
    );

    expect(result.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("does not relax verification for lookalike Supabase hostnames", () => {
    const result = productionConfig(
      "postgresql://user:pass@pooler.supabase.com.evil.example:5432/postgres",
    );

    expect(result.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("does not add SSL options outside production", () => {
    const url = "postgresql://user:pass@host:5432/db?sslmode=require";
    expect(buildDatabaseConnectionConfig(url, false)).toEqual({
      connectionString: url,
    });
  });
});
