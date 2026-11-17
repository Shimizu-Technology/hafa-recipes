import HealthKit

/// Asks once for what a class recording needs: save the workout with its heart rate and energy.
/// HealthKit never reveals whether read access was denied, so "answered" only means the person saw the prompt.
@MainActor
final class HealthAuthorization: ObservableObject {
  enum Status: Equatable { case checking, unavailable, notAsked, asking, answered, failed }

  @Published private(set) var status: Status = .checking

  private let store = HKHealthStore()
  static let share: Set<HKSampleType> = [
    HKObjectType.workoutType(), HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned),
  ]
  static let read: Set<HKObjectType> = [HKQuantityType(.heartRate), HKQuantityType(.activeEnergyBurned)]

  func refresh() async {
    guard HKHealthStore.isHealthDataAvailable() else { status = .unavailable; return }
    do {
      let request = try await store.statusForAuthorizationRequest(toShare: Self.share, read: Self.read)
      status = request == .unnecessary ? .answered : .notAsked
    } catch {
      status = .failed
    }
  }

  func request() async {
    guard status == .notAsked || status == .failed else { return }
    status = .asking
    do {
      try await store.requestAuthorization(toShare: Self.share, read: Self.read)
      await refresh()
    } catch {
      status = .failed
    }
  }
}
