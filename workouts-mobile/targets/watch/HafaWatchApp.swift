import SwiftUI
import WatchKit

@main
struct HafaWatchApp: App {
  @WKApplicationDelegateAdaptor private var delegate: AppDelegate
  @StateObject private var health = HealthAuthorization()

  var body: some Scene {
    WindowGroup {
      WatchRootView()
        .environmentObject(health)
        .environmentObject(delegate.engine)
        .task {
          await health.refresh()
          // A class that outlived a crash comes back before anything else starts.
          await delegate.engine.recover()
        }
    }
  }
}

final class AppDelegate: NSObject, WKApplicationDelegate {
  let engine = WorkoutEngine(recorder: HealthKitRecorder(), store: .standard(), outbox: .standard())

  /// watchOS can relaunch the app in the background after a crash mid-workout, with no window yet.
  func handleActiveWorkoutRecovery() {
    Task { await engine.recover() }
  }
}
