import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const rawUrl = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === "production";

// In production, strip sslmode from the connection string and supply explicit
// ssl options instead. pg-connection-string emits a deprecation warning when
// it sees sslmode='require'/'prefer'/'verify-ca' in the URL regardless of
// whether a separate `ssl` option is also provided, so the only reliable fix
// is to remove it from the URL before passing to Pool.
let connectionString = rawUrl;
const sslOption: { ssl?: { rejectUnauthorized: boolean } } = {};

if (isProduction) {
  try {
    const u = new URL(rawUrl);
    u.searchParams.delete("sslmode");
    connectionString = u.toString();
  } catch {
    // Non-standard URL format — keep original and rely on ssl option alone
  }
  sslOption.ssl = { rejectUnauthorized: true };
}

export const pool = new Pool({ connectionString, ...sslOption });

pool.on("error", (err) => {
  // Use process.stderr directly here — logger depends on DB and would create
  // a circular dependency if imported in connection.ts.
  process.stderr.write(`[db] Unexpected idle-client error: ${err.message}\n`);
});

export const db = drizzle(pool, { schema });
