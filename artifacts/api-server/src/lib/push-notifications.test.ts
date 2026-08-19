import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockLogWarn, mockLogError } = vi.hoisted(() => ({
  mockLogWarn: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock("./logger.js", () => ({
  logger: {
    warn: mockLogWarn,
    error: mockLogError,
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { sendPushNotification } from "./push-notifications.js";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const VALID_TOKEN = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";

describe("sendPushNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the exp.host URL with the expected payload for a valid Expo token", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    const result = await sendPushNotification({
      to: VALID_TOKEN,
      title: "Reserva confirmada",
      body: "Boa viagem!",
      data: { type: "reservation_confirmed", reservationId: "res-001" },
    });

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(EXPO_PUSH_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Accept: "application/json",
      "Accept-encoding": "gzip, deflate",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body)).toEqual({
      to: VALID_TOKEN,
      title: "Reserva confirmada",
      body: "Boa viagem!",
      sound: "default",
      data: { type: "reservation_confirmed", reservationId: "res-001" },
    });
  });

  it("accepts the ExpoPushToken[ prefix variant", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    const result = await sendPushNotification({
      to: "ExpoPushToken[yyyy]",
      title: "Title",
      body: "Body",
    });

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("short-circuits with NO fetch call when the token is invalid", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const result = await sendPushNotification({
      to: "not-a-valid-token",
      title: "Title",
      body: "Body",
    });

    expect(result).toEqual({ ok: false });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockLogWarn).toHaveBeenCalledTimes(1);
  });

  it("swallows a fetch rejection without throwing and returns { ok: false }", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await sendPushNotification({
      to: VALID_TOKEN,
      title: "Title",
      body: "Body",
    });

    expect(result).toEqual({ ok: false });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });

  it("returns { ok: false } when the Expo API responds with a non-OK status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    vi.stubGlobal("fetch", mockFetch);

    const result = await sendPushNotification({
      to: VALID_TOKEN,
      title: "Title",
      body: "Body",
    });

    expect(result).toEqual({ ok: false });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockLogError).toHaveBeenCalledTimes(1);
  });
});
