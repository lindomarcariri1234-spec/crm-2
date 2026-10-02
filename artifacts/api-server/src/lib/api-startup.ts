export interface ApiStartupEnvironment {
  NODE_ENV?: string;
  RUN_STARTUP_MIGRATIONS?: string;
  ENABLE_BACKGROUND_SERVICES?: string;
}

export interface ApiStartupHooks {
  applyMigrations: () => Promise<void>;
  listen: () => Promise<boolean | void> | boolean | void;
  initializeStripeSync: () => void;
  onMigrationsSkipped?: () => void;
  onStripeSyncSkipped?: () => void;
  onBackgroundServicesSkipped?: () => void;
}

/**
 * Order startup side effects so the API cannot accept requests before a
 * required schema migration completes. Local development avoids implicit
 * database/provider work unless the developer opts in explicitly.
 */
export async function runApiStartup(
  environment: ApiStartupEnvironment,
  hooks: ApiStartupHooks,
): Promise<boolean> {
  const isProduction = environment.NODE_ENV === "production";

  if (isProduction || environment.RUN_STARTUP_MIGRATIONS === "true") {
    await hooks.applyMigrations();
  } else {
    hooks.onMigrationsSkipped?.();
  }

  const serverStarted = await hooks.listen();
  if (serverStarted === false) return false;

  if (isProduction) {
    hooks.initializeStripeSync();
  } else {
    hooks.onStripeSyncSkipped?.();
  }

  const startBackgroundServices =
    isProduction || environment.ENABLE_BACKGROUND_SERVICES === "true";
  if (!startBackgroundServices) {
    hooks.onBackgroundServicesSkipped?.();
  }
  return startBackgroundServices;
}
