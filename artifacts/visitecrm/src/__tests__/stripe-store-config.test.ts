import { describe, expect, it } from "vitest";
import {
  getStripeCredentialMode,
  isStripeSupportedPaymentMethod,
  shouldWarnAboutPublishedStripeTestKey,
  validateStripeStoreConfig,
} from "../lib/stripe-store-config.js";

describe("Stripe store configuration", () => {
  it("detects test/live mode for standard and restricted API keys", () => {
    expect(getStripeCredentialMode(" pk_test_example ")).toBe("test");
    expect(getStripeCredentialMode("rk_live_example")).toBe("live");
    expect(getStripeCredentialMode("whsec_example")).toBeNull();
  });

  it("accepts a same-mode credential pair and a webhook signing secret", () => {
    expect(validateStripeStoreConfig({
      enabled: true,
      paymentMethods: ["credit_card"],
      publishableKey: "pk_live_public123",
      secretKey: "sk_live_secret123",
      secretKeyConfigured: false,
      webhookSecret: "whsec_valid-secret==",
    })).toEqual([]);
  });

  it("keeps test credentials valid in development and warns only in published builds", () => {
    const testCredentials = {
      enabled: true,
      paymentMethods: ["credit_card"],
      publishableKey: "pk_test_public123",
      secretKey: "sk_test_secret123",
      secretKeyConfigured: false,
    };

    expect(validateStripeStoreConfig(testCredentials)).toEqual([]);
    expect(shouldWarnAboutPublishedStripeTestKey(false, testCredentials.publishableKey)).toBe(false);
    expect(shouldWarnAboutPublishedStripeTestKey(true, testCredentials.publishableKey)).toBe(true);
    expect(shouldWarnAboutPublishedStripeTestKey(true, "pk_live_public123")).toBe(false);
    expect(shouldWarnAboutPublishedStripeTestKey(true, null)).toBe(false);
  });

  it("rejects credentials from different Stripe environments", () => {
    const issues = validateStripeStoreConfig({
      enabled: true,
      paymentMethods: ["credit_card"],
      publishableKey: "pk_live_public123",
      secretKey: "sk_test_secret123",
      secretKeyConfigured: false,
    });

    expect(issues).toEqual([
      expect.objectContaining({
        field: "secretKey",
        message: expect.stringContaining("mesmo ambiente"),
      }),
    ]);
  });

  it("requires credentials when Stripe is active for Pix or boleto", () => {
    const issues = validateStripeStoreConfig({
      enabled: true,
      paymentMethods: ["pix"],
      publishableKey: "",
      secretKey: "",
      secretKeyConfigured: false,
    });

    expect(issues.map((issue) => issue.field)).toEqual(["publishableKey", "secretKey"]);
    expect(isStripeSupportedPaymentMethod("boleto")).toBe(true);
    expect(isStripeSupportedPaymentMethod("transfer")).toBe(false);
  });

  it("does not block unrelated payment methods or a disabled Stripe account", () => {
    expect(validateStripeStoreConfig({
      enabled: false,
      paymentMethods: ["credit_card"],
      publishableKey: "",
      secretKey: "",
      secretKeyConfigured: false,
    })).toEqual([]);
    expect(validateStripeStoreConfig({
      enabled: true,
      paymentMethods: ["transfer"],
      publishableKey: "",
      secretKey: "",
      secretKeyConfigured: false,
    })).toEqual([]);
  });

  it("requires replacing the secret when switching an existing key from test to live", () => {
    const issues = validateStripeStoreConfig({
      enabled: true,
      paymentMethods: ["debit_card"],
      publishableKey: "pk_live_public123",
      previousPublishableKey: "pk_test_old123",
      secretKey: "",
      secretKeyConfigured: true,
    });

    expect(issues).toEqual([
      expect.objectContaining({
        field: "secretKey",
        message: expect.stringContaining("Informe também a chave secreta"),
      }),
    ]);
  });

  it("rejects a malformed webhook secret without exposing it", () => {
    const issues = validateStripeStoreConfig({
      enabled: true,
      paymentMethods: ["boleto"],
      publishableKey: "pk_test_public123",
      secretKey: "",
      secretKeyConfigured: true,
      webhookSecret: "not-a-webhook-secret",
    });

    expect(issues).toEqual([
      expect.objectContaining({
        field: "webhookSecret",
        message: expect.stringContaining("whsec_"),
      }),
    ]);
    expect(JSON.stringify(issues)).not.toContain("not-a-webhook-secret");
  });
});
