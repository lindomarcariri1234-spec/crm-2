const { getDefaultConfig } = require("expo/metro-config");
const fs = require("node:fs");
const path = require("node:path");
const { collectMetroDependencyFolders } = require("../../scripts/metro-watch-folders.cjs");

const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "../..");
const appNodeModulesPath = path.join(__dirname, "node_modules");
const expoRoot = fs.realpathSync(path.join(appNodeModulesPath, "expo"));
const expoDependencyRoot = path.dirname(expoRoot);
const runtimeRoot = fs.realpathSync(path.join(__dirname, "node_modules/@expo/metro-runtime"));
const runtimeDependencyRoot = path.resolve(runtimeRoot, "../..");

// Keep the shared API client source and this app's resolved dependencies in
// Metro's file map. The web runtime also needs its adjacent PNPM dependency
// links, without crawling the workspace-wide dependency store.
const dependencyRoots = [expoDependencyRoot, runtimeDependencyRoot];
config.watchFolders = [
  ...collectMetroDependencyFolders(appNodeModulesPath, dependencyRoots),
  ...dependencyRoots,
  path.join(workspaceRoot, "lib/api-client-react"),
].filter((folder, index, folders) => folders.indexOf(folder) === index);

module.exports = config;
