import { db, storesTable, tenantIntegrationsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { encryptCredential, decryptCredential, isEncrypted } from "./crypto";
import { logger } from "./logger";

// One-shot, idempotent migration: walks every store row and encrypts any
// stripeSecretKey / mpAccessToken / pixKey still in plaintext. Re-runs are
// safe — already-encrypted values are detected by their `enc:v1:` prefix
// and skipped. Called at server startup after drizzle migrations.
export async function backfillEncryptedCredentials(): Promise<void> {
  if (!process.env["CREDENTIAL_ENCRYPTION_KEY"]) return;

  let rows: { id: string; stripeSecretKey: string | null; mpAccessToken: string | null; pixKey: string | null }[];
  try {
    rows = await db
      .select({
        id: storesTable.id,
        stripeSecretKey: storesTable.stripeSecretKey,
        mpAccessToken: storesTable.mpAccessToken,
        pixKey: storesTable.pixKey,
      })
      .from(storesTable);
  } catch (err) {
    // On a brand-new database the stores table may not exist yet (migrations
    // still running or schema push not yet complete). Skip gracefully.
    logger.warn({ err }, "[credential-backfill] Skipping — stores table not accessible yet");
    return;
  }

  let updated = 0;
  for (const r of rows) {
    const patch: Record<string, string> = {};
    if (r.stripeSecretKey && !isEncrypted(r.stripeSecretKey)) {
      patch["stripeSecretKey"] = encryptCredential(r.stripeSecretKey);
    }
    if (r.mpAccessToken && !isEncrypted(r.mpAccessToken)) {
      patch["mpAccessToken"] = encryptCredential(r.mpAccessToken);
    }
    if (r.pixKey && !isEncrypted(r.pixKey)) {
      patch["pixKey"] = encryptCredential(r.pixKey);
    }
    if (Object.keys(patch).length > 0) {
      await db.update(storesTable).set(patch).where(eq(storesTable.id, r.id));
      updated++;
    }
  }

  if (updated > 0) {
    logger.info({ updated }, "[credential-backfill] Encrypted plaintext gateway credentials");
  }

  // ── MercadoPago system_configs → tenant_integrations migration backfill ──
  // Migration 0069 copies the raw accessToken into config._mig_accessToken so
  // that SQL can do the row move without an encryption library. This backfill
  // encrypts and promotes that temp field into secrets_encrypted, then clears it.
  // Non-fatal: if tenant_integrations doesn't exist yet (fresh environment that
  // hasn't run migrations) we skip gracefully rather than aborting boot.
  try {
    await backfillMercadoPagoMigratedSecrets();
  } catch (err) {
    // PostgreSQL error code 42P01 = "undefined_table" (relation does not exist).
    // Drizzle wraps the original PG error in _DrizzleQueryError, so the PG error
    // may be at err.cause. We check both levels to be safe.
    const pgCode =
      (err as Record<string, unknown> | null)?.["code"] ??
      ((err as Record<string, unknown> | null)?.["cause"] as Record<string, unknown> | null)?.["code"];
    if (pgCode === "42P01") {
      logger.debug(
        "[credential-backfill] tenant_integrations table not yet created — MercadoPago backfill skipped (expected in fresh environments)",
      );
    } else {
      logger.warn(
        { err },
        "[credential-backfill] MercadoPago migration backfill skipped — unexpected error",
      );
    }
  }
}

// Idempotent: only touches rows that still have the `_mig_accessToken` temp
// field in their config. Safe to call multiple times.
async function backfillMercadoPagoMigratedSecrets(): Promise<void> {
  const rows = await db
    .select({
      id: tenantIntegrationsTable.id,
      tenantId: tenantIntegrationsTable.tenantId,
      config: tenantIntegrationsTable.config,
      secretsEncrypted: tenantIntegrationsTable.secretsEncrypted,
    })
    .from(tenantIntegrationsTable)
    .where(eq(tenantIntegrationsTable.type, "mercadopago"));

  let promoted = 0;
  for (const row of rows) {
    const config = (row.config ?? {}) as Record<string, string>;
    const rawToken = config["_mig_accessToken"];

    if (!rawToken) continue;

    // Merge with any already-stored secrets (keeps the function idempotent).
    let existingSecrets: Record<string, string> = {};
    if (row.secretsEncrypted) {
      try {
        const plain = decryptCredential(row.secretsEncrypted);
        const parsed: unknown = JSON.parse(plain);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          existingSecrets = parsed as Record<string, string>;
        }
      } catch {
        // Corrupted blob — start fresh; admin must re-enter secrets.
      }
    }

    const resolvedSecrets: Record<string, string> = {
      ...existingSecrets,
      accessToken: rawToken,
    };

    const newSecretsEncrypted = encryptCredential(JSON.stringify(resolvedSecrets));

    // Remove the temp migration field from config before saving.
    const cleanConfig: Record<string, string> = { ...config };
    delete cleanConfig["_mig_accessToken"];

    await db
      .update(tenantIntegrationsTable)
      .set({ config: cleanConfig, secretsEncrypted: newSecretsEncrypted })
      .where(
        and(
          eq(tenantIntegrationsTable.id, row.id),
          eq(tenantIntegrationsTable.tenantId, row.tenantId),
        ),
      );

    promoted++;
  }

  if (promoted > 0) {
    logger.info(
      { promoted },
      "[credential-backfill] Promoted MercadoPago accessToken from system_configs migration",
    );
  }
}
