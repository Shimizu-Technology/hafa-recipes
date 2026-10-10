import Foundation
import HealthKit

struct ActualHealthInterval: Decodable { let started_at: String; let ended_at: String }
struct ActualHealthWrite: Decodable {
  let canonical_session_id: String
  let revision: Int
  let status: String
  let started_at: String
  let ended_at: String
  let active_seconds: Double
  let active_intervals: [ActualHealthInterval]
  let activity_type: UInt
}

final class PausedHealthWriter {
  private let store = HKHealthStore()
  private func invalid(_ message: String) -> NSError { NSError(domain: "HafaPausedHealth", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
  private func date(_ value: String) throws -> Date {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let result = formatter.date(from: value) { return result }
    formatter.formatOptions = [.withInternetDateTime]
    guard let result = formatter.date(from: value) else { throw invalid("Invalid recorded timestamp") }
    return result
  }
  func save(_ json: String) async throws -> String {
    let payload = try JSONDecoder().decode(ActualHealthWrite.self, from: Data(json.utf8))
    guard payload.canonical_session_id.range(of: "^[A-Za-z0-9_-]{1,100}$", options: .regularExpression) != nil,
          payload.revision > 0, ["completed", "partial"].contains(payload.status),
          let activity = HKWorkoutActivityType(rawValue: payload.activity_type),
          [UInt(37), 52, 50, 6, 3000].contains(payload.activity_type),
          !payload.active_intervals.isEmpty, payload.active_intervals.count <= 1000 else { throw invalid("Invalid actual workout") }
    let start = try date(payload.started_at), end = try date(payload.ended_at)
    guard end > start, payload.active_seconds > 0 else { throw invalid("Invalid actual workout duration") }
    var previous = start, total: Double = 0
    var events: [HKWorkoutEvent] = []
    for interval in payload.active_intervals {
      let a = try date(interval.started_at), b = try date(interval.ended_at)
      guard a >= previous, b > a, b <= end else { throw invalid("Recorded intervals must be ordered and within the workout") }
      if a > previous {
        events.append(HKWorkoutEvent(type: .pause, dateInterval: DateInterval(start: previous, duration: 0), metadata: nil))
        events.append(HKWorkoutEvent(type: .resume, dateInterval: DateInterval(start: a, duration: 0), metadata: nil))
      }
      total += b.timeIntervalSince(a); previous = b
    }
    if previous < end { events.append(HKWorkoutEvent(type: .pause, dateInterval: DateInterval(start: previous, duration: 0), metadata: nil)) }
    guard abs(total - payload.active_seconds) <= 1 else { throw invalid("Active intervals do not match recorded duration") }
    guard HKHealthStore.isHealthDataAvailable(), store.authorizationStatus(for: HKObjectType.workoutType()) == .sharingAuthorized else { throw invalid("Allow workout writing in Apple Health first") }
    let config = HKWorkoutConfiguration()
    config.activityType = activity
    config.locationType = .unknown
    // A retrospective builder collects no sensor samples, energy, distance or routes.
    let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: nil)
    do {
      try await builder.beginCollection(at: start)
      try await builder.addMetadata([HKMetadataKeySyncIdentifier: "hafa-workouts:\(payload.canonical_session_id)", HKMetadataKeySyncVersion: payload.revision, "hafa.partial": payload.status == "partial"])
      try await builder.addWorkoutEvents(events)
      try await builder.endCollection(at: end)
      guard abs(builder.elapsedTime(at: end) - total) <= 0.01 else { throw invalid("HealthKit did not preserve recorded pause duration") }
      guard store.authorizationStatus(for: HKObjectType.workoutType()) == .sharingAuthorized else { throw invalid("Workout write permission changed") }
      guard let workout = try await builder.finishWorkout() else { throw invalid("HealthKit did not confirm the saved workout") }
      return workout.uuid.uuidString
    } catch { builder.discardWorkout(); throw error }
  }
}
