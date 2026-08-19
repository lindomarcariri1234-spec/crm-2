---
name: Expo pnpm workspace @types/react conflict
description: Root pnpm.overrides for @types/react trumps Expo apps own specs causing version-mismatch warnings at startup
---

## Rule
The root `package.json` `pnpm.overrides` for `@types/react` and `@types/react-dom`
must be pinned to the version Expo SDK expects, not a higher version used by visitecrm.
Higher versions cause "should be updated for best compatibility" warnings at every Expo startup.

## Why
pnpm workspace overrides are global and always win over per-package devDependencies.
Even if `artifacts/cliente-app/package.json` specifies `"@types/react": "~19.1.10"`,
if the root override is `19.2.14`, all packages get 19.2.14.

## How to apply
When upgrading Expo SDK: check the Expo docs for the expected @types/react version
and update the root pnpm.overrides to match. The visitecrm typecheck is not sensitive
to minor @types/react version changes (19.1.x → 19.2.x and back).

When upgrading expo-auth-session: match the semver used by the target Expo SDK version
(SDK 54 → expo-auth-session ~7.0.11, not ^56.x.x which was for a different release stream).
