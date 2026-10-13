import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { runApiStartup, runMigrationsWithErrorLogging } from "../lib/api-startup";

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

  it("logs the migration lock blocker safely before production startup rejects", async () => {
    const { calls, hooks } = createHooks();
    const records: Record<string, unknown>[] = [];
    const logStream = {
      write(line: string) {
        records.push(JSON.parse(line) as Record<string, unknown>);
      },
    };
    const startupLogger = pino({ level: "error" }, logStream);
    const timeoutError = Object.assign(
      new Error(
        "Timed out after 3000 ms waiting for the database migration lock " +
          "(MIGRATION_LOCK_TIMEOUT_MS). Another migration may still be running. " +
          "Check active PostgreSQL sessions and retry; this attempt did not prepare or apply migrations. " +
          "Blocking PostgreSQL process(es): pid=4321, application_name=visitecrm-migration-lock-holder-test.",
      ),
      {
        name: "MigrationLockTimeoutError",
        code: "ERR_MIGRATION_LOCK_TIMEOUT",
        blockers: [{ pid: 4321, applicationName: "visitecrm-migration-lock-holder-test" }],
      },
    );
    hooks.applyMigrations.mockImplementationOnce(() =>
      runMigrationsWithErrorLogging(
        async () => {
          throw timeoutError;
        },
        (err) => startupLogger.error({ err }, "Drizzle migration failed"),
      ),
    );

    await expect(
      runApiStartup({ NODE_ENV: "production" }, hooks),
    ).rejects.toBe(timeoutError);

    expect(calls).toEqual([]);
    expect(hooks.listen).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
    expect(records[0].msg).toBe("Drizzle migration failed");
    const serializedRecord = JSON.stringify(records[0]);
    expect(serializedRecord).toContain("pid=4321");
    expect(serializedRecord).toContain("application_name=visitecrm-migration-lock-holder-test");
    expect(serializedRecord).not.toMatch(/postgres(?:ql)?:\/\/|SELECT\s/i);
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
