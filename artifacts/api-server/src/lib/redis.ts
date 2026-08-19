import { Redis } from "ioredis";
import { logger } from "./logger";
import { sendRedisAlertEmail, sendRedisRecoveryEmail, sendRedisDailyLimitAlertEmail } from "@workspace/email";
import { db, platformSettingsTable, redisAlertLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { generateId } from "./id";

let _connection: Redis | null = null;
export let isQueueEnabled = false;

// ─── Eviction policy ──────────────────────────────────────────────────────────
// Tracked per process so we only attempt the CONFIG SET once at startup (not on
// every reconnect) and only log the actionable warning once.
//
// _evictionPolicyPromise resolves when the check/set attempt has completed so
// that callers (e.g. the server startup in index.ts) can await it before
// initialising BullMQ workers, eliminating the race between our CONFIG SET and
// BullMQ's own internal eviction check.
let _evictionPolicyChecked = false;
let _evictionPolicyResolve: (() => void) | null = null;
// eslint-disable-next-line prefer-const
let _evictionPolicyPromise: Promise<void> = Promise.resolve(); // replaced when connection is created
let _evictionPolicySafe: boolean | null = null; // null = not checked yet

// ─── Transient error tracking ─────────────────────────────────────────────────
// We count consecutive transient Redis errors in-memory so the system-health
// endpoint can surface a meaningful status without a DB write.
let _consecutiveTransientErrors = 0;
let _lastTransientErrorAt: number | null = null;
const DEGRADED_THRESHOLD = 3;    // ≥3 consecutive errors → degraded
const UNAVAILABLE_THRESHOLD = 10; // ≥10 consecutive errors → unavailable
// If the connection has been healthy for this many ms, auto-clear degraded state.
const ERROR_DECAY_MS = 5 * 60 * 1000; // 5 minutes

// ─── Alert rate-limiting ──────────────────────────────────────────────────────
// At most one email alert per hour, triggered on ok → degraded/unavailable
// transitions (or when the status worsens further after the rate-limit window).
let _lastAlertSentAt: number | null = null;
let _lastKnownStatus: "ok" | "degraded" | "unavailable" = "ok";
const ALERT_RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour

// ─── Recovery tracking ────────────────────────────────────────────────────────
// We need to correctly handle two race orderings between alert delivery and
// the Redis reconnect:
//
//  Case A (normal): alert send resolves BEFORE resetTransientRedisErrors runs.
//    → _hadActiveAlert becomes true, reset sees it, fires recovery.
//
//  Case B (fast reconnect): resetTransientRedisErrors runs WHILE the alert
//    send is still in-flight (promise not yet resolved).
//    → _alertInFlight is true, reset sets _resetPendingRecovery = true.
//    → When the send resolves successfully, recovery is fired immediately.
//
//  Case C (alert failure): send fails, reset runs afterward.
//    → Neither _hadActiveAlert nor _alertInFlight is true → no recovery.
//
// _hadActiveAlert: true only after confirmed successful alert delivery.
// _alertInFlight:  true while the sendRedisAlertEmail promise is pending.
// _resetPendingRecovery: set by resetTransientRedisErrors when _alertInFlight
//   is true; causes the alert success path to fire recovery immediately.
let _hadActiveAlert = false;
let _alertInFlight = false;
let _resetPendingRecovery = false;
let _lastRecoveryEmailSentAt: number | null = null;
const RECOVERY_EMAIL_DEBOUNCE_MS = 60_000; // 1 minute

// ─── Alert email recipient ────────────────────────────────────────────────────
// Reads from the `redis_alert_email` platform setting first; falls back to the
// SUPERADMIN_EMAIL environment variable.  The DB read is intentionally short-
// lived: if the DB is unreachable we silently fall back to the env var so that
// alert delivery is not blocked by a secondary outage.
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

// Fire-and-forget: log an alert or recovery event to the DB for audit history.
function logRedisAlert(eventType: string, alertStatus: string | null, emailTo: string | null): void {
  db.insert(redisAlertLogTable)
    .values({ id: generateId(), eventType, alertStatus, emailTo, triggeredAt: new Date() })
    .execute()
    .catch((err: unknown) => logger.error({ err }, "[redis-alert-log] Failed to log alert event"));
}

// Check platform settings to see if a specific alert type is enabled.
// Defaults to enabled on DB error so we never silently drop alerts.
async function isAlertEnabled(key: "redis_alert_on_degraded" | "redis_alert_on_daily_limit"): Promise<boolean> {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, key))
      .limit(1);
    return row?.value !== "false";
  } catch {
    return true;
  }
}

