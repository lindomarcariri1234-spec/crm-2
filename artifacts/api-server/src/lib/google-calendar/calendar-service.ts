import { google } from "googleapis";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger";

export const CALENDAR_STATUS_CONNECTED = "connected";
export const CALENDAR_STATUS_INVALID = "invalid";

/** Google API 403 error codes that indicate a quota/rate issue (retryable, not auth-expired). */
const GOOGLE_QUOTA_ERROR_CODES = new Set([
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "dailyLimitExceeded",
  "quotaExceeded",
]);

/** Node.js error codes that indicate a transient network/transport failure. */
const TRANSIENT_NODE_CODES = new Set([
  "ETIMEDOUT", "ECONNRESET", "ECONNABORTED", "ECONNREFUSED",
  "EAI_AGAIN", "ENETUNREACH", "EPIPE", "EHOSTUNREACH",
]);

export function isInvalidGrantError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { code?: number | string; response?: { status?: number; data?: { error?: string } }; message?: string };
  const status = anyErr.response?.status ?? (typeof anyErr.code === "number" ? anyErr.code : undefined);
  const errorCode = anyErr.response?.data?.error;
  if (errorCode === "invalid_grant" || errorCode === "invalid_token") return true;
  if (status === 401) return true;
  // 403 without a quota error code = revoked token / insufficient scopes → mark invalid
  if (status === 403 && !GOOGLE_QUOTA_ERROR_CODES.has(errorCode ?? "")) return true;
  if (typeof anyErr.message === "string" && (anyErr.message.includes("invalid_grant") || anyErr.message.includes("invalid_token"))) return true;
  return false;
}

export function isEventNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { code?: number | string; response?: { status?: number } };
  const status = anyErr.response?.status ?? (typeof anyErr.code === "number" ? anyErr.code : undefined);
  return status === 404;
}

export function isTransientCalendarError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { code?: number | string; response?: { status?: number; data?: { error?: string } }; message?: string };
  const httpStatus = anyErr.response?.status ?? (typeof anyErr.code === "number" ? anyErr.code : undefined);
  if (httpStatus === 429 || httpStatus === 500 || httpStatus === 502 || httpStatus === 503 || httpStatus === 504) return true;
  // 403 with a quota/rate-limit error code is transient (retryable)
  if (httpStatus === 403 && GOOGLE_QUOTA_ERROR_CODES.has(anyErr.response?.data?.error ?? "")) return true;
  // Node.js transport-level errors (ETIMEDOUT, ECONNRESET, etc.)
  if (typeof anyErr.code === "string" && TRANSIENT_NODE_CODES.has(anyErr.code)) return true;
  if (typeof anyErr.message === "string") {
    const m = anyErr.message.toLowerCase();
    if (
      m.includes("rate limit") || m.includes("quota") ||
      m.includes("too many requests") || m.includes("backend error") ||
      m.includes("internal error") || m.includes("timeout") ||
      m.includes("socket hang up") || m.includes("etimedout") ||
      m.includes("econnreset") || m.includes("econnaborted")
    ) return true;
  }
  return false;
}

/** Backoff delays between retry attempts: 30s → 5min → 20min (3 retries, 4 total attempts). */
export const CALENDAR_RETRY_DELAYS_MS = [30_000, 300_000, 1_200_000] as const;

/**
 * Retries `fn` up to `maxAttempts` times for transient errors (429/5xx/timeout).
 * Permanent errors (401/invalid_grant) are re-thrown immediately without retry.
 * @param delaysMs - milliseconds to wait before each retry; defaults to [30s, 5min, 20min].
 *   Override in tests to use fast zero delays.
 */
