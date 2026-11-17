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

  enum StartError: Error { case emptyPlan, sessionLost }
  enum Control: Equatable { case end, skip }
  enum Sheet: Identifiable, Equatable {
    case confirmation(Control), capReps(Int)
    var id: String {
      switch self {
      case .confirmation(.end): return "end"
      case .confirmation(.skip): return "skip"
      case .capReps(let index): return "cap-\(index)"
      }
    }
  }
  @Published private(set) var sheet: Sheet?
  private var sheetIsPresented = false
  private var queuedCaps: [Int] = []
  private var pendingPartIndex: Int?
  var pendingControl: Control? {
    get { if case .confirmation(let control) = sheet { return control }; return nil }
    set { if newValue == nil, pendingControl != nil { dismissSheet() } }
  }
  func request(_ control: Control) {
    guard !sheetIsPresented else { return }
    pendingPartIndex = runner?.cursor
    sheetIsPresented = true
    sheet = .confirmation(control)
  }
  func presentCapReps(for index: Int) {
    if sheetIsPresented { queuedCaps.append(index) }
    else { sheetIsPresented = true; sheet = .capReps(index) }
  }
  func dismissSheet() { sheet = nil }
  /// Called by SwiftUI only after the previous presentation has finished dismissing.
  func sheetDismissed() {
    sheetIsPresented = false
    pendingPartIndex = nil
    if !queuedCaps.isEmpty { presentCapReps(for: queuedCaps.removeFirst()) }
  }
  func confirmControl() {
    let action = pendingControl
    let expected = pendingPartIndex
    pendingControl = nil
    switch action {
    case .end: stop()
    case .skip: if let expected { endPart(expected: expected) }
    case nil: break
    }
  }
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
  private var recordedSummary: RecordedSummary?
  private var recovery: Task<Void, Never>?
  var canSaveScoresOnly: Bool { !recorder.collectionEnded }
  private var deferredEvents: [RunnerEvent] = []
  private var deferredUntil: Date?
  private var lastCheckpoint = Date.distantPast

  init(recorder: WorkoutRecorder, store: CheckpointStore, outbox: ClassOutbox, clock: Clock = SystemClock()) {
    self.recorder = recorder
    self.store = store
    self.outbox = outbox
    self.clock = clock
    recorder.onCollectionEnded = { [weak self] in self?.checkpoint(force: true) }
    recorder.onEventsAdded = { [weak self] in self?.checkpoint(force: true) }
    recorder.onSessionLost = { [weak self] in self?.sessionLost() }
  }

  /// Only from idle or after a saved class, never over one that is running or failed to save.
  func start(_ plan: WatchPlan, leadIn: TimeInterval) async throws {
    await recover()
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
      guard recorder.isRecording else { throw StartError.sessionLost }
    } catch {
      startError = "Couldn’t start. Check Health access, then try again."
      state = .idle
      throw error
    }
    sessionID = UUID()
    startedAt = now
    isRecording = recorder.isRecording
    recordedSummary = nil
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
  func advance() -> PartRunner.AdvanceResult { applyAdvance { $0.advance(at: $1) } }

  private func applyAdvance(_ change: (inout PartRunner, Date) -> (PartRunner.AdvanceResult, [RunnerEvent])) -> PartRunner.AdvanceResult {
    guard pendingControl == nil else { return .ignored(.confirmationOpen) }
    guard state == .running, var runner else { return .ignored(.nothingToAdvance) }
    flushDeferred()
    let now = clock.now
    let (result, events) = change(&runner, now)
    if case .applied = result {
      flushDeferred(force: true)
      self.runner = runner
      // Catch-up boundaries predate this press and cannot be undone with it.
      apply(events.filter { $0.date < now })
      deferredUntil = now.addingTimeInterval(PartRunner.undoWindow)
      deliver(events.filter { $0.date >= now })
    } else {
      self.runner = runner
      deliver(events)
    }
    checkpoint(force: true)
    return result
  }

  @discardableResult
  func undo() -> Bool {
    guard state == .running, var runner, let events = runner.undoWithEvents(at: clock.now) else { return false }
    deferredEvents = []; deferredUntil = nil
    self.runner = runner
    apply(events.filter { event in
      switch event { case .paused, .resumed: return false; default: return true }
    })
    checkpoint(force: true)
    return true
  }

  private func flushDeferred(force: Bool = false) {
    guard let until = deferredUntil, force || clock.now > until else { return }
    apply(deferredEvents)
    deferredEvents = []; deferredUntil = nil
    runner?.clearUndo()
    checkpoint(force: true)
  }

  private func deliver(_ events: [RunnerEvent]) {
    for event in events {
      switch event {
      case .paused, .resumed: apply([event])
      default:
        if deferredUntil != nil { deferredEvents.append(event) } else { apply([event]) }
      }
    }
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
  func completePart() { _ = applyAdvance { $0.completePartWithResult(at: $1) } }
  func endPart(expected: Int? = nil) {
    mutate { runner, now in
      let events = runner.tick(at: now)
      guard expected == nil || runner.cursor == expected else { return events }
      return events + runner.endPart(at: now)
    }
  }

  /// Ends the class and saves it to Health. After a failure the class is kept: try again, or save the
  /// scores without a Health workout.
  func finish(withoutHealth: Bool = false) async {
    guard state == .running || state.isFailure, var runner else { return }
    flushDeferred(force: true)
    let events = runner.finish(at: clock.now)
    self.runner = runner
    apply(events)
    guard case .finished(let end) = runner.phase else { return }
    state = .saving
    checkpoint(force: true)
    var summary = recordedSummary ?? .none
    if isRecording && withoutHealth && canSaveScoresOnly {
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
      recordedSummary = summary
      checkpoint(force: true)
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
    deferredEvents = []; deferredUntil = nil
    runner = nil
    isRecording = false
    state = .idle
  }

  /// On launch, or when watchOS relaunches the app to recover a workout: bring back a class that
  /// outlived a crash, catching up on any part changes since.
  func recover() async {
    if let recovery { await recovery.value; return }
    let task = Task { await self.performRecovery() }
    recovery = task
    await task.value
  }

  private func performRecovery() async {
    guard state == .idle else { return }
    state = .starting
    let saved = store.load()
    let live = (try? await recorder.recover(inPart: saved?.healthPartOpen ?? false)) ?? false
    guard let saved else {
      // HealthKit kept a session the checkpoint never saw. Save what it recorded rather than drop it.
      if live {
        do {
          _ = try await recorder.finish(
            at: clock.now, segments: [], syncIdentifier: "hafa-workouts:\(UUID().uuidString.lowercased())")
        } catch { await recorder.discard() }
      }
      state = .idle
      return
    }
    if live && !saved.isRecording { await recorder.discard() }
    recorder.restoreCollectionEnded(saved.collectionEnded ?? false)
    recorder.restoreEventsAdded(saved.eventsAdded ?? false)
    recordedSummary = saved.recordedSummary
    sessionID = saved.sessionID
    startedAt = saved.startedAt
    runner = saved.runner
    deferredEvents = saved.deferredEvents ?? []
    deferredUntil = saved.deferredUntil
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
    guard state == .running else { return }
    flushDeferred()
    guard var runner else { return }
    let events = change(&runner, clock.now)
    if runner != self.runner { self.runner = runner }
    if !runner.canUndo(at: clock.now) { flushDeferred(force: true) }
    deliver(events)
    if case .finished = runner.phase { pendingControl = nil }
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
    guard (try? store.save(Checkpoint(sessionID: sessionID, startedAt: startedAt, runner: runner, isRecording: isRecording, recordedSummary: recordedSummary, collectionEnded: recorder.collectionEnded, eventsAdded: recorder.eventsAdded, deferredEvents: deferredEvents, deferredUntil: deferredUntil))) != nil
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