async function maybeFireRedisAlert(): Promise<void> {
  const currentStatus = getRedisStatus();

  if (currentStatus === "ok") {
    _lastKnownStatus = "ok";
    return;
  }

  const prevStatus = _lastKnownStatus;
  _lastKnownStatus = currentStatus;

  // Skip if the status hasn't changed and we're still within the rate-limit window
  if (prevStatus === currentStatus && _lastAlertSentAt !== null) {
    if (Date.now() - _lastAlertSentAt < ALERT_RATE_LIMIT_MS) return;
  }

  // Skip if this is not a transition from ok and we've already alerted recently
  if (prevStatus !== "ok" && _lastAlertSentAt !== null) {
    if (Date.now() - _lastAlertSentAt < ALERT_RATE_LIMIT_MS) return;
  }

  const alertEmail = await getAlertEmail();
  if (!alertEmail) {
    logger.warn("[redis-alert] No alert email configured (set redis_alert_email in platform settings or SUPERADMIN_EMAIL env) — skipping alert email");
    return;
  }

  const alertEnabled = await isAlertEnabled("redis_alert_on_degraded");
  if (!alertEnabled) {
    logger.info("[redis-alert] Degraded/unavailable alerts disabled via platform settings — skipping");
    return;
  }

  const appUrl = (process.env["APP_URL"] ?? "").trim().replace(/\/$/, "");
  if (!appUrl) {
    logger.warn("[redis-alert] APP_URL not set — alert email will not include a dashboard link");
  }
  const dashboardUrl = appUrl ? `${appUrl}/admin` : null;

  // Mark the attempt immediately to prevent concurrent duplicate sends.
  // _alertInFlight lets resetTransientRedisErrors() know a send is pending
  // so it can set _resetPendingRecovery instead of silently dropping recovery.
  _lastAlertSentAt = Date.now();
  _alertInFlight = true;

  sendRedisAlertEmail({ to: alertEmail, status: currentStatus, dashboardUrl })
    .then((result) => {
      _alertInFlight = false;
      if (result.success) {
        _hadActiveAlert = true;
        logRedisAlert("alert", currentStatus, alertEmail);
        logger.warn({ status: currentStatus, to: alertEmail }, "[redis-alert] Alert email sent");
        // Case B: Redis recovered while we were sending — fire recovery now.
        if (_resetPendingRecovery) {
          _resetPendingRecovery = false;
          void sendRecoveryEmailIfNeeded();
        }
      } else {
        logger.error({ status: currentStatus, error: result.error }, "[redis-alert] Failed to send alert email — clearing rate-limit so next error can retry");
        _lastAlertSentAt = null;
        _resetPendingRecovery = false; // abort deferred recovery — no alert was delivered
      }
    })
    .catch((err) => {
      logger.error({ err }, "[redis-alert] Unexpected error sending alert email — clearing rate-limit so next error can retry");
      _alertInFlight = false;
      _lastAlertSentAt = null;
      _resetPendingRecovery = false; // abort deferred recovery — no alert was delivered
    });
}

