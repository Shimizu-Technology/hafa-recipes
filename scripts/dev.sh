#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  kill "${api_pid:-}" "${mobile_pid:-}" "${web_pid:-}" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

(
  cd "$repository_root/api"
  exec uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
) &
api_pid=$!

(
  cd "$repository_root/mobile"
  exec npm run start -- --port 8081
) &
mobile_pid=$!

(
  cd "$repository_root/web"
  exec npm run dev -- --host 0.0.0.0 --port 5173
) &
web_pid=$!

echo "Håfa Recipes API: http://localhost:8000"
echo "Håfa Recipes web: http://localhost:5173"
echo "Håfa Recipes Expo: http://localhost:8081"

wait "$api_pid" "$mobile_pid" "$web_pid"
