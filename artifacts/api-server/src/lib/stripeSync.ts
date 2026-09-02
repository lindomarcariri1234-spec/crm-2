import { StripeSync, runMigrations } from "stripe-replit-sync";
import type Stripe from "stripe";
import { getStripeSecretKey, getUncachableStripeClient } from "./stripeClient";
import { logger } from "./logger";
import {
  buildDatabaseConnectionConfig,
  db,
  platformSettingsTable,
  tenantsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateId } from "./id";
import { dispatchOutboundMessage } from "../services/outbound-delivery";

let _stripeSyncInstance: StripeSync | null = null;

export interface StripeSyncTablesStatus {
  ok: boolean | null;
  checkedAt: string | null;
}

// null means the table assertion has not completed yet (or could not be
// evaluated). Keep the timestamp separately so the health dashboard can show
// when an attempted check last ran, even when its result is unknown.
let _stripeSyncTablesOk: boolean | null = null;
let _stripeSyncTablesCheckedAt: string | null = null;

export function getStripeSyncTablesStatus(): StripeSyncTablesStatus {
  return {
    ok: _stripeSyncTablesOk,
    checkedAt: _stripeSyncTablesCheckedAt,
  };
}

/**
 * Tracks whether initStripeSync() has finished running (success OR failure).
 *
 * While this is false, the server is still in its startup window and the
 * StripeSync instance / managed webhook secret may still be on its way. The
 * webhook handler uses this to decide between asking Stripe to retry (503,
 * init still in progress) and a hard rejection (400, init done and genuinely
 * unconfigured).
 */
let _initCompleted = false;

export function getStripeSync(): StripeSync | null {
  return _stripeSyncInstance;
}

/**
 * Whether initStripeSync() has completed (either successfully or by warning out).
 * Returns false during the boot window before init has finished.
 */
