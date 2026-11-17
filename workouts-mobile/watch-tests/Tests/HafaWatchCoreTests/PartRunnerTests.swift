import XCTest
@testable import HafaWatchCore

final class PartRunnerTests: XCTestCase {
  func testViewTickTransitionStillGuardsTheFollowingPress() throws {
    for delay in [0.0, 0.3, 0.599] {
      var runner = PartRunner(plan: plan(part("A", .amrap, cap: 10), part("B", .amrap, cap: 60)), leadIn: 0)
      _ = runner.start(at: t0)
      _ = runner.tick(at: at(10))
      let data = try JSONEncoder().encode(runner)
      runner = try JSONDecoder().decode(PartRunner.self, from: data)
      XCTAssertEqual(runner.advance(at: at(10 + delay)).0, .ignored(.stateChanged))
      XCTAssertEqual(runner.runs[1].taps.count, 0)
      XCTAssertEqual(runner.advance(at: at(10.61)).0, .applied(.round(1)))
    }
  }

  func testOldCatchUpAppliesPressButFreshTransitionIsProtected() {
    let fixture = plan(part("A", .amrap, cap: 60), part("B", .amrap, cap: 600))
    var old = PartRunner(plan: fixture, leadIn: 0)
    _ = old.start(at: t0)
    let (result, events) = old.advance(at: at(200))
    XCTAssertEqual(result, .applied(.round(1)))
    XCTAssertEqual(old.runs[1].taps.count, 1)
    XCTAssertEqual(events, [.partEnded(0, at(60)), .partBegan(1, at(60))])
    var fresh = PartRunner(plan: fixture, leadIn: 0)
    _ = fresh.start(at: t0)
    XCTAssertEqual(fresh.advance(at: at(60.2)).0, .ignored(.stateChanged))
    XCTAssertEqual(fresh.runs[1].taps.count, 0)
  }

  func testOpenPartsCompleteSuccessfullyByActionAndPartDone() {
    for kind in [WatchPlan.Part.Kind.forTime, .sets] {
      var runner = PartRunner(plan: plan(part("A", kind)), leadIn: 0)
      _ = runner.start(at: t0)
      XCTAssertEqual(runner.advance(at: at(20)).0, .applied(.partDone))
      XCTAssertFalse(runner.runs[0].skipped)
      var manual = PartRunner(plan: plan(part("A", kind)), leadIn: 0)
      _ = manual.start(at: t0)
      XCTAssertEqual(manual.completePart(at: at(30)), [.partEnded(0, at(30)), .finished(at(30))])
      XCTAssertFalse(manual.runs[0].skipped)
      var skip = PartRunner(plan: plan(part("A", kind)), leadIn: 0)
      _ = skip.start(at: t0)
      _ = skip.endPart(at: at(30))
      XCTAssertTrue(skip.runs[0].skipped)
    }
  }

  func testLeadInIsNotPartTime() {
    var runner = PartRunner(plan: plan(part("A", .amrap, cap: 600)), leadIn: 3)
    XCTAssertEqual(runner.start(at: t0), [])
    XCTAssertEqual(runner.phase, .leadIn(until: at(3)))
    XCTAssertEqual(runner.tick(at: at(4)), [.partBegan(0, at(3))])
    XCTAssertEqual(runner.activeSeconds(of: 0, at: at(13)), 10)
    XCTAssertEqual(runner.remaining(at: at(13)), 590)
  }

  func testLateTickEndsPartAtItsCapAndCatchesUpThroughRestAndLeadIn() {
    var runner = PartRunner(
      plan: plan(part("A", .amrap, cap: 60, restAfter: 180), part("B", .amrap, cap: 900)), leadIn: 3)
    _ = runner.start(at: t0)
    // Suspended for six minutes: A's cap, the rest and B's lead-in all passed.
    let events = runner.tick(at: at(400))
    XCTAssertEqual(events, [.partBegan(0, at(3)), .partEnded(0, at(63)), .partBegan(1, at(246))])
    XCTAssertEqual(runner.cursor, 1)
    XCTAssertEqual(runner.activeSeconds(of: 1, at: at(400)), 154)
  }

