import Foundation

/// What the watch keeps after a class is saved. X5 turns it into the WatchResult payload for the phone.
struct ClassRecord: Codable, Equatable {
  struct Part: Codable, Equatable {
    var blockId: String
    var start: Date?
    var end: Date?
    var activeSeconds: Double
    var rounds: Int
    var buyInDoneAt: Date?
    var skipped: Bool
    var heartRate: HeartRateSummary?
    var score: PartScore?
  }

  var clientSessionId: UUID
  var planKey: String
  var startedAt: Date
  var finishedAt: Date
  var parts: [Part]
  var segments: [Segment]
  var heartRate: HeartRateSummary?
  var healthWorkoutUUID: UUID?
  var status: String?
  var plan: WatchPlan?
  var activeIntervals: [ActiveInterval]?
  struct ActiveInterval: Codable, Equatable { var startedAt: Date; var endedAt: Date }
  private static func iso(_ date: Date) -> String { ISO8601DateFormatter().string(from: date) }
  /// JSON dates and keys match the phone's versioned intake contract.
  func payload() throws -> String {
    let encoder = JSONEncoder()
    encoder.keyEncodingStrategy = .convertToSnakeCase
    encoder.dateEncodingStrategy = .iso8601
    var object = try JSONSerialization.jsonObject(with: encoder.encode(self)) as! [String: Any]
    object["source"] = (object["plan"] as? [String: Any])?["source"]
    object["activity_type"] = plan?.activityType ?? 11
    object["status"] = status ?? (parts.contains { $0.skipped || $0.end == nil } ? "partial" : "completed")
    var actuals: [WatchPlan.Part.Actual] = []
    var results: [[String: Any]] = []
    var splits: [[String: Any]] = []
    for (index, part) in (plan?.parts ?? []).enumerated() {
      guard let run = parts.first(where: { $0.blockId == part.blockId }), !run.skipped, let start = run.start, let end = run.end else { continue }
      let templates = part.actuals ?? []
      if part.kind == .amrap || part.kind == .forTime {
        for round in 1...max(1, min(100, run.rounds)) where round <= run.rounds {
          actuals += templates.filter { a in part.moves.first(where: { $0.index == a.exerciseIndex })?.segment == nil }.map { a in
            var next = a; next.roundIndex = round
            if let scheme = a.repScheme, scheme.indices.contains(round - 1) { next.reps = scheme[round - 1] }
            if let start = a.ladderStart, let step = a.ladderStep { next.reps = max(0, start + step * (round - 1)) }
            return next
          }
        }
        if run.buyInDoneAt != nil {
          actuals += templates.filter { a in part.moves.first(where: { $0.index == a.exerciseIndex })?.segment == "buy_in" }
        }
      } else if part.kind == .sets {
        var cells: [String] = []
        for a in templates {
          let key = "\(a.roundIndex):\(a.setIndex):\(a.exerciseIndex)"
          if !cells.contains(key) { cells.append(key) }
          if let position = cells.firstIndex(of: key), position < run.rounds { actuals.append(a) }
        }
      }
      if part.scored {
        var result: [String: Any] = ["block_id": part.blockId, "origin": "watch", "started_at": Self.iso(start), "ended_at": Self.iso(end),
          "scaling": run.score?.scaled == true ? "scaled" : "rx"]
        switch part.kind {
        case .amrap:
          result["kind"] = "rounds_reps"; result["rounds"] = run.score?.rounds ?? run.rounds; result["reps"] = run.score?.reps ?? 0
          if part.hasBuyIn { result["buy_in_done"] = run.buyInDoneAt != nil }
        case .forTime:
          result["kind"] = "time"; result["time_seconds"] = run.score?.seconds ?? Int(run.activeSeconds)
          result["capped"] = part.timeLimit.map { run.activeSeconds >= $0 } ?? false
        default: result["kind"] = "completed"
        }
        results.append(result)
      }
      var counts: [String: Int] = [:]
      for segment in segments where segment.part == index {
        let kind = segment.kind == .set ? "station" : segment.kind.rawValue
        counts[kind, default: 0] += 1
        splits.append(["block_id": part.blockId, "kind": kind, "index": counts[kind]!,
          "started_at": Self.iso(segment.start), "ended_at": Self.iso(segment.end)])
      }
    }
    object["actuals"] = try JSONSerialization.jsonObject(with: encoder.encode(actuals.map { a in
      var clean = a; if parts.first(where: { $0.blockId == a.blockId })?.score?.scaled == true { clean.load = nil; clean.loadUnit = nil; clean.loadConvention = nil }; clean.repScheme = nil; clean.ladderStart = nil; clean.ladderStep = nil; clean.ladderEnd = nil; return clean
    }))
    object["results"] = results; object["segments"] = splits
    object["v"] = 1; object["recorded_on"] = "watch"
    object["watch_build"] = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "unknown"
    object["client_session_id"] = clientSessionId.uuidString.lowercased()
    return String(decoding: try JSONSerialization.data(withJSONObject: object), as: UTF8.self)
  }
}

/// Saved classes waiting for the phone, one file each. A class is written here before its checkpoint
/// is cleared, so scores survive a relaunch. X5 sends them and deletes each file after the phone's ack.
struct ClassOutbox {
  let directory: URL

  static func standard() -> ClassOutbox {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return ClassOutbox(directory: base.appendingPathComponent("hafa-watch/outbox"))
  }

  func add(_ record: ClassRecord) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var options: Data.WritingOptions = [.atomic]
    #if os(watchOS)
    options.insert(.completeFileProtectionUntilFirstUserAuthentication)
    #endif
    let url = directory.appendingPathComponent("\(record.clientSessionId.uuidString.lowercased()).json")
    try JSONEncoder().encode(record).write(to: url, options: options)
  }

  func acknowledge(_ id: String) throws {
    guard let uuid = UUID(uuidString: id) else { return }
    let file = directory.appendingPathComponent(uuid.uuidString.lowercased() + ".json")
    if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
  }

  func records() -> [ClassRecord] {
    let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
    return files.compactMap { try? JSONDecoder().decode(ClassRecord.self, from: Data(contentsOf: $0)) }
      .sorted { $0.finishedAt < $1.finishedAt }
  }
}
