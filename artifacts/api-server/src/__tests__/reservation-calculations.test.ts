import { describe, it, expect } from "vitest";
import { normalizeOrderEmail } from "../lib/pricing.js";

describe("normalizeOrderEmail — store order lookup email validation", () => {
  it("returns normalized email for a valid email string", () => {
    expect(normalizeOrderEmail("  User@Example.com  ")).toBe("user@example.com");
  });

  it("returns empty string for undefined (query param not provided)", () => {
    expect(normalizeOrderEmail(undefined)).toBe("");
  });

  it("returns empty string for an empty string", () => {
    expect(normalizeOrderEmail("")).toBe("");
  });

  it("returns empty string for a whitespace-only string", () => {
    expect(normalizeOrderEmail("   ")).toBe("");
  });

  it("returns empty string for a number (non-string type)", () => {
    expect(normalizeOrderEmail(123)).toBe("");
  });

  it("returns empty string for an array (multiple query params)", () => {
    expect(normalizeOrderEmail(["a@b.com", "c@d.com"])).toBe("");
  });
});