export function isStripeSyncInitComplete(): boolean {
  return _initCompleted;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The signing secret of the managed webhook endpoint, cached at startup.
 *
 * stripe-replit-sync stores this in stripe._managed_webhooks.secret at creation
 * time. We cache it here so the webhook handler can verify incoming Stripe events
 * even when STRIPE_WEBHOOK_SECRET is not set in the environment — eliminating the
 * need to manually copy the secret after production first-boot.
 *
 * Cache is populated in two paths:
 *   1. New webhook — Stripe returns `secret` in the creation response.
 *   2. Existing webhook — query stripe._managed_webhooks directly via the sync pool.
 */
let _cachedManagedWebhookSecret: string | null = null;

/**
 * Return the managed webhook signing secret.
 *
 * Returns the in-memory cached value if available (set during initStripeSync).
 * Falls back to a live DB query when called before init completes (rare — only
 * possible for events delivered during server startup).
 */
export async function getManagedWebhookSigningSecret(): Promise<string | null> {
  if (_cachedManagedWebhookSecret) return _cachedManagedWebhookSecret;

  // Events delivered during the server's startup window can arrive before
  // initStripeSync() has created the StripeSync instance. Rather than failing
  // immediately, wait with a short backoff for init to make progress — but only
  // while init is still running. Once init has completed without an instance,
  // waiting longer is pointless.
  if (!_stripeSyncInstance && !_initCompleted) {
    const backoffsMs = [200, 300, 500];
    for (const delay of backoffsMs) {
      await sleep(delay);
      if (_cachedManagedWebhookSecret) return _cachedManagedWebhookSecret;
      if (_stripeSyncInstance || _initCompleted) break;
    }
  }

  if (!_stripeSyncInstance) return null;

  try {
    const result = await _stripeSyncInstance.postgresClient.query(
      "SELECT secret FROM stripe._managed_webhooks ORDER BY created DESC LIMIT 1",
    );
    const secret = (result.rows[0] as { secret?: string } | undefined)?.secret ?? null;
    if (secret) _cachedManagedWebhookSecret = secret;
    return secret;
  } catch {
    return null;
  }
}

/**
 * The path every VisiteCRM Stripe webhook endpoint must resolve to. Used by the
 * duplicate-endpoint audit to identify endpoints that target this app.
 */
const WEBHOOK_PATH = "/api/stripe/webhook";

export interface WebhookAuditStatus {
  /**
   * "ok" — one or zero enabled endpoints target this app (nothing wrong).
   * "duplicate" — more than one enabled endpoint targets this app.
   * "unknown" — the audit has not run yet, or the last run could not reach Stripe.
   */
  status: "ok" | "duplicate" | "unknown";
  duplicateCount: number;
  endpoints: Array<{ id: string; url: string }>;
  checkedAt: string | null;
}

let _lastWebhookAudit: WebhookAuditStatus = {
  status: "unknown",
  duplicateCount: 0,
  endpoints: [],
  checkedAt: null,
};

// ─── Duplicate-webhook alert rate-limiting ────────────────────────────────────
// At most one email alert per 24 hours so a restart loop does not spam the
// operator.
//
// Two-layer debounce:
//   1. In-process: `_lastDuplicateWebhookAlertSentAt` — set synchronously (before
//      any async work) so concurrent audit calls in the same process cannot both
//      race through the guard. Also used as the in-flight lock: set immediately,
//      cleared on failure.
//   2. Cross-restart: timestamp persisted in `platform_settings` under the key
//      `stripe_duplicate_webhook_alert_sent_at`. Read inside the async IIFE to
//      prevent re-sending after a server restart within the 24-hour window.
//      Falls back gracefully when the DB is unavailable.
const DUPLICATE_WEBHOOK_ALERT_RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours
const DUPLICATE_WEBHOOK_ALERT_SETTING_KEY = "stripe_duplicate_webhook_alert_sent_at";
let _lastDuplicateWebhookAlertSentAt: number | null = null;

/**
 * Resolve the operator alert email address.
 * Reads from the `redis_alert_email` platform setting first (reusing the same
 * setting as the Redis alert path); falls back to the SUPERADMIN_EMAIL env var.
 */
async function getAlertEmail(): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "redis_alert_email"))
      .limit(1);
    if (row?.value?.trim()) return row.value.trim();
  } catch {
    // DB unavailable — fall back to env var
  }
  return process.env["SUPERADMIN_EMAIL"]?.trim() ?? null;
}

async function getAlertTenantId(): Promise<string | null> {
  const [tenant] = await db.select({ id: tenantsTable.id }).from(tenantsTable).limit(1);
  return tenant?.id ?? null;
}

/**
 * Return the result of the most recent duplicate-webhook-endpoint audit, for
 * display in the admin UI (e.g. a warning banner on the Plans page). Reflects
 * whatever the last `initStripeSync()` run found; "unknown" until the first
 * successful audit or when the last attempt could not reach Stripe.
 */
export function getWebhookAuditStatus(): WebhookAuditStatus {
  return _lastWebhookAudit;
}

/**
 * Re-run the duplicate-webhook endpoint audit immediately.
 *
 * Resets the in-process and DB rate-limit state so a new alert email can fire
 * if the problem recurs after the operator thinks they've fixed it.
 * Returns the fresh audit status.
 *
 * Called by the admin "Re-verificar agora" action on the Plans page.
 */
export async function recheckWebhookAudit(): Promise<WebhookAuditStatus> {
  // Reset in-process rate-limit so a new detected duplicate triggers a new email.
  _lastDuplicateWebhookAlertSentAt = null;

  // Clear the persisted DB timestamp so the 24-hour window is also reset
  // across restarts. Non-fatal — in-process guard is already cleared above.
  try {
    await db
      .delete(platformSettingsTable)
      .where(eq(platformSettingsTable.key, DUPLICATE_WEBHOOK_ALERT_SETTING_KEY));
  } catch {
    // DB unavailable — in-process guard is still reset; acceptable.
  }

  // Re-run the audit synchronously so the caller receives the fresh result.
  await auditDuplicateWebhookEndpoints();
  return _lastWebhookAudit;
}

/**
 * Reset the duplicate-webhook alert rate-limit state (in-process only).
 * Exported for use in unit tests only — not for production use.
 *
 * @internal
 */
