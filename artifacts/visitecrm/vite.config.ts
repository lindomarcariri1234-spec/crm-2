import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { execFileSync } from "node:child_process";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 5173;

const basePath = process.env.BASE_PATH ?? "/";

function getPublicationVersion(): string {
  const configuredVersion =
    process.env.PUBLICATION_VERSION ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    process.env.VERCEL_DEPLOYMENT_ID;
  if (configuredVersion?.trim()) return configuredVersion.trim();

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: path.resolve(import.meta.dirname, "..", ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error(
      "Unable to determine the publication version. Set PUBLICATION_VERSION before building the storefront.",
    );
  }
}

const publicationVersion = getPublicationVersion();

const publicationIdentityPlugin = {
  name: "visitecrm-publication-identity",
  transformIndexHtml(html: string): string {
    return html.replaceAll("__VISITECRM_PUBLICATION_VERSION__", publicationVersion);
  },
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: ".publication-version",
      source: `${publicationVersion}\n`,
    });
  },
};

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
    publicationIdentityPlugin,
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
    // ExcelJS is a single, on-demand third-party runtime (~937 kB minified)
    // that cannot be meaningfully split by Rollup. It is loaded only by the
    // spreadsheet import/download flows. The post-build bundle check enforces
    // the 500 kB budget for the entrypoint and normal chunks while allowing
    // ExcelJS its separate 1,000 kB budget.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/jspdf")) {
            return "vendor-jspdf";
          }
          if (id.includes("node_modules/html2canvas")) {
            return "vendor-html2canvas";
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
      // Production sourcemaps are intentionally disabled. Some shadcn/Radix
      // wrappers still carry an incomplete transform map, which Rollup tries
      // to use only while formatting a diagnostic. Ignore that diagnostic
      // rather than publishing a false sourcemap warning; real build warnings
      // continue through the default handler.
      onwarn(warning, warn) {
        if (warning.code === "SOURCEMAP_ERROR") return;
        warn(warning);
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