async function sendRecoveryEmailIfNeeded(): Promise<void> {
  if (!_hadActiveAlert) return;

  // Debounce: don't send more than once per minute for rapid consecutive resets
  const now = Date.now();
  if (_lastRecoveryEmailSentAt !== null && now - _lastRecoveryEmailSentAt < RECOVERY_EMAIL_DEBOUNCE_MS) {
    return;
  }

  _hadActiveAlert = false;
  _lastRecoveryEmailSentAt = now;

  const alertEmail = await getAlertEmail();
  if (!alertEmail) return;

  const appUrl = (process.env["APP_URL"] ?? "").trim().replace(/\/$/, "");
  const dashboardUrl = appUrl ? `${appUrl}/admin` : null;

  sendRedisRecoveryEmail({ to: alertEmail, dashboardUrl })
    .then((result) => {
      if (result.success) {
        logRedisAlert("recovery", null, alertEmail);
        logger.info({ to: alertEmail }, "[redis-recovery] Recovery email sent");
      } else {
        logger.error({ error: result.error }, "[redis-recovery] Failed to send recovery email");
        _lastRecoveryEmailSentAt = null; // reset so next recovery can retry
      }
    })
    .catch((err) => {
      logger.error({ err }, "[redis-recovery] Unexpected error sending recovery email");
      _lastRecoveryEmailSentAt = null;
    });
}

export function recordTransientRedisError(): void {
  _consecutiveTransientErrors++;
  _lastTransientErrorAt = Date.now();
  void maybeFireRedisAlert();
}

export function resetTransientRedisErrors(): void {
  const wasAlerting = _hadActiveAlert;
  const wasInFlight = _alertInFlight;
  _consecutiveTransientErrors = 0;
  _lastTransientErrorAt = null;
  _lastKnownStatus = "ok";

  if (wasAlerting) {
    // Case A: alert was confirmed delivered before this reset — send recovery now.
    void sendRecoveryEmailIfNeeded();
  } else if (wasInFlight) {
    // Case B: alert send is still in-flight — defer recovery until it resolves.
    _resetPendingRecovery = true;
  }
  // Case C: no alert was sent (or it failed) — nothing to recover from.
}

export function getRedisStatus(): "ok" | "degraded" | "unavailable" {
  if (!process.env["REDIS_URL"]?.trim()) return "ok"; // Redis not configured — not applicable

  // If the connection is currently ready AND the last transient error is old
  // enough, treat the service as recovered — even if the counter hasn't been
  // reset by a full disconnect/reconnect cycle.
  if (
    _connection?.status === "ready" &&
    _lastTransientErrorAt !== null &&
    Date.now() - _lastTransientErrorAt > ERROR_DECAY_MS
  ) {
    return "ok";
  }

  if (_consecutiveTransientErrors >= UNAVAILABLE_THRESHOLD) return "unavailable";
  if (_consecutiveTransientErrors >= DEGRADED_THRESHOLD) return "degraded";
  // Also treat a non-ready connection with any errors as degraded
  if (_connection && _connection.status !== "ready" && _consecutiveTransientErrors > 0) return "degraded";
  return "ok";
}

/**
 * Returns true when an ioredis/BullMQ error looks transient — i.e. the kind
 * of error that is expected to resolve on its own (rate-limited, connection
 * refused while Redis restarts, network hiccup, etc.).  These are logged at
 * WARN level to avoid masking genuine application bugs.
 */
export function isTransientRedisError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("rate limit") ||
    msg.includes("ratelimit") ||
    msg.includes("max daily request limit") ||
    msg.includes("max requests limit exceeded") ||
    msg.includes("maxretriesperrequest") ||
    msg.includes("connection is closed") ||
    msg.includes("stream isn't writeable")
  );
}

/**
 * Attempts to set maxmemory-policy to noeviction so BullMQ jobs are never
 * silently evicted under memory pressure.  Called once per process startup
 * (tracked via _evictionPolicyChecked) on the "ready" event.
 *
 * - Self-hosted Redis / Upstash dedicated: CONFIG SET succeeds → warning gone.
 * - Upstash Serverless: CONFIG SET is not permitted → we log a single, clear
 *   actionable message so the operator can fix it in the dashboard instead of
 *   seeing BullMQ's raw console.warn on every restart.
 */
