#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required for the isolated local PostgreSQL database." >&2
  exit 1
fi

if [[ ! -f "$repository_root/api/.env" ]]; then
  cp "$repository_root/api/.env.example" "$repository_root/api/.env"
  echo "Created api/.env with local-only defaults."
fi

if [[ ! -f "$repository_root/mobile/.env.local" ]]; then
  cp "$repository_root/mobile/.env.example" "$repository_root/mobile/.env.local"
  echo "Created mobile/.env.local. Add your Clerk development publishable key."
fi

docker compose -f "$repository_root/docker-compose.dev.yml" up -d --wait

(
  cd "$repository_root/api"
  uv sync --dev
  uv run python -m scripts.seed_development
)

(
  cd "$repository_root/mobile"
  npm ci
)

(
  cd "$repository_root/web"
  npm ci
)

echo "Local environment is ready. Run ./scripts/dev.sh to start all three apps."
