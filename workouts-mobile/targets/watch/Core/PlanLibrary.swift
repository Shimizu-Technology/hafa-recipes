import Foundation

/// X5 writes its last-received context here. No networking or sample data in Release.
struct PlanLibrary {
  struct Context: Codable {
    var v: Int
    var plans: [WatchPlan]
    var accountKey: String?
    var leadInSeconds: Int?
  }
  static var contextURL: URL {
    FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("hafa-watch/context.json")
  }
  static func receive(_ data: Data, at url: URL = contextURL) throws {
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    let context = try decoder.decode(Context.self, from: data)
    guard context.v == 1, data.count < 16 * 1024 else { throw CocoaError(.fileReadCorruptFile) }
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: url, options: .atomic)
  }
  static var context: Context? {
    guard let data = try? Data(contentsOf: contextURL) else { return nil }
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try? decoder.decode(Context.self, from: data)
  }
  static func ageLabel(_ plan: WatchPlan, at date: Date = Date()) -> String? {
    guard let day = plan.date else { return nil }
    let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
    guard day < f.string(from: date), let from = f.date(from: day) else { return nil }
    f.dateFormat = "EEE"; return "From " + f.string(from: from)
  }
  static func todaysPlan(in plans: [WatchPlan] = plans, at date: Date = Date()) -> WatchPlan? {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    let today = formatter.string(from: date)
    return plans.first { $0.date == today }
  }
  static var plans: [WatchPlan] {
    if let context { return context.plans }
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    let url = base.appendingPathComponent("hafa-watch/plans.json")
    guard let data = try? Data(contentsOf: url) else { return [] }
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return (try? decoder.decode([WatchPlan].self, from: data)) ?? []
  }

  static var openTimer: WatchPlan { var plan = WatchPlan(
    planKey: "open-timer", title: "Open timer", activityType: 11,
    parts: [.init(blockId: "timer", label: "Open timer", kind: .amrap, scored: false, moves: [])])
    plan.accountKey = context?.accountKey
    plan.leadInSeconds = context?.leadInSeconds
    return plan
  }
}
