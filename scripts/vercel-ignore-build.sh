#!/usr/bin/env bash

# Vercel runs this command from the configured project root. Resolve the
# repository root first so the same command works whether the project is still
# using artifacts/api-server as its root or has been corrected to the
# monorepo root.
set -u

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  echo "[vercel-ignore-build] Could not locate the repository; building."
  exit 1
fi
cd "$repo_root" || exit 1

# A deployment must run when the published frontend changes, when the API
# changes, or when any workspace package/build input used by either changes.
# Keep this list explicit so unrelated mobile artifacts and documentation do
# not consume a Vercel build.
deployment_paths=(
  "artifacts/visitecrm"
  "artifacts/api-server"
  "lib"
  "attached_assets"
  "api"
  "scripts"
  "patches"
  "package.json"
  "pnpm-lock.yaml"
  "pnpm-workspace.yaml"
  "tsconfig.json"
  "tsconfig.*"
  "vercel.json"
)

# Vercel supplies these SHAs for Git deployments. A missing or unavailable
# previous SHA happens on the first deployment and must fail open so the site
# is built rather than silently skipped.
previous_sha="${VERCEL_GIT_PREVIOUS_SHA:-}"
current_sha="${VERCEL_GIT_COMMIT_SHA:-HEAD}"
if [[ -z "$previous_sha" ]] || ! git rev-parse --verify "${previous_sha}^{commit}" >/dev/null 2>&1; then
  echo "[vercel-ignore-build] No comparable previous commit; building."
  exit 1
fi
if ! git rev-parse --verify "${current_sha}^{commit}" >/dev/null 2>&1; then
  echo "[vercel-ignore-build] Current commit is unavailable; building."
  exit 1
fi

if git diff --quiet "$previous_sha" "$current_sha" -- "${deployment_paths[@]}"; then
  echo "[vercel-ignore-build] No published-app changes; skipping build."
  exit 0
fi

echo "[vercel-ignore-build] Published app or dependency changed; building."
exit 1