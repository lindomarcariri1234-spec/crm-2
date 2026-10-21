import { describe, expect, it } from "vitest";
import { resolveClerkProxyUrl } from "../lib/clerk-proxy-url";

describe("resolveClerkProxyUrl", () => {
  const configuredUrls = [
    "https://visitecrm.com/api/__clerk",
    "https://www.visitecrm.com/api/__clerk",
    "https://visitecariri.com.br/api/__clerk",
    "https://crm-2-lindomarcariri.replit.app/api/__clerk",
  ].join(",");

  it("selects the proxy URL for the current custom domain", () => {
    expect(
      resolveClerkProxyUrl(configuredUrls, "https://visitecariri.com.br"),
    ).toBe("https://visitecariri.com.br/api/__clerk");
  });

  it("does not match a hostname that merely starts with the current origin", () => {
    expect(
      resolveClerkProxyUrl(
        "https://visitecrm.com.attacker.invalid/api/__clerk",
        "https://visitecrm.com",
      ),
    ).toBeUndefined();
  });

  it("returns no proxy for an unset value or an unconfigured origin", () => {
    expect(resolveClerkProxyUrl(undefined, "https://visitecrm.com")).toBeUndefined();
    expect(
      resolveClerkProxyUrl(configuredUrls, "https://unknown.example"),
    ).toBeUndefined();
  });
});
