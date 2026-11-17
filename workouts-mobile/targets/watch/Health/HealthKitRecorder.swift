import HealthKit

/// One HKWorkoutSession per class with one HKWorkoutActivity per part (design §5.2). Every
/// activity uses the class's activity type, since HealthKit only mixes types for swim-bike-run.
@MainActor
final class HealthKitRecorder: WorkoutRecorder {
  enum RecorderError: Error { case noSession }

  private let store: HKHealthStore
  private var session: HKWorkoutSession?
  private var builder: HKLiveWorkoutBuilder?
  private var partOpen = false

  init(store: HKHealthStore = HKHealthStore()) {
    self.store = store
  }

  func begin(activityType: UInt, at date: Date) async throws {
    let configuration = HKWorkoutConfiguration()
    configuration.activityType = HKWorkoutActivityType(rawValue: activityType) ?? .crossTraining
    configuration.locationType = .indoor
    let session = try HKWorkoutSession(healthStore: store, configuration: configuration)
    attach(session)
    session.startActivity(with: date)
    try await builder?.beginCollection(at: date)
  }

  func recover(inPart: Bool) async throws -> Bool {
    guard let session = try await store.recoverActiveWorkoutSession() else { return false }
    attach(session)
    partOpen = inPart
    return true
  }

  func beginPart(_ part: WatchPlan.Part, at date: Date) {
    guard let session else { return }
    let configuration = HKWorkoutConfiguration()
    configuration.activityType = session.workoutConfiguration.activityType
    configuration.locationType = session.workoutConfiguration.locationType
    session.beginNewActivity(
      configuration: configuration, date: date,
      metadata: ["HafaBlockID": part.blockId, "HafaPartLabel": part.label, "HafaPartKind": part.kind.rawValue])
    partOpen = true
  }

  func endPart(at date: Date) {
    guard let session, partOpen else { return }
    session.endCurrentActivity(on: date)
    partOpen = false
  }

  func pause() { session?.pause() }
  func resume() { session?.resume() }

  func finish(at date: Date, segments: [Segment], syncIdentifier: String) async throws -> RecordedSummary {
    guard let session, let builder else { throw RecorderError.noSession }
    session.stopActivity(with: date)
    try await builder.endCollection(at: date)
    let events = segments.map { segment in
      HKWorkoutEvent(
        type: .segment, dateInterval: DateInterval(start: segment.start, end: segment.end),
        metadata: ["HafaSegmentKind": segment.kind.rawValue, "HafaPartIndex": segment.part])
    }
    if !events.isEmpty { try await builder.addWorkoutEvents(events) }
    // The same sync keys the phone exporter uses (lib/health/provider.ios.ts), so the phone can tell it's ours.
    try await builder.addMetadata([
      HKMetadataKeySyncIdentifier: syncIdentifier, HKMetadataKeySyncVersion: 1, "hafa.recorded_on": "watch",
    ])
    let workout = try await builder.finishWorkout()
    session.end()
    let heartRate = HKQuantityType(.heartRate)
    let summary = RecordedSummary(
      workoutUUID: workout?.uuid, heartRate: Self.summary(builder.statistics(for: heartRate)),
      parts: builder.workoutActivities.map { Self.summary($0.statistics(for: heartRate)) })
    detach()
    return summary
  }

  func discard() async {
    session?.end()
    builder?.discardWorkout()
    detach()
  }

  private func attach(_ session: HKWorkoutSession) {
    let builder = session.associatedWorkoutBuilder()
    builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: session.workoutConfiguration)
    self.session = session
    self.builder = builder
    partOpen = false
  }

  private func detach() {
    session = nil
    builder = nil
  }

  private static func summary(_ statistics: HKStatistics?) -> HeartRateSummary? {
    guard let statistics else { return nil }
    let bpm = HKUnit.count().unitDivided(by: .minute())
    return HeartRateSummary(
      average: statistics.averageQuantity()?.doubleValue(for: bpm),
      max: statistics.maximumQuantity()?.doubleValue(for: bpm))
  }
}
