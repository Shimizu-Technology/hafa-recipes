#!/usr/bin/env bash

# Netlify treats exit 0 as "skip this build" and exit 1 as "build it".
# Fail open so missing or invalid build metadata never suppresses a deployment.
set -u

# Only production is eligible for skipping. Unknown contexts build too.
if [[ "${CONTEXT:-}" != "production" ]]; then
  echo "Non-production context; running the build."
  exit 1
fi

if [[ -z "${CACHED_COMMIT_REF:-}" || -z "${COMMIT_REF:-}" ]]; then
  echo "Netlify commit metadata is unavailable; running the build."
  exit 1
fi

if [[ "$CACHED_COMMIT_REF" == "$COMMIT_REF" ]]; then
  echo "This commit was explicitly requested again; running the build."
  exit 1
fi

repository_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "Unable to locate the Git repository; running the build."
  exit 1
}

if ! git -C "$repository_root" cat-file -e "${CACHED_COMMIT_REF}^{commit}" 2>/dev/null ||
  ! git -C "$repository_root" cat-file -e "${COMMIT_REF}^{commit}" 2>/dev/null; then
  echo "A Netlify commit reference is unavailable; running the build."
  exit 1
fi

git -C "$repository_root" diff --quiet \
  "$CACHED_COMMIT_REF" \
  "$COMMIT_REF" \
  -- \
  web \
  netlify.toml \
  .nvmrc \
  .node-version \
  .npmrc \
  .yarnrc.yml \
  package.json \
  package-lock.json \
  yarn.lock \
  pnpm-lock.yaml \
  pnpm-workspace.yaml \
  bun.lock \
  bun.lockb \
  packages \
  shared \
  scripts \
  netlify

diff_status=$?

if [[ "$diff_status" -eq 0 ]]; then
  echo "No frontend or Netlify configuration changes detected; skipping the build."
  exit 0
fi

if [[ "$diff_status" -eq 1 ]]; then
  echo "Frontend or Netlify configuration changed; running the build."
  exit 1
fi

echo "Unable to compare Netlify commits; running the build."
exit 1
