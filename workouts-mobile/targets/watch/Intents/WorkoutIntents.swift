import AppIntents
import SwiftUI
import WatchKit

enum WorkoutStyle: String, AppEnum {
  case todaysClass, openTimer
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "Workout"
  static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
    .todaysClass: "Today's class", .openTimer: "Open timer"
  ]
}

/// Shared with the scene and recovery delegate; intents never create a second engine.
@MainActor final class WatchRuntime: ObservableObject {
  static let shared = WatchRuntime()
  let health = HealthAuthorization()
  let engine: WorkoutEngine
  @Published var donationFailed = false
  @Published var notice: String?
  private var recovery: Task<Void, Never>?

  private init() {
    let recorder = HealthKitRecorder()
    engine = WorkoutEngine(recorder: recorder, store: .standard(), outbox: .standard())
    recorder.beforeCollection = { [weak self] in
      await self?.health.refresh()
      await self?.health.request()
    }
    recorder.onCollectionBegan = { [weak self] in
      self?.donationFailed = false
      Task { @MainActor in
        do { try await StartClassIntent().donate(result: .result(actionButtonIntent: AdvanceIntent())) }
        catch { self?.donationFailed = true }
      }
    }
  }

  func recover() async {
    if recovery == nil { recovery = Task { await engine.recover() } }
    await recovery?.value
  }

  func start(_ style: WorkoutStyle) async {
    await recover()
    let plan = style == .todaysClass ? PlanLibrary.todaysPlan() ?? PlanLibrary.openTimer : PlanLibrary.openTimer
    do { try await engine.start(plan, leadIn: 3) }
    catch { /* Engine retains a start error for the root alert. */ }
  }

  func advance() {
    switch engine.advance() {
    case .applied: WKInterfaceDevice.current().play(.click)
    case .ignored(.clockDriven):
      notice = "Clock advances this part"
      Task { @MainActor in try? await Task.sleep(for: .seconds(2)); notice = nil }
    default: break
    }
  }
}

struct StartClassIntent: StartWorkoutIntent {
  static var title: LocalizedStringResource = "Start Håfa workout"
  @Parameter(title: "Workout") var workoutStyle: WorkoutStyle
  @AppDependency private var runtime: WatchRuntime
  static var suggestedWorkouts: [Self] { [Self(style: .todaysClass), Self(style: .openTimer)] }
  init() { workoutStyle = .todaysClass }
  init(style: WorkoutStyle) { workoutStyle = style }
  var displayRepresentation: DisplayRepresentation { WorkoutStyle.caseDisplayRepresentations[workoutStyle]! }

  @MainActor func perform() async throws -> some IntentResult {
    // Return before an authorization prompt can block the intent. Recorder.begin starts the
    // HK session first, then asks for Health access and begins collection (Apple's Action guide).
    Task { await runtime.start(workoutStyle) }
    return .result()
  }
}

struct AdvanceIntent: AppIntent {
  static var title: LocalizedStringResource = "Advance Håfa workout"
  @AppDependency private var runtime: WatchRuntime
  @MainActor func perform() async throws -> some IntentResult {
    await runtime.recover(); runtime.advance(); return .result()
  }
}

struct PauseWorkoutIntent: AppIntents.PauseWorkoutIntent {
  static var title: LocalizedStringResource = "Pause Håfa workout"
  @AppDependency private var runtime: WatchRuntime
  @MainActor func perform() async throws -> some IntentResult {
    await runtime.recover(); runtime.engine.pause(); return .result()
  }
}

struct ResumeWorkoutIntent: AppIntents.ResumeWorkoutIntent {
  static var title: LocalizedStringResource = "Resume Håfa workout"
  @AppDependency private var runtime: WatchRuntime
  @MainActor func perform() async throws -> some IntentResult {
    await runtime.recover(); runtime.engine.resume(); return .result()
  }
}
