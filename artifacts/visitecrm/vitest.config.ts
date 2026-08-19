import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // Component tests render real TSX (NotificationBell, BoardingControlPage), so
  // JSX must use the automatic runtime — none of those files import React.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
