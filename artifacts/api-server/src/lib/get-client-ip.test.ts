import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { getClientIp } from "./get-client-ip.js";

function requestWithIp(ip: string): Request {
  return { ip, socket: { remoteAddress: ip } } as unknown as Request;
}

describe("getClientIp", () => {
  it("normalizes IPv4-mapped IPv6 addresses", () => {
    expect(getClientIp(requestWithIp("::ffff:127.0.0.1"))).toBe("127.0.0.1");
  });

  it("preserves native IPv6 addresses", () => {
    expect(getClientIp(requestWithIp("2001:db8::1"))).toBe("2001:db8::1");
  });
});