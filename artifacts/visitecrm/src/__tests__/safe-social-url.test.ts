import { describe, expect, it } from "vitest";
import { getSafeSocialUrl } from "@/lib/safe-social-url";

describe("getSafeSocialUrl", () => {
  it("preserves HTTPS social URLs", () => {
    expect(getSafeSocialUrl("https://www.facebook.com/example")).toBe(
      "https://www.facebook.com/example",
    );
    expect(getSafeSocialUrl("  https://www.youtube.com/@example  ")).toBe(
      "https://www.youtube.com/@example",
    );
  });

  it("rejects unsafe and non-HTTPS URLs", () => {
    expect(getSafeSocialUrl("javascript:alert(document.domain)")).toBeNull();
    expect(getSafeSocialUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(getSafeSocialUrl("http://www.facebook.com/example")).toBeNull();
    expect(getSafeSocialUrl("//www.youtube.com/@example")).toBeNull();
    expect(getSafeSocialUrl("not a URL")).toBeNull();
  });
});