export function _resetDuplicateWebhookAlertStateForTesting(): void {
  _lastDuplicateWebhookAlertSentAt = null;
  _initCompleted = false;
  _stripeSyncInstance = null;
  _stripeSyncTablesOk = null;
  _stripeSyncTablesCheckedAt = null;
  _cachedManagedWebhookSecret = null;
  _lastWebhookAudit = {
    status: "unknown",
    duplicateCount: 0,
    endpoints: [],
    checkedAt: null,
  };
}

/**
 * Audit Stripe for duplicate webhook endpoints pointing at this app.
 *
 * We recently removed a second Stripe webhook endpoint that was silently
 * delivering every billing event twice (double plan activations, misleading
 * logs). Nothing prevents this from recurring — a manually-added Dashboard
 * endpoint or a stale one left by a prior deploy would re-introduce
 * duplicate processing without anyone noticing.
 *
 * This runs after the managed webhook is registered: it lists all Stripe
 * webhook endpoints for the active mode and logs a clear WARN if more than one
 * *enabled* endpoint targets `/api/stripe/webhook`. It is fully non-fatal —
 * any error is swallowed with a warn so it can never block startup.
 */
async function auditDuplicateWebhookEndpoints(): Promise<void> {
  try {
    const stripe = await getUncachableStripeClient();

    // Paginate through all endpoints — the account may have more than the
    // default page size, and a duplicate could live on a later page.
    const matching: Array<{ id: string; url: string }> = [];
    for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
      if (endpoint.status !== "enabled") continue;
      let path: string;
      try {
        path = new URL(endpoint.url).pathname;
      } catch {
        // A non-absolute URL can't target our app path; skip it.
        continue;
      }
      if (path === WEBHOOK_PATH) {
        matching.push({ id: endpoint.id, url: endpoint.url });
      }
    }

    if (matching.length > 1) {
      logger.warn(
        { count: matching.length, endpoints: matching },
        `[stripe-sync] DUPLICATE WEBHOOK ENDPOINTS DETECTED — ${matching.length} enabled endpoints target ${WEBHOOK_PATH}. ` +
          "Every billing event will be delivered multiple times (double plan activations). " +
          "Remove the extra endpoint(s) in the Stripe Dashboard, leaving only the managed one.",
      );
      _lastWebhookAudit = {
        status: "duplicate",
        duplicateCount: matching.length,
        endpoints: matching,
        checkedAt: new Date().toISOString(),
      };

      // Send an alert email to the operator — rate-limited to once per 24 hours
      // so a restart loop doesn't flood the inbox.
      //
      // In-process guard: set _lastDuplicateWebhookAlertSentAt synchronously
      // (before any await) so concurrent audit calls in the same process cannot
      // both race through the check and schedule two sends.
      const now = Date.now();
      const inProcessWithinRateLimit =
        _lastDuplicateWebhookAlertSentAt !== null &&
        now - _lastDuplicateWebhookAlertSentAt < DUPLICATE_WEBHOOK_ALERT_RATE_LIMIT_MS;

      if (inProcessWithinRateLimit) {
        logger.info(
          { rateLimitRemainingMs: DUPLICATE_WEBHOOK_ALERT_RATE_LIMIT_MS - (now - _lastDuplicateWebhookAlertSentAt!) },
          "[stripe-sync] Duplicate webhook alert email rate-limited (in-process) — skipping",
        );
      } else {
        // Claim the send slot synchronously — prevents a second concurrent audit
        // from also passing the guard before the first IIFE has a chance to run.
        _lastDuplicateWebhookAlertSentAt = now;

        void (async () => {
          try {
            // Cross-restart check: read the persisted timestamp from the DB.
            // A process restart resets the in-process timestamp, but the DB
            // record survives — so a restart loop won't re-send within 24 h.
            try {
              const [row] = await db
                .select({ value: platformSettingsTable.value })
                .from(platformSettingsTable)
                .where(eq(platformSettingsTable.key, DUPLICATE_WEBHOOK_ALERT_SETTING_KEY))
                .limit(1);
              if (row?.value) {
                const dbTs = parseInt(row.value, 10);
                if (!isNaN(dbTs) && now - dbTs < DUPLICATE_WEBHOOK_ALERT_RATE_LIMIT_MS) {
                  // DB says we already sent within 24 h — restore in-process
                  // state to the DB value so future in-process checks also skip.
                  _lastDuplicateWebhookAlertSentAt = dbTs;
                  logger.info(
                    { rateLimitRemainingMs: DUPLICATE_WEBHOOK_ALERT_RATE_LIMIT_MS - (now - dbTs) },
                    "[stripe-sync] Duplicate webhook alert email rate-limited (DB record, cross-restart) — skipping",
                  );
                  return;
                }
              }
            } catch {
              // DB unavailable — proceed with in-process guard only; acceptable
              // trade-off: at most one extra send per restart in a degraded DB state.
            }

            const alertEmail = await getAlertEmail();
            if (!alertEmail) {
              logger.warn(
                "[stripe-sync] No alert email configured (set redis_alert_email in platform settings or SUPERADMIN_EMAIL env) — skipping duplicate webhook alert email",
              );
              _lastDuplicateWebhookAlertSentAt = null; // allow retry once configured
              return;
            }

            const stripeDashboardUrl = "https://dashboard.stripe.com/webhooks";
            const tenantId = await getAlertTenantId();
            if (!tenantId) {
              _lastDuplicateWebhookAlertSentAt = null;
              logger.warn("[stripe-sync] No tenant available for duplicate webhook alert — skipping");
              return;
            }
            const endpointRows = matching
              .map((e) => `<li><code>${e.id}</code> — ${e.url}</li>`).join("");
            const dashboardLink = `<p><a href="${stripeDashboardUrl}">Abrir Stripe Dashboard — Webhooks</a></p>`;
            const outbound = await dispatchOutboundMessage({
              tenantId,
              eventType: "stripe_webhook_duplicate",
              idempotencyKey: `stripe-webhook-duplicate:${Math.floor(now / DUPLICATE_WEBHOOK_ALERT_RATE_LIMIT_MS)}:${matching.map((e) => e.id).sort().join(",")}`,
              recipient: { type: "direct", email: alertEmail },
              email: {
                subject: `[VisiteCRM] Alerta: ${matching.length} endpoints de webhook Stripe duplicados`,
                html: `<h2>⚠️ Alerta Stripe — Endpoints de Webhook Duplicados</h2><p>Foram detectados <strong>${matching.length} endpoints habilitados</strong> apontando para /api/stripe/webhook.</p><ul>${endpointRows}</ul>${dashboardLink}`,
                senderName: "VisiteCRM",
              },
              whatsapp: {
                text: `Alerta VisiteCRM: ${matching.length} endpoints de webhook Stripe duplicados. ${stripeDashboardUrl}`,
              },
              origin: "stripe-sync",
              metadata: { count: matching.length, endpoints: matching, stripeDashboardUrl },
            });
            const delivery = outbound.deliveries.find((item) => item.channel === "email");
            const success = delivery?.status === "accepted" || delivery?.status === "pending";

            if (success) {
              logger.warn(
                { count: matching.length, to: alertEmail },
                "[stripe-sync] Duplicate webhook alert email sent",
              );
              // Persist timestamp so subsequent restarts also respect the 24-hour window.
              try {
                await db
                  .insert(platformSettingsTable)
                  .values({
                    id: generateId(),
                    key: DUPLICATE_WEBHOOK_ALERT_SETTING_KEY,
                    value: String(now),
                    label: "Last Stripe duplicate webhook alert sent (unix ms)",
                  })
                  .onConflictDoUpdate({
                    target: platformSettingsTable.key,
                    set: { value: String(now) },
                  });
              } catch (dbErr) {
                // Non-fatal: in-process guard still prevents same-process spam.
                logger.warn({ err: dbErr }, "[stripe-sync] Could not persist duplicate webhook alert timestamp to DB");
              }
            } else {
              logger.error(
                { error: delivery?.lastError ?? delivery?.skippedReason },
                "[stripe-sync] Failed to send duplicate webhook alert email — clearing rate-limit so next startup can retry",
              );
              _lastDuplicateWebhookAlertSentAt = null; // allow retry
            }
          } catch (emailErr) {
            logger.error({ err: emailErr }, "[stripe-sync] Unexpected error sending duplicate webhook alert email");
            _lastDuplicateWebhookAlertSentAt = null; // allow retry
          }
        })();
      }
    } else {
      logger.info(
        { count: matching.length },
        "[stripe-sync] Webhook endpoint audit passed — no duplicate endpoints",
      );
      _lastWebhookAudit = {
        status: "ok",
        duplicateCount: matching.length,
        endpoints: matching,
        checkedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    logger.warn({ err }, "[stripe-sync] Could not audit webhook endpoints for duplicates");
    _lastWebhookAudit = {
      status: "unknown",
      duplicateCount: 0,
      endpoints: [],
      checkedAt: new Date().toISOString(),
    };
  }
}

const MANAGED_WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
];

