import type { Pool } from "pg";

export declare function prepareEmptyMigrations(
  pool: Pool,
  migrationsFolder: string,
): Promise<void>;

export declare function runMigrationPipeline<T>(
  pool: Pool,
  migrationsFolder: string,
  applyMigrations: () => Promise<T>,
): Promise<T>;