  func testBuyInThenRoundsBecomeSegments() {
    var runner = PartRunner(plan: plan(part("B", .amrap, cap: 900, buyIn: true)), leadIn: 0)
    XCTAssertEqual(runner.start(at: t0), [.partBegan(0, t0)])
    XCTAssertEqual(runner.advance(at: at(390)).0, .applied(.buyInDone))
    XCTAssertEqual(runner.advance(at: at(500)).0, .applied(.round(1)))
    XCTAssertEqual(runner.advance(at: at(610)).0, .applied(.round(2)))
    XCTAssertEqual(runner.segments().map(\.kind), [.buyIn, .round, .round])
    XCTAssertEqual(runner.segments().map(\.end), [at(390), at(500), at(610)])
    XCTAssertEqual(runner.segments()[1].start, at(390))
  }

  func testPressesInside600msCountOnce() {
    var runner = PartRunner(plan: plan(part("A", .amrap, cap: 600)), leadIn: 0)
    _ = runner.start(at: t0)
    XCTAssertEqual(runner.advance(at: at(30)).0, .applied(.round(1)))
    XCTAssertEqual(runner.advance(at: at(30.4)).0, .ignored(.tooSoon))
    XCTAssertEqual(runner.advance(at: at(30.7)).0, .applied(.round(2)))
  }

  func testForTimeEndsOnTheLastRound() {
    var runner = PartRunner(plan: plan(part("A", .forTime, cap: 720, rounds: 2), part("C", .sets)), leadIn: 0)
    _ = runner.start(at: t0)
    _ = runner.advance(at: at(200))
    let (result, events) = runner.advance(at: at(410))
    XCTAssertEqual(result, .applied(.partDone))
    XCTAssertEqual(events, [.partEnded(0, at(410)), .partBegan(1, at(410))])
  }

  func testClockDrivenPartsIgnoreAdvance() {
    var emom = part("A", .emom)
    emom.intervalSeconds = 60
    emom.intervals = 10
    XCTAssertEqual(emom.timeLimit, 600)
    var runner = PartRunner(plan: plan(emom), leadIn: 0)
    _ = runner.start(at: t0)
    XCTAssertEqual(runner.advance(at: at(5)).0, .ignored(.clockDriven))
  }

  func testPausedTimeDoesNotCountTowardTheCap() {
    var runner = PartRunner(plan: plan(part("A", .amrap, cap: 60)), leadIn: 0)
    _ = runner.start(at: t0)
    XCTAssertEqual(runner.pause(at: at(20)), [.paused(at(20))])
    XCTAssertEqual(runner.tick(at: at(100)), [])
    XCTAssertEqual(runner.advance(at: at(100)).0, .ignored(.paused))
    XCTAssertEqual(runner.resume(at: at(120)), [.resumed(at(120))])
    XCTAssertEqual(runner.tick(at: at(200)), [.partEnded(0, at(160)), .finished(at(160))])
  }

  func testPauseExtendsRestAndRestartsLeadIn() {
    var runner = PartRunner(plan: plan(part("A", .amrap, cap: 10, restAfter: 60), part("B", .sets)), leadIn: 3)
    _ = runner.start(at: t0)
    _ = runner.tick(at: at(13))  // A ran 3–13; rest until 73.
    _ = runner.pause(at: at(30))
    _ = runner.resume(at: at(50))
    XCTAssertEqual(runner.phase, .resting(until: at(93)))
    _ = runner.tick(at: at(93))
    _ = runner.pause(at: at(94))
    _ = runner.resume(at: at(100))
    XCTAssertEqual(runner.phase, .leadIn(until: at(103)))
  }

