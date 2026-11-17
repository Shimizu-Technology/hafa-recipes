import Foundation

/// X5 writes its last-received context here. No networking or sample data in Release.
struct PlanLibrary {
  static var plans: [WatchPlan] {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let url = base.appendingPathComponent("hafa-watch/plans.json")
    guard let data = try? Data(contentsOf: url) else { return [] }
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return (try? decoder.decode([WatchPlan].self, from: data)) ?? []
  }

  static let openTimer = WatchPlan(
    planKey: "open-timer", title: "Open timer", activityType: 11,
    parts: [.init(blockId: "timer", label: "Open timer", kind: .amrap, scored: true, moves: [])])
}
