---
name: Expo Metro version pins
description: pnpm overrides + patch required for the guide-app Expo artifact to start — metro-* version pinning plus a DependencyGraph null-guard patch.
---

## Rule
When adding a new Expo artifact to this workspace, apply these pnpm overrides AND the metro patch to fix Metro bundler crashes.

## Required overrides (in `pnpm.overrides`)
```json
"metro": "0.83.7",
"metro-babel-transformer": "0.83.7",
"metro-cache": "0.83.7",
"metro-cache-key": "0.83.7",
"metro-config": "0.83.7",
"metro-core": "0.83.7",
"metro-file-map": "0.83.3",
"metro-minify-terser": "0.83.7",
"metro-resolver": "0.83.7",
"metro-runtime": "0.83.7",
"metro-source-map": "0.83.7",
"metro-symbolicate": "0.83.7",
"metro-transform-plugins": "0.83.7",
"metro-transform-worker": "0.83.7"
```

## Required patch: `patches/metro@0.83.7.patch`
Already committed to the repo. Must remain in `pnpm.patchedDependencies`.

**What it fixes:** `metro@0.83.7`'s `DependencyGraph._onHasteChange` guards against `undefined` changes:
```js
if (changes != null) {
  [...changes.addedFiles, ...changes.modifiedFiles, ...changes.removedFiles]
    .forEach(...);
}
```

**Why both the override AND the patch are needed:**
- `metro-file-map@0.83.3` emits change events as `{ logger, eventsQueue }`.
- `metro-file-map@0.83.7` emits change events as `{ changes, rootDir }`.
- `@expo/cli@54.0.25` (`metroWatchTypeScriptFiles`, `waitForMetroToObserveTypeScriptFile`)
  destructures `{ eventsQueue }` from the change event → requires 0.83.3.
- `metro@0.83.7`'s `DependencyGraph._onHasteChange` destructures `{ changes, rootDir }`
  → crashes with "Cannot read properties of undefined (reading 'addedFiles')" when
  metro-file-map@0.83.3 fires a change event.
- The patch adds `if (changes != null)` to silence the crash when 0.83.3 fires.
  Package cache invalidation is skipped (minor perf), but `_resolutionCache` and
  `_createModuleResolver()` still run — correctness is preserved.
- metro-file-map@0.83.7 itself was originally pinned at 0.83.3 because 0.83.7 caused
  "@expo/cli: eventsQueue is not iterable" — that is still true; do not upgrade it.

**How to apply (fresh workspace):**
1. Edit root `package.json` → `pnpm.overrides`, add all lines above.
2. Ensure `patches/metro@0.83.7.patch` exists and is listed in `pnpm.patchedDependencies`.
3. Run `pnpm install`.