  func testUndoTakesBackTheLastTapWithinTenSeconds() {
    var runner = PartRunner(plan: plan(part("A", .amrap, cap: 600, buyIn: true)), leadIn: 0)
    _ = runner.start(at: t0)
    _ = runner.advance(at: at(100))
    XCTAssertTrue(runner.undo(at: at(105)))
    XCTAssertNil(runner.runs[0].buyInDoneAt)
    _ = runner.advance(at: at(110))
    _ = runner.advance(at: at(200))
    XCTAssertFalse(runner.undo(at: at(211)))
    XCTAssertEqual(runner.runs[0].taps.count, 1)
  }

  func testAdvanceDuringRestStartsTheNextLeadIn() {
    var runner = PartRunner(plan: plan(part("A", .amrap, cap: 10, restAfter: 180), part("B", .sets)), leadIn: 3)
    _ = runner.start(at: t0)
    XCTAssertEqual(runner.advance(at: at(1)).0, .applied(.startedPart))
    XCTAssertEqual(runner.advance(at: at(11.2)).1, [.partEnded(0, at(11))])
    XCTAssertEqual(runner.advance(at: at(31)).0, .applied(.startedPart))
    XCTAssertEqual(runner.phase, .leadIn(until: at(34)))
  }

  func testRestExtensionAndSetsRestRespectPause() {
    var sets = part("B", .sets, rounds: 2)
    sets.restSeconds = 20
    var runner = PartRunner(plan: plan(part("A", .amrap, cap: 10, restAfter: 30), sets), leadIn: 0)
    _ = runner.start(at: t0)
    _ = runner.tick(at: at(10))
    runner.extendRest(by: 15)
    XCTAssertEqual(runner.phase, .resting(until: at(55)))
    _ = runner.tick(at: at(55))
    _ = runner.advance(at: at(60))
    _ = runner.pause(at: at(65))
    _ = runner.resume(at: at(85))
    XCTAssertEqual(runner.setRestRemaining(at: at(90)), 10)
    XCTAssertEqual(runner.advance(at: at(100)).0, .applied(.partDone))
  }

  func testCorrectedTimeChangesCapStatus() {
    let timed = part("A", .forTime, cap: 300)
    var score = PartScore(seconds: 300)
    XCTAssertTrue(score.isCapped(for: timed))
    score.seconds -= 1
    XCTAssertFalse(score.isCapped(for: timed))
  }

  func testSetsWithBuyInCountOnlyWorkingMoves() {
    var runner = PartRunner(plan: plan(part("A", .sets, rounds: 2, buyIn: true)), leadIn: 0)
    _ = runner.start(at: t0)
    XCTAssertEqual(runner.advance(at: at(1)).0, .applied(.buyInDone))
    XCTAssertEqual(runner.advance(at: at(2)).0, .applied(.setDone(1)))
    XCTAssertEqual(runner.advance(at: at(3)).0, .applied(.partDone))
    XCTAssertEqual(runner.segments().map(\.kind), [.buyIn, .set, .set])
    XCTAssertEqual(PartRunner(plan: plan(), leadIn: 0).activeSeconds(of: 0, at: t0), 0)
  }

  func testUndoLeadInRestAndFinalSetTransitions() throws {
    var runner = PartRunner(plan: plan(part("A", .forTime, rounds: 1, restAfter: 30), part("B", .sets, rounds: 1)), leadIn: 3)
    _ = runner.start(at: t0)
    _ = runner.advance(at: at(1))
    XCTAssertTrue(runner.undo(at: at(2)))
    XCTAssertEqual(runner.phase, .leadIn(until: at(3)))
    _ = runner.tick(at: at(3))
    _ = runner.advance(at: at(10))
    XCTAssertEqual(runner.cursor, 1)
    XCTAssertTrue(runner.undo(at: at(12)))
    XCTAssertEqual(runner.cursor, 0)
    XCTAssertEqual(runner.phase, .running)
    _ = runner.advance(at: at(15))
    _ = runner.advance(at: at(16)) // skip rest
    XCTAssertTrue(runner.undo(at: at(17)))
    XCTAssertEqual(runner.phase, .resting(until: at(45)))
    _ = runner.tick(at: at(48))
    _ = runner.advance(at: at(49))
    guard case .finished = runner.phase else { return XCTFail("last set didn't finish") }
    let data = try JSONEncoder().encode(runner)
    var relaunched = try JSONDecoder().decode(PartRunner.self, from: data)
    XCTAssertTrue(relaunched.undo(at: at(59)))
    XCTAssertEqual(relaunched.phase, .running)
    XCTAssertEqual(relaunched.runs[1].taps.count, 0)
  }

