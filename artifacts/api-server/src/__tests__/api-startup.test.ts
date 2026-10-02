import { describe, expect, it, vi } from "vitest";
import { runApiStartup } from "../lib/api-startup";

function createHooks() {
  const calls: string[] = [];
  return {
    calls,
    hooks: {
      applyMigrations: vi.fn(async () => {
        calls.push("migrate");
      }),
      listen: vi.fn(async () => {
        calls.push("listen");
        return true;
      }),
      initializeStripeSync: vi.fn(() => {
        calls.push("stripe");
      }),
      onMigrationsSkipped: vi.fn(),
      onStripeSyncSkipped: vi.fn(),
      onBackgroundServicesSkipped: vi.fn(),
    },
  };
}

describe("runApiStartup", () => {
  it("keeps development startup free of implicit migration and provider work", async () => {
    const { calls, hooks } = createHooks();

    const shouldStartBackgroundServices = await runApiStartup(
      { NODE_ENV: "development" },
      hooks,
    );

    expect(calls).toEqual(["listen"]);
    expect(shouldStartBackgroundServices).toBe(false);
    expect(hooks.applyMigrations).not.toHaveBeenCalled();
    expect(hooks.initializeStripeSync).not.toHaveBeenCalled();
    expect(hooks.onMigrationsSkipped).toHaveBeenCalledOnce();
    expect(hooks.onStripeSyncSkipped).toHaveBeenCalledOnce();
    expect(hooks.onBackgroundServicesSkipped).toHaveBeenCalledOnce();
  });

  it("waits for explicitly requested development migrations before listening", async () => {
    const { calls, hooks } = createHooks();

    const shouldStartBackgroundServices = await runApiStartup(
      { NODE_ENV: "development", RUN_STARTUP_MIGRATIONS: "true" },
      hooks,
    );

    expect(calls).toEqual(["migrate", "listen"]);
    expect(shouldStartBackgroundServices).toBe(false);
    expect(hooks.initializeStripeSync).not.toHaveBeenCalled();
  });

  it("runs required production migrations before listening and production services", async () => {
    const { calls, hooks } = createHooks();

    const shouldStartBackgroundServices = await runApiStartup(
      {
        NODE_ENV: "production",
        RUN_STARTUP_MIGRATIONS: "false",
        ENABLE_BACKGROUND_SERVICES: "false",
      },
      hooks,
    );

    expect(calls).toEqual(["migrate", "listen", "stripe"]);
    expect(shouldStartBackgroundServices).toBe(true);
  });

  it("does not listen or start services if required migrations fail", async () => {
    const { calls, hooks } = createHooks();
    hooks.applyMigrations.mockRejectedValueOnce(new Error("migration failed"));

    await expect(
      runApiStartup({ NODE_ENV: "production" }, hooks),
    ).rejects.toThrow("migration failed");

    expect(calls).toEqual([]);
    expect(hooks.listen).not.toHaveBeenCalled();
    expect(hooks.initializeStripeSync).not.toHaveBeenCalled();
  });

  it("does not start provider or background services when the development port is unavailable", async () => {
    const { calls, hooks } = createHooks();
    hooks.listen.mockImplementationOnce(async () => {
      calls.push("listen");
      return false;
    });

    const shouldStartBackgroundServices = await runApiStartup(
      { NODE_ENV: "development" },
      hooks,
    );

    expect(calls).toEqual(["listen"]);
    expect(shouldStartBackgroundServices).toBe(false);
    expect(hooks.initializeStripeSync).not.toHaveBeenCalled();
  });

  it("allows an explicit development opt-in to background services but not Stripe Sync", async () => {
    const { calls, hooks } = createHooks();

    const shouldStartBackgroundServices = await runApiStartup(
      { NODE_ENV: "development", ENABLE_BACKGROUND_SERVICES: "true" },
      hooks,
    );

    expect(calls).toEqual(["listen"]);
    expect(shouldStartBackgroundServices).toBe(true);
    expect(hooks.initializeStripeSync).not.toHaveBeenCalled();
  });
});
