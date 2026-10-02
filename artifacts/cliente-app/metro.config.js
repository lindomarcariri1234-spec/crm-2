const { getDefaultConfig } = require("expo/metro-config");
const fs = require("node:fs");
const path = require("node:path");
const { collectMetroDependencyFolders } = require("../../scripts/metro-watch-folders.cjs");

// Replit injects the active Clerk development key as CLERK_PUBLISHABLE_KEY.
// Expo only exposes EXPO_PUBLIC_* variables to the client bundle, so map it
// before Metro starts transforming files. Never fall back to the live VITE key.
if (process.env.REPL_ID && process.env.CLERK_PUBLISHABLE_KEY) {
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY;
}

const config = getDefaultConfig(__dirname);

// Avoid crawling every workspace dependency in the monorepo. PNPM's symlinks
// let us watch only this app's resolved dependency graph. Expo Router's web
// runtime resolves its own dependencies from its adjacent PNPM node_modules.
const runtimeRoot = fs.realpathSync(path.join(__dirname, "node_modules/@expo/metro-runtime"));
const runtimeDependencyRoot = path.resolve(runtimeRoot, "../..");
config.watchFolders = [
  ...collectMetroDependencyFolders(path.join(__dirname, "node_modules"), [runtimeDependencyRoot]),
  runtimeDependencyRoot,
].filter((folder, index, folders) => folders.indexOf(folder) === index);

module.exports = config;
