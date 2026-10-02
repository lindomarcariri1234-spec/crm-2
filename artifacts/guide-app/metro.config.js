const { getDefaultConfig } = require("expo/metro-config");
const fs = require("node:fs");
const path = require("node:path");
const { collectMetroDependencyFolders } = require("../../scripts/metro-watch-folders.cjs");

const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "../..");
const appNodeModulesPath = path.join(__dirname, "node_modules");
function adjacentNodeModulesRoot(packagePath) {
  let directory = path.dirname(fs.realpathSync(packagePath));
  while (path.basename(directory) !== "node_modules" && path.dirname(directory) !== directory) {
    directory = path.dirname(directory);
  }
  if (path.basename(directory) !== "node_modules") {
    throw new Error(`Could not find adjacent node_modules for ${packagePath}`);
  }
  return directory;
}

const expoRoot = fs.realpathSync(path.join(appNodeModulesPath, "expo"));
const expoDependencyRoot = adjacentNodeModulesRoot(expoRoot);
const whatwgUrlRoot = fs.realpathSync(
  path.join(expoDependencyRoot, "whatwg-url-without-unicode"),
);
const whatwgUrlDependencyRoot = adjacentNodeModulesRoot(whatwgUrlRoot);
const bufferRoot = fs.realpathSync(path.join(whatwgUrlDependencyRoot, "buffer"));
const reactNativeRoot = fs.realpathSync(path.join(appNodeModulesPath, "react-native"));
const reactNativeDependencyRoot = adjacentNodeModulesRoot(reactNativeRoot);
const virtualizedListsRoot = fs.realpathSync(
  path.join(reactNativeDependencyRoot, "@react-native/virtualized-lists"),
);
const abortControllerRoot = fs.realpathSync(
  path.join(reactNativeDependencyRoot, "abort-controller"),
);
const gestureHandlerRoot = fs.realpathSync(
  path.join(appNodeModulesPath, "react-native-gesture-handler"),
);
const gestureHandlerDependencyRoot = adjacentNodeModulesRoot(gestureHandlerRoot);
const hoistNonReactStaticsRoot = fs.realpathSync(
  path.join(gestureHandlerDependencyRoot, "hoist-non-react-statics"),
);
const reanimatedRoot = fs.realpathSync(
  path.join(appNodeModulesPath, "react-native-reanimated"),
);
const reanimatedDependencyRoot = adjacentNodeModulesRoot(reanimatedRoot);
const routerRoot = fs.realpathSync(path.join(appNodeModulesPath, "expo-router"));
const routerDependencyRoot = adjacentNodeModulesRoot(routerRoot);
const queryStringRoot = fs.realpathSync(path.join(routerDependencyRoot, "query-string"));
const bottomTabsRoot = fs.realpathSync(
  path.join(routerDependencyRoot, "@react-navigation/bottom-tabs"),
);
const bottomTabsDependencyRoot = adjacentNodeModulesRoot(bottomTabsRoot);
const nativeStackRoot = fs.realpathSync(
  path.join(routerDependencyRoot, "@react-navigation/native-stack"),
);
const nativeStackDependencyRoot = adjacentNodeModulesRoot(nativeStackRoot);
const reactNativeScreensRoot = fs.realpathSync(
  path.join(nativeStackDependencyRoot, "react-native-screens"),
);
const reactNativeScreensDependencyRoot = adjacentNodeModulesRoot(reactNativeScreensRoot);
const navigationElementsRoot = fs.realpathSync(
  path.join(bottomTabsDependencyRoot, "@react-navigation/elements"),
);
const navigationElementsDependencyRoot = adjacentNodeModulesRoot(navigationElementsRoot);
const colorRoot = fs.realpathSync(
  path.join(navigationElementsDependencyRoot, "color"),
);
const colorDependencyRoot = adjacentNodeModulesRoot(colorRoot);
const colorStringRoot = fs.realpathSync(
  path.join(colorDependencyRoot, "color-string"),
);
const colorStringDependencyRoot = adjacentNodeModulesRoot(colorStringRoot);
const colorConvertRoot = fs.realpathSync(
  path.join(colorDependencyRoot, "color-convert"),
);
const colorConvertDependencyRoot = adjacentNodeModulesRoot(colorConvertRoot);
const simpleSwizzleRoot = fs.realpathSync(
  path.join(colorStringDependencyRoot, "simple-swizzle"),
);
const simpleSwizzleDependencyRoot = adjacentNodeModulesRoot(simpleSwizzleRoot);
const radixSlotRoot = fs.realpathSync(
  path.join(routerDependencyRoot, "@radix-ui/react-slot"),
);
const navigationNativeRoot = fs.realpathSync(
  path.join(routerDependencyRoot, "@react-navigation/native"),
);
const navigationNativeDependencyRoot = adjacentNodeModulesRoot(navigationNativeRoot);
const navigationCoreRoot = fs.realpathSync(
  path.join(navigationNativeDependencyRoot, "@react-navigation/core"),
);
const reactQueryRoot = fs.realpathSync(path.join(appNodeModulesPath, "@tanstack/react-query"));
const reactQueryDependencyRoot = adjacentNodeModulesRoot(reactQueryRoot);
const queryCoreRoot = fs.realpathSync(
  path.join(reactQueryDependencyRoot, "@tanstack/query-core"),
);
const runtimeRoot = fs.realpathSync(path.join(__dirname, "node_modules/@expo/metro-runtime"));
const runtimeDependencyRoot = adjacentNodeModulesRoot(runtimeRoot);

// Keep the shared API client source and this app's resolved dependencies in
// Metro's file map. The web runtime also needs its adjacent PNPM dependency
// links, without crawling the workspace-wide dependency store.
const dependencyRoots = [
  expoDependencyRoot,
  whatwgUrlDependencyRoot,
  adjacentNodeModulesRoot(bufferRoot),
  reactNativeDependencyRoot,
  adjacentNodeModulesRoot(virtualizedListsRoot),
  adjacentNodeModulesRoot(abortControllerRoot),
  gestureHandlerDependencyRoot,
  adjacentNodeModulesRoot(hoistNonReactStaticsRoot),
  reanimatedDependencyRoot,
  routerDependencyRoot,
  adjacentNodeModulesRoot(queryStringRoot),
  bottomTabsDependencyRoot,
  nativeStackDependencyRoot,
  reactNativeScreensDependencyRoot,
  navigationElementsDependencyRoot,
  colorDependencyRoot,
  colorStringDependencyRoot,
  colorConvertDependencyRoot,
  simpleSwizzleDependencyRoot,
  adjacentNodeModulesRoot(radixSlotRoot),
  navigationNativeDependencyRoot,
  adjacentNodeModulesRoot(navigationCoreRoot),
  reactQueryDependencyRoot,
  adjacentNodeModulesRoot(queryCoreRoot),
  runtimeDependencyRoot,
];
config.watchFolders = [
  ...collectMetroDependencyFolders(appNodeModulesPath, dependencyRoots),
  ...dependencyRoots,
  path.join(workspaceRoot, "lib/api-client-react"),
].filter((folder, index, folders) => folders.indexOf(folder) === index);

module.exports = config;