  func testUndoAfterCapReplaysTheUnadvancedTimeline() {
    var runner = PartRunner(plan: plan(part("A", .amrap, cap: 20, restAfter: 30), part("B", .sets)), leadIn: 0)
    _ = runner.start(at: t0)
    _ = runner.advance(at: at(15))
    _ = runner.tick(at: at(22))
    XCTAssertTrue(runner.undo(at: at(24)))
    XCTAssertEqual(runner.phase, .resting(until: at(50)))
    XCTAssertEqual(runner.runs[0].taps.count, 0)
  }

  func testDebounceBoundaryExpiryAndClockDrivenPressHaveNoUndo() {
    var runner = PartRunner(plan: plan(part("A", .amrap, cap: 600)), leadIn: 0)
    _ = runner.start(at: t0)
    _ = runner.advance(at: at(10))
    XCTAssertEqual(runner.advance(at: at(10.599)).0, .ignored(.tooSoon))
    XCTAssertEqual(runner.advance(at: at(10.601)).0, .applied(.round(2)))
    XCTAssertFalse(runner.undo(at: at(20.602)))
    var emom = part("B", .emom); emom.intervalSeconds = 10; emom.intervals = 2
    var timed = PartRunner(plan: plan(emom), leadIn: 0)
    _ = timed.start(at: t0)
    XCTAssertEqual(timed.advance(at: at(1)).0, .ignored(.clockDriven))
    XCTAssertFalse(timed.canUndo(at: at(1)))
  }

  func testIgnoredPauseAtFinishDoesNotPauseTheUndoTimeline() {
    var runner = PartRunner(plan: plan(part("A", .forTime, rounds: 1)), leadIn: 0)
    _ = runner.start(at: t0)
    _ = runner.advance(at: at(10))
    XCTAssertEqual(runner.pause(at: at(11)), [])
    XCTAssertTrue(runner.undo(at: at(12)))
    XCTAssertNil(runner.pausedAt)
    XCTAssertEqual(runner.activeSeconds(of: 0, at: at(12)), 12)
  }

  func testTodaysPlanRequiresLocalDateRatherThanFirstOrStalePlan() {
    let formatter = DateFormatter(); formatter.dateFormat = "yyyy-MM-dd"
    var today = plan(part("A", .sets)); today.date = formatter.string(from: t0)
    var stale = today; stale.date = "2000-01-01"
    XCTAssertEqual(PlanLibrary.todaysPlan(in: [stale, today], at: t0), today)
    XCTAssertNil(PlanLibrary.todaysPlan(in: [stale], at: t0))
  }

  func testSkippingAndFinishingEarlyMarksUnreachedParts() {
    var runner = PartRunner(plan: plan(part("C", .sets), part("D", .sets, rounds: 2), part("E", .sets)), leadIn: 3)
    _ = runner.start(at: t0)
    XCTAssertEqual(runner.endPart(at: at(1)), [])
    XCTAssertTrue(runner.runs[0].skipped)
    _ = runner.tick(at: at(4))
    _ = runner.advance(at: at(60))
    XCTAssertEqual(runner.finish(at: at(90)), [.partEnded(1, at(90)), .finished(at(90))])
    XCTAssertEqual(runner.runs.map(\.skipped), [true, false, true])
    XCTAssertEqual(runner.segments().map(\.kind), [.set])
  }
}