async function maybeFixEvictionPolicy(conn: Redis): Promise<void> {
  if (_evictionPolicyChecked) return;
  _evictionPolicyChecked = true;

  try {
    await conn.config("SET", "maxmemory-policy", "noeviction");
    _evictionPolicySafe = true;
    logger.info("[redis] maxmemory-policy set to noeviction — BullMQ job safety ensured");
    // Note: do NOT return early here — the finally block below must always run
    // to resolve _evictionPolicyPromise so waitForEvictionPolicyCheck() unblocks.
  } catch {
    // CONFIG SET not supported by this provider (e.g. Upstash Serverless).
    // Fall through to read the current policy and log an actionable message.
    try {
      const configResult = await conn.config("GET", "maxmemory-policy") as string[];
      // ioredis returns ["maxmemory-policy", "<value>"]
      const currentPolicy = configResult[1] ?? "unknown";
      if (currentPolicy === "noeviction") {
        _evictionPolicySafe = true;
        logger.info("[redis] maxmemory-policy is already noeviction — no action needed");
      } else {
        _evictionPolicySafe = false;
        logger.warn(
          { currentPolicy },
          "[redis] maxmemory-policy is not 'noeviction' — BullMQ jobs may be silently lost under memory pressure. " +
          "Fix: Upstash dashboard → your database → Settings → Eviction Policy → No Eviction. " +
          "Self-hosted: run `redis-cli CONFIG SET maxmemory-policy noeviction`.",
        );
      }
    } catch {
      _evictionPolicySafe = false;
      logger.warn(
        "[redis] Cannot read maxmemory-policy (CONFIG GET not allowed by provider). " +
        "If using Upstash, set Eviction Policy = No Eviction in the Upstash dashboard to prevent silent BullMQ job loss.",
      );
    }
  } finally {
    // Always resolve so waitForEvictionPolicyCheck() unblocks the server startup —
    // whether CONFIG SET succeeded, fell through to CONFIG GET, or both failed.
    _evictionPolicyResolve?.();
    _evictionPolicyResolve = null;
  }
}

/**
 * Returns a promise that resolves once the startup eviction-policy check has
 * completed (either a successful CONFIG SET, a successful CONFIG GET read, or
 * a provider that forbids both).  Awaiting this in the server startup before
 * initialising BullMQ workers eliminates the race between our CONFIG SET and
 * BullMQ's own internal eviction-policy check.
 *
 * Resolves immediately when Redis is not configured (REDIS_URL not set).
 */
export function waitForEvictionPolicyCheck(): Promise<void> {
  return _evictionPolicyPromise;
}

/**
 * Returns whether the Redis eviction policy is safe for BullMQ (noeviction).
 * null = check not yet complete.
 */
export function isEvictionPolicySafe(): boolean | null {
  return _evictionPolicySafe;
}

