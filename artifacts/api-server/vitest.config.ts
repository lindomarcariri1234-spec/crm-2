import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // These suites import the real database connection. Run them through
    // `pnpm test:integration` when DATABASE_URL is available.
    exclude: [
      "src/__tests__/admin-cancel-referral-integration.test.ts",
      "src/__tests__/backup-export-integration.test.ts",
    ],
  },
});
