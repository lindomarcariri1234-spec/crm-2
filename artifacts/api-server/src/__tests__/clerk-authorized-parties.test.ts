import { describe, expect, it } from "vitest";
import {
  canonicalizeInstagramConnectClerkRequest,
  requireClerkAuthorizedParties,
} from "../lib/clerk-request.js";

describe("requireClerkAuthorizedParties", () => {
  it("normalizes configured origins", () => {
    expect(
      requireClerkAuthorizedParties(
        ["https://crm.example/", undefined, "https://store.example///"],
        true,
      ),
    ).toEqual(["https://crm.example", "https://store.example"]);
  });

  it("rejects an empty allowlist in production", () => {
    expect(() => requireClerkAuthorizedParties([], true)).toThrow(
      /Missing Clerk authorized parties in production/,
    );
  });

  it("keeps the empty allowlist fallback outside production", () => {
    expect(requireClerkAuthorizedParties([], false)).toEqual([]);
  });
});

describe("canonicalizeInstagramConnectClerkRequest", () => {
  const options = {
    isProduction: true,
    canonicalFrontendOrigin: "https://visitecrm.com",
    replitDomains: ["crm-2-lindomarcariri.replit.app"],
  };

  it("uses the canonical frontend host for Clerk's connect-route handshake", () => {
    const request = {
      path: "/api/instagram-messaging/connect",
      headers: {
        host: "crm-2-lindomarcariri.replit.app",
        "x-forwarded-host": "crm-2-lindomarcariri.replit.app",
        "x-forwarded-proto": "http",
      },
    };

    expect(canonicalizeInstagramConnectClerkRequest(request, options)).toBe(true);
    expect(request.headers["x-forwarded-host"]).toBe("visitecrm.com");
    expect(request.headers["x-forwarded-proto"]).toBe("https");
  });

  it("leaves other routes and non-Replit hosts unchanged", () => {
    const otherRoute = {
      path: "/api/users/me",
      headers: { host: "crm-2-lindomarcariri.replit.app" },
    };
    const canonicalHost = {
      path: "/api/instagram-messaging/connect",
      headers: { host: "visitecrm.com" },
    };

    expect(canonicalizeInstagramConnectClerkRequest(otherRoute, options)).toBe(false);
    expect(canonicalizeInstagramConnectClerkRequest(canonicalHost, options)).toBe(false);
    expect(otherRoute.headers.host).toBe("crm-2-lindomarcariri.replit.app");
    expect(canonicalHost.headers.host).toBe("visitecrm.com");
  });

  it("does not rewrite requests outside production", () => {
    const request = {
      path: "/api/instagram-messaging/connect",
      headers: { host: "crm-2-lindomarcariri.replit.app" },
    };

    expect(canonicalizeInstagramConnectClerkRequest(request, {
      ...options,
      isProduction: false,
    })).toBe(false);
    expect(request.headers.host).toBe("crm-2-lindomarcariri.replit.app");
  });
});