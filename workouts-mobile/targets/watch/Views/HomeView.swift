import SwiftUI

/// First screen. Plans arrive from the iPhone in a later release, so this shows the brand,
/// an honest empty state and the one setup step the watch needs: Health access.
struct HomeView: View {
  @EnvironmentObject private var health: HealthAuthorization

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 10) {
        Text("HÅFA WORKOUTS")
          .font(.system(.footnote, weight: .semibold))
          .tracking(0.8)
          .foregroundStyle(Theme.accent)
        Text("Today's class")
          .font(Theme.display(30))
          .foregroundStyle(Theme.text)
        // Health comes first: it's the one setup step, and it must be visible without scrolling.
        HealthCard()
        Text("Classes you plan on your iPhone will show here.")
          .font(.footnote)
          .foregroundStyle(Theme.muted)
          .fixedSize(horizontal: false, vertical: true)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(Theme.background)
  }
}

private struct HealthCard: View {
  @EnvironmentObject private var health: HealthAuthorization

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      switch health.status {
      case .checking, .asking:
        ProgressView().frame(maxWidth: .infinity, minHeight: 60)
      case .unavailable:
        note("Health isn't available on this watch, so classes can't be recorded here.")
      case .answered:
        Label("Health is set up", systemImage: "heart.fill")
          .font(.system(.headline))
          .foregroundStyle(Theme.text)
          .symbolRenderingMode(.multicolor)
        note("Change access in the Health app on your iPhone.")
      case .notAsked, .failed:
        note(health.status == .failed
          ? "Couldn't ask for Health access. Try again."
          : "Allow Health so your watch can record heart rate and save each class.")
        Button {
          Task { await health.request() }
        } label: {
          Text("Allow Health")
            .font(.system(.headline))
            .frame(maxWidth: .infinity, minHeight: 60)
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.onAccent)
        .background(Theme.accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
      }
    }
    .padding(12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
  }

  private func note(_ text: String) -> some View {
    Text(text)
      .font(.footnote)
      .foregroundStyle(Theme.muted)
      .fixedSize(horizontal: false, vertical: true)
  }
}
