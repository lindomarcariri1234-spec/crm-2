import { mergeConfig } from "vite";
import path from "node:path";
import baseConfig from "./vite.config";

export default mergeConfig(baseConfig, {
  resolve: {
    alias: {
      "@clerk/react": path.resolve(import.meta.dirname, "visual-tests/clerk-react-shim.tsx"),
    },
  },
});