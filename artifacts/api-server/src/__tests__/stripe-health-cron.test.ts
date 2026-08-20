import { beforeEach, describe, expect, it, vi } from "vitest";

type Plan = {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  monthlyPrice: string;
  annualPrice: string;
  sortOrder: number;
  createdAt: Date;
};

const h = vi.hoisted(() => {
  const settings = new Map<string, string>();
  const plans: Plan[] = [];
  const stripePrices = new Map<string, Array<Record<string, unknown>>>();

  return {
    settings,
    plans,
    stripePrices,
    plansTable: {},
    platformSettingsTable: {},
    sendAlert: vi.fn(async () => ({ success: true, messageId: "alert-1" })),
    sendRecovery: vi.fn(async () => ({ success: true, messageId: "recovery-1" })),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
});

vi.mock("@workspace/db", () => {
  const db = {
    select: vi.fn((fields?: { value?: unknown }) => ({
      from: (table: unknown) => {
        if (table === h.plansTable) {
          return { orderBy: () => Promise.resolve(h.plans) };
        }
        return {
          where: (condition: { value?: string }) => ({
            limit: () => {
              const value = h.settings.get(condition.value ?? "");
              return Promise.resolve(value === undefined ? [] : [{ value }]);
            },
          }),
        };
      },
    })),
    execute: vi.fn(async (query: { text: string; values: unknown[] }) => {
      const { text, values } = query;
      const alertKey = "stripe_health_alert_last_sent";
      const unhealthyKey = "stripe_health_was_unhealthy";

      if (text.includes("INSERT INTO platform_settings")) {
        const key = values.find((value) => value === alertKey || value === unhealthyKey) as string;
        if (key === alertKey) {
          const claimValue = values.find(
            (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}:/.test(value),
          ) as string;
          const todayPrefix = claimValue.slice(0, 11);
          if (h.settings.get(key)?.startsWith(todayPrefix)) return { rows: [] };
          h.settings.set(key, claimValue);
          return { rows: [{ value: claimValue }] };
        }

        h.settings.set(unhealthyKey, "unhealthy");
        return { rows: [] };
      }

      if (text.includes("UPDATE platform_settings") && text.includes("RETURNING value")) {
        const claimValue = values.find(
          (value) => typeof value === "string" && value.startsWith("recovery:"),
        ) as string;
        if (h.settings.get(unhealthyKey) !== "unhealthy") return { rows: [] };
        h.settings.set(unhealthyKey, claimValue);
        return { rows: [{ value: claimValue }] };
      }

      if (text.includes("UPDATE platform_settings")) {
        const recoveryClaim = values.find(
          (value) => typeof value === "string" && value.startsWith("recovery:"),
        ) as string;
        if (h.settings.get(unhealthyKey) === recoveryClaim) {
          h.settings.set(unhealthyKey, "unhealthy");
        }
        return { rows: [] };
      }

      if (text.includes("DELETE FROM platform_settings")) {
        const recoveryClaim = values.find(
          (value) => typeof value === "string" && value.startsWith("recovery:"),
        ) as string;
        if (h.settings.get(unhealthyKey) === recoveryClaim) {
          h.settings.delete(unhealthyKey);
        }
        return { rows: [] };
      }

      return { rows: [] };
    }),
  };

  return {
    db,
    plansTable: h.plansTable,
    platformSettingsTable: h.platformSettingsTable,
  };
});

vi.mock("drizzle-orm", () => ({
  asc: vi.fn(),
  eq: vi.fn((_column: unknown, value: string) => ({ value })),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    text: strings.join("?"),
    values,
  }),
}));

vi.mock("../lib/stripeClient", () => ({
  getStripeSecretKey: vi.fn(async () => "sk_test_health"),
}));

vi.mock("stripe", () => ({
  default: class {
    prices = {
      search: vi.fn(async ({ query }: { query: string }) => {
        const slug = query.match(/\]:'([^']+)'/)?.[1] ?? "";
        return { data: h.stripePrices.get(slug) ?? [] };
      }),
    };
  },
}));

vi.mock("@workspace/email", () => ({
  sendStripeHealthAlertEmail: h.sendAlert,
  sendStripeHealthRecoveryEmail: h.sendRecovery,
}));

vi.mock("../lib/logger", () => ({
  logger: { error: h.error, info: h.info, warn: h.warn },
}));

vi.mock("../lib/id", () => ({
  generateId: vi.fn(() => "generated-id"),
}));

import { runStripeHealthCheckCron } from "../lib/stripe-health-check.js";

const paidPlan: Plan = {
  id: "plan-pro",
  slug: "pro",
  name: "Pro",
  isActive: true,
  monthlyPrice: "49.90",
  annualPrice: "499.00",
  sortOrder: 1,
  createdAt: new Date("2026-01-01"),
};

function setHealthyStripePrices(): void {
  h.stripePrices.set("pro", [
    { recurring: { interval: "month" }, unit_amount: 4990, currency: "brl" },
    { recurring: { interval: "year" }, unit_amount: 49900, currency: "brl" },
  ]);
}

describe("runStripeHealthCheckCron — recovery notification", () => {
  beforeEach(() => {
    h.settings.clear();
    h.plans.splice(0, h.plans.length, paidPlan);
    h.stripePrices.clear();
    h.sendAlert.mockClear();
    h.sendRecovery.mockClear();
    h.sendAlert.mockResolvedValue({ success: true, messageId: "alert-1" });
    h.sendRecovery.mockResolvedValue({ success: true, messageId: "recovery-1" });
    process.env["SUPERADMIN_EMAIL"] = "admin@example.com";
  });

  it("sends one recovery email after a delivered alert and clears the event", async () => {
    await runStripeHealthCheckCron();

    expect(h.sendAlert).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@example.com" }),
    );
    expect(h.settings.get("stripe_health_was_unhealthy")).toBe("unhealthy");

    setHealthyStripePrices();
    await runStripeHealthCheckCron();

    expect(h.sendRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ to: "admin@example.com" }),
    );
    expect(h.settings.has("stripe_health_was_unhealthy")).toBe(false);

    await runStripeHealthCheckCron();
    expect(h.sendRecovery).toHaveBeenCalledTimes(1);
  });

  it("restores the pending recovery event when delivery fails so a later run retries", async () => {
    h.settings.set("stripe_health_was_unhealthy", "unhealthy");
    setHealthyStripePrices();
    h.sendRecovery.mockResolvedValueOnce({ success: false, error: "Resend unavailable" });

    await runStripeHealthCheckCron();
    expect(h.settings.get("stripe_health_was_unhealthy")).toBe("unhealthy");

    await runStripeHealthCheckCron();
    expect(h.sendRecovery).toHaveBeenCalledTimes(2);
    expect(h.settings.has("stripe_health_was_unhealthy")).toBe(false);
  });
});