import XCTest
@testable import HafaWatchCore

@MainActor
final class WorkoutEngineTests: XCTestCase {
  private var clock: ManualClock!
  private var recorder: FakeRecorder!
  private var store: CheckpointStore!
  private var outbox: ClassOutbox!

  override func setUp() async throws {
    clock = ManualClock()
    recorder = FakeRecorder()
    store = CheckpointStore(url: temporaryURL())
    outbox = ClassOutbox(directory: temporaryURL().deletingLastPathComponent())
  }

  private func engine() -> WorkoutEngine {
    WorkoutEngine(recorder: recorder, store: store, outbox: outbox, clock: clock)
  }

  private let twoParts = plan(part("A", .amrap, cap: 60, restAfter: 30), part("B", .forTime, cap: 600, rounds: 1))

  func testStartLossIsNotSuccess() async {
    recorder.loseDuringBegin = true
    do { try await engine().start(twoParts, leadIn: 0); XCTFail("lost start accepted") } catch {}
    XCTAssertNil(store.load())
  }

  func testRecoveredNotRecordingDiscardsOrphanBeforeAnotherClass() async throws {
    var runner = PartRunner(plan: twoParts, leadIn: 0)
    _ = runner.start(at: t0)
    try store.save(Checkpoint(sessionID: UUID(), startedAt: t0, runner: runner, isRecording: false))
    recorder.liveSession = true
    let engine = engine()
    await engine.recover()
    XCTAssertFalse(engine.isRecording)
    XCTAssertEqual(recorder.calls.last, "discard")
    await engine.discard()
    try await engine.start(twoParts, leadIn: 0)
    XCTAssertTrue(engine.isRecording)
  }

  func testEndAndSkipRequireConfirmationAndCancelPreservesClass() async throws {
    let engine = engine()
    try await engine.start(twoParts, leadIn: 0)
    engine.request(.end)
    XCTAssertEqual(engine.runner?.phase, .running)
    engine.pendingControl = nil
    engine.sheetDismissed()
    engine.confirmControl()
    XCTAssertEqual(engine.runner?.phase, .running)
    engine.request(.skip)
    XCTAssertFalse(engine.runner!.runs[0].skipped)
    engine.confirmControl()
    XCTAssertTrue(engine.runner!.runs[0].skipped)
    engine.sheetDismissed()
    engine.request(.end)
    engine.confirmControl()
    guard case .finished = engine.runner?.phase else { return XCTFail("not ended") }
  }

  func testSkipConfirmationCatchesUpBeforeCheckingExpectedPartWithoutViewTick() async throws {
    let engine = engine()
    try await engine.start(plan(part("A", .amrap, cap: 10), part("B", .amrap, cap: 60)), leadIn: 0)
    engine.request(.skip)
    clock.advance(11) // No intervening engine.tick().
    engine.confirmControl()
    XCTAssertEqual(engine.runner?.cursor, 1)
    XCTAssertEqual(engine.runner?.phase, .running)
    XCTAssertEqual(engine.runner?.runs.map(\.skipped), [false, false])
    XCTAssertNil(engine.pendingControl)
    XCTAssertEqual(store.load()?.runner, engine.runner)
  }

  func testFinishedClassDismissesEndConfirmation() async throws {
    let engine = engine()
    try await engine.start(plan(part("A", .amrap, cap: 10)), leadIn: 0)
    engine.request(.end)
    clock.advance(11)
    engine.tick()
    XCTAssertNil(engine.pendingControl)
    XCTAssertNil(engine.sheet)
  }

  func testCapRepsWaitsForConfirmationDismissal() async throws {
    let engine = engine()
    try await engine.start(twoParts, leadIn: 0)
    for control in [WorkoutEngine.Control.skip, .end] {
      engine.request(control)
      engine.presentCapReps(for: 0)
      XCTAssertEqual(engine.sheet, .confirmation(control))
      engine.pendingControl = nil
      engine.presentCapReps(for: 1) // Even callbacks during dismissal must queue.
      XCTAssertNil(engine.sheet)
      engine.sheetDismissed()
      XCTAssertEqual(engine.sheet, .capReps(0))
      engine.dismissSheet(); engine.sheetDismissed()
      XCTAssertEqual(engine.sheet, .capReps(1))
      engine.dismissSheet(); engine.sheetDismissed()
      XCTAssertNil(engine.sheet)
    }
  }

