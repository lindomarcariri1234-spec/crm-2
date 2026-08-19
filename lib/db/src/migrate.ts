import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./connection.js";

/**
 * Applies all pending Drizzle migrations from the given folder.
 *
 * The migration history was squashed into a single consolidated, idempotent
 * baseline (0000_squash_baseline) generated from the current schema. It uses
 * CREATE TABLE/INDEX IF NOT EXISTS plus DO $$ … EXCEPTION WHEN duplicate_object
 * guards on every FK, so it is safe against both empty databases (creates the
 * full schema) and populated ones (all statements are no-ops).
 *
 * The baseline's `when` in meta/_journal.json is set deliberately low so that
 * databases with existing migration history skip it (the migrator only applies
 * entries newer than the single most-recently-applied one), while empty
 * databases apply it. Future schema changes are added as new migrations
 * (idx 1+) via `pnpm --filter @workspace/db generate`.
 *
 * No custom bootstrap is required: on first use Drizzle creates the
 * drizzle.__drizzle_migrations tracking table and runs every unapplied
 * migration in journal order.
 */
export async function runMigrations(migrationsFolder: string): Promise<void> {
  await migrate(db, { migrationsFolder });
}
