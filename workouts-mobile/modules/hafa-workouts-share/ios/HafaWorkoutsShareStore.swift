import Darwin
import Foundation
import Security

// Compiled into the app and extension. The shared Keychain contains only an
// expiring Workouts import capability; Clerk credentials never leave the app.
enum WorkoutsShareStore {
  static let group = "group.com.shimizutechnology.hafaworkouts"
  static let service = "com.shimizutechnology.hafaworkouts.share.v1"
  static let pending = "workouts.share.pending.v1"
  static let sessionKey = "workouts.share.session.v1"
  static let installationKey = "workouts.share.installation"
  static let staging = "workouts.share.staging.v1"
  static func locked<T>(_ operation: (WorkoutsShareDefaults) throws -> T) rethrows -> T? {
    try withLock { try withJournal($0, $1, operation) } ?? nil
  }
  static func withJournal<T>(_ defaults: UserDefaults, _ container: URL,
    _ operation: (WorkoutsShareDefaults) throws -> T) rethrows -> T? {
    guard let state = try? WorkoutsShareDefaults(defaults: defaults, container: container) else { return nil }
    // Writers commit their own exact boundaries. Never retry a dirty journal
    // after a thrown error or a false/nil result.
    return try operation(state)
  }
  static func withLock<T>(_ operation: (UserDefaults, URL) throws -> T) rethrows -> T? {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
      let defaults = UserDefaults(suiteName: group) else { return nil }
    return try withFileLock(container) {
      defaults.synchronize()
      return try operation(defaults, container)
    }
  }
  // Nonblocking flock attempts use a monotonic deadline. A timeout never opens
  // or mutates the journal; the last durable capture remains the retry source.
  static func withFileLock<T>(_ container: URL, timeout: TimeInterval = 0.25,
    _ operation: () throws -> T) rethrows -> T? {
    let fd = open(container.appendingPathComponent("workouts-share.lock").path, O_CREAT | O_RDWR, mode_t(0o600))
    guard fd >= 0 else { return nil }; defer { close(fd) }
    let deadline = ProcessInfo.processInfo.systemUptime + max(0, timeout)
    while flock(fd, LOCK_EX | LOCK_NB) != 0 {
      guard errno == EWOULDBLOCK || errno == EAGAIN || errno == EINTR else { return nil }
      let remaining = deadline - ProcessInfo.processInfo.systemUptime
      guard remaining > 0 else { return nil }
      Thread.sleep(forTimeInterval: min(0.01, remaining))
    }
    defer { flock(fd, LOCK_UN) }
    return try operation()
  }
  private static let captureWriteQueue = DispatchQueue(label: "com.shimizutechnology.hafaworkouts.capture-writes", qos: .utility)
  static func performCaptureWrite<T>(_ operation: @escaping () -> T, completion: @escaping (T) -> Void) {
    captureWriteQueue.async {
      let result = operation()
      DispatchQueue.main.async { completion(result) }
    }
  }
  static func shareFile(_ path: String) -> URL? {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.standardizedFileURL,
      let url = URL(string: path), url.isFileURL,
      url.standardizedFileURL.deletingLastPathComponent() == root else { return nil }
    return url
  }
  static func removeFiles(_ paths: [String]) -> Bool {
    for path in paths {
      guard let url = shareFile(path) else { return false }
      do { try FileManager.default.removeItem(at: url) }
      catch { if (error as NSError).code != NSFileNoSuchFileError { return false } }
    }
    return true
  }
  // Call only while holding the shared flock. Keep failed deletion receipts for
  // a later retry; never search or remove unrelated shared-container files.
  static func abortStage(_ key: String, _ d: WorkoutsShareDefaults) -> Bool {
    if let stage = d.dictionary(forKey: key + ".stage") {
      guard let paths = stage["paths"] as? [String] else { return false }
      if let capture = d.dictionary(forKey: key + ".capture") {
        // Interrupted promotion may retain both receipts. Protect completed
        // sources and restore their queue entry instead of deleting the files.
        guard let files = capture["files"] as? [[String: Any]] else { return false }
        let capturedPaths = files.compactMap { $0["path"] as? String }
        guard capturedPaths.count == files.count, capturedPaths.count == paths.count,
          Set(capturedPaths) == Set(paths) else { return false }
        let keys = d.stringArray(forKey: pending) ?? []
        d.set(keys.contains(key) ? keys : keys + [key], forKey: pending)
      } else if !removeFiles(paths) { return false }
    }
    d.removeObject(forKey: key + ".stage")
    d.set((d.stringArray(forKey: staging) ?? []).filter { $0 != key }, forKey: staging)
    return d.synchronize()
  }
  static func abortStage(_ key: String) -> Bool { locked { abortStage(key, $0) } ?? false }
  static func reconcileStages(_ d: WorkoutsShareDefaults) -> Bool {
    let cutoff = Date().timeIntervalSince1970 - 24 * 60 * 60
    for key in d.stringArray(forKey: staging) ?? [] {
      guard let stage = d.dictionary(forKey: key + ".stage") else {
        _ = abortStage(key, d); continue
      }
      // An unrelated interrupted receipt must not prevent another source from
      // being saved. Retain malformed/unremovable receipts and their files.
      guard let created = stage["createdAt"] as? Double else { continue }
      if created <= cutoff { _ = abortStage(key, d) }
    }
    return true
  }
  static func beginStage(_ key: String) -> Bool {
    locked { beginStage(key, $0) } ?? false
  }
  static func beginStage(_ key: String, _ d: WorkoutsShareDefaults) -> Bool {
    guard reconcileStages(d), d.object(forKey: key + ".stage") == nil,
      d.object(forKey: key + ".capture") == nil else { return false }
    let session = d.dictionary(forKey: sessionKey)
    var stage: [String: Any] = ["createdAt": Date().timeIntervalSince1970,
      "paths": [String](), "isPublic": session?["isPublic"] as? Bool ?? false]
    stage["ownerId"] = session?["ownerId"]; stage["generation"] = session?["generation"]
    stage["accountScopeId"] = session?["accountScopeId"]
    d.set(stage, forKey: key + ".stage")
    d.set((d.stringArray(forKey: staging) ?? []) + [key], forKey: staging)
    return d.synchronize()
  }
  static func copyStagedFile(_ key: String, source: URL, destination: URL) throws {
    guard try locked({ d -> Bool in
      guard var stage = d.dictionary(forKey: key + ".stage"),
        var paths = stage["paths"] as? [String], shareFile(destination.absoluteString) != nil,
        !paths.contains(destination.absoluteString) else { throw NSError(domain: service, code: 5) }
      paths.append(destination.absoluteString); stage["paths"] = paths
      d.set(stage, forKey: key + ".stage")
      // Flush the exact receipt BEFORE copying. The lock spans both operations
      // so owner discard cannot remove a receipt just before its file appears.
      guard d.synchronize() else { throw NSError(domain: service, code: 5) }
      try FileManager.default.copyItem(at: source, to: destination)
      return true
    }) == true else { throw NSError(domain: service, code: 5) }
  }
  static func promoteStage(_ key: String, payload: [String: Any]) -> Bool? {
    locked { d -> Bool? in
      guard let stage = d.dictionary(forKey: key + ".stage"), let paths = stage["paths"] as? [String],
        let files = payload["files"] as? [[String: Any]],
        d.object(forKey: key + ".capture") == nil else { return nil }
      let capturedPaths = files.compactMap { $0["path"] as? String }
      guard capturedPaths.count == files.count, capturedPaths.count == paths.count,
        Set(capturedPaths) == Set(paths), paths.allSatisfy({ path in
          guard let url = shareFile(path) else { return false }
          return FileManager.default.fileExists(atPath: url.path)
        }) else { return nil }
      var capture = payload
      capture["ownerId"] = stage["ownerId"]; capture["generation"] = stage["generation"]
      capture["accountScopeId"] = stage["accountScopeId"]; capture["isPublic"] = stage["isPublic"]
      d.set(capture, forKey: key + ".capture")
      let keys = d.stringArray(forKey: pending) ?? []
      d.set(keys.contains(key) ? keys : keys + [key], forKey: pending)
      // Durably publish capture+queue before retiring its staging receipt.
      // A crash at either boundary is reconciled without deleting final files.
      guard d.synchronize() else {
        d.removeObject(forKey: key + ".capture"); d.set(keys, forKey: pending); return nil
      }
      d.removeObject(forKey: key + ".stage")
      d.set((d.stringArray(forKey: staging) ?? []).filter { $0 != key }, forKey: staging)
      // The capture is already committed. Failed staging cleanup leaves both
      // receipts on disk for reconciliation, with its completed files protected.
      _ = d.synchronize()
      return capture["isPublic"] as? Bool ?? false
    } ?? nil
  }
  // Only this durable capture changes; the account's default stays unchanged.
  static func chooseVisibility(_ key: String, isPublic: Bool, confirmed: Bool = false) -> Bool {
    locked { chooseVisibility(key, isPublic: isPublic, confirmed: confirmed, $0) } ?? false
  }
  static func chooseVisibility(_ key: String, isPublic: Bool, confirmed: Bool, _ d: WorkoutsShareDefaults) -> Bool {
    guard var capture = d.dictionary(forKey: key + ".capture"),
      capture["visibilityPending"] as? Bool == true, capture["jobId"] == nil else { return false }
    capture["isPublic"] = isPublic; capture["visibilityChosen"] = true
    capture["visibilityPending"] = !confirmed
    d.set(capture, forKey: key + ".capture")
    return d.synchronize()
  }
  // Opening the host takes ownership of unfinished confirmations. An untouched
  // choice recovers privately; an explicit per-item choice survives dismissal.
  static func readyCaptures(_ d: WorkoutsShareDefaults) -> [[String: Any]]? {
    let captures = (d.stringArray(forKey: pending) ?? []).compactMap { key -> [String: Any]? in
      guard var capture = d.dictionary(forKey: key + ".capture") else { return nil }
      if capture["visibilityPending"] as? Bool == true {
        if capture["visibilityChosen"] as? Bool != true { capture["isPublic"] = false }
        capture["visibilityPending"] = false
        d.set(capture, forKey: key + ".capture")
      }
      return capture
    }
    return d.synchronize() ? captures : nil
  }
  static func discardOwner(_ owner: String) -> Bool {
    locked { d in
      for key in d.stringArray(forKey: staging) ?? [] {
        if d.dictionary(forKey: key + ".stage")?["ownerId"] as? String == owner,
          !abortStage(key, d) { return false }
      }
      for key in d.stringArray(forKey: pending) ?? [] {
        if d.dictionary(forKey: key + ".capture")?["ownerId"] as? String == owner,
          !acknowledge(key, d) { return false }
      }
      return true
    } ?? false
  }
  static func tokenQuery() -> [String: Any]? {
    guard let access = Bundle.main.object(forInfoDictionaryKey: "WorkoutsShareKeychainGroup") as? String,
      !access.contains("$(") else { return nil }
    return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "import-link", kSecAttrAccessGroup as String: access]
  }
  static func token() -> String? {
    guard var query = tokenQuery() else { return nil }
    query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }
  static func setToken(_ value: String?) throws {
    guard var query = tokenQuery() else { throw NSError(domain: service, code: 1) }
    let deleted = SecItemDelete(query as CFDictionary)
    guard deleted == errSecSuccess || deleted == errSecItemNotFound else { throw NSError(domain: service, code: Int(deleted)) }
    if let value {
      query[kSecValueData as String] = Data(value.utf8)
      query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      let result = SecItemAdd(query as CFDictionary, nil)
      guard result == errSecSuccess else { throw NSError(domain: service, code: Int(result)) }
    }
  }
  static func baseURL(_ value: String) -> URL? {
    guard let url = URL(string: value), url.host != nil,
      url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return nil }
    var transportAllowed = url.scheme == "https"
    #if targetEnvironment(simulator)
    transportAllowed = transportAllowed || (url.scheme == "http" && url.host == "127.0.0.1")
    #endif
    guard transportAllowed else { return nil }
    return url
  }
  static func network() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 7; config.timeoutIntervalForResource = 8
    return URLSession(configuration: config, delegate: WorkoutsShareNetworkDelegate(), delegateQueue: nil)
  }
  static func enqueue(_ key: String, completion: @escaping (Bool) -> Void) {
    guard let state = locked({ d -> ([String: Any], String, [String: Any])? in
      guard let session = d.dictionary(forKey: sessionKey), let capability = token(),
        let capture = d.dictionary(forKey: key + ".capture"),
        capture["visibilityPending"] as? Bool != true,
        capture["accountScopeId"] as? String == session["accountScopeId"] as? String,
        capture["generation"] as? Int == session["generation"] as? Int,
        let expires = session["expiresAt"] as? Double, expires > Date().timeIntervalSince1970 else { return nil }
      return (session, capability, capture)
    }) ?? nil, let base = state.0["apiBaseURL"] as? String, let url = baseURL(base),
      (state.2["files"] as? [[String: Any]] ?? []).isEmpty,
      let source = state.2["url"] as? String, let capture = state.2["captureId"] as? String else { completion(false); return }
    var request = URLRequest(url: url.appendingPathComponent("api/v1/workouts/share/imports"))
    request.httpMethod = "POST"; request.timeoutInterval = 7
    request.setValue("Bearer " + state.1, forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    // typed_formats: this build runs EMOM, for-time and work/rest formats.
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["capture_id": capture, "url": source,
      "is_public": state.2["isPublic"] as? Bool ?? false, "typed_formats": true])
    let network = network()
    network.dataTask(with: request) { data, response, _ in
      defer { network.finishTasksAndInvalidate() }
      guard (response as? HTTPURLResponse)?.statusCode == 202, let data,
        let receipt = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        receipt["capture_id"] as? String == capture,
        receipt["generation"] as? Int == state.2["generation"] as? Int,
        let job = receipt["job_id"] as? String else { completion(false); return }
      let persisted = locked { d -> Bool in
        guard var current = d.dictionary(forKey: key + ".capture") else { return true }
        current["jobId"] = job; current["workoutId"] = receipt["workout_id"] as? String
        d.set(current, forKey: key + ".capture"); return d.synchronize()
      } ?? false
      completion(persisted)
    }.resume()
  }
  static func acknowledge(_ key: String) -> Bool {
    locked { acknowledge(key, $0) } ?? false
  }
  static func acknowledge(_ key: String, _ d: WorkoutsShareDefaults) -> Bool {
      let keys = d.stringArray(forKey: pending) ?? []
      guard keys.contains(key) else { return false }
      // Delete only files copied into this app's own shared container.
      if let files = d.dictionary(forKey: key + ".capture")?["files"] as? [[String: Any]] {
        let paths = files.compactMap { $0["path"] as? String }
        guard paths.count == files.count, removeFiles(paths) else { return false }
      }
      d.set(keys.filter { $0 != key }, forKey: pending)
      d.removeObject(forKey: key); d.removeObject(forKey: key + ".capture"); return d.synchronize()
  }
}