export async function withCalendarRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 4,
  delaysMs: readonly number[] = CALENDAR_RETRY_DELAYS_MS,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        logger.info({ attempt, maxAttempts }, "google-calendar: retry succeeded");
      }
      return result;
    } catch (err) {
      if (!isTransientCalendarError(err) || attempt === maxAttempts) throw err;
      const delayMs = delaysMs[attempt - 1] ?? delaysMs[delaysMs.length - 1] ?? 30_000;
      logger.warn(
        { attempt, maxAttempts, delayMs, errMessage: (err as Error)?.message },
        "google-calendar: transient error — retrying after backoff",
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  /* istanbul ignore next — loop always throws or returns before this */
  throw new Error("withCalendarRetry: unreachable");
}

export async function markCalendarConnectionInvalid(userId: string, reason: string): Promise<void> {
  await db.update(usersTable).set({
    googleCalendarStatus: CALENDAR_STATUS_INVALID,
    googleCalendarEnabled: false,
  }).where(eq(usersTable.id, userId));
  logger.warn({ userId, reason }, "google-calendar: connection marked invalid (user must reconnect)");
}

const GOOGLE_CLIENT_ID = process.env["GOOGLE_CLIENT_ID"] ?? "";
const GOOGLE_CLIENT_SECRET = process.env["GOOGLE_CLIENT_SECRET"] ?? "";

function getRedirectUri(): string {
  if (process.env["GOOGLE_CALENDAR_REDIRECT_URI"]) {
    return process.env["GOOGLE_CALENDAR_REDIRECT_URI"];
  }
  const domain = process.env["REPLIT_DEV_DOMAIN"];
  if (domain) {
    return `https://${domain}/api/calendar/callback`;
  }
  const frontendUrl = process.env["FRONTEND_URL"];
  if (frontendUrl) {
    try {
      const { origin } = new URL(frontendUrl);
      return `${origin}/api/calendar/callback`;
    } catch {
      // ignore invalid URL, fall through
    }
  }
  const devPort = process.env["PORT"] ?? "8080";
  return `http://localhost:${devPort}/api/calendar/callback`;
}

function getStateSecret(): string {
  const s = process.env["CLERK_SECRET_KEY"];
  if (!s) throw new Error("CLERK_SECRET_KEY is required for Google Calendar OAuth state signing");
  return s;
}

export function createOAuth2Client() {
  return new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, getRedirectUri());
}

function signState(userId: string, nonce: string): string {
  const payload = `${userId}:${nonce}`;
  const sig = createHmac("sha256", getStateSecret()).update(payload).digest("base64url");
  return Buffer.from(JSON.stringify({ userId, nonce, sig })).toString("base64url");
}

// ─── Server-side nonce registry ───────────────────────────────────────────────
// Each OAuth flow generates a one-time nonce stored here for up to 15 minutes.
// consumeNonce validates HMAC, checks the nonce is present and unexpired, then
// deletes it — preventing state replay even if the signed token is intercepted.

const NONCE_TTL_MS = 15 * 60 * 1000; // 15 minutes

interface NonceEntry {
  userId: string;
  expiresAt: number;
}

const pendingNonces = new Map<string, NonceEntry>();

function registerNonce(nonce: string, userId: string): void {
  // Evict expired entries on each registration to avoid unbounded growth.
  const now = Date.now();
  for (const [key, entry] of pendingNonces) {
    if (entry.expiresAt <= now) pendingNonces.delete(key);
  }
  pendingNonces.set(nonce, { userId, expiresAt: now + NONCE_TTL_MS });
}

/**
 * Verifies the HMAC signature, checks the nonce is present and unexpired,
 * and then deletes it so the state cannot be reused. Returns the userId on
 * success, or null if invalid / expired / already consumed.
 */
