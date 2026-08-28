import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";
import { buildDatabaseConnectionConfig } from "./ssl.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const rawUrl = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === "production";

export const pool = new Pool(buildDatabaseConnectionConfig(rawUrl, isProduction));

pool.on("error", (err) => {
  // Use process.stderr directly here — logger depends on DB and would create
  // a circular dependency if imported in connection.ts.
  process.stderr.write(`[db] Unexpected idle-client error: ${err.message}\n`);
});

export const db = drizzle(pool, { schema });
