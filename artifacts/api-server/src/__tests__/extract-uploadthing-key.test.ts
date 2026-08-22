/**
 * extract-uploadthing-key.test.ts
 *
 * Regression guard for extractVerifiedUploadThingKey() in lib/uploadthing.ts.
 *
 * Each UploadThing URL format that the application stores in the DB must be
 * recognized by this helper so referenced-key checks (cleanup job, orphan
 * detection) never mistake live assets for orphans.
 *
 * URL formats in use:
 *   - https://<appId>.ufs.sh/f/<key>   — current "ufsUrl" format (ufs.sh domain)
 *   - https://utfs.io/f/<key>           — legacy format (still in existing DB rows)
 *   - https://*.ufs.io/f/<key>          — ufs.io subdomain variant
 *   - https://*.uploadthing.com/f/<key> — uploadthing.com domain
 */

// uploadthing.ts is not vi.mocked here — we test the real implementation.
// The UTApi instantiation at the top of uploadthing.ts uses a CJS require() that
// is safe to run without UPLOADTHING_TOKEN because we only import the named export.
vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("drizzle-orm", () => ({ sql: vi.fn() }));

import { describe, it, expect, vi } from "vitest";
import { extractVerifiedUploadThingKey } from "../lib/uploadthing.js";

const KEY = "abc123XYZ";

describe("extractVerifiedUploadThingKey()", () => {
  // ── Recognized hosts ────────────────────────────────────────────────────────

  it("extracts key from current ufs.sh subdomain URL (ufsUrl format)", () => {
    expect(extractVerifiedUploadThingKey(`https://utfs.ufs.sh/f/${KEY}`)).toBe(KEY);
  });

  it("extracts key from arbitrary ufs.sh subdomain (app-specific)", () => {
    expect(extractVerifiedUploadThingKey(`https://myapp.ufs.sh/f/${KEY}`)).toBe(KEY);
  });

  it("extracts key from bare ufs.sh hostname", () => {
    expect(extractVerifiedUploadThingKey(`https://ufs.sh/f/${KEY}`)).toBe(KEY);
  });

  it("extracts key from legacy utfs.io URL", () => {
    expect(extractVerifiedUploadThingKey(`https://utfs.io/f/${KEY}`)).toBe(KEY);
  });

  it("extracts key from ufs.io subdomain URL", () => {
    expect(extractVerifiedUploadThingKey(`https://sub.ufs.io/f/${KEY}`)).toBe(KEY);
  });

  it("extracts key from uploadthing.com URL", () => {
    expect(extractVerifiedUploadThingKey(`https://example.uploadthing.com/f/${KEY}`)).toBe(KEY);
  });

  // ── Rejected inputs ─────────────────────────────────────────────────────────

  it("returns null for an unknown host (would wrongly skip a referenced-key check)", () => {
    expect(extractVerifiedUploadThingKey(`https://cdn.example.com/f/${KEY}`)).toBeNull();
  });

  it("returns null for a path without /f/ prefix", () => {
    expect(extractVerifiedUploadThingKey(`https://utfs.ufs.sh/assets/${KEY}`)).toBeNull();
  });

  it("returns null for a null URL", () => {
    expect(extractVerifiedUploadThingKey(null as unknown as string)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(extractVerifiedUploadThingKey("")).toBeNull();
  });

  it("returns null for a non-URL string", () => {
    expect(extractVerifiedUploadThingKey("not-a-url")).toBeNull();
  });

  it("returns null for a Clerk avatar URL (different domain)", () => {
    expect(
      extractVerifiedUploadThingKey(`https://img.clerk.com/eyJ0eXAiOi.../${KEY}`),
    ).toBeNull();
  });
});
