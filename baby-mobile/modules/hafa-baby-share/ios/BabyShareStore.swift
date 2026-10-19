import Foundation
import CryptoKit
import Darwin

// One store is embedded in the extension and compiled into the host bridge.
// Immutable captures survive supersession. OS file leases protect a live producer
// or host read, including when that read exceeds the 24-hour orphan grace period.
final class BabyShareStore {
  static let expiry: TimeInterval = 24 * 60 * 60
  enum Failure: Error { case unavailable, invalid, stale }
  private final class Lease {
    let descriptor: Int32
    init(_ url: URL, exclusive: Bool, nonblocking: Bool = false) throws {
      descriptor = Darwin.open(url.path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, S_IRUSR | S_IWUSR)
      guard descriptor >= 0 else { throw Failure.unavailable }
      if flock(descriptor, (exclusive ? LOCK_EX : LOCK_SH) | (nonblocking ? LOCK_NB : 0)) != 0 {
        Darwin.close(descriptor)
        throw Failure.unavailable
      }
    }
    deinit { flock(descriptor, LOCK_UN); Darwin.close(descriptor) }
  }
  final class Capture {
    let id: String
    let directory: URL
    fileprivate let epoch: UUID
    fileprivate let createdAt: Date
    fileprivate var lease: AnyObject?
    fileprivate init(id: String, directory: URL, epoch: UUID, createdAt: Date, lease: AnyObject) {
      self.id = id; self.directory = directory; self.epoch = epoch; self.createdAt = createdAt; self.lease = lease
    }
  }
  struct Snapshot {
    let token: String
    let raw: Any
  }
  private struct Manifest: Codable {
    let id: String
    let epoch: UUID
    let createdAt: Date
    let text: Bool
    let payload: Data?
    var token: String? {
      payload.map { id + ":" + SHA256.hash(data: $0).map { String(format: "%02x", $0) }.joined() }
    }
  }
  private let container: URL, root: URL, captures: URL, defaults: UserDefaults
  private let sharedKey: String, receiptKey = "babyCaptureId"
  private let now: () -> Date
  private var consumers: [String: Lease] = [:]
  init(container: URL, defaults: UserDefaults, sharedKey: String = "hafababyShareKey", now: @escaping () -> Date = Date.init) {
    self.container = container.standardizedFileURL.resolvingSymlinksInPath()
    self.root = self.container.appendingPathComponent(".hafa-baby-share-store-v1", isDirectory: true)
    self.captures = root.appendingPathComponent("captures", isDirectory: true)
    self.defaults = defaults; self.sharedKey = sharedKey; self.now = now
  }
  private func protect(_ url: URL) throws {
    #if os(iOS)
    try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
    #endif
  }
  private func locked<T>(_ work: () throws -> T) throws -> T {
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try protect(root)
    let lock = try Lease(root.appendingPathComponent("store.lock"), exclusive: true)
    return try withExtendedLifetime(lock) { try work() }
  }
  private func directory(_ id: String) throws -> URL {
    guard UUID(uuidString: id) != nil, !id.contains("/") else { throw Failure.invalid }
    return captures.appendingPathComponent(id, isDirectory: true)
  }
  private func write<T: Encodable>(_ value: T, to url: URL) throws {
    var options: Data.WritingOptions = [.atomic]
    #if os(iOS)
    options.insert(.completeFileProtection)
    #endif
    try JSONEncoder().encode(value).write(to: url, options: options)
  }
  private func read<T: Decodable>(_ type: T.Type, _ url: URL) throws -> T {
    try JSONDecoder().decode(type, from: Data(contentsOf: url))
  }
  private func epoch() throws -> UUID {
    let url = root.appendingPathComponent("epoch.json")
    if FileManager.default.fileExists(atPath: url.path) { return try read(UUID.self, url) }
    let value = UUID(); try write(value, to: url); return value
  }
  private func currentID() -> String? { try? read(String.self, root.appendingPathComponent("current.json")) }
  private func manifest(_ id: String) throws -> Manifest {
    let value = try read(Manifest.self, directory(id).appendingPathComponent("manifest.json"))
    guard value.id == id else { throw Failure.invalid }; return value
  }
  private func beginLocked(id: String) throws -> Capture {
    let folder = try directory(id)
    guard !FileManager.default.fileExists(atPath: folder.path) else { throw Failure.invalid }
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    try protect(folder)
    let lease = try Lease(folder.appendingPathComponent("lease.lock"), exclusive: false)
    let generation = try epoch(), date = now()
    try write(Manifest(id: id, epoch: generation, createdAt: date, text: false, payload: nil), to: folder.appendingPathComponent("manifest.json"))
    return Capture(id: id, directory: folder, epoch: generation, createdAt: date, lease: lease)
  }
  func begin(id: String = UUID().uuidString) throws -> Capture {
    try locked { try sweepLocked(); return try beginLocked(id: id) }
  }
  private func bytes(_ raw: Any) throws -> (Data, Bool) {
    if let text = raw as? [String] { return (try JSONEncoder().encode(text), true) }
    if let data = raw as? Data,
      (try? JSONSerialization.jsonObject(with: data)) is [[String: Any]] { return (data, false) }
    throw Failure.invalid
  }
  private func publishLocked(_ raw: Any, capture: Capture) throws {
    guard capture.epoch == (try epoch()), capture.lease != nil else { throw Failure.stale }
    let (payload, text) = try bytes(raw)
    let value = Manifest(id: capture.id, epoch: capture.epoch, createdAt: capture.createdAt, text: text, payload: payload)
    try write(value, to: capture.directory.appendingPathComponent("manifest.json"))
    try write(capture.id, to: root.appendingPathComponent("current.json"))
    // Keep the stock share-intent reader compatible. The native bridge uses the
    // immutable manifest, so these two legacy keys are never a token transaction.
    defaults.set(raw, forKey: sharedKey); defaults.set(capture.id, forKey: receiptKey); defaults.synchronize()
  }
  func publish(_ raw: Any, capture: Capture) throws { try locked { try publishLocked(raw, capture: capture) } }
  func publish(_ raw: Any, id: String) throws {
    let capture = try begin(id: id)
    do { try publish(raw, capture: capture) }
    catch { try? abort(capture); throw error }
  }
  func abort(_ capture: Capture) throws {
    try locked {
      guard currentID() != capture.id else { return }
      try? FileManager.default.removeItem(at: capture.directory)
      capture.lease = nil
    }
  }
  private func snapshot(_ value: Manifest) throws -> Snapshot {
    guard let payload = value.payload, let token = value.token else { throw Failure.invalid }
    let raw: Any = value.text ? try JSONDecoder().decode([String].self, from: payload) : payload
    if consumers[token] == nil {
      consumers[token] = try Lease(directory(value.id).appendingPathComponent("lease.lock"), exclusive: false)
    }
    return Snapshot(token: token, raw: raw)
  }
  func pending() throws -> Snapshot? {
    try locked {
      try sweepLocked()
      if let id = currentID() {
        let value = try manifest(id)
        guard value.epoch == (try epoch()) else { throw Failure.stale }
        return try snapshot(value)
      }
      // Only an upgrade from the old store can migrate compatibility keys. Once
      // an epoch exists, stale cross-process defaults must not resurrect a clear.
      guard !FileManager.default.fileExists(atPath: root.appendingPathComponent("epoch.json").path) else { return nil }
      defaults.synchronize()
      guard let raw = defaults.object(forKey: sharedKey) else { return nil }
      let capture = try beginLocked(id: UUID().uuidString)
      try publishLocked(raw, capture: capture)
      return try snapshot(manifest(capture.id))
    }
  }
  func ownedFile(_ path: String) -> URL? {
    let parsed = URL(string: path)
    let file = (parsed?.isFileURL == true ? parsed! : container.appendingPathComponent(URL(fileURLWithPath: path).lastPathComponent))
      .standardizedFileURL.resolvingSymlinksInPath()
    let parent = file.deletingLastPathComponent()
    if parent == container || parent == container.appendingPathComponent("thumbnail") { return file }
    if parent.deletingLastPathComponent() == captures,
      UUID(uuidString: parent.lastPathComponent) != nil,
      !["manifest.json", "lease.lock"].contains(file.lastPathComponent) { return file }
    return nil
  }
  private func removeLegacyFiles(_ value: Manifest) throws {
    guard !value.text, let payload = value.payload,
      let rows = (try? JSONSerialization.jsonObject(with: payload)) as? [[String: Any]] else { return }
    for row in rows { for field in ["path", "thumbnail"] {
      guard let path = row[field] as? String, let file = ownedFile(path),
        file.deletingLastPathComponent() == container || file.deletingLastPathComponent() == container.appendingPathComponent("thumbnail")
      else { continue }
      if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    } }
  }
  func acknowledge(_ token: String) throws -> Bool {
    try locked {
      guard let id = token.split(separator: ":").first.map(String.init), UUID(uuidString: id) != nil,
        let value = try? manifest(id), value.token == token else { return false }
      consumers.removeValue(forKey: token)
      // No producer or another live reader may be using this capture's files.
      guard let lease = try? Lease(directory(id).appendingPathComponent("lease.lock"), exclusive: true, nonblocking: true)
      else { return false }
      return try withExtendedLifetime(lease) {
        try removeLegacyFiles(value)
        try FileManager.default.removeItem(at: directory(id))
        if currentID() == id {
          try FileManager.default.removeItem(at: root.appendingPathComponent("current.json"))
          defaults.removeObject(forKey: sharedKey); defaults.removeObject(forKey: receiptKey); defaults.synchronize()
        }
        return true
      }
    }
  }
  // Explicit privacy cleanup invalidates even an extension that is still loading.
  // The lock/epoch files contain no captured content and must retain their inode.
  func clear() throws {
    try locked {
      try write(UUID(), to: root.appendingPathComponent("epoch.json"))
      consumers.removeAll()
      if let folders = try? FileManager.default.contentsOfDirectory(at: captures, includingPropertiesForKeys: nil) {
        for folder in folders {
          if let value = try? manifest(folder.lastPathComponent) { try removeLegacyFiles(value) }
        }
      }
      if currentID() == nil, let raw = defaults.object(forKey: sharedKey), let (payload, text) = try? bytes(raw) {
        try removeLegacyFiles(Manifest(id: UUID().uuidString, epoch: try epoch(), createdAt: now(), text: text, payload: payload))
      }
      if FileManager.default.fileExists(atPath: captures.path) { try FileManager.default.removeItem(at: captures) }
      let pointer = root.appendingPathComponent("current.json")
      if FileManager.default.fileExists(atPath: pointer.path) { try FileManager.default.removeItem(at: pointer) }
      defaults.removeObject(forKey: sharedKey); defaults.removeObject(forKey: receiptKey); defaults.synchronize()
    }
  }
  private func sweepLocked() throws {
    guard FileManager.default.fileExists(atPath: captures.path) else { return }
    let current = currentID()
    for folder in try FileManager.default.contentsOfDirectory(at: captures, includingPropertiesForKeys: [.creationDateKey]) {
      guard UUID(uuidString: folder.lastPathComponent) != nil, folder.lastPathComponent != current else { continue }
      let created = (try? manifest(folder.lastPathComponent).createdAt) ?? (try? folder.resourceValues(forKeys: [.creationDateKey]).creationDate)
      guard let created, now().timeIntervalSince(created) >= Self.expiry,
        let lease = try? Lease(folder.appendingPathComponent("lease.lock"), exclusive: true, nonblocking: true)
      else { continue }
      do {
        try withExtendedLifetime(lease) {
          if let value = try? manifest(folder.lastPathComponent) { try removeLegacyFiles(value) }
          try FileManager.default.removeItem(at: folder)
        }
      } catch { /* Keep the manifest for a later cleanup attempt; never log private paths. */ }
    }
  }
}
