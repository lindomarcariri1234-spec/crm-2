import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // This suite imports the real database connection. Run it through
    // `pnpm test:integration` when DATABASE_URL is available.
    exclude: ["src/__tests__/admin-cancel-referral-integration.test.ts"],
  },
});