// Capture receipts need cross-process durability, not a successful preference
// cache flush. Publish import metadata atomically in the locked AppGroup
// container; the capability token remains exclusively in the shared Keychain.
// Legacy receipts are migrated without deleting their preferences or files.
final class WorkoutsShareDefaults {
  static let journalName = "workouts-share-journal.v1.plist"
  private let defaults: UserDefaults
  private let journalURL: URL
  private var values: [String: Any]
  private var dirty = false

  static func isReceipt(_ key: String) -> Bool {
    key == WorkoutsShareStore.pending || key == WorkoutsShareStore.staging ||
      key == WorkoutsShareStore.sessionKey || key == WorkoutsShareStore.installationKey ||
      key.hasPrefix("hafaworkoutsShareKey.") && (key.hasSuffix(".capture") || key.hasSuffix(".stage"))
  }
  init(defaults: UserDefaults, container: URL) throws {
    self.defaults = defaults
    journalURL = container.appendingPathComponent(Self.journalName)
    if FileManager.default.fileExists(atPath: journalURL.path) {
      guard let data = try PropertyListSerialization.propertyList(from: Data(contentsOf: journalURL), format: nil) as? [String: Any],
        data["version"] as? Int == 1, let receipts = data["receipts"] as? [String: Any],
        receipts.keys.allSatisfy(Self.isReceipt) else {
        throw NSError(domain: WorkoutsShareStore.service, code: 8)
      }
      values = receipts
    } else {
      values = defaults.dictionaryRepresentation().filter { Self.isReceipt($0.key) }
      dirty = true
    }
  }
  func object(forKey key: String) -> Any? { Self.isReceipt(key) ? values[key] : defaults.object(forKey: key) }
  func dictionary(forKey key: String) -> [String: Any]? { object(forKey: key) as? [String: Any] }
  func stringArray(forKey key: String) -> [String]? { object(forKey: key) as? [String] }
  func string(forKey key: String) -> String? { object(forKey: key) as? String }
  func set(_ value: Any?, forKey key: String) {
    if Self.isReceipt(key) { values[key] = value; dirty = true }
    else { defaults.set(value, forKey: key) }
  }
  func removeObject(forKey key: String) { set(nil, forKey: key) }
  @discardableResult func synchronize() -> Bool {
    _ = defaults.synchronize()
    guard dirty else { return true }
    let temporary = journalURL.appendingPathExtension("tmp")
    do {
      let data = try PropertyListSerialization.data(fromPropertyList: ["version": 1, "receipts": values], format: .binary, options: 0)
      // This exact temporary path is exclusively ours under the shared flock.
      // Replacing an interrupted write must not leave account metadata orphaned.
      if FileManager.default.fileExists(atPath: temporary.path) { try FileManager.default.removeItem(at: temporary) }
      let fd = open(temporary.path, O_CREAT | O_EXCL | O_RDWR, mode_t(0o600))
      guard fd >= 0 else { return false }
      let file = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
      defer { try? file.close(); try? FileManager.default.removeItem(at: temporary) }
      #if os(iOS)
      try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: temporary.path)
      #endif
      try file.write(contentsOf: data)
      guard fcntl(fd, F_FULLFSYNC) == 0, try Data(contentsOf: temporary) == data,
        rename(temporary.path, journalURL.path) == 0 else { return false }
      let directory = open(journalURL.deletingLastPathComponent().path, O_RDONLY)
      guard directory >= 0 else { return false }
      defer { close(directory) }
      guard fsync(directory) == 0 else { return false }
      dirty = false
      return true
    } catch { return false }
  }
}
private final class WorkoutsShareNetworkDelegate: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
