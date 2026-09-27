import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:5190";

export default defineConfig({
  testDir: "./visual-tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium",
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm run dev:visual",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});