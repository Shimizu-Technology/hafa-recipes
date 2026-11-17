import XCTest
@testable import HafaWatchCore

final class PartRunnerTests: XCTestCase {
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
    XCTAssertEqual(runner.advance(at: at(30)).1, [.partEnded(0, at(11))])
    XCTAssertEqual(runner.advance(at: at(31)).0, .applied(.startedPart))
    XCTAssertEqual(runner.phase, .leadIn(until: at(34)))
  }

  func testSkippingAndFinishingEarlyMarksUnreachedParts() {
    var runner = PartRunner(plan: plan(part("C", .sets), part("D", .sets), part("E", .sets)), leadIn: 3)
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
