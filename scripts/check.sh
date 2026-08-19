#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"

(
  cd "$repository_root/api"
  uv run ruff check app migrations tests
  uv run pytest
)

(
  cd "$repository_root/mobile"
  npx -y -p node@22.22.2 -c '
    node -e '\''const appVersion=require("./app.json").expo.version; const packageVersion=require("./package.json").version; if (appVersion !== packageVersion) { throw new Error(`Mobile version mismatch: app.json=${appVersion}, package.json=${packageVersion}`) }'\'' &&
    npm test &&
    npm run typecheck &&
    npm run doctor &&
    npm run audit:runtime
  '
)

(
  cd "$repository_root/web"
  npx -y -p node@22.22.2 -c '
    npm audit --omit=dev --audit-level=high &&
    npm run lint &&
    npm run build
  '
)

(
  cd "$repository_root/admin"
  npx -y -p node@22.22.2 -c '
    npm audit --omit=dev --audit-level=high &&
    npm run typecheck &&
    npm run lint &&
    npm test &&
    VITE_CLERK_PUBLISHABLE_KEY=pk_test_ci_placeholder \
      VITE_API_BASE_URL=https://recipe-api-x5na.onrender.com \
      npm run build
  '
)
