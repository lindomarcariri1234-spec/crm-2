import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;

const basePath = process.env.BASE_PATH ?? "/";


// Replit provisions CLERK_PUBLISHABLE_KEY for the active Clerk environment:
// the development tenant for workspace previews and the production tenant for
// published deployments. Keeping this mapping at build time prevents an old
// VITE_ key from pointing the preview at a different Clerk instance, whose
// redirect URLs would not be managed for the current replit.dev domain.
//
// Do not add a hard-coded key or temporary preview URL here. Replit registers
// the active preview redirect URLs automatically for its managed Clerk tenant.
//
// This override only applies inside Replit's own environment (REPL_ID is
// always set there). On other hosts (e.g. Vercel) there is no equivalent
// auto-swapped CLERK_PUBLISHABLE_KEY, so Vite's normal env handling passes
// VITE_CLERK_PUBLISHABLE_KEY (set directly in that platform's project
// settings) straight through untouched.
const clerkKeyOverride =
  process.env.REPL_ID !== undefined
    ? {
        "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY": JSON.stringify(
          process.env.CLERK_PUBLISHABLE_KEY ?? "",
        ),
      }
    : {};

export default defineConfig({
  base: basePath,
  define: clerkKeyOverride,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      "@workspace/shared": path.resolve(import.meta.dirname, "..", "..", "lib", "shared", "src", "index.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/jspdf") || id.includes("node_modules/html2canvas")) {
            return "vendor-pdf";
          }
          if (id.includes("node_modules/@tiptap") || id.includes("node_modules/prosemirror")) {
            return "vendor-editor";
          }
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-") || id.includes("node_modules/victory")) {
            return "vendor-charts";
          }
          if (id.includes("node_modules/@dnd-kit")) {
            return "vendor-dnd";
          }
          if (id.includes("node_modules/@clerk")) {
            return "vendor-clerk";
          }
          if (id.includes("node_modules/date-fns")) {
            return "vendor-dates";
          }
          if (id.includes("node_modules/@radix-ui") || id.includes("node_modules/cmdk") || id.includes("node_modules/vaul")) {
            return "vendor-ui";
          }
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/wouter") || id.includes("node_modules/@tanstack")) {
            return "vendor-react";
          }
        },
      },
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
