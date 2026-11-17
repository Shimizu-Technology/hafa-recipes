#!/usr/bin/env bash
set -euo pipefail
# Compiles the widget's list layout with the shared snapshot models and runs
# the fixtures on the Mac. No simulator or WidgetKit is needed.
mobile_root="$(cd "$(dirname "$0")/../.." && pwd)"
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/hafa-widget-layout.XXXXXX")"
trap 'rm -rf "$build_dir"' EXIT
xcrun swiftc -D HAFA_WIDGET_TESTS \
  "$mobile_root/modules/hafa-widget-bridge/ios/HafaWidgetShared.swift" \
  "$mobile_root/widget/ios/HafaWidgetSections.swift" \
  "$mobile_root/widget/ios/HafaWidgetListLayout.swift" \
  "$mobile_root/widget/tests/layout/main.swift" \
  -o "$build_dir/test"
"$build_dir/test"
