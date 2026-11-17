#!/usr/bin/env bash
set -euo pipefail
# Device must already be booted/owned by the caller. This is a project test
# runner, not a simulator lifecycle or UI automation wrapper.
: "${1:?usage: test-capture-controller.sh <booted simulator UDID>}"
mobile_root="$(cd "$(dirname "$0")/../../.." && pwd)"
fixture_dir="$(mktemp -d "${TMPDIR:-/tmp}/hafa-share-controller.XXXXXX")"
trap 'rm -rf "$fixture_dir"' EXIT
python3 - "$mobile_root" "$fixture_dir" <<'PY'
from pathlib import Path
import sys
mobile, output = map(Path, sys.argv[1:])
source = (mobile / 'ios/ShareExtension/ShareViewController.swift').read_text()
access = (mobile / 'modules/hafa-share-bridge/tests/controller/access.swift').read_text()
(output / 'Controller.swift').write_text(source + '\n' + access)
native = (mobile / 'node_modules/expo-share-intent/ios/ExpoShareIntentModule.swift').read_text()
helper = native.split('// HAFA_ATOMIC_CAPTURE_SNAPSHOT_BEGIN\n', 1)[1].split('// HAFA_ATOMIC_CAPTURE_SNAPSHOT_END', 1)[0]
(output / 'Snapshot.swift').write_text('import Foundation\n' + helper)
PY
sim_sdk="$(xcrun --sdk iphonesimulator --show-sdk-path)"
SDKROOT="$sim_sdk" xcrun swiftc -D HAFA_SHARE_TESTS -sdk "$sim_sdk" -target arm64-apple-ios17.0-simulator "$fixture_dir/Controller.swift" "$fixture_dir/Snapshot.swift" "$mobile_root/modules/hafa-share-bridge/tests/controller/main.swift" -o "$fixture_dir/controller-tests"
xcrun simctl spawn "$1" "$fixture_dir/controller-tests"
