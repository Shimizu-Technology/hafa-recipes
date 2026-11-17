import Foundation

/// The class in progress, written on every press and at least every 5 seconds, so a crash or
/// relaunch brings back the part, rounds and clock.
struct Checkpoint: Codable, Equatable {
  static let currentVersion = 1

  var version = Checkpoint.currentVersion
  var sessionID: UUID
  var startedAt: Date
  var runner: PartRunner
  /// False once HealthKit has lost the session; the class then finishes without a Health workout.
  var isRecording: Bool
}

struct CheckpointStore {
  let url: URL

  /// Application Support/hafa-watch/active-class.json, kept until the class is saved or discarded.
  static func standard() -> CheckpointStore {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return CheckpointStore(url: base.appendingPathComponent("hafa-watch/active-class.json"))
  }

  func save(_ checkpoint: Checkpoint) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    var options: Data.WritingOptions = [.atomic]
    #if os(watchOS)
    options.insert(.completeFileProtectionUntilFirstUserAuthentication)
    #endif
    try JSONEncoder().encode(checkpoint).write(to: url, options: options)
  }

  /// Nil when no class is in progress, or the file is unreadable or from another version.
  func load() -> Checkpoint? {
    guard let data = try? Data(contentsOf: url),
      let checkpoint = try? JSONDecoder().decode(Checkpoint.self, from: data),
      checkpoint.version == Checkpoint.currentVersion
    else { return nil }
    return checkpoint
  }

  func clear() {
    try? FileManager.default.removeItem(at: url)
  }
}