export function consumeNonce(state: string): string | null {
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
      userId: string;
      nonce: string;
      sig: string;
    };
    const expected = createHmac("sha256", getStateSecret())
      .update(`${decoded.userId}:${decoded.nonce}`)
      .digest("base64url");
    const expectedBuf = Buffer.from(expected, "base64url");
    const actualBuf = Buffer.from(decoded.sig, "base64url");
    if (expectedBuf.length !== actualBuf.length) return null;
    if (!timingSafeEqual(expectedBuf, actualBuf)) return null;

    const entry = pendingNonces.get(decoded.nonce);
    if (!entry) return null; // not registered or already consumed
    if (entry.expiresAt <= Date.now()) {
      pendingNonces.delete(decoded.nonce);
      return null; // expired
    }
    if (entry.userId !== decoded.userId) return null; // userId mismatch

    pendingNonces.delete(decoded.nonce); // consume — one-time use
    return decoded.userId;
  } catch {
    return null;
  }
}

export function verifyState(state: string): string | null {
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
      userId: string;
      nonce: string;
      sig: string;
    };
    const expected = createHmac("sha256", getStateSecret())
      .update(`${decoded.userId}:${decoded.nonce}`)
      .digest("base64url");
    const expectedBuf = Buffer.from(expected, "base64url");
    const actualBuf = Buffer.from(decoded.sig, "base64url");
    if (expectedBuf.length !== actualBuf.length) return null;
    if (!timingSafeEqual(expectedBuf, actualBuf)) return null;
    return decoded.userId;
  } catch {
    return null;
  }
}

export function generateAuthUrl(userId: string): string {
  const nonce = randomBytes(16).toString("base64url");
  registerNonce(nonce, userId);
  const state = signState(userId, nonce);
  const auth = createOAuth2Client();
  return auth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    state,
  });
}

export async function exchangeCodeForTokens(code: string) {
  const auth = createOAuth2Client();
  const { tokens } = await auth.getToken(code);
  return tokens;
}

export async function revokeToken(accessToken: string): Promise<void> {
  try {
    const auth = createOAuth2Client();
    await auth.revokeToken(accessToken);
  } catch {
    // Best effort — continue even if revoke fails
  }
}