/**
 * Initialize the Stripe sync engine: instantiate StripeSync, register/find the
 * managed webhook, and run an initial backfill of recent subscriptions.
 * Called once at server startup, after DB migrations. Non-fatal — warns on failure.
 *
 * Initialization sequence (as required by task spec):
 *   getStripeSync() → findOrCreateManagedWebhook() → syncBackfill()
 */
export async function initStripeSync(): Promise<void> {
  // Use getStripeSecretKey() — not process.env directly — so production gets the
  // live key from the Replit Connector rather than the test key baked into env vars.
  const stripeSecretKey = await getStripeSecretKey();
  const databaseUrl = process.env["DATABASE_URL"];

  if (!stripeSecretKey) {
    logger.warn("[stripe-sync] Stripe not configured — skipping StripeSync initialization");
    _initCompleted = true;
    return;
  }

  if (!databaseUrl) {
    logger.warn("[stripe-sync] DATABASE_URL not set — skipping StripeSync initialization");
    _initCompleted = true;
    return;
  }

  try {
    const databaseConnection = buildDatabaseConnectionConfig(
      databaseUrl,
      process.env["NODE_ENV"] === "production",
    );

    // Step 0: runMigrations() — provision the `stripe.*` schema and tables.
    // StripeSync does NOT auto-migrate on construction, so without this the sync
    // engine fails at runtime with `relation "stripe.accounts" does not exist`.
    try {
      await runMigrations({
        databaseUrl: databaseConnection.connectionString,
        ssl: databaseConnection.ssl,
        logger,
      });
      logger.info("[stripe-sync] Schema migrations applied");
    } catch (err) {
      logger.warn({ err }, "[stripe-sync] Failed to run schema migrations — sync tables may be missing");
    }

    // Step 1: getStripeSync() — create the StripeSync instance
    _stripeSyncInstance = new StripeSync({
      stripeSecretKey,
      poolConfig: {
        connectionString: databaseConnection.connectionString,
        ssl: databaseConnection.ssl,
      },
      logger,
    });

    logger.info("[stripe-sync] StripeSync instance created");

    // Boot-time assertion: verify that the stripe.* tables were actually
    // created by runMigrations(). If they are absent (e.g. the SQL migration
    // files were not copied into the esbuild bundle — see build.mjs and
    // stripe-sync-migrations-bundling memory note), log a CRITICAL error
    // immediately so the regression is visible in startup logs rather than
    // surfacing later as a silent billing failure.
    try {
      const assertResult = await _stripeSyncInstance.postgresClient.query(
        "SELECT EXISTS (" +
          "  SELECT 1 FROM information_schema.tables" +
          "  WHERE table_schema = 'stripe' AND table_name = 'accounts'" +
          ") AS exists",
      );
      const stripeSyncTablesExist =
        (assertResult.rows[0] as { exists?: boolean } | undefined)?.exists === true;
      _stripeSyncTablesOk = stripeSyncTablesExist;
      _stripeSyncTablesCheckedAt = new Date().toISOString();
      if (stripeSyncTablesExist) {
        logger.info("[stripe-sync] stripe.accounts table verified — schema migration successful");
      } else {
        logger.error(
          "[stripe-sync] CRITICAL: stripe.accounts does not exist after runMigrations(). " +
            "The stripe.* schema was not created — the SQL migration files may be missing from " +
            "the bundle. Verify that build.mjs copies stripe-replit-sync/migrations into dist/. " +
            "Billing sync will fail until this is resolved.",
        );
      }
    } catch (assertErr) {
      _stripeSyncTablesOk = null;
      _stripeSyncTablesCheckedAt = new Date().toISOString();
      logger.warn({ err: assertErr }, "[stripe-sync] Could not verify stripe.* table existence");
    }

    // Step 2: findOrCreateManagedWebhook() — register this server's endpoint in Stripe
    const appUrl = process.env["FRONTEND_URL"]
      ?? (process.env["REPLIT_DEV_DOMAIN"] ? `https://${process.env["REPLIT_DEV_DOMAIN"]}` : null);

    if (appUrl) {
      const webhookUrl = `${appUrl}/api/stripe/webhook`;
      try {
        const webhook = await _stripeSyncInstance.findOrCreateManagedWebhook(webhookUrl, {
          enabled_events: MANAGED_WEBHOOK_EVENTS,
        });
        logger.info({ webhookId: webhook.id, url: webhookUrl }, "[stripe-sync] Managed webhook registered");

        // Cache the signing secret so the app webhook handler can verify events
        // without requiring STRIPE_WEBHOOK_SECRET to be set manually.
        //
        // stripe-replit-sync persists this in stripe._managed_webhooks.secret.
        // On a new webhook creation the secret is available in the API response
        // directly; on subsequent startups (existing webhook) we read it from the
        // DB via the sync pool so it remains available across restarts.
        if (webhook.secret) {
          _cachedManagedWebhookSecret = webhook.secret;
          logger.info("[stripe-sync] Managed webhook secret cached from creation response");
        } else {
          try {
            const result = await _stripeSyncInstance.postgresClient.query(
              "SELECT secret FROM stripe._managed_webhooks WHERE url = $1 LIMIT 1",
              [webhookUrl],
            );
            const storedSecret = (result.rows[0] as { secret?: string } | undefined)?.secret ?? null;
            if (storedSecret) {
              _cachedManagedWebhookSecret = storedSecret;
              logger.info("[stripe-sync] Managed webhook secret cached from DB");
            } else {
              logger.warn("[stripe-sync] Managed webhook secret not found in DB — set STRIPE_WEBHOOK_SECRET manually");
            }
          } catch (err) {
            logger.warn({ err }, "[stripe-sync] Could not read managed webhook secret from DB");
          }
        }
      } catch (err) {
        logger.warn({ err }, "[stripe-sync] Could not register managed webhook — configure manually in Stripe Dashboard");
      }
    } else {
      logger.warn("[stripe-sync] No app URL available — skipping managed webhook registration");
    }

    // After the managed webhook is registered, audit Stripe for duplicate
    // endpoints pointing at this app. A second enabled endpoint would deliver
    // every billing event twice; this surfaces that condition loudly.
    await auditDuplicateWebhookEndpoints();

    // Step 3: syncBackfill() — backfill recent subscriptions into the sync tables
    try {
      const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
      const result = await _stripeSyncInstance.syncBackfill({
        created: { gte: thirtyDaysAgo },
        object: "subscription",
      });
      logger.info({ result }, "[stripe-sync] syncBackfill complete");
    } catch (err) {
      logger.warn({ err }, "[stripe-sync] syncBackfill failed — will retry on next startup");
    }
  } catch (err) {
    logger.warn({ err }, "[stripe-sync] Failed to initialize StripeSync — billing sync disabled");
    _stripeSyncInstance = null;
  } finally {
    _initCompleted = true;
  }
}
