import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./connection.js";
import { runMigrationPipeline } from "../scripts/prepare-empty-migrations.mjs";

/**
 * Applies all pending Drizzle migrations from the given folder.
 *
 * The immutable baseline adds three constraints to referral tables that were
 * first created by later migrations. A completely empty public schema needs
 * those two CREATE TABLE statements before Drizzle runs the baseline.
 *
 * The baseline's `when` in meta/_journal.json is set deliberately low so that
 * databases with existing migration history skip it (the migrator only applies
 * entries newer than the single most-recently-applied one), while empty
 * databases apply it. Future schema changes are added as new migrations
 * (idx 1+) via `pnpm --filter @workspace/db generate`.
 *
 * Existing databases are never bootstrapped; their migration history and
 * rows remain untouched by this preparation step.
 */
export async function runMigrations(migrationsFolder: string): Promise<void> {
  await runMigrationPipeline(pool, migrationsFolder, () =>
    migrate(db, { migrationsFolder }),
  );
}
