import Foundation

/// One class from the phone's WatchPlan v1 payload (design §5.5). The phone sends it in X5.
struct WatchPlan: Codable, Equatable {
  var planKey: String
  var title: String
  /// HKWorkoutActivityType raw value: 11 cross training, 20 functional strength, 63 HIIT.
  var activityType: UInt
  var parts: [Part]
  var date: String?
  var source: Source?
  var accountKey: String?
  var leadInSeconds: Int?
  var runsOutside: Bool?
  struct Source: Codable, Equatable {
    var workoutId: String?
    var workoutRevision: Int?
    var programId: String?
    var programRevision: Int?
    var programSessionId: String?
  }

  struct Part: Codable, Equatable {
    enum Kind: String, Codable { case amrap, forTime = "for_time", emom, workRest = "work_rest", sets }

    var blockId: String
    var label: String
    var kind: Kind
    var capSeconds: Int?
    var intervalSeconds: Int?
    var intervals: Int?
    var workSeconds: Int?
    var restSeconds: Int?
    var rounds: Int?
    var restAfterSeconds: Int?
    var scored: Bool
    var moves: [Move]
    var actuals: [Actual]?
    struct Actual: Codable, Equatable {
      var blockId: String
      var exerciseIndex: Int
      var roundIndex: Int
      var setIndex: Int
      var side: String?
      var completed: Bool
      var reps: Int?
      var repScheme: [Int]?
      var ladderStart: Int?
      var ladderStep: Int?
      var ladderEnd: Int?
      var durationSeconds: Double?
      var distanceMeters: Double?
      var load: Double?
      var loadUnit: String?
      var loadConvention: String?
    }

    /// How long the clock runs before the part ends by itself; nil for open for-time and sets.
    var timeLimit: TimeInterval? {
      switch kind {
      case .amrap, .forTime: return capSeconds.map(TimeInterval.init)
      case .emom:
        guard let interval = intervalSeconds, let count = intervals else { return nil }
        return TimeInterval(interval * count)
      case .workRest:
        guard let work = workSeconds, let count = rounds, count > 0 else { return nil }
        return TimeInterval(work * count + (restSeconds ?? 0) * (count - 1))
      case .sets: return nil
      }
    }

    var restAfter: TimeInterval { TimeInterval(restAfterSeconds ?? 0) }
    var hasBuyIn: Bool { moves.contains { $0.segment == "buy_in" } }
  }

  struct Move: Codable, Equatable {
    var index: Int
    var text: String
    var segment: String?
    var isRun: Bool
    var distanceM: Double?
  }

  /// The phone sends snake_case keys.
  static func decode(_ data: Data) throws -> WatchPlan {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try decoder.decode(WatchPlan.self, from: data)
  }
}
