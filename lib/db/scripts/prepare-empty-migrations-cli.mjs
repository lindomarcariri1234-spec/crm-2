import { resolve } from "node:path";
import pg from "pg";
import { prepareEmptyMigrations } from "./prepare-empty-migrations.mjs";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running migrations");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  await prepareEmptyMigrations(pool, resolve(import.meta.dirname, "../drizzle"));
} finally {
  await pool.end();
}