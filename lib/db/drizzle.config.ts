// After modifying any file in src/schema/, always run:
//   pnpm --filter @workspace/db generate
// to create the corresponding migration file. Skipping this step will cause
// the running database to diverge silently from the Drizzle schema.
// Run `pnpm --filter @workspace/db check` (or `pnpm run schema:check` at the
// workspace root) to verify all schema changes have a corresponding migration.
//
// SCHEMA-ONLY MODE (generate without a live DB):
//   DRIZZLE_SCHEMA_ONLY=1 pnpm --filter @workspace/db generate
// Use this in CI or when you only need to generate/compare migration SQL
// without connecting to a database.  `migrate`, `push`, `check`, and `studio`
// still require DATABASE_URL.
import { defineConfig } from "drizzle-kit";
import path from "path";

const schemaOnly = process.env.DRIZZLE_SCHEMA_ONLY === "1";

if (!schemaOnly && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  out: "./drizzle",
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : {}),
});