export function getRedisConnection(): Redis | null {
  const raw = process.env["REDIS_URL"]?.trim();
  if (!raw) return null;

  // Extract the canonical URL from values that may be a redis-cli command
  // e.g. "redis-cli --tls -u rediss://..." → "rediss://..."
  const urlMatch = raw.match(/(rediss?:\/\/\S+)/);
  const url = urlMatch ? urlMatch[1] : raw;

  // Enable TLS when the scheme is rediss:// OR when the host is a known managed
  // Redis provider that requires TLS (e.g. Upstash). Passing tls:{} lets Node
  // use its built-in CA bundle so the server certificate is fully verified.
  const knownTlsHosts = [".upstash.io", ".redis.cache.windows.net", ".redislabs.com"];
  let parsedHost = "";
  try { parsedHost = new URL(url.replace(/^redis:\/\//, "https://")).hostname; } catch { /* ignore */ }
  const useTls = url.startsWith("rediss://") || knownTlsHosts.some((h) => parsedHost.endsWith(h));

  if (!_connection) {
    // Create a new promise for this connection's eviction policy check.
    // Any caller that awaits waitForEvictionPolicyCheck() will block until
    // maybeFixEvictionPolicy resolves it (or until closeRedisConnection resolves it).
    _evictionPolicyPromise = new Promise((resolve) => {
      _evictionPolicyResolve = resolve;
    });
    _evictionPolicySafe = null;

    try {
      _connection = new Redis(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: false,
        // TCP keep-alive: prevents Upstash / managed Redis providers from closing
        // idle connections after ~20 s, which causes the frequent reconnection
        // warnings observed in production logs.
        keepAlive: 30_000,
        // Fail fast on initial connect rather than hanging.
        connectTimeout: 10_000,
        ...(useTls ? { tls: {} } : {}),
        // Exponential back-off reconnection strategy: 500 ms → 1 s → 2 s → … → 30 s cap.
        // Returning a positive number tells ioredis to wait that many ms before the
        // next reconnect attempt.  We never return null so the client keeps trying
        // indefinitely — Upstash rate limits and transient network issues are
        // expected to clear within minutes.
        //
        // Log throttling: emit a message for the first 3 attempts (so problems
        // are noticed quickly), then only at every 10th attempt thereafter,
        // to avoid flooding logs during prolonged outages.
        retryStrategy: (times: number) => {
          const delayMs = Math.min(500 * Math.pow(2, times - 1), 30_000);
          const shouldLog = times <= 3 || times % 10 === 0;
          if (shouldLog) {
            logger.warn({ attempt: times, delayMs }, "[redis] Reconnecting with exponential back-off");
          }
          return delayMs;
        },
      });

      _connection.on("connect", () => {
        isQueueEnabled = true;
        resetTransientRedisErrors();
        logger.info("[redis] Connected");
      });

      _connection.on("ready", () => {
        resetTransientRedisErrors();
        // Attempt to enforce noeviction policy for BullMQ safety (once per startup).
        void maybeFixEvictionPolicy(_connection!);
      });

      _connection.on("error", (err: Error) => {
        if (isTransientRedisError(err)) {
          recordTransientRedisError();
          logger.warn({ err }, "[redis] Transient error (will retry)");
        } else {
          logger.error({ err }, "[redis] Error");
        }
      });

      _connection.on("close", () => {
        logger.warn("[redis] Connection closed");
      });

    } catch (err) {
      logger.error({ err }, "[redis] Failed to create connection");
      _connection = null;
    }
  }

  return _connection;
}

let _producerConnection: Redis | null = null;

/**
 * Returns a dedicated ioredis connection for BullMQ Queue producers (not workers).
 * Configured with enableOfflineQueue: false so that queue.add() calls fail
 * immediately and explicitly when Redis is unavailable — rather than silently
 * queuing commands that may never be delivered.  Callers must handle the thrown
 * error and fall back (e.g. direct email send) instead of relying on transparent
 * command queuing.
 *
 * Note: BullMQ duplicates this connection internally with maxRetriesPerRequest:null
 * (required for Workers).  The duplicate inherits enableOfflineQueue: false, so
 * Queue producers will still fail-fast.
 */
export function getBullMQQueueConnection(): Redis | null {
  const conn = getRedisConnection();
  if (!conn) return null;

  if (!_producerConnection) {
    _producerConnection = conn.duplicate({
      // Fail immediately when Redis is disconnected instead of queuing commands.
      // This converts silent job loss into an explicit error the caller can handle.
      enableOfflineQueue: false,
      // Finite retry limit for producers: 3 attempts before failing explicitly.
      // BullMQ will override this to null on its own internal duplicate for Workers,
      // but it signals intent here and applies to any direct commands on this connection.
      maxRetriesPerRequest: 3,
    });

    _producerConnection.on("error", (err: Error) => {
      if (isTransientRedisError(err)) {
        logger.warn({ err }, "[redis-producer] Transient error");
      } else {
        logger.error({ err }, "[redis-producer] Error");
      }
    });
  }

  return _producerConnection;
}

export async function closeRedisConnection(): Promise<void> {
  // Resolve any pending eviction-policy waiters before tearing down.
  _evictionPolicyResolve?.();
  _evictionPolicyResolve = null;
  _evictionPolicyPromise = Promise.resolve();
  _evictionPolicyChecked = false;
  _evictionPolicySafe = null;

  await Promise.all([
    _producerConnection?.quit().catch(() => {}),
    _connection?.quit().catch(() => {}),
  ]);
  _producerConnection = null;
  _connection = null;
  isQueueEnabled = false;
}

// ─── Workers-enabled flag ─────────────────────────────────────────────────────
// Returns true when BullMQ workers are (or would be) initialised. Follows the
// same logic used in index.ts: explicit ENABLE_WORKERS env var takes precedence,
// otherwise defaults to true in production and false elsewhere.
export function areWorkersEnabled(): boolean {
  const envVal = process.env["ENABLE_WORKERS"];
  if (envVal !== undefined) return envVal === "true";
  return process.env["NODE_ENV"] === "production";
}

// ─── Upstash daily usage stats ────────────────────────────────────────────────

export const REDIS_DAILY_LIMIT = 500_000;

/**
 * The usage percentage (0–100) at which we start warning.
 * Defaults to 80 but can be overridden via REDIS_DAILY_LIMIT_THRESHOLD_PCT.
 */
export function getRedisWarningThresholdPct(): number {
  const raw = process.env["REDIS_DAILY_LIMIT_THRESHOLD_PCT"]?.trim();
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) return parsed;
  }
  return 80;
}

