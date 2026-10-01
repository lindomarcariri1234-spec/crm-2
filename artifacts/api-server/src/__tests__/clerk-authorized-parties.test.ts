import { describe, expect, it } from "vitest";
import { requireClerkAuthorizedParties } from "../lib/clerk-request.js";

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