import { describe, expect, it } from "vitest";
import { getSafeRedirectTarget } from "@/lib/safe-redirect";

describe("getSafeRedirectTarget", () => {
  it("keeps a safe relative redirect", () => {
    expect(
      getSafeRedirectTarget("?redirect_url=%2Fperfil%3Ftab%3Dreservas", "redirect_url", "/"),
    ).toBe("/perfil?tab=reservas");
  });

  it("falls back when the redirect is external or malformed", () => {
    expect(getSafeRedirectTarget("?redirect_url=https%3A%2F%2Fevil.test", "redirect_url", "/")).toBe("/");
    expect(getSafeRedirectTarget("?redirect_url=%2F%2Fevil.test", "redirect_url", "/")).toBe("/");
    expect(getSafeRedirectTarget("?redirect_url=%2F%5Cevil.test", "redirect_url", "/")).toBe("/");
    expect(getSafeRedirectTarget("", "redirect_url", "/")).toBe("/");
  });
});