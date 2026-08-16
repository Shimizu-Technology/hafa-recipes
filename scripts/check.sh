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
  npm test
  npm run typecheck
  npm run doctor
)

(
  cd "$repository_root/web"
  npm audit --omit=dev --audit-level=high
  npm run lint
  npm run build
)
