import { logger } from "./logger";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const PUSH_TIMEOUT_MS = 8000;

function isExpoPushToken(token: string): boolean {
  return token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");
}

function redactToken(token: string): string {
  if (token.length <= 12) return "***";
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

export async function sendPushNotification(opts: {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<{ ok: boolean }> {
  const { to, title, body, data } = opts;

  if (!isExpoPushToken(to)) {
    logger.warn({ to: redactToken(to) }, "[push] Invalid Expo push token — skipping push notification");
    return { ok: false };
  }

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, title, body, sound: "default", data }),
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });

    if (!res.ok) {
      logger.error({ status: res.status, to: redactToken(to) }, "[push] Expo push API returned a non-OK response");
      return { ok: false };
    }

    return { ok: true };
  } catch (err) {
    logger.error({ err, to: redactToken(to) }, "[push] Failed to send push notification");
    return { ok: false };
  }
}
