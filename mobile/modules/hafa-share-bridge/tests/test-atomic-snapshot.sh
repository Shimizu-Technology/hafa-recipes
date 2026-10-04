#!/usr/bin/env bash
set -euo pipefail
mobile_root="$(cd "$(dirname "$0")/../../.." && pwd)"
fixture_dir="$(mktemp -d "${TMPDIR:-/tmp}/hafa-share-atomic.XXXXXX")"
trap 'rm -rf "$fixture_dir"' EXIT
python3 - "$mobile_root" "$fixture_dir" <<'PY'
from pathlib import Path
import sys
mobile, output = map(Path, sys.argv[1:])
native = (mobile / 'node_modules/expo-share-intent/ios/ExpoShareIntentModule.swift').read_text()
helper = native.split('// HAFA_ATOMIC_CAPTURE_SNAPSHOT_BEGIN\n', 1)[1].split('// HAFA_ATOMIC_CAPTURE_SNAPSHOT_END', 1)[0]
(output / 'HafaAtomicCaptureSnapshot.swift').write_text('import Foundation\n' + helper)
PY
xcrun swiftc "$mobile_root/modules/hafa-share-bridge/ios/HafaShareShared.swift" "$fixture_dir/HafaAtomicCaptureSnapshot.swift" "$mobile_root/modules/hafa-share-bridge/tests/atomic-snapshot/main.swift" -o "$fixture_dir/test"
"$fixture_dir/test"
