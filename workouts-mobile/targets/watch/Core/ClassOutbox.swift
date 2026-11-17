import Foundation

/// What the watch keeps after a class is saved. X5 turns it into the WatchResult payload for the phone.
struct ClassRecord: Codable, Equatable {
  struct Part: Codable, Equatable {
    var blockId: String
    var start: Date?
    var end: Date?
    var activeSeconds: Double
    var rounds: Int
    var buyInDoneAt: Date?
    var skipped: Bool
    var heartRate: HeartRateSummary?
    var score: PartScore?
  }

  var clientSessionId: UUID
  var planKey: String
  var startedAt: Date
  var finishedAt: Date
  var parts: [Part]
  var segments: [Segment]
  var heartRate: HeartRateSummary?
  var healthWorkoutUUID: UUID?
}

/// Saved classes waiting for the phone, one file each. A class is written here before its checkpoint
/// is cleared, so scores survive a relaunch. X5 sends them and deletes each file after the phone's ack.
struct ClassOutbox {
  let directory: URL

  static func standard() -> ClassOutbox {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return ClassOutbox(directory: base.appendingPathComponent("hafa-watch/outbox"))
  }

  func add(_ record: ClassRecord) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var options: Data.WritingOptions = [.atomic]
    #if os(watchOS)
    options.insert(.completeFileProtectionUntilFirstUserAuthentication)
    #endif
    let url = directory.appendingPathComponent("\(record.clientSessionId.uuidString.lowercased()).json")
    try JSONEncoder().encode(record).write(to: url, options: options)
  }

  func records() -> [ClassRecord] {
    let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
    return files.compactMap { try? JSONDecoder().decode(ClassRecord.self, from: Data(contentsOf: $0)) }
      .sorted { $0.finishedAt < $1.finishedAt }
  }
}
