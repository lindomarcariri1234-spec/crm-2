import { spawn } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import { runMigrationPipeline } from "./prepare-empty-migrations.mjs";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running migrations");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const packageDir = resolve(import.meta.dirname, "..");
  const migrationsFolder = resolve(packageDir, "drizzle");
  await runMigrationPipeline(pool, migrationsFolder, () => new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      "pnpm",
      ["exec", "drizzle-kit", "migrate", "--config", "./drizzle.config.ts"],
      { cwd: packageDir, env: process.env, stdio: "inherit" },
    );
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`drizzle-kit migrate exited with ${code ?? signal}`));
    });
  }));
} finally {
  await pool.end();
}