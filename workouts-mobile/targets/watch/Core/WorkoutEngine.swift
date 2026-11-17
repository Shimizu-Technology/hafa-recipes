import Combine
import Foundation

/// Runs one class: drives PartRunner from the clock and presses, mirrors it into the Health
/// recording (one activity per part), and checkpoints so a crash loses nothing.
@MainActor
final class WorkoutEngine: ObservableObject {
  enum State: Equatable {
    case idle, starting, running, saving, saved(ClassRecord), failed(String)

    var isFailure: Bool {
      if case .failed = self { return true }
      return false
    }
  }

  enum StartError: Error { case emptyPlan }
  @Published var startError: String?
  @Published private(set) var runner: PartRunner?
  @Published private(set) var state: State = .idle
  /// False when HealthKit lost the session. The class still runs and saves its scores.
  @Published private(set) var isRecording = false
  @Published private(set) var metrics = LiveMetrics()

  static let checkpointInterval: TimeInterval = 5

  private let recorder: WorkoutRecorder
  private let store: CheckpointStore
  private let outbox: ClassOutbox
  private let clock: Clock
  private var sessionID = UUID()
  private var startedAt = Date.distantPast
  private var lastCheckpoint = Date.distantPast

  init(recorder: WorkoutRecorder, store: CheckpointStore, outbox: ClassOutbox, clock: Clock = SystemClock()) {
    self.recorder = recorder
    self.store = store
    self.outbox = outbox
    self.clock = clock
    recorder.onSessionLost = { [weak self] in self?.sessionLost() }
  }

  /// Only from idle or after a saved class, never over one that is running or failed to save.
  func start(_ plan: WatchPlan, leadIn: TimeInterval) async throws {
    switch state {
    case .idle, .saved: break
    case .starting, .running, .saving, .failed: return
    }
    guard !plan.parts.isEmpty else {
      startError = "This class has no parts. Open Today's class on your iPhone."
      throw StartError.emptyPlan
    }
    startError = nil
    state = .starting
    let now = clock.now
    do {
      try await recorder.begin(activityType: plan.activityType, at: now)
    } catch {
      startError = "Couldn’t start. Check Health access, then try again."
      state = .idle
      throw error
    }
    sessionID = UUID()
    startedAt = now
    isRecording = true
    var runner = PartRunner(plan: plan, leadIn: leadIn)
    let events = runner.start(at: now)
    self.runner = runner
    state = .running
    apply(events)
    checkpoint(force: true)
  }

  /// Called about once a second while a class screen is visible.
  func tick() {
    metrics = recorder.metrics
    mutate(force: false) { $0.tick(at: $1) }
  }

  @discardableResult
  func advance() -> PartRunner.AdvanceResult {
    var result = PartRunner.AdvanceResult.ignored(.nothingToAdvance)
    mutate { runner, now in
      let (outcome, events) = runner.advance(at: now)
      result = outcome
      return events
    }
    return result
  }

  @discardableResult
  func undo() -> Bool {
    guard state == .running, var runner, runner.undo(at: clock.now) else { return false }
    self.runner = runner
    checkpoint(force: true)
    return true
  }

  func setScore(_ score: PartScore, for index: Int) {
    guard state == .running || state.isFailure, var runner else { return }
    runner.setScore(score, for: index)
    self.runner = runner
    checkpoint(force: true)
  }
  func extendRest() { mutate { runner, _ in runner.extendRest(by: 15); return [] } }
  func stop() { mutate { $0.finish(at: $1) } }

  func pause() { mutate { $0.pause(at: $1) } }
  func resume() { mutate { $0.resume(at: $1) } }
  func endPart() { mutate { $0.endPart(at: $1) } }

