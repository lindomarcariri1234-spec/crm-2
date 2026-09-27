import type { Pool } from "pg";

export declare function prepareEmptyMigrations(
  pool: Pool,
  migrationsFolder: string,
): Promise<void>;

export declare function runMigrationPipeline<T>(
  pool: Pool,
  migrationsFolder: string,
  applyMigrations: () => Promise<T>,
  options?: { applicationName?: string },
): Promise<T>;

export declare class MigrationLockTimeoutError extends Error {
  code: "ERR_MIGRATION_LOCK_TIMEOUT";
  blockers: Array<{ pid: number; applicationName: string }>;
  constructor(timeoutMs: number, blockers?: Array<{ pid: number; applicationName: string }>);
}