import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    // These suites import the real database connection. Run them through
    // `pnpm test:integration` when DATABASE_URL is available.
    exclude: [
      "src/**/*integration.test.ts",
      "src/__tests__/referral-reversal-gaps.test.ts",
      "src/__tests__/referral-source-constraint.test.ts",
      "src/__tests__/reservation-patch-deal-sync.test.ts",
    ],
  },
});
