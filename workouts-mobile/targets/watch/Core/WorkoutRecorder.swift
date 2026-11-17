import Foundation

struct HeartRateSummary: Codable, Equatable {
  var average: Double?
  var max: Double?
}

struct RecordedSummary: Codable, Equatable {
  var workoutUUID: UUID?
  var heartRate: HeartRateSummary?
  /// Keyed by the part's block ID, read back from each saved activity's metadata.
  var parts: [String: HeartRateSummary]

  static let none = RecordedSummary(workoutUUID: nil, heartRate: nil, parts: [:])
}

struct LiveMetrics: Equatable {
  var heartRate: Double?
  var average: Double?
  var maximum: Double?
  var kilocalories: Double?
}

/// The Health side of a class. HealthKitRecorder implements it on the watch; tests use a fake.
@MainActor
protocol WorkoutRecorder: AnyObject {
  var metrics: LiveMetrics { get }
  var isRecording: Bool { get }
  var collectionEnded: Bool { get }
  var onCollectionEnded: (() -> Void)? { get set }
  func restoreCollectionEnded(_ ended: Bool)
  /// Called when the system ends or fails the session outside finish and discard.
  var onSessionLost: (() -> Void)? { get set }
  func begin(activityType: UInt, at date: Date) async throws
  /// Reattaches to a session that outlived a crash. False when there was none.
  /// `inPart` says whether the checkpoint was inside a part, so its activity is still open.
  func recover(inPart: Bool) async throws -> Bool
  func beginPart(_ part: WatchPlan.Part, at date: Date)
  func endPart(at date: Date)
  func pause()
  func resume()
  /// Safe to call again after it throws: steps that already succeeded are skipped.
  func finish(at date: Date, segments: [Segment], syncIdentifier: String) async throws -> RecordedSummary
  func discard() async
}

extension WorkoutRecorder {
  var metrics: LiveMetrics { LiveMetrics() }
}
