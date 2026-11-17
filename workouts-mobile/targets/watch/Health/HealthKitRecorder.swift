import HealthKit

/// One HKWorkoutSession per class with one HKWorkoutActivity per part (design §5.2). Every
/// activity uses the class's activity type, since HealthKit only mixes types for swim-bike-run.
@MainActor
final class HealthKitRecorder: NSObject, WorkoutRecorder {
  enum RecorderError: Error { case noSession, busy }

  var onSessionLost: (() -> Void)?

  private let store: HKHealthStore
  private var session: HKWorkoutSession?
  private var builder: HKLiveWorkoutBuilder?
  private var partOpen = false
  /// Set once finish or discard starts, so the session's own end isn't reported as a loss.
  private var ending = false
  private var collectionEnded = false
  private var eventsAdded = false

  init(store: HKHealthStore = HKHealthStore()) {
    self.store = store
  }

  func begin(activityType: UInt, at date: Date) async throws {
    guard session == nil else { throw RecorderError.busy }
    let configuration = HKWorkoutConfiguration()
    configuration.activityType = HKWorkoutActivityType(rawValue: activityType) ?? .crossTraining
    configuration.locationType = .indoor
    let session = try HKWorkoutSession(healthStore: store, configuration: configuration)
    attach(session)
    session.startActivity(with: date)
    do {
      try await builder?.beginCollection(at: date)
    } catch {
      ending = true
      session.end()
      detach()
      throw error
    }
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
    ending = true
    if !collectionEnded {
      session.stopActivity(with: date)
      try await builder.endCollection(at: date)
      collectionEnded = true
    }
    if !eventsAdded {
      // A wall clock moved backwards could put a tap before its start; never build a negative interval.
      let events = segments.map { segment in
        HKWorkoutEvent(
          type: .segment, dateInterval: DateInterval(start: segment.start, end: max(segment.start, segment.end)),
          metadata: ["HafaSegmentKind": segment.kind.rawValue, "HafaPartIndex": segment.part])
      }
      if !events.isEmpty { try await builder.addWorkoutEvents(events) }
      // The same sync keys the phone exporter uses (lib/health/provider.ios.ts), so the phone can tell it's ours.
      try await builder.addMetadata([
        HKMetadataKeySyncIdentifier: syncIdentifier, HKMetadataKeySyncVersion: 1, "hafa.recorded_on": "watch",
      ])
      eventsAdded = true
    }
    let workout = try await builder.finishWorkout()
    session.end()
    detach()
    return Self.summary(of: workout)
  }

  func discard() async {
    ending = true
    session?.end()
    builder?.discardWorkout()
    detach()
  }

  private func attach(_ session: HKWorkoutSession) {
    let builder = session.associatedWorkoutBuilder()
    builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: session.workoutConfiguration)
    session.delegate = self
    self.session = session
    self.builder = builder
    partOpen = false
    ending = false
    collectionEnded = false
    eventsAdded = false
  }

  private func detach() {
    session?.delegate = nil
    session = nil
    builder = nil
  }

  private func lost(_ workoutSession: HKWorkoutSession) {
    guard workoutSession === session, !ending else { return }
    detach()
    onSessionLost?()
  }

  /// Read from the saved workout, matching each activity to its part by block ID.
  private static func summary(of workout: HKWorkout?) -> RecordedSummary {
    let heartRate = HKQuantityType(.heartRate)
    var parts: [String: HeartRateSummary] = [:]
    for activity in workout?.workoutActivities ?? [] {
      guard let blockId = activity.metadata?["HafaBlockID"] as? String,
        let summary = heartRateSummary(activity.statistics(for: heartRate))
      else { continue }
      parts[blockId] = summary
    }
    return RecordedSummary(
      workoutUUID: workout?.uuid, heartRate: heartRateSummary(workout?.statistics(for: heartRate)), parts: parts)
  }

  private static func heartRateSummary(_ statistics: HKStatistics?) -> HeartRateSummary? {
    guard let statistics else { return nil }
    let bpm = HKUnit.count().unitDivided(by: .minute())
    return HeartRateSummary(
      average: statistics.averageQuantity()?.doubleValue(for: bpm),
      max: statistics.maximumQuantity()?.doubleValue(for: bpm))
  }
}

extension HealthKitRecorder: HKWorkoutSessionDelegate {
  nonisolated func workoutSession(
    _ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState,
    date: Date
  ) {
    guard toState == .ended else { return }
    Task { @MainActor in self.lost(workoutSession) }
  }

  nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
    Task { @MainActor in self.lost(workoutSession) }
  }
}
