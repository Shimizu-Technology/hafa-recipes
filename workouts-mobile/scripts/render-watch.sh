#!/usr/bin/env bash
exec python3 "$(dirname "$0")/../watch-renders/render.py" "$@"
