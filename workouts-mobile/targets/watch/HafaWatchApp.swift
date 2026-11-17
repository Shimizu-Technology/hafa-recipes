import SwiftUI

@main
struct HafaWatchApp: App {
  @StateObject private var health = HealthAuthorization()
  @StateObject private var engine = WorkoutEngine(recorder: HealthKitRecorder(), store: .standard())

  var body: some Scene {
    WindowGroup {
      HomeView()
        .environmentObject(health)
        .environmentObject(engine)
        .task {
          await health.refresh()
          // A class that outlived a crash comes back before anything else starts.
          await engine.recover()
        }
    }
  }
}
