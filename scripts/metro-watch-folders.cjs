const fs = require("node:fs");
const path = require("node:path");

function listPackagePaths(nodeModulesPath) {
  let entries;
  try {
    entries = fs.readdirSync(nodeModulesPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const packages = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const entryPath = path.join(nodeModulesPath, entry.name);

    if (entry.name.startsWith("@") && entry.isDirectory()) {
      try {
        for (const scopedEntry of fs.readdirSync(entryPath, { withFileTypes: true })) {
          if (!scopedEntry.name.startsWith(".")) {
            packages.push(path.join(entryPath, scopedEntry.name));
          }
        }
      } catch {
        // An incomplete package installation should not stop Metro config loading.
      }
    } else if (entry.name !== ".bin") {
      packages.push(entryPath);
    }
  }

  return packages;
}

function collectMetroDependencyFolders(appNodeModulesPath, additionalNodeModulesPaths = []) {
  const packageRoots = new Set();
  for (const nodeModulesPath of new Set([appNodeModulesPath, ...additionalNodeModulesPaths])) {
    for (const packagePath of listPackagePaths(nodeModulesPath)) {
      try {
        packageRoots.add(fs.realpathSync(packagePath));
      } catch {
        // A broken or concurrently removed symlink should not block Metro config loading.
      }
    }
  }

  return [...packageRoots].sort();
}

module.exports = { collectMetroDependencyFolders };