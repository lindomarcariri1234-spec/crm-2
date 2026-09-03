import { describe, expect, it, vi } from "vitest";
import {
  getBundleSizeLimits,
  reportBundleSize,
} from "./vercel-bundle-size.mjs";

function logger() {
  return {
    log: vi.fn(),
    warn: vi.fn(),
  };
}

function report(bytes) {
  return {
    bundlePath: "synthetic-bundle.mjs",
    label: "synthetic-bundle.mjs",
    bytes,
    gzipBytes: Math.max(1, Math.floor(bytes / 2)),
  };
}

describe("vercel bundle size limits", () => {
  const limits = {
    warningBytes: 100,
    maxBytes: 200,
  };

  it("accepts a bundle below the warning threshold without warning", () => {
    const output = logger();

    expect(() => reportBundleSize(report(99), limits, output)).not.toThrow();
    expect(output.warn).not.toHaveBeenCalled();
  });

  it("warns when a bundle is within the warning range", () => {
    const output = logger();

    expect(() => reportBundleSize(report(100), limits, output)).not.toThrow();
    expect(output.warn).toHaveBeenCalledOnce();
  });

  it("fails when a bundle reaches the maximum threshold", () => {
    const output = logger();

    expect(() => reportBundleSize(report(200), limits, output)).toThrow(
      /configured maximum/,
    );
    expect(output.warn).not.toHaveBeenCalled();
  });

  it("parses custom byte and MiB limits together", () => {
    expect(
      getBundleSizeLimits({
        VERCEL_BUNDLE_WARN_BYTES: "2 MiB",
        VERCEL_BUNDLE_MAX_BYTES: "3145728",
      }),
    ).toEqual({
      warningBytes: 2 * 1024 * 1024,
      maxBytes: 3145728,
    });
  });
});