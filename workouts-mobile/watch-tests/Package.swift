// swift-tools-version:5.9
// XCTest for the watch app's HealthKit-free core (targets/watch/Core, linked in as Sources/HafaWatchCore).
// Run with scripts/test-watch.sh; HealthKit itself is checked on the simulator and Leon's watch.
import PackageDescription

let package = Package(
  name: "HafaWatchCore",
  platforms: [.macOS(.v13)],
  targets: [
    .target(name: "HafaWatchCore"),
    .testTarget(name: "HafaWatchCoreTests", dependencies: ["HafaWatchCore"]),
  ]
)