  func testAddedHealthEventsAreCheckpointedBeforeFinishAndRestored() async throws {
    let first = engine()
    try await first.start(twoParts, leadIn: 0)
    clock.advance(2)
    _ = first.advance()
    recorder.addEventsBeforeFailure = true
    recorder.failFinish = true
    await first.finish()
    XCTAssertEqual(store.load()?.eventsAdded, true)
    XCTAssertEqual(recorder.eventBatches, 1)
    recorder.eventsAdded = false // A fresh recorder reattaches to the existing Health builder.
    recorder.liveSession = true
    let second = engine()
    await second.recover()
    XCTAssertTrue(recorder.eventsAdded)
    recorder.failFinish = false
    await second.finish()
    XCTAssertEqual(recorder.eventBatches, 1)
    XCTAssertEqual(outbox.records().count, 1)
  }

  func testHealthSummarySurvivesOutboxFailureAndRelaunch() async throws {
    let engine = engine()
    try await engine.start(twoParts, leadIn: 0)
    try FileManager.default.createDirectory(at: outbox.directory.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data().write(to: outbox.directory)
    await engine.finish()
    XCTAssertTrue(engine.state.isFailure)
    let summary = try XCTUnwrap(store.load()?.recordedSummary)
    XCTAssertNotNil(summary.workoutUUID)
    try FileManager.default.removeItem(at: outbox.directory)
    let recovered = self.engine()
    await recovered.recover()
    await recovered.finish()
    XCTAssertEqual(outbox.records().first?.healthWorkoutUUID, summary.workoutUUID)
    XCTAssertEqual(outbox.records().first?.heartRate, summary.heartRate)
  }

  func testCollectionEndedSurvivesCrashAndScoresOnlyRetriesHealth() async throws {
    let first = engine()
    try await first.start(twoParts, leadIn: 0)
    recorder.endCollectionBeforeFailure = true
    recorder.failFinish = true
    await first.finish()
    XCTAssertEqual(store.load()?.collectionEnded, true)
    recorder.collectionEnded = false // new recorder process
    recorder.liveSession = true
    let second = engine()
    await second.recover()
    XCTAssertFalse(second.canSaveScoresOnly)
    recorder.failFinish = false
    await second.finish(withoutHealth: true)
    XCTAssertNotNil(outbox.records().first?.healthWorkoutUUID)
    XCTAssertFalse(recorder.calls.contains("discard"))
  }

  func testExpiredDeferredBoundaryIsCheckpointedBeforeFiveSecondInterval() async throws {
    let first = engine()
    try await first.start(plan(part("A", .forTime, rounds: 1), part("B", .amrap, cap: 600)), leadIn: 0)
    clock.advance(20); first.advance()
    clock.advance(9); first.pause() // a checkpoint just before undo expiry
    XCTAssertFalse(store.load()!.deferredEvents!.isEmpty)
    clock.advance(1.1); first.tick()
    XCTAssertEqual(store.load()?.deferredEvents, [])
    XCTAssertNil(store.load()?.deferredUntil)
    XCTAssertEqual(recorder.calls.filter { $0 == "part B 20" }.count, 1)
    recorder.liveSession = true
    let recovered = engine()
    await recovered.recover()
    XCTAssertEqual(recorder.calls.filter { $0 == "part B 20" }.count, 1, "crash must not replay an applied boundary")
  }

  func testUndoAfterOldCatchUpKeepsHealthOnNewPart() async throws {
    let engine = engine()
    try await engine.start(plan(part("A", .amrap, cap: 60), part("B", .amrap, cap: 600)), leadIn: 0)
    clock.advance(200)
    XCTAssertEqual(engine.advance(), .applied(.round(1)))
    XCTAssertEqual(recorder.calls.filter { $0 == "part B 60" }.count, 1)
    clock.advance(1)
    XCTAssertTrue(engine.undo())
    XCTAssertEqual(engine.runner?.runs[1].taps.count, 0)
    XCTAssertEqual(recorder.calls.filter { $0 == "part B 60" }.count, 1)
  }

  func testRecordingFollowsTheParts() async throws {
    let engine = engine()
    try await engine.start(twoParts, leadIn: 3)
    clock.advance(4)
    engine.tick()
    clock.advance(10)
    XCTAssertEqual(engine.advance(), .applied(.round(1)))
    clock.advance(60)
    engine.tick()  // A capped at 63; resting until 93.
    clock.advance(26)
    engine.tick()  // B's lead-in ended at 96.
    clock.advance(4)
    XCTAssertEqual(engine.advance(), .applied(.partDone))
    XCTAssertFalse(recorder.calls.contains("end part 104"), "boundary stays reversible for ten seconds")
    clock.advance(11)
    engine.tick()
    XCTAssertEqual(recorder.calls, ["recover inPart=false", "begin 11 0", "part A 3", "end part 63", "part B 96", "end part 104"])
  }

  func testCheckpointsOnPressesAndEveryFiveSeconds() async throws {
    let engine = engine()
    try await engine.start(twoParts, leadIn: 0)
    XCTAssertEqual(store.load()?.runner, engine.runner)
    clock.advance(10)
    engine.advance()
    XCTAssertEqual(store.load()?.runner.runs[0].taps.count, 1)
    clock.advance(2)
    engine.tick()
    XCTAssertEqual(store.load()?.runner.runs[0].taps.count, 1, "unchanged runner, too soon to write")
    engine.pause()
    XCTAssertNotNil(store.load()?.runner.pausedAt)
  }

  func testRelaunchRestoresTheClassAndCatchesUp() async throws {
    let first = engine()
    try await first.start(twoParts, leadIn: 3)
    clock.advance(20)
    first.tick()
    first.advance()
    // The app dies. HealthKit keeps the session; the relaunch happens during B.
    clock.advance(100)
    recorder.calls = []
    recorder.liveSession = true
    let second = engine()
    await second.recover()
    XCTAssertEqual(second.state, .running)
    XCTAssertTrue(second.isRecording)
    XCTAssertEqual(second.runner?.runs[0].taps.count, 1)
    XCTAssertEqual(second.runner?.cursor, 1)
    XCTAssertEqual(recorder.calls, ["recover inPart=true", "end part 63", "part B 96"])
  }

  func testRelaunchWithoutHealthSessionKeepsScoringWithoutRecording() async throws {
    let first = engine()
    try await first.start(twoParts, leadIn: 0)
    clock.advance(30)
    first.advance()
    let second = engine()
    await second.recover()
    XCTAssertFalse(second.isRecording)
    await second.finish()
    guard case .saved(let record) = second.state else { return XCTFail("not saved: \(second.state)") }
    XCTAssertNil(record.healthWorkoutUUID)
    XCTAssertEqual(record.parts[0].rounds, 1)
    XCTAssertFalse(recorder.calls.contains { $0.hasPrefix("finish") })
  }

  func testOrphanHealthSessionIsSavedNotDropped() async {
    recorder.liveSession = true
    let engine = engine()
    await engine.recover()
    XCTAssertEqual(engine.state, .idle)
    XCTAssertEqual(recorder.calls, ["recover inPart=false", "finish 0"])
  }

  func testFinishSavesSegmentsSyncIdentifierAndHeartRate() async throws {
    let engine = engine()
    try await engine.start(plan(part("B", .amrap, cap: 900, buyIn: true), part("C", .sets)), leadIn: 0)
    clock.advance(390)
    engine.advance()
    clock.advance(100)
    engine.advance()
    clock.advance(50)
    await engine.finish()
    guard case .saved(let record) = engine.state else { return XCTFail("not saved: \(engine.state)") }
    XCTAssertEqual(recorder.finishedSegments.map(\.kind), [.buyIn, .round])
    XCTAssertEqual(recorder.syncIdentifier, "hafa-workouts:\(record.clientSessionId.uuidString.lowercased())")
    XCTAssertEqual(record.parts.map(\.rounds), [1, 0])
    XCTAssertEqual(record.parts.map(\.skipped), [false, true])
    XCTAssertEqual(record.parts[0].activeSeconds, 540)
    XCTAssertEqual(record.parts[0].heartRate, .init(average: 158, max: 181))
    XCTAssertNil(record.parts[1].heartRate)
    XCTAssertEqual(record.heartRate?.max, 181)
    XCTAssertNil(store.load())
    XCTAssertEqual(outbox.records(), [record], "kept for the phone after the checkpoint is cleared")
  }

  func testFailedHealthSaveKeepsTheClassForRetry() async throws {
    let engine = engine()
    try await engine.start(twoParts, leadIn: 0)
    clock.advance(30)
    recorder.failFinish = true
    await engine.finish()
    XCTAssertTrue(engine.state.isFailure)
    XCTAssertNotNil(store.load())
    try await engine.start(twoParts, leadIn: 0)
    XCTAssertTrue(engine.state.isFailure, "a new class never replaces one that isn't saved")
    recorder.failFinish = false
    await engine.finish()
    guard case .saved = engine.state else { return XCTFail("retry didn't save") }
  }

  func testSaveWithoutHealthKeepsTheScores() async throws {
    let engine = engine()
    try await engine.start(twoParts, leadIn: 0)
    clock.advance(30)
    engine.advance()
    recorder.failFinish = true
    await engine.finish()
    await engine.finish(withoutHealth: true)
    guard case .saved(let record) = engine.state else { return XCTFail("not saved: \(engine.state)") }
    XCTAssertEqual(record.parts[0].rounds, 1)
    XCTAssertNil(record.healthWorkoutUUID)
    XCTAssertEqual(recorder.calls.last, "discard")
    XCTAssertEqual(outbox.records().count, 1)
  }

  func testScoreCorrectionsSurviveRelaunchAndOutboxSave() async throws {
    let first = engine()
    try await first.start(twoParts, leadIn: 0)
    clock.advance(20)
    first.advance()
    let score = PartScore(rounds: 4, reps: 7, seconds: 20, scaled: true)
    first.setScore(score, for: 0)
    XCTAssertEqual(store.load()?.runner.runs[0].score, score)
    let second = engine()
    await second.recover()
    await second.finish()
    XCTAssertEqual(outbox.records().first?.parts[0].score, score)
    XCTAssertEqual(outbox.records().first?.parts[0].rounds, 1, "recorded taps stay intact")
  }

  func testEditsAfterFailedSavePersistAndSkipRemainsMarked() async throws {
    let engine = engine()
    try await engine.start(twoParts, leadIn: 0)
    clock.advance(20); engine.endPart()
    recorder.failFinish = true
    await engine.finish()
    let score = PartScore(rounds: 3, reps: 9, seconds: 19, scaled: true)
    engine.setScore(score, for: 0)
    XCTAssertEqual(store.load()?.runner.runs[0].score, score)
    await engine.finish(withoutHealth: true)
    XCTAssertEqual(outbox.records().first?.parts[0].score, score)
    XCTAssertEqual(outbox.records().first?.parts[0].skipped, true)
  }

  func testEmptyPlanAndBeginFailureRetainStartErrorWithoutStartingRunner() async {
    let engine = engine()
    do { try await engine.start(plan(), leadIn: 0); XCTFail("empty plan accepted") } catch {}
    XCTAssertNotNil(engine.startError)
    XCTAssertEqual(recorder.calls, ["recover inPart=false"])
    recorder.failBegin = true
    do { try await engine.start(twoParts, leadIn: 0); XCTFail("begin should fail") } catch {}
    XCTAssertEqual(engine.state, .idle)
    XCTAssertNotNil(engine.startError)
    XCTAssertNil(engine.runner)
  }

  func testUndoFinalRoundAfterRelaunchDoesNotCloseOrDuplicateHealthActivities() async throws {
    let first = engine()
    try await first.start(plan(part("A", .forTime, rounds: 1), part("B", .sets)), leadIn: 0)
    clock.advance(20)
    first.advance()
    XCTAssertEqual(recorder.calls, ["recover inPart=false", "begin 11 0", "part A 0"])
    recorder.liveSession = true
    let second = engine()
    await second.recover()
    clock.advance(2)
    XCTAssertTrue(second.undo())
    XCTAssertEqual(second.runner?.cursor, 0)
    XCTAssertEqual(second.runner?.runs[0].taps.count, 0)
    XCTAssertEqual(recorder.calls, ["recover inPart=false", "begin 11 0", "part A 0", "recover inPart=true"])
    await second.finish()
    XCTAssertEqual(recorder.finishedSegments, [])
    XCTAssertEqual(recorder.calls.filter { $0.hasPrefix("end part") }, ["end part 22"])
  }

  func testUndoRestAdvanceUsesOriginalClockAndKeepsImmediatePause() async throws {
    let engine = engine()
    try await engine.start(twoParts, leadIn: 0)
    clock.advance(60); engine.tick()
    clock.advance(5); engine.advance()
    clock.advance(1); engine.pause()
    XCTAssertEqual(recorder.calls.last, "pause")
    clock.advance(2)
    XCTAssertTrue(engine.undo())
    XCTAssertEqual(engine.runner?.phase, .resting(until: at(90)))
    XCTAssertNotNil(engine.runner?.pausedAt)
    engine.resume()
    XCTAssertEqual(engine.runner?.phase, .resting(until: at(92)))
    XCTAssertFalse(recorder.calls.contains("part B 65"))
  }

  func testSavingCommitsDeferredBoundaryOnce() async throws {
    let engine = engine()
    try await engine.start(plan(part("A", .forTime, rounds: 1)), leadIn: 0)
    clock.advance(20); engine.advance()
    await engine.finish()
    XCTAssertEqual(recorder.calls.filter { $0.hasPrefix("end part") }, ["end part 20"])
    XCTAssertEqual(outbox.records().first?.parts[0].rounds, 1)
  }

  func testStartingTwiceAtOnceBeginsOneSession() async throws {
    let engine = engine()
    async let first: Void = engine.start(twoParts, leadIn: 0)
    async let second: Void = engine.start(twoParts, leadIn: 0)
    _ = try await (first, second)
    XCTAssertEqual(recorder.calls.filter { $0.hasPrefix("begin") }.count, 1)
  }

  func testLostSessionStopsRecordingButKeepsTheClass() async throws {
    let engine = engine()
    try await engine.start(twoParts, leadIn: 0)
    recorder.onSessionLost?()
    XCTAssertFalse(engine.isRecording)
    XCTAssertEqual(store.load()?.isRecording, false)
    clock.advance(30)
    XCTAssertEqual(engine.advance(), .applied(.round(1)))
    XCTAssertFalse(recorder.calls.contains("part A 30"))
  }
}

final class ManualClock: Clock {
  var now = t0
  func advance(_ seconds: TimeInterval) { now = now.addingTimeInterval(seconds) }
}

@MainActor
final class FakeRecorder: WorkoutRecorder {
  var calls: [String] = []
  var onSessionLost: (() -> Void)?
  var liveSession = false
  var isRecording = false
  var collectionEnded = false
  var eventsAdded = false
  var onEventsAdded: (() -> Void)?
  var addEventsBeforeFailure = false
  var eventBatches = 0
  func restoreEventsAdded(_ added: Bool) { eventsAdded = added }
  var onCollectionEnded: (() -> Void)?
  var loseDuringBegin = false
  var endCollectionBeforeFailure = false
  func restoreCollectionEnded(_ ended: Bool) { collectionEnded = ended }
  var failFinish = false
  var failBegin = false
  var finishedSegments: [Segment] = []
  var syncIdentifier: String?

