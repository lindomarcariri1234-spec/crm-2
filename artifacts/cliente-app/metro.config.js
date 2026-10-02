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

// Avoid crawling every workspace dependency in the monorepo. Metro has exposed
// dependencies from these package-local PNPM links during the static bundle;
// watch only their adjacent link roots in addition to this app's dependencies.
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

const appNodeModulesPath = path.join(__dirname, "node_modules");
const expoRoot = fs.realpathSync(path.join(appNodeModulesPath, "expo"));
const expoDependencyRoot = adjacentNodeModulesRoot(expoRoot);
const routerRoot = fs.realpathSync(path.join(appNodeModulesPath, "expo-router"));
const runtimeRoot = fs.realpathSync(path.join(appNodeModulesPath, "@expo/metro-runtime"));
const reactNativeRoot = fs.realpathSync(path.join(appNodeModulesPath, "react-native"));

const routerDependencyRoot = adjacentNodeModulesRoot(routerRoot);
const reactNativeDependencyRoot = adjacentNodeModulesRoot(reactNativeRoot);
const navigationNativeRoot = fs.realpathSync(
  path.join(routerDependencyRoot, "@react-navigation/native"),
);
const navigationNativeDependencyRoot = adjacentNodeModulesRoot(navigationNativeRoot);
const bottomTabsRoot = fs.realpathSync(
  path.join(routerDependencyRoot, "@react-navigation/bottom-tabs"),
);
const bottomTabsDependencyRoot = adjacentNodeModulesRoot(bottomTabsRoot);
const reactNativeScreensRoot = fs.realpathSync(
  path.join(bottomTabsDependencyRoot, "react-native-screens"),
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
const nativeStackRoot = fs.realpathSync(
  path.join(routerDependencyRoot, "@react-navigation/native-stack"),
);
const nativeStackDependencyRoot = adjacentNodeModulesRoot(nativeStackRoot);
const navigationCoreRoot = fs.realpathSync(
  path.join(navigationNativeDependencyRoot, "@react-navigation/core"),
);
const virtualizedListsRoot = fs.realpathSync(
  path.join(reactNativeDependencyRoot, "@react-native/virtualized-lists"),
);
const abortControllerRoot = fs.realpathSync(path.join(reactNativeDependencyRoot, "abort-controller"));
const clerkExpoRoot = fs.realpathSync(path.join(appNodeModulesPath, "@clerk/expo"));
const clerkExpoDependencyRoot = adjacentNodeModulesRoot(clerkExpoRoot);
const authSessionRoot = fs.realpathSync(
  path.join(clerkExpoDependencyRoot, "expo-auth-session"),
);
const authSessionDependencyRoot = adjacentNodeModulesRoot(authSessionRoot);
const expoCryptoRoot = fs.realpathSync(
  path.join(authSessionDependencyRoot, "expo-crypto"),
);
const clerkReactRoot = fs.realpathSync(path.join(clerkExpoDependencyRoot, "@clerk/react"));
const clerkReactDependencyRoot = adjacentNodeModulesRoot(clerkReactRoot);
const reactDomRoot = fs.realpathSync(path.join(clerkReactDependencyRoot, "react-dom"));
const reactDomDependencyRoot = adjacentNodeModulesRoot(reactDomRoot);
const clerkSharedRoot = fs.realpathSync(path.join(clerkReactDependencyRoot, "@clerk/shared"));
const clerkSharedDependencyRoot = adjacentNodeModulesRoot(clerkSharedRoot);
const clerkQueryCoreRoot = fs.realpathSync(
  path.join(clerkSharedDependencyRoot, "@tanstack/query-core"),
);
const reactQueryRoot = fs.realpathSync(path.join(appNodeModulesPath, "@tanstack/react-query"));
const reactQueryDependencyRoot = adjacentNodeModulesRoot(reactQueryRoot);
const queryCoreRoot = fs.realpathSync(path.join(reactQueryDependencyRoot, "@tanstack/query-core"));
const notificationsRoot = fs.realpathSync(path.join(appNodeModulesPath, "expo-notifications"));
const notificationsDependencyRoot = adjacentNodeModulesRoot(notificationsRoot);
const ideBackoffRoot = fs.realpathSync(path.join(notificationsDependencyRoot, "@ide/backoff"));
const ideBackoffSourcePath = path.join(ideBackoffRoot, "build/backoff.js");
const applicationRoot = fs.realpathSync(
  path.join(notificationsDependencyRoot, "expo-application"),
);
const queryStringRoot = fs.realpathSync(path.join(routerDependencyRoot, "query-string"));
const whatwgUrlRoot = fs.realpathSync(
  path.join(expoDependencyRoot, "whatwg-url-without-unicode"),
);
const bufferRoot = fs.realpathSync(
  path.join(adjacentNodeModulesRoot(whatwgUrlRoot), "buffer"),
);
const reactNativeSvgRoot = fs.realpathSync(
  path.join(appNodeModulesPath, "react-native-svg"),
);
const reactNativeSvgDependencyRoot = adjacentNodeModulesRoot(reactNativeSvgRoot);
const cssTreeRoot = fs.realpathSync(
  path.join(reactNativeSvgDependencyRoot, "css-tree"),
);
const cssSelectRoot = fs.realpathSync(
  path.join(reactNativeSvgDependencyRoot, "css-select"),
);
const cssSelectDependencyRoot = adjacentNodeModulesRoot(cssSelectRoot);
const nthCheckRoot = fs.realpathSync(
  path.join(cssSelectDependencyRoot, "nth-check"),
);
const nthCheckDependencyRoot = adjacentNodeModulesRoot(nthCheckRoot);
const domutilsRoot = fs.realpathSync(
  path.join(cssSelectDependencyRoot, "domutils"),
);
const domutilsDependencyRoot = adjacentNodeModulesRoot(domutilsRoot);
const domhandlerRoot = fs.realpathSync(
  path.join(domutilsDependencyRoot, "domhandler"),
);
const domhandlerDependencyRoot = adjacentNodeModulesRoot(domhandlerRoot);
const domSerializerRoot = fs.realpathSync(
  path.join(domutilsDependencyRoot, "dom-serializer"),
);
const domSerializerDependencyRoot = adjacentNodeModulesRoot(domSerializerRoot);
const reactNativeSvgFetchDataPath = path.join(
  reactNativeSvgRoot,
  "src/utils/fetchData.ts",
);
const bufferEntryPath = path.join(bufferRoot, "index.js");
const gestureHandlerRoot = fs.realpathSync(
  path.join(appNodeModulesPath, "react-native-gesture-handler"),
);
const gestureHandlerDependencyRoot = adjacentNodeModulesRoot(gestureHandlerRoot);
const reanimatedRoot = fs.realpathSync(
  path.join(appNodeModulesPath, "react-native-reanimated"),
);
const reanimatedDependencyRoot = adjacentNodeModulesRoot(reanimatedRoot);
const hoistNonReactStaticsRoot = fs.realpathSync(
  path.join(gestureHandlerDependencyRoot, "hoist-non-react-statics"),
);
const radixSlotRoot = fs.realpathSync(path.join(routerDependencyRoot, "@radix-ui/react-slot"));
const radixSlotDependencyRoot = adjacentNodeModulesRoot(radixSlotRoot);
const qrSvgRoot = fs.realpathSync(path.join(appNodeModulesPath, "react-native-qrcode-svg"));
const qrSvgDependencyRoot = adjacentNodeModulesRoot(qrSvgRoot);
const qrcodeRoot = fs.realpathSync(path.join(qrSvgDependencyRoot, "qrcode"));
const dependencyRoots = [
  expoDependencyRoot,
  routerDependencyRoot,
  adjacentNodeModulesRoot(runtimeRoot),
  reactNativeDependencyRoot,
  navigationNativeDependencyRoot,
  bottomTabsDependencyRoot,
  reactNativeScreensDependencyRoot,
  nativeStackDependencyRoot,
  navigationElementsDependencyRoot,
  colorDependencyRoot,
  colorStringDependencyRoot,
  colorConvertDependencyRoot,
  simpleSwizzleDependencyRoot,
  adjacentNodeModulesRoot(navigationCoreRoot),
  adjacentNodeModulesRoot(virtualizedListsRoot),
  adjacentNodeModulesRoot(abortControllerRoot),
  clerkExpoDependencyRoot,
  authSessionDependencyRoot,
  adjacentNodeModulesRoot(expoCryptoRoot),
  clerkReactDependencyRoot,
  reactDomDependencyRoot,
  clerkSharedDependencyRoot,
  adjacentNodeModulesRoot(clerkQueryCoreRoot),
  reactQueryDependencyRoot,
  adjacentNodeModulesRoot(queryCoreRoot),
  notificationsDependencyRoot,
  adjacentNodeModulesRoot(applicationRoot),
  adjacentNodeModulesRoot(queryStringRoot),
  gestureHandlerDependencyRoot,
  reanimatedDependencyRoot,
  adjacentNodeModulesRoot(hoistNonReactStaticsRoot),
  radixSlotDependencyRoot,
  qrSvgDependencyRoot,
  adjacentNodeModulesRoot(qrcodeRoot),
  adjacentNodeModulesRoot(whatwgUrlRoot),
  adjacentNodeModulesRoot(bufferRoot),
  reactNativeSvgDependencyRoot,
  adjacentNodeModulesRoot(cssTreeRoot),
  cssSelectDependencyRoot,
  nthCheckDependencyRoot,
  domutilsDependencyRoot,
  domhandlerDependencyRoot,
  domSerializerDependencyRoot,
].filter((folder, index, folders) => folders.indexOf(folder) === index);

config.watchFolders = [
  ...collectMetroDependencyFolders(appNodeModulesPath, dependencyRoots),
  ...dependencyRoots,
].filter((folder, index, folders) => folders.indexOf(folder) === index);

// @ide/backoff uses Node's assert only for argument validation. Keep this
// React Native-compatible shim scoped to that one importer.
const backoffAssertPolyfillPath = path.join(__dirname, "polyfills/ide-backoff-assert.js");
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const originModulePath = path.resolve(context.originModulePath);
  if (moduleName === "assert" && originModulePath === ideBackoffSourcePath) {
    return { type: "sourceFile", filePath: backoffAssertPolyfillPath };
  }
  if (moduleName === "buffer" && originModulePath === reactNativeSvgFetchDataPath) {
    return { type: "sourceFile", filePath: bufferEntryPath };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