export interface UpstashDailyStats {
  commandCount: number;
  maxCommands: number;
  usagePct: number;
  warningThresholdPct: number;
}

/**
 * Derives the Upstash REST base URL and Bearer token from environment.
 *
 * Priority:
 * 1. UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN  (explicit)
 * 2. Derived from REDIS_URL  (rediss://:<password>@<host>:port)
 *
 * Returns null when neither source is configured.
 */
function getUpstashRestCredentials(): { restUrl: string; token: string } | null {
  const explicitUrl = process.env["UPSTASH_REDIS_REST_URL"]?.trim();
  const explicitToken = process.env["UPSTASH_REDIS_REST_TOKEN"]?.trim();
  if (explicitUrl && explicitToken) {
    return { restUrl: explicitUrl.replace(/\/$/, ""), token: explicitToken };
  }

  const redisUrl = process.env["REDIS_URL"]?.trim();
  if (!redisUrl) return null;

  const urlMatch = redisUrl.match(/(rediss?:\/\/\S+)/);
  const url = urlMatch ? urlMatch[1] : redisUrl;

  try {
    // rediss://:<password>@<host>:<port>
    const parsed = new URL(url);
    const token = parsed.password;
    const host = parsed.hostname;
    if (!token || !host) return null;

    // Only derive REST creds for known Upstash hosts — other Redis providers
    // don't expose a compatible REST stats API.
    const isUpstash = host.endsWith(".upstash.io");
    if (!isUpstash) return null;

    return { restUrl: `https://${host}`, token };
  } catch {
    return null;
  }
}

// ─── Upstash daily stats cache ────────────────────────────────────────────────
// Caching avoids hammering the Upstash REST API on every /admin/system-health
// request. The cache is intentionally short-lived so the dashboard still
// reflects near-real-time data.
let _dailyStatsCache: { stats: UpstashDailyStats; fetchedAt: number } | null = null;
const DAILY_STATS_CACHE_TTL_MS = 45_000; // 45 seconds

// ─── Upstash daily limit alert ────────────────────────────────────────────────
// At most one alert per hour when usage crosses the configured threshold.
let _lastDailyLimitAlertAt: number | null = null;
const DAILY_LIMIT_ALERT_RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour

/**
 * Sends a daily-limit alert email to the superadmin if usage has crossed the
 * warning threshold and the rate-limit window has elapsed.
 * Safe to call on every stats fetch — does nothing if conditions aren't met.
 */