  /// Ends the class and saves it to Health. After a failure the class is kept: try again, or save the
  /// scores without a Health workout.
  func finish(withoutHealth: Bool = false) async {
    guard state == .running || state.isFailure, var runner else { return }
    let events = runner.finish(at: clock.now)
    self.runner = runner
    apply(events)
    guard case .finished(let end) = runner.phase else { return }
    state = .saving
    checkpoint(force: true)
    var summary = RecordedSummary.none
    if isRecording && withoutHealth {
      await recorder.discard()
      isRecording = false
    } else if isRecording {
      do {
        summary = try await recorder.finish(
          at: end, segments: runner.segments(), syncIdentifier: "hafa-workouts:\(sessionID.uuidString.lowercased())")
      } catch {
        state = .failed("Couldn't save to Health. Your class is still on this watch.")
        return
      }
      isRecording = false
    }
    let record = record(runner, end: end, summary: summary)
    do {
      try outbox.add(record)
    } catch {
      state = .failed("Couldn't save your class on this watch.")
      return
    }
    store.clear()
    state = .saved(record)
  }

  func discard() async {
    if isRecording { await recorder.discard() }
    store.clear()
    runner = nil
    isRecording = false
    state = .idle
  }

  /// On launch, or when watchOS relaunches the app to recover a workout: bring back a class that
  /// outlived a crash, catching up on any part changes since.
  func recover() async {
    guard state == .idle else { return }
    state = .starting
    let saved = store.load()
    let live = (try? await recorder.recover(inPart: saved?.runner.phase == .running)) ?? false
    guard let saved else {
      // HealthKit kept a session the checkpoint never saw. Save what it recorded rather than drop it.
      if live {
        _ = try? await recorder.finish(
          at: clock.now, segments: [], syncIdentifier: "hafa-workouts:\(UUID().uuidString.lowercased())")
      }
      state = .idle
      return
    }
    sessionID = saved.sessionID
    startedAt = saved.startedAt
    runner = saved.runner
    isRecording = live && saved.isRecording
    state = .running
    mutate { $0.tick(at: $1) }
  }

  private func sessionLost() {
    guard isRecording else { return }
    isRecording = false
    checkpoint(force: true)
  }

  private func mutate(force: Bool = true, _ change: (inout PartRunner, Date) -> [RunnerEvent]) {
    guard state == .running, var runner else { return }
    let events = change(&runner, clock.now)
    if runner != self.runner { self.runner = runner }
    apply(events)
    checkpoint(force: force || !events.isEmpty)
  }

  private func apply(_ events: [RunnerEvent]) {
    guard isRecording, let plan = runner?.plan else { return }
    for event in events {
      switch event {
      case .partBegan(let index, let at): recorder.beginPart(plan.parts[index], at: at)
      case .partEnded(_, let at): recorder.endPart(at: at)
      case .paused: recorder.pause()
      case .resumed: recorder.resume()
      case .finished: break
      }
    }
  }

  private func checkpoint(force: Bool) {
    let now = clock.now
    guard let runner, force || now.timeIntervalSince(lastCheckpoint) >= Self.checkpointInterval else { return }
    // A failed write is retried on the next tick; the class keeps running either way.
    guard (try? store.save(Checkpoint(sessionID: sessionID, startedAt: startedAt, runner: runner, isRecording: isRecording))) != nil
    else { return }
    lastCheckpoint = now
  }

  private func record(_ runner: PartRunner, end: Date, summary: RecordedSummary) -> ClassRecord {
    let parts = runner.plan.parts.indices.map { index -> ClassRecord.Part in
      let run = runner.runs[index]
      return ClassRecord.Part(
        blockId: runner.plan.parts[index].blockId, start: run.span?.start, end: run.span?.end,
        activeSeconds: runner.activeSeconds(of: index, at: end), rounds: run.taps.count,
        buyInDoneAt: run.buyInDoneAt, skipped: run.skipped, heartRate: summary.parts[runner.plan.parts[index].blockId], score: run.score)
    }
    return ClassRecord(
      clientSessionId: sessionID, planKey: runner.plan.planKey, startedAt: startedAt, finishedAt: end, parts: parts,
      segments: runner.segments(), heartRate: summary.heartRate, healthWorkoutUUID: summary.workoutUUID)
  }
}
