import SwiftUI

@main
struct HafaWatchApp: App {
  @StateObject private var health = HealthAuthorization()

  var body: some Scene {
    WindowGroup {
      HomeView()
        .environmentObject(health)
        .task { await health.refresh() }
    }
  }
}
