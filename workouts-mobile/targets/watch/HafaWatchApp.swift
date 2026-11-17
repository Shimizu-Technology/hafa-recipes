import SwiftUI
import AppIntents
import WatchKit

@main
struct HafaWatchApp: App {
  @WKApplicationDelegateAdaptor private var delegate: AppDelegate
  @StateObject private var runtime = WatchRuntime.shared

  init() {
    PhoneLink.shared.activate()
    let shared = WatchRuntime.shared
    AppDependencyManager.shared.add(dependency: shared)
  }

  var body: some Scene {
    WindowGroup {
      WatchRootView()
        .environmentObject(runtime)
        .environmentObject(runtime.health)
        .environmentObject(delegate.engine)
        .task {
          PhoneLink.shared.flush()
          await runtime.recover()
          await runtime.health.refresh()
        }
    }
  }
}

final class AppDelegate: NSObject, WKApplicationDelegate {
  let engine = WatchRuntime.shared.engine

  /// watchOS can relaunch the app in the background after a crash mid-workout, with no window yet.
  func handleActiveWorkoutRecovery() {
    Task { await WatchRuntime.shared.recover() }
  }
}
