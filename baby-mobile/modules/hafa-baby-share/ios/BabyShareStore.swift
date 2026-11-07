import Foundation
import CryptoKit
import Darwin

// One store is embedded in the extension and compiled into the host bridge.
// Immutable captures survive supersession. OS file leases protect a live producer
// or host read, including when that read exceeds the 24-hour orphan grace period.
final class BabyShareStore {
  static let expiry: TimeInterval = 24 * 60 * 60
  // How long a share kept under no account waits for someone to say it's theirs.
  static let unassignedExpiry: TimeInterval = 30 * 24 * 60 * 60
  // Past those 30 days a capture can't be seen or claimed. It goes from disk only once the clock has said so for this long,
  // to reduce losses from transient clock jumps. This is wall time, not a monotonic guarantee; backward corrections can also accelerate expiry.
  static let unassignedDeleteAfter: TimeInterval = 24 * 60 * 60
  enum Claim: String { case claimed, expired, refused }
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
    // Frozen when the share began, so the sheet can say what happened whatever changes later.
    let scope: String?
    let signedIn: Bool
    fileprivate let epoch: UUID
    fileprivate let createdAt: Date
    fileprivate let automaticEpoch: Int
    fileprivate var lease: AnyObject?
    fileprivate init(id: String, directory: URL, scope: String?, signedIn: Bool, epoch: UUID, createdAt: Date, automaticEpoch: Int, lease: AnyObject) {
      self.id = id; self.directory = directory; self.scope = scope; self.signedIn = signedIn; self.epoch = epoch; self.createdAt = createdAt; self.automaticEpoch = automaticEpoch; self.lease = lease
    }
  }
  struct Snapshot {
    let token: String
    let raw: Any
    let scope: String?
    let occurredAt: Date
    let automaticEpoch: Int
    let receipt: [String: String]?
    var claimed = false
    var recordID: String? = nil
  }
  struct Waiting {
    let snapshot: Snapshot
    let keptUntil: Date
    var blocked: String? = nil
  }
  private struct Manifest: Codable {
    let id: String
    var epoch: UUID
    let createdAt: Date
    let text: Bool
    let payload: Data?
    var scope: String? = nil
    var sequence: Int? = nil
    var automaticEpoch: Int? = nil
    // When a no-owner capture's clock started. One from an older build has none, so its clock starts when this build first
    // sees it and it can't be removed unseen.
    var heldSince: Date? = nil
    // When the clock first said its 30 days were up.
    var expiryNoticed: Date? = nil
    // Someone signed in and said this no-owner capture was theirs. It keeps its share time, and never counts as permission for AI.
    var claimed: Bool? = nil
    // The app can never take this one: `file_too_large`, `unsupported_file` or `unreadable`. It stays until removed, behind nothing and in front of nothing.
    var blocked: String? = nil
    // A lapsed login retains this owner tag, but only for the original 30-day window.
    var lapsed: Bool? = nil
    var recordID: String? = nil
    var token: String? {
      payload.map { id + ":" + SHA256.hash(data: $0 + Data((recordID ?? "").utf8)).map { String(format: "%02x", $0) }.joined() }
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
  func locked<T>(_ work: () throws -> T) throws -> T {
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try protect(root)
    let lock = try Lease(root.appendingPathComponent("store.lock"), exclusive: true)
    return try withExtendedLifetime(lock) { try work() }
  }
  // Complete protection refuses even a read once the phone is locked. Only asked after something has already failed.
  func protectedDataClosed() -> Bool {
    let descriptor = Darwin.open(root.appendingPathComponent("store.lock").path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
    if descriptor >= 0 { Darwin.close(descriptor); return false }
    return errno == EPERM || errno == EACCES
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
  func scope() -> String? { try? read(String.self, root.appendingPathComponent("scope.json")) }
  // Not a secret and not an identity: only that the app has seen a sign-in here, so a share made before its
  // connection arrives isn't told it's signed out. Every sign-out path goes through `clearLocked`, which removes it.
  func noteSignedIn() throws { try locked { try write(true, to: root.appendingPathComponent("signed-in.json")) } }
  // A capture's tag is identity, generation and destination: `owner:generation:personal` or
  // `owner:generation:<family uuid>`. A build before spaces wrote `owner:generation`, and all it
  // had was personal, so reading it that way is the whole migration: nothing on disk has to change.
  private static func tag(_ scope: String) -> (owner: String, generation: String, destination: String) {
    var parts = scope.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
    let destination = parts.count > 2 && (parts.last == "personal" || UUID(uuidString: parts.last ?? "") != nil) ? parts.removeLast() : "personal"
    let generation = parts.count > 1 ? parts.removeLast() : ""
    return (parts.joined(separator: ":"), generation, destination)
  }
  private static func sameOwner(_ a: String?, _ b: String?) -> Bool {
    guard let a, let b else { return false }
    return tag(a).owner == tag(b).owner
  }
  // The rebind is the ordinary case. Create family, leaving and rotating a credential all change
  // where new captures go, and older ones keep their own tag. Only another account, or this same
  // destination's data having been cleared, retires them. Erasure and sign-out call `clear`.
  private static func retires(_ previous: String, _ next: String) -> Bool {
    let old = tag(previous), new = tag(next)
    return old.owner != new.owner || (old.destination == new.destination && old.generation != new.generation)
  }
  func bind(_ value: String, automaticEpoch: Int = 0, install: () throws -> Void = {}) throws {
    guard automaticEpoch >= 0 else { throw Failure.invalid }
    try locked {
      // A share kept under no account isn't this account's data, so its own space being cleared doesn't take it.
      if let previous = scope() ?? (try? read(String.self, root.appendingPathComponent("suspended-owner.json"))), previous != value, Self.retires(previous, value) { try clearLocked(preserveUnassigned: Self.sameOwner(previous, value), recoverClaims: Self.sameOwner(previous, value)) }
      try install()
      try write(value, to: root.appendingPathComponent("scope.json"))
      for name in ["suspended.json", "suspended-owner.json"] {
        let file = root.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
      }
      // The Keychain install and this non-sensitive sidecar share the store lock.
      // Foundation-only producers freeze it before awaiting any provider work.
      try write(automaticEpoch, to: root.appendingPathComponent("automatic-epoch.json"))
    }
  }
  private func currentID() -> String? { try? read(String.self, root.appendingPathComponent("current.json")) }
  private func manifest(_ id: String) throws -> Manifest {
    let value = try read(Manifest.self, directory(id).appendingPathComponent("manifest.json"))
    guard value.id == id else { throw Failure.invalid }; return value
  }
  private func nextSequence() throws -> Int {
    let url = root.appendingPathComponent("sequence.json")
    let next = ((try? read(Int.self, url)) ?? 0) + 1
    try write(next, to: url); return next
  }
  private func beginLocked(id: String, automaticEpoch: Int? = nil, unassigned: Bool = false) throws -> Capture {
    let folder = try directory(id)
    guard !FileManager.default.fileExists(atPath: folder.path) else { throw Failure.invalid }
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    try protect(folder)
    let lease = try Lease(folder.appendingPathComponent("lease.lock"), exclusive: false)
    let generation = try epoch(), date = now()
    let automaticEpoch = automaticEpoch ?? (try? read(Int.self, root.appendingPathComponent("automatic-epoch.json"))) ?? 0
    let owner = unassigned ? nil : scope(), signedIn = (try? read(Bool.self, root.appendingPathComponent("signed-in.json"))) ?? false
    try write(Manifest(id: id, epoch: generation, createdAt: date, text: false, payload: nil, scope: owner, sequence: try nextSequence(), automaticEpoch: automaticEpoch), to: folder.appendingPathComponent("manifest.json"))
    return Capture(id: id, directory: folder, scope: owner, signedIn: signedIn, epoch: generation, createdAt: date, automaticEpoch: automaticEpoch, lease: lease)
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
    let original = try manifest(capture.id)
    let value = Manifest(id: capture.id, epoch: capture.epoch, createdAt: capture.createdAt, text: text, payload: payload, scope: original.scope, sequence: original.sequence, automaticEpoch: capture.automaticEpoch, heldSince: original.scope == nil ? capture.createdAt : nil)
    try write(value, to: capture.directory.appendingPathComponent("manifest.json"))
    try write(capture.id, to: root.appendingPathComponent("current.json"))
    // Keep the stock share-intent reader compatible. The native bridge uses the
    // immutable manifest, so these two legacy keys are never a token transaction.
    defaults.set(raw, forKey: sharedKey); defaults.set(capture.id, forKey: receiptKey); defaults.synchronize()
    // Publication is immutable. Retire the producer lease before the host can
    // acknowledge; only host read leases may now protect this capture.
    capture.lease = nil
  }
  func publish(_ raw: Any, capture: Capture) throws { try locked { try publishLocked(raw, capture: capture) } }
  func publish(_ raw: Any, id: String) throws {
    let capture = try begin(id: id)
    do { try publish(raw, capture: capture) }
    catch { try? abort(capture); throw error }
  }
  func abort(_ capture: Capture) throws {
    try locked {
      guard capture.lease != nil, currentID() != capture.id else { return }
      try? FileManager.default.removeItem(at: capture.directory)
      capture.lease = nil
    }
  }
  private func snapshot(_ value: Manifest) throws -> Snapshot {
    guard let payload = value.payload, let token = value.token else { throw Failure.invalid }
    let raw: Any = value.text ? ((try? JSONDecoder().decode([String].self, from: payload)) as Any? ?? payload) : payload
    if consumers[token] == nil {
      consumers[token] = try Lease(directory(value.id).appendingPathComponent("lease.lock"), exclusive: false)
    }
    return Snapshot(token: token, raw: raw, scope: value.scope, occurredAt: value.createdAt, automaticEpoch: value.automaticEpoch ?? 0,
      receipt: try? read([String: String].self, directory(value.id).appendingPathComponent("receipt.json")), claimed: value.claimed == true, recordID: value.recordID)
  }
  func published(_ id: String) throws -> Snapshot? {
    try locked {
      let value = try manifest(id)
      guard value.epoch == (try epoch()), value.scope == scope() else { return nil }
      return try snapshot(value)
    }
  }
  func release(_ token: String) throws { _ = try locked { consumers.removeValue(forKey: token) } }
  func accept(_ token: String, receipt: [String: String]) throws -> Bool {
    try locked {
      guard let id = token.split(separator: ":").first.map(String.init),
        let value = try? manifest(id), value.token == token,
        value.epoch == (try epoch()), value.scope == scope() else { return false }
      try write(receipt, to: directory(id).appendingPathComponent("receipt.json")); return true
    }
  }
  func pending() throws -> Snapshot? {
    try locked {
      try sweepLocked()
      if FileManager.default.fileExists(atPath: root.appendingPathComponent("suspended.json").path) { return nil }
      // Every published manifest is a queue entry; current.json is compatibility
      // metadata only. Never expire accepted originals before exact handoff.
      let hadEpoch = FileManager.default.fileExists(atPath: root.appendingPathComponent("epoch.json").path)
      let generation = try epoch(), currentScope = scope()
      let folders = (try? FileManager.default.contentsOfDirectory(at: captures, includingPropertiesForKeys: nil)) ?? []
      let published: [Manifest] = folders.compactMap { try? manifest($0.lastPathComponent) }
      let values = published.filter { $0.payload != nil && $0.blocked == nil && (($0.scope != nil && $0.lapsed != true) || !expired($0)) && $0.epoch == generation &&
        (currentScope == nil || $0.scope == currentScope || Self.sameOwner($0.scope, currentScope)) }
        .sorted { $0.createdAt == $1.createdAt ? ($0.sequence ?? 0) < ($1.sequence ?? 0) : $0.createdAt < $1.createdAt }
      if let value = values.first { return try snapshot(value) }
      // Only an upgrade from the old store can migrate compatibility keys. Once
      // an epoch exists, stale cross-process defaults must not resurrect a clear.
      guard !hadEpoch else { return nil }
      defaults.synchronize()
      guard let raw = defaults.object(forKey: sharedKey) else { return nil }
      let capture = try beginLocked(id: UUID().uuidString, automaticEpoch: 0, unassigned: true)
      try publishLocked(raw, capture: capture)
      return scope() == nil ? try snapshot(manifest(capture.id)) : nil
    }
  }
  // A file is found by its place in this store, never by the container path it was saved under: restoring or moving a phone
  // gives the app group a new path, and the file is still right here. Manifests keep the path as written, since their token
  // hashes it and an older build reads it, so this is the one place that turns it into a real location.
  func ownedFile(_ path: String, capture id: String? = nil) -> URL? {
    let parsed = URL(string: path)
    let written = (parsed?.isFileURL == true ? parsed! : URL(fileURLWithPath: path)).standardizedFileURL
    let name = written.lastPathComponent, parent = written.deletingLastPathComponent()
    guard !name.isEmpty, name != "/", name != root.lastPathComponent else { return nil }
    let home: URL
    if parent.deletingLastPathComponent().lastPathComponent == captures.lastPathComponent, UUID(uuidString: parent.lastPathComponent) != nil,
      parent.deletingLastPathComponent().deletingLastPathComponent().lastPathComponent == root.lastPathComponent {
      guard id == nil || parent.lastPathComponent == id, !["manifest.json", "lease.lock", "receipt.json"].contains(name) else { return nil }
      home = captures.appendingPathComponent(parent.lastPathComponent, isDirectory: true)
    } else if parent.lastPathComponent == "thumbnail" {
      home = container.appendingPathComponent("thumbnail", isDirectory: true)
    } else if parsed?.isFileURL != true || parent == container || parent.deletingLastPathComponent().lastPathComponent == "AppGroup" {
      home = container
    } else { return nil }
    let file = home.appendingPathComponent(name).standardizedFileURL.resolvingSymlinksInPath()
    return file.deletingLastPathComponent() == home.standardizedFileURL.resolvingSymlinksInPath() ? file : nil
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
      return try removeLocked(value)
    }
  }
  // No producer or another live reader may be using this capture's files.
  private func removeLocked(_ value: Manifest) throws -> Bool {
    guard let lease = try? Lease(directory(value.id).appendingPathComponent("lease.lock"), exclusive: true, nonblocking: true)
    else { return false }
    return try withExtendedLifetime(lease) {
      try removeLegacyFiles(value)
      try FileManager.default.removeItem(at: directory(value.id))
      if currentID() == value.id {
        try FileManager.default.removeItem(at: root.appendingPathComponent("current.json"))
        defaults.removeObject(forKey: sharedKey); defaults.removeObject(forKey: receiptKey); defaults.synchronize()
      }
      return true
    }
  }
  private func expired(_ value: Manifest) -> Bool {
    // A share time ahead of the clock is one the clock got wrong, and the sweep gives it a new start rather than a guess.
    guard let held = value.heldSince, held <= now() else { return false }
    return now().timeIntervalSince(held) >= Self.unassignedExpiry
  }
  private func unassignedLocked() throws -> [Manifest] {
    try sweepLocked()
    // Only reading. Starting an epoch here would stop `pending` and `clear` carrying over an older build's share.
    guard let generation = try? read(UUID.self, root.appendingPathComponent("epoch.json")) else { return [] }
    let folders = (try? FileManager.default.contentsOfDirectory(at: captures, includingPropertiesForKeys: nil)) ?? []
    return folders.compactMap { try? manifest($0.lastPathComponent) }
      .filter { $0.scope == nil && $0.payload != nil && (($0.scope != nil && $0.lapsed != true) || !expired($0)) && $0.epoch == generation && !expired($0) }
      .sorted { $0.createdAt == $1.createdAt ? ($0.sequence ?? 0) < ($1.sequence ?? 0) : $0.createdAt < $1.createdAt }
  }
  // Shares kept under no account, for a sign-in screen or a warning: how many, and nothing about them.
  func unassignedCount() throws -> Int { try locked { try unassignedLocked().count } }
  // Privacy cleanup removes hidden, blocked and in-flight originals too. Never expose their contents in a count.
  func removalCount() throws -> Int {
    try locked {
      let folders = try FileManager.default.fileExists(atPath: captures.path) ? FileManager.default.contentsOfDirectory(at: captures, includingPropertiesForKeys: nil) : []
      return folders.filter { folder in
        if let value = try? manifest(folder.lastPathComponent) { return value.payload != nil }
        // Unknown future manifests are retained, and explicit cleanup must warn about them too.
        return FileManager.default.fileExists(atPath: folder.appendingPathComponent("manifest.json").path)
      }.count
    }
  }
  // What the connected account may see before it says a share is its own. Nothing, with no account connected.
  func unassigned(owner: String) throws -> [Waiting] {
    try locked {
      guard let bound = scope(), Self.tag(bound).owner == owner else { return [] }
      return try unassignedLocked().compactMap { value in
        guard let token = value.token, let payload = value.payload else { return nil }
        let raw: Any = value.text ? ((try? JSONDecoder().decode([String].self, from: payload)) as Any? ?? payload) : payload
        let held = value.heldSince ?? value.createdAt
        return Waiting(snapshot: Snapshot(token: token, raw: raw, scope: nil, occurredAt: value.createdAt, automaticEpoch: 0, receipt: nil, recordID: value.recordID),
          keptUntil: held.addingTimeInterval(Self.unassignedExpiry))
      }
    }
  }
  // A capture of this account's that can never be delivered, set aside so it can't hold up the ones behind it.
  func block(_ token: String, reason: String) throws -> Bool {
    try locked {
      guard ["file_too_large", "unsupported_file", "unreadable"].contains(reason), let id = token.split(separator: ":").first.map(String.init),
        UUID(uuidString: id) != nil, var value = try? manifest(id), value.token == token, value.scope != nil,
        value.epoch == (try epoch()), Self.sameOwner(value.scope, scope()) else { return false }
      value.blocked = reason
      consumers.removeValue(forKey: token)
      try write(value, to: directory(id).appendingPathComponent("manifest.json"))
      return true
    }
  }
  func blocked(owner: String) throws -> [Waiting] {
    try locked {
      guard let generation = try? read(UUID.self, root.appendingPathComponent("epoch.json")) else { return [] }
      let folders = (try? FileManager.default.contentsOfDirectory(at: captures, includingPropertiesForKeys: nil)) ?? []
      return try folders.compactMap { try? manifest($0.lastPathComponent) }
        .filter { $0.blocked != nil && ($0.lapsed != true || !expired($0)) && $0.epoch == generation && $0.scope.map { Self.tag($0).owner == owner } == true }
        .sorted { $0.createdAt < $1.createdAt }
        .compactMap { value in
          guard let token = value.token, let payload = value.payload else { return nil }
          let raw: Any = value.text ? ((try? JSONDecoder().decode([String].self, from: payload)) as Any? ?? payload) : payload
          return Waiting(snapshot: Snapshot(token: token, raw: raw, scope: value.scope, occurredAt: value.createdAt, automaticEpoch: 0, receipt: nil, recordID: value.recordID), keptUntil: value.createdAt, blocked: value.blocked)
        }
    }
  }
  func removeBlocked(_ token: String, owner: String) throws -> Bool {
    try locked {
      guard let id = token.split(separator: ":").first.map(String.init), UUID(uuidString: id) != nil,
        let value = try? manifest(id), value.token == token, value.blocked != nil,
        value.scope.map({ Self.tag($0).owner == owner }) == true else { return false }
      consumers.removeValue(forKey: token)
      return try removeLocked(value)
    }
  }
  // The one door out of no-owner: this exact capture, for the account connected right now, into its own personal space.
  // The tag is written here rather than copied from the connection, because that may name a family.
  // Under the lock, the capture's own age and the connection's own generation have the last word, whatever a card still shows.
  func claim(_ token: String, owner: String, generation: Int) throws -> Claim {
    try locked {
      guard generation > 0, !owner.isEmpty, let bound = scope().map(Self.tag), bound.owner == owner,
        bound.destination != "personal" || bound.generation == String(generation),
        let id = token.split(separator: ":").first.map(String.init), UUID(uuidString: id) != nil,
        var value = try? manifest(id), value.token == token, value.scope == nil, value.epoch == (try epoch())
      else { return .refused }
      guard !expired(value) else { return .expired }
      value.scope = "\(owner):\(generation):personal"
      value.claimed = true
      value.automaticEpoch = 0
      value.expiryNoticed = nil
      try write(value, to: directory(id).appendingPathComponent("manifest.json"))
      return .claimed
    }
  }
  // A personal reset may overtake Add while a family credential is connected. Return that original to the card, never acknowledge it away.
  func returnClaim(_ token: String, owner: String) throws -> Bool {
    try locked {
      guard let id = token.split(separator: ":").first.map(String.init), UUID(uuidString: id) != nil,
        var value = try? manifest(id), value.token == token, value.claimed == true,
        value.scope.map({ Self.tag($0).owner == owner }) == true,
        scope().map({ Self.tag($0).owner == owner }) == true else { return false }
      value.scope = nil; value.claimed = nil; value.automaticEpoch = 0; value.blocked = nil
      value.recordID = UUID().uuidString
      try? FileManager.default.removeItem(at: directory(id).appendingPathComponent("receipt.json"))
      consumers.removeValue(forKey: token)
      try write(value, to: directory(id).appendingPathComponent("manifest.json"))
      return true
    }
  }
  // "Not mine": only ever a no-owner capture. Anything under an account goes the way it always has.
  func discard(_ token: String) throws -> Bool {
    try locked {
      guard let id = token.split(separator: ":").first.map(String.init), UUID(uuidString: id) != nil,
        let value = try? manifest(id), value.token == token, value.scope == nil else { return false }
      consumers.removeValue(forKey: token)
      return try removeLocked(value)
    }
  }
  // A login lapse is not a privacy clear. Retire authority/producers, keep exact owner tags and suppress intake until bind.
  func suspend(retire: () throws -> Void = {}) throws {
    try locked {
      let previous = scope() ?? (try? read(String.self, root.appendingPathComponent("suspended-owner.json")))
      try retire()
      try clearLocked(preserveUnassigned: true, preserveTagged: true)
      if let previous { try write(previous, to: root.appendingPathComponent("suspended-owner.json")) }
      try write(true, to: root.appendingPathComponent("suspended.json"))
    }
  }
  // Explicit privacy cleanup invalidates even an extension that is still loading.
  // The lock/epoch files contain no captured content and must retain their inode.
  func clear(preserveUnassigned: Bool = false, recoveringOwner: String? = nil, retire: () throws -> Void = {}) throws {
    try locked {
      let recover = recoveringOwner.map { owner in scope().map { Self.tag($0).owner == owner } == true } ?? false
      try retire(); try clearLocked(preserveUnassigned: preserveUnassigned, recoverClaims: recover)
    }
  }
  private func clearLocked(preserveUnassigned: Bool = false, recoverClaims: Bool = false, preserveTagged: Bool = false) throws {
      // Preserve pre-manifest originals on the initial signed-out upgrade too.
      if preserveUnassigned, !FileManager.default.fileExists(atPath: root.appendingPathComponent("epoch.json").path),
        let raw = defaults.object(forKey: sharedKey) {
        let capture = try beginLocked(id: UUID().uuidString, automaticEpoch: 0, unassigned: true)
        try publishLocked(raw, capture: capture)
      }
      let generation = UUID()
      try write(generation, to: root.appendingPathComponent("epoch.json"))
      consumers.removeAll()
      if let folders = try? FileManager.default.contentsOfDirectory(at: captures, includingPropertiesForKeys: nil) {
        for folder in folders {
          if var value = try? manifest(folder.lastPathComponent) {
            if preserveUnassigned, (value.scope == nil || preserveTagged || (recoverClaims && value.claimed == true)), value.payload != nil {
              if preserveTagged, value.scope != nil {
                value.lapsed = true
                value.heldSince = value.heldSince ?? value.createdAt
              } else {
                if value.claimed == true {
                  value.recordID = UUID().uuidString
                  try? FileManager.default.removeItem(at: folder.appendingPathComponent("receipt.json"))
                }
                value.scope = nil; value.claimed = nil; value.automaticEpoch = 0; value.blocked = nil
              }
              // Retire all live producers while retaining quarantined originals.
              value.epoch = generation
              try write(value, to: folder.appendingPathComponent("manifest.json"))
              continue
            }
            try removeLegacyFiles(value)
          }
          if preserveUnassigned {
            if FileManager.default.fileExists(atPath: folder.appendingPathComponent("manifest.json").path), (try? manifest(folder.lastPathComponent)) == nil { continue }
            try FileManager.default.removeItem(at: folder)
          }
        }
      }
      if currentID() == nil, let raw = defaults.object(forKey: sharedKey), let (payload, text) = try? bytes(raw) {
        try removeLegacyFiles(Manifest(id: UUID().uuidString, epoch: try epoch(), createdAt: now(), text: text, payload: payload))
      }
      if !preserveUnassigned, FileManager.default.fileExists(atPath: captures.path) { try FileManager.default.removeItem(at: captures) }
      let pointer = root.appendingPathComponent("current.json")
      if FileManager.default.fileExists(atPath: pointer.path) { try FileManager.default.removeItem(at: pointer) }
      defaults.removeObject(forKey: sharedKey); defaults.removeObject(forKey: receiptKey); defaults.synchronize()
      try? FileManager.default.removeItem(at: root.appendingPathComponent("scope.json"))
      try? FileManager.default.removeItem(at: root.appendingPathComponent("automatic-epoch.json"))
      try? FileManager.default.removeItem(at: root.appendingPathComponent("signed-in.json"))
      for name in ["suspended.json", "suspended-owner.json"] {
        let file = root.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
      }
  }
  private func sweepLocked() throws {
    guard FileManager.default.fileExists(atPath: captures.path) else { return }
    let current = currentID()
    for folder in try FileManager.default.contentsOfDirectory(at: captures, includingPropertiesForKeys: [.creationDateKey]) {
      guard UUID(uuidString: folder.lastPathComponent) != nil else { continue }
      // An atomic manifest we cannot decode is not an abandoned producer. A future build may still read it.
      if FileManager.default.fileExists(atPath: folder.appendingPathComponent("manifest.json").path), (try? manifest(folder.lastPathComponent)) == nil { continue }
      if var value = try? manifest(folder.lastPathComponent), (value.scope == nil || value.lapsed == true), value.payload != nil {
        sweepUnassigned(&value, folder)
        continue
      }
      guard folder.lastPathComponent != current else { continue }
      if (try? manifest(folder.lastPathComponent).payload) != nil { continue }
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
  private func sweepUnassigned(_ value: inout Manifest, _ folder: URL) {
    let moment = now(), before = (value.heldSince, value.expiryNoticed)
    // Older metadata or a future wall timestamp restarts retention at the current wall clock.
    // Clock corrections can still shorten real retention and deletion grace across boots.
    if value.heldSince == nil || value.heldSince! > moment { value.heldSince = moment; value.expiryNoticed = nil }
    if expired(value) {
      if let noticed = value.expiryNoticed, noticed <= moment {
        guard moment.timeIntervalSince(noticed) >= Self.unassignedDeleteAfter else { return }
        if let token = value.token { consumers.removeValue(forKey: token) }
        _ = try? removeLocked(value)
        return
      }
      value.expiryNoticed = moment
    } else {
      // The clock came back, and it's not expired after all.
      value.expiryNoticed = nil
    }
    if before.0 != value.heldSince || before.1 != value.expiryNoticed {
      try? write(value, to: folder.appendingPathComponent("manifest.json"))
    }
  }
}
