import Foundation

struct HeartRateSummary: Codable, Equatable {
  var average: Double?
  var max: Double?
}

struct RecordedSummary: Equatable {
  var workoutUUID: UUID?
  var heartRate: HeartRateSummary?
  /// One entry per part that ran, in order.
  var parts: [HeartRateSummary?]

  static let none = RecordedSummary(workoutUUID: nil, heartRate: nil, parts: [])
}

/// The Health side of a class. HealthKitRecorder implements it on the watch; tests use a fake.
@MainActor
protocol WorkoutRecorder: AnyObject {
  func begin(activityType: UInt, at date: Date) async throws
  /// Reattaches to a session that outlived a crash. False when there was none.
  /// `inPart` says whether the checkpoint was inside a part, so its activity is still open.
  func recover(inPart: Bool) async throws -> Bool
  func beginPart(_ part: WatchPlan.Part, at date: Date)
  func endPart(at date: Date)
  func pause()
  func resume()
  func finish(at date: Date, segments: [Segment], syncIdentifier: String) async throws -> RecordedSummary
  func discard() async
}

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
  }

  var clientSessionId: UUID
  var planKey: String
  var startedAt: Date
  var finishedAt: Date
  var parts: [Part]
  var segments: [Segment]
  var heartRate: HeartRateSummary?
  var healthWorkoutUUID: UUID?
}
