import type { Pool } from "pg";

export declare function prepareEmptyMigrations(
  pool: Pool,
  migrationsFolder: string,
): Promise<void>;