export function maybeSendDailyLimitAlert(stats: UpstashDailyStats): void {
  if (stats.usagePct < stats.warningThresholdPct) return;

  if (_lastDailyLimitAlertAt !== null) {
    if (Date.now() - _lastDailyLimitAlertAt < DAILY_LIMIT_ALERT_RATE_LIMIT_MS) return;
  }

  // Mark immediately to prevent concurrent duplicate sends; reset on failure.
  _lastDailyLimitAlertAt = Date.now();

  void getAlertEmail().then(async (alertEmail) => {
    if (!alertEmail) {
      logger.warn("[redis-daily-limit] No alert email configured — skipping daily limit alert email");
      _lastDailyLimitAlertAt = null;
      return;
    }

    const dailyLimitEnabled = await isAlertEnabled("redis_alert_on_daily_limit");
    if (!dailyLimitEnabled) {
      logger.info("[redis-daily-limit] Daily limit alerts disabled via platform settings — skipping");
      return;
    }

    const appUrl = (process.env["APP_URL"] ?? "").trim().replace(/\/$/, "");
    const dashboardUrl = appUrl ? `${appUrl}/admin` : null;

    sendRedisDailyLimitAlertEmail({
      to: alertEmail,
      usagePct: stats.usagePct,
      commandCount: stats.commandCount,
      maxCommands: stats.maxCommands,
      warningThresholdPct: stats.warningThresholdPct,
      dashboardUrl,
    })
      .then((result) => {
        if (result.success) {
          logRedisAlert("daily_limit", null, alertEmail);
          logger.warn(
            { usagePct: Math.round(stats.usagePct * 10) / 10, to: alertEmail },
            "[redis-daily-limit] Alert email sent",
          );
        } else {
          logger.error(
            { error: result.error },
            "[redis-daily-limit] Failed to send alert email — clearing rate-limit so next check can retry",
          );
          _lastDailyLimitAlertAt = null;
        }
      })
      .catch((err) => {
        logger.error(
          { err },
          "[redis-daily-limit] Unexpected error sending alert email — clearing rate-limit so next check can retry",
        );
        _lastDailyLimitAlertAt = null;
      });
  });
}

/**
 * Fetches the current daily request count from the Upstash REST INFO endpoint.
 *
 * Results are cached for 45 seconds so repeated calls (e.g. from the
 * /admin/system-health endpoint) don't each consume a REST request.
 *
 * Returns null when:
 * - Redis is not configured
 * - The host is not an Upstash instance (no REST stats API available)
 * - The network request fails
 */
export async function fetchUpstashDailyStats(): Promise<UpstashDailyStats | null> {
  // Return cached result if still fresh
  if (_dailyStatsCache !== null && Date.now() - _dailyStatsCache.fetchedAt < DAILY_STATS_CACHE_TTL_MS) {
    return _dailyStatsCache.stats;
  }

  const creds = getUpstashRestCredentials();
  if (!creds) return null;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    const response = await fetch(`${creds.restUrl}/info`, {
      headers: { Authorization: `Bearer ${creds.token}` },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(
        { status: response.status },
        "[redis-stats] Upstash INFO request returned non-OK status",
      );
      return null;
    }

    // Upstash REST returns the INFO bulk string directly when called with GET /info
    // The body is a JSON object: { result: "<redis info string>" }
    const json = (await response.json()) as { result?: string };
    const infoStr = json.result ?? "";

    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parseField = (field: string): number | null => {
      const match = new RegExp(`^${escapeRegex(field)}:(\\d+)`, "m").exec(infoStr);
      return match ? parseInt(match[1], 10) : null;
    };

    const commandCount = parseField("daily_request_count") ?? 0;
    // Upstash free tier hard limit
    const maxCommands = parseField("max_daily_requests") ?? REDIS_DAILY_LIMIT;
    const usagePct = maxCommands > 0 ? (commandCount / maxCommands) * 100 : 0;
    const warningThresholdPct = getRedisWarningThresholdPct();

    const result = { commandCount, maxCommands, usagePct, warningThresholdPct };
    _dailyStatsCache = { stats: result, fetchedAt: Date.now() };
    return result;
  } catch (err) {
    logger.warn({ err }, "[redis-stats] Failed to fetch Upstash daily stats");
    return null;
  }
}
