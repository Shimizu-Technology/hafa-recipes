import Foundation

/// Immutable files plus imported receipts survive delivery replay and JS relaunch.
struct WatchInbox {
  let directory: URL
  private func url(_ id: String) throws -> URL {
    guard let uuid = UUID(uuidString: id) else { throw CocoaError(.fileWriteInvalidFileName) }
    return directory.appendingPathComponent(uuid.uuidString.lowercased() + ".json")
  }
  func receive(_ json: String) throws -> String {
    guard let data = json.data(using: .utf8),
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      object["v"] as? Int == 1, object["recorded_on"] as? String == "watch",
      let id = object["client_session_id"] as? String else { throw CocoaError(.fileReadCorruptFile) }
    let file = try url(id)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    if !FileManager.default.fileExists(atPath: file.path) && !FileManager.default.fileExists(atPath: file.path + ".imported") {
      var options: Data.WritingOptions = [.atomic]
      #if os(iOS)
      options.insert(.completeFileProtectionUntilFirstUserAuthentication)
      #endif
      try data.write(to: file, options: options)
    }
    return id.lowercased()
  }
  func pending() throws -> [String] {
    guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
    try pruneReceipts()
    return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
      .filter { $0.pathExtension == "json" && !FileManager.default.fileExists(atPath: $0.path + ".imported") }
      .sorted { $0.lastPathComponent < $1.lastPathComponent }.map { try String(contentsOf: $0, encoding: .utf8) }
  }
  func purge(owner: String, account: String? = nil) throws {
    for json in try pending() {
      guard let object = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
        let plan = object["plan"] as? [String: Any], let key = plan["account_key"] as? String,
        let split = key.lastIndex(of: ":"), String(key[..<split]) == owner,
        account == nil || key == account else { continue }
      if let id = object["client_session_id"] as? String { try markImported(id) }
    }
  }
  func markImported(_ id: String) throws {
    let file = try url(id)
    // Retain only a content-free receipt, so replay never recreates an imported result.
    let receipt = URL(fileURLWithPath: file.path + ".imported")
    if !FileManager.default.fileExists(atPath: receipt.path) { try Data().write(to: receipt, options: .atomic) }
    if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    try pruneReceipts()
  }
  // Bounded replay protection: keep the latest 500 acknowledgements, never pending results.
  func pruneReceipts() throws {
    let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])
    var receipts: [(url: URL, date: Date)] = []
    for receipt in files where receipt.pathExtension == "imported" {
      let file = receipt.deletingPathExtension()
      if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
      let date = try receipt.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate ?? Date.distantPast
      receipts.append((url: receipt, date: date))
    }
    receipts.sort { a, b in
      if a.date == b.date { return a.url.lastPathComponent > b.url.lastPathComponent }
      return a.date > b.date
    }
    for (receipt, _) in receipts.dropFirst(500) {
      let file = receipt.deletingPathExtension()
      if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
      try FileManager.default.removeItem(at: receipt)
    }
  }
}

/// The absence of a retry file means an explicit, account-free empty context.
/// Queue confinement belongs to PhoneWatchLink, including observer callbacks.
struct WatchPlanCache {
  let url: URL
  static let empty = "{\"v\":1,\"plans\":[]}"
  func read() throws -> String {
    guard FileManager.default.fileExists(atPath: url.path) else { return Self.empty }
    return try String(contentsOf: url, encoding: .utf8)
  }
  func save(_ json: String) throws {
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    var options: Data.WritingOptions = [.atomic]
    #if os(iOS)
    options.insert(.completeFileProtectionUntilFirstUserAuthentication)
    #endif
    try Data(json.utf8).write(to: url, options: options)
  }
  func clear(push: () throws -> Void = {}) throws {
    if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    // The deleted retry file is durable. A watch that is absent/offline must not block cleanup.
    try? push()
  }
}

/// Expo can start/stop observing on a different queue from WCSession delivery.
/// Every access to the callback, including invocation, stays on this serial queue.
final class WatchChanges: @unchecked Sendable {
  private let queue = DispatchQueue(label: "hafa-watch.observer")
  private var changed: (() -> Void)?
  func observe(_ callback: (() -> Void)?) { queue.sync { changed = callback } }
  func notify() { queue.async { self.changed?() } }
  func flush() { queue.sync {} }
}
