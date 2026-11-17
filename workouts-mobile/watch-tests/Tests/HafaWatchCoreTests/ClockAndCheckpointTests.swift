import XCTest
@testable import HafaWatchCore

final class ClockAndCheckpointTests: XCTestCase {
  func testSpanSubtractsClosedAndOpenPauses() {
    var span = Span(start: t0, pauses: [.init(at: at(10), until: at(15))])
    XCTAssertEqual(span.active(at: at(30)), 25)
    span.pauses.append(.init(at: at(40)))
    XCTAssertEqual(span.active(at: at(100)), 35)
    span.closePause(at: at(50))
    span.end = at(60)
    XCTAssertEqual(span.active(at: at(500)), 45)
  }

  func testPlanDecodesThePhonesSnakeCasePayload() throws {
    let json = """
      {"plan_key":"2026-11-17","title":"BUILD | BRIK","activity_type":11,"parts":[
        {"block_id":"b1","label":"B","kind":"amrap","cap_seconds":900,"rest_after_seconds":180,"scored":true,
         "moves":[{"index":0,"text":"Run 1000 m","segment":"buy_in","is_run":true,"distance_m":1000}]},
        {"block_id":"b2","label":"C","kind":"work_rest","work_seconds":40,"rest_seconds":20,"rounds":8,"scored":false,"moves":[]}]}
      """
    let plan = try WatchPlan.decode(Data(json.utf8))
    XCTAssertEqual(plan.parts[0].kind, .amrap)
    XCTAssertTrue(plan.parts[0].hasBuyIn)
    XCTAssertEqual(plan.parts[0].restAfter, 180)
    XCTAssertEqual(plan.parts[0].moves[0].distanceM, 1000)
    XCTAssertEqual(plan.parts[1].timeLimit, 460)
  }

  func testCheckpointRoundTripsAndRejectsOtherVersions() throws {
    let store = CheckpointStore(url: temporaryURL())
    XCTAssertNil(store.load())
    var runner = PartRunner(plan: plan(part("A", .amrap, cap: 600, buyIn: true)), leadIn: 3)
    _ = runner.start(at: t0)
    _ = runner.tick(at: at(5))
    _ = runner.advance(at: at(200))
    let checkpoint = Checkpoint(sessionID: UUID(), startedAt: t0, runner: runner, isRecording: true)
    try store.save(checkpoint)
    XCTAssertEqual(store.load(), checkpoint)

    var future = checkpoint
    future.version = 2
    try store.save(future)
    XCTAssertNil(store.load())
    store.clear()
    XCTAssertFalse(FileManager.default.fileExists(atPath: store.url.path))
  }

  func testUnreadableCheckpointLoadsAsNothing() throws {
    let store = CheckpointStore(url: temporaryURL())
    try FileManager.default.createDirectory(at: store.url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data("{not json".utf8).write(to: store.url)
    XCTAssertNil(store.load())
  }
}

func temporaryURL() -> URL {
  FileManager.default.temporaryDirectory.appendingPathComponent("hafa-watch-tests/\(UUID().uuidString)/active-class.json")
}
