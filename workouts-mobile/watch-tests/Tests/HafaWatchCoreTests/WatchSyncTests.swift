import XCTest
@testable import HafaWatchCore

final class WatchSyncTests: XCTestCase {
  func testPhoneEncodedContextDecodesOnTheWatchWithinBudget() throws {
    let url = try XCTUnwrap(Bundle.module.url(forResource: "watch-plans-v1", withExtension: "json", subdirectory: "Fixtures"))
    let data = try Data(contentsOf: url)
    XCTAssertLessThan(data.count, 16 * 1024)
    let decoder = JSONDecoder(); decoder.keyDecodingStrategy = .convertFromSnakeCase
    let context = try decoder.decode(PlanLibrary.Context.self, from: data)
    let plan = try XCTUnwrap(context.plans.first)
    XCTAssertEqual(plan.title, "Morning class")
    XCTAssertEqual(plan.source?.workoutRevision, 1)
    XCTAssertEqual(plan.accountKey, "synthetic:1")
    XCTAssertEqual(plan.parts.map(\.kind), [.amrap, .amrap, .sets, .sets])
    XCTAssertEqual(plan.parts[0].moves.first?.segment, "buy_in")
    XCTAssertEqual(plan.parts.last?.actuals?.count, 6)
  }
  func testInboxSurvivesRelaunchAndReplaysWithoutOverwriting() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let inbox = WatchInbox(directory: dir)
    let id = UUID().uuidString.lowercased()
    let json = "{\"v\":1,\"recorded_on\":\"watch\",\"client_session_id\":\"\(id)\",\"value\":1}"
    XCTAssertEqual(try inbox.receive(json), id)
    _ = try inbox.receive(json.replacingOccurrences(of: "\"value\":1", with: "\"value\":2"))
    XCTAssertEqual(try WatchInbox(directory: dir).pending(), [json])
    try inbox.markImported(id)
    _ = try inbox.receive(json)
    XCTAssertEqual(try inbox.pending(), [])
    XCTAssertThrowsError(try inbox.markImported("../escape"))
    XCTAssertThrowsError(try inbox.receive("{}"))
  }
  func testOutboxDeletesOnlyAcknowledgedRecordAndPayloadUsesISOKeys() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let box = ClassOutbox(directory: dir)
    let record = ClassRecord(clientSessionId: UUID(), planKey: "test", startedAt: Date(timeIntervalSince1970: 100),
      finishedAt: Date(timeIntervalSince1970: 200), parts: [], segments: [], healthWorkoutUUID: UUID())
    try box.add(record)
    let wire = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(record.payload().utf8)) as? [String: Any])
    XCTAssertEqual(wire["v"] as? Int, 1)
    XCTAssertEqual(wire["recorded_on"] as? String, "watch")
    XCTAssertEqual(wire["started_at"] as? String, "1970-01-01T00:01:40Z")
    XCTAssertNotNil(wire["health_workout_uuid"])
    try box.acknowledge(UUID().uuidString)
    XCTAssertEqual(box.records().count, 1)
    try box.acknowledge(record.clientSessionId.uuidString)
    XCTAssertEqual(box.records().count, 0)
  }
  func testWatchResultPreservesRoundIdentityDoseAndOnlyConfirmedBuyIn() throws {
    var p = part("A", .amrap, cap: 900, buyIn: true)
    p.actuals = [
      .init(blockId: p.blockId, exerciseIndex: 0, roundIndex: 1, setIndex: 1, completed: true, distanceMeters: 1000),
      .init(blockId: p.blockId, exerciseIndex: 1, roundIndex: 1, setIndex: 1, completed: true, reps: 15, load: 20, loadUnit: "kg")]
    var plan = plan(p); plan.accountKey = "synthetic:1"
    let run = ClassRecord.Part(blockId: p.blockId, start: at(0), end: at(900), activeSeconds: 900,
      rounds: 2, buyInDoneAt: at(60), skipped: false, score: PartScore(rounds: 2, reps: 3, scaled: true))
    let record = ClassRecord(clientSessionId: UUID(), planKey: plan.planKey, startedAt: at(0), finishedAt: at(900),
      parts: [run], segments: [], plan: plan, activeIntervals: [.init(startedAt: at(0), endedAt: at(900))])
    let wire = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(record.payload().utf8)) as? [String: Any])
    let actuals = try XCTUnwrap(wire["actuals"] as? [[String: Any]])
    XCTAssertEqual(actuals.count, 3)
    XCTAssertEqual(actuals.filter { $0["round_index"] as? Int == 2 }.count, 1)
    XCTAssertEqual(actuals.filter { $0["exercise_index"] as? Int == 0 }.count, 1)
    XCTAssertTrue(actuals.allSatisfy { $0["load"] == nil })
    XCTAssertEqual((wire["results"] as? [[String: Any]])?.first?["reps"] as? Int, 3)
    XCTAssertNotNil(wire["active_intervals"])
  }
  func testPlansRejectWrongVersionAndOversizeWithoutReplacingCache() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: dir) }
    let url = dir.appendingPathComponent("context.json")
    let valid = Data("{\"v\":1,\"plans\":[],\"account_key\":\"synthetic:1\"}".utf8)
    try PlanLibrary.receive(valid, at: url)
    XCTAssertThrowsError(try PlanLibrary.receive(Data("{\"v\":2,\"plans\":[]}".utf8), at: url))
    XCTAssertThrowsError(try PlanLibrary.receive(Data(("{\"v\":1,\"plans\":[],\"pad\":\"" + String(repeating: "x", count: 16384) + "\"}").utf8), at: url))
    XCTAssertEqual(try Data(contentsOf: url), valid)
    var plan = PlanLibrary.openTimer; plan.date = "2026-11-17"
    XCTAssertEqual(PlanLibrary.ageLabel(plan, at: Date(timeIntervalSince1970: 1795046400)), "From Tue")
  }
}