export async function refreshTokenIfNeeded(userId: string): Promise<string | null> {
  const [user] = await db.select({
    googleAccessToken: usersTable.googleAccessToken,
    googleRefreshToken: usersTable.googleRefreshToken,
    googleTokenExpiry: usersTable.googleTokenExpiry,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);

  if (!user?.googleAccessToken) return null;

  const isExpired = user.googleTokenExpiry ? user.googleTokenExpiry <= new Date() : false;
  if (!isExpired) return user.googleAccessToken;

  if (!user.googleRefreshToken) return null;

  try {
    const auth = createOAuth2Client();
    auth.setCredentials({ refresh_token: user.googleRefreshToken });
    const { credentials } = await auth.refreshAccessToken();
    if (!credentials.access_token) return null;

    await db.update(usersTable).set({
      googleAccessToken: credentials.access_token,
      googleTokenExpiry: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
      googleCalendarStatus: CALENDAR_STATUS_CONNECTED,
    }).where(eq(usersTable.id, userId));

    return credentials.access_token;
  } catch (err) {
    if (isInvalidGrantError(err)) {
      await markCalendarConnectionInvalid(userId, "refresh token rejected (invalid_grant)");
    } else {
      logger.error({ err, userId }, "google-calendar: refreshTokenIfNeeded failed");
    }
    return null;
  }
}

export interface CalendarEventData {
  summary: string;
  description?: string;
  location?: string;
  startDateTime: Date;
  endDateTime?: Date;
  attendees?: string[];
  colorId?: string;
}

export class GoogleCalendarService {
  private calendar;
  readonly userId: string;

  constructor(accessToken: string, userId: string) {
    const auth = createOAuth2Client();
    auth.setCredentials({ access_token: accessToken });
    this.calendar = google.calendar({ version: "v3", auth });
    this.userId = userId;
  }

  private async handleApiError(err: unknown, op: string, ctx: Record<string, unknown> = {}): Promise<void> {
    if (isInvalidGrantError(err)) {
      await markCalendarConnectionInvalid(this.userId, `${op} returned invalid credentials`);
    } else {
      logger.error({ err, userId: this.userId, ...ctx }, `google-calendar: ${op} failed`);
    }
  }

  async createEvent(data: CalendarEventData, ctx: Record<string, unknown> = {}): Promise<{ id: string } | null> {
    try {
      const end = data.endDateTime ?? data.startDateTime;
      const event = {
        summary: data.summary,
        description: data.description,
        location: data.location,
        start: { dateTime: data.startDateTime.toISOString(), timeZone: "America/Sao_Paulo" },
        end: { dateTime: end.toISOString(), timeZone: "America/Sao_Paulo" },
        attendees: data.attendees?.map((email) => ({ email })),
        colorId: data.colorId ?? "9",
        reminders: {
          useDefault: false,
          overrides: [
            { method: "email" as const, minutes: 24 * 60 },
            { method: "popup" as const, minutes: 30 },
          ],
        },
      };
      const response = await this.calendar.events.insert({
        calendarId: "primary",
        requestBody: event,
        sendUpdates: "none",
      });
      return { id: response.data.id! };
    } catch (err) {
      // Re-throw transient errors (429, 5xx, network) so withCalendarRetry and
      // BullMQ can retry them with exponential backoff. Only swallow permanent
      // failures (invalid_grant, 400, etc.) after logging them.
      if (isTransientCalendarError(err)) throw err;
      await this.handleApiError(err, "createEvent", ctx);
      return null;
    }
  }

  async updateEvent(eventId: string, data: Partial<CalendarEventData>, ctx: Record<string, unknown> = {}): Promise<boolean | "not-found"> {
    try {
      const patch: Record<string, unknown> = {};
      if (data.summary) patch.summary = data.summary;
      if (data.description !== undefined) patch.description = data.description;
      if (data.location !== undefined) patch.location = data.location;
      if (data.startDateTime) {
        patch.start = { dateTime: data.startDateTime.toISOString(), timeZone: "America/Sao_Paulo" };
      }
      if (data.endDateTime) {
        patch.end = { dateTime: data.endDateTime.toISOString(), timeZone: "America/Sao_Paulo" };
      }
      if (data.attendees) {
        patch.attendees = data.attendees.map((email) => ({ email }));
      }
      await this.calendar.events.patch({
        calendarId: "primary",
        eventId,
        requestBody: patch,
        sendUpdates: "none",
      });
      return true;
    } catch (err) {
      // Re-throw transient errors so withCalendarRetry and BullMQ can retry them.
      if (isTransientCalendarError(err)) throw err;
      // Detect external deletion: event was removed from Google but DB record still exists.
      if (isEventNotFoundError(err)) {
        logger.warn({ ...ctx, eventId }, "calendar-sync: updateEvent event not found (deleted externally)");
        return "not-found";
      }
      await this.handleApiError(err, "updateEvent", { ...ctx, eventId });
      return false;
    }
  }

  async deleteEvent(eventId: string, ctx: Record<string, unknown> = {}): Promise<boolean> {
    try {
      await this.calendar.events.delete({
        calendarId: "primary",
        eventId,
        sendUpdates: "none",
      });
      return true;
    } catch (err) {
      // Re-throw transient errors so withCalendarRetry and BullMQ can retry them.
      if (isTransientCalendarError(err)) throw err;
      await this.handleApiError(err, "deleteEvent", { ...ctx, eventId });
      return false;
    }
  }

  async listEvents(timeMin: Date, timeMax: Date): Promise<Array<{ id: string; summary: string }>> {
    try {
      const resp = await this.calendar.events.list({
        calendarId: "primary",
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
      });
      return (resp.data.items ?? [])
        .filter((e) => e.id && e.summary)
        .map((e) => ({ id: e.id!, summary: e.summary! }));
    } catch (err) {
      await this.handleApiError(err, "listEvents");
      return [];
    }
  }
}