  func begin(activityType: UInt, at date: Date) async throws {
    if failBegin { throw CocoaError(.fileReadUnknown) }
    calls.append("begin \(activityType) \(offset(date))")
    await Task.yield()
    isRecording = !loseDuringBegin
  }
  func recover(inPart: Bool) async throws -> Bool {
    calls.append("recover inPart=\(inPart)")
    isRecording = liveSession
    return liveSession
  }
  func beginPart(_ part: WatchPlan.Part, at date: Date) { calls.append("part \(part.label) \(offset(date))") }
  func endPart(at date: Date) { calls.append("end part \(offset(date))") }
  func pause() { calls.append("pause") }
  func resume() { calls.append("resume") }
  func finish(at date: Date, segments: [Segment], syncIdentifier: String) async throws -> RecordedSummary {
    if endCollectionBeforeFailure { collectionEnded = true; onCollectionEnded?() }
    if addEventsBeforeFailure && !eventsAdded {
      eventBatches += 1; eventsAdded = true; onEventsAdded?()
    }
    if failFinish { throw CocoaError(.fileWriteUnknown) }
    calls.append("finish \(offset(date))")
    finishedSegments = segments
    self.syncIdentifier = syncIdentifier
    return RecordedSummary(
      workoutUUID: UUID(), heartRate: .init(average: 150, max: 181), parts: ["block-B": .init(average: 158, max: 181)])
  }
  func discard() async { calls.append("discard"); isRecording = false; liveSession = false }

  private func offset(_ date: Date) -> Int { Int(date.timeIntervalSince(t0).rounded()) }
}

