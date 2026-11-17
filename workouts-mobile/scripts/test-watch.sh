#!/usr/bin/env bash
# XCTest for the watch app's HealthKit-free core (targets/watch/Core). Needs Xcode, so it runs on macOS only.
# Build products go to a temp folder so Metro and TypeScript never crawl them.
set -euo pipefail
cd "$(dirname "$0")/../watch-tests"
swift test --scratch-path "${TMPDIR:-/tmp}/hafa-watch-core-build" "$@"
