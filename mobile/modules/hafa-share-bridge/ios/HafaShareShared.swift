import Darwin
import Foundation
import Security

// Compiled into the containing app and Share extension. Only the import-link
// capability lives in their shared Keychain group; Clerk remains app-private.
enum HafaShareStore {
  static let appGroup = "group.com.shimizutechnology.recipeextractor"
  static let pendingKey = "hafarecipesShareKey.pending"
  static let sessionKey = "hafa.share.session.v1"
  static let preferencesKey = "hafa.share.preferences.v1"
  static let service = "com.shimizutechnology.hafa.share-import.v1"

  static func locked<T>(_ operation: (UserDefaults) throws -> T) rethrows -> T? {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup),
      let defaults = UserDefaults(suiteName: appGroup) else { return nil }
    return try withFileLock(container) {
      defaults.synchronize()
      defer { defaults.synchronize() }
      return try operation(defaults)
    }
  }

  // Timeout must occur before touching any receipt/defaults. Use uptime so a
  // wall-clock change cannot extend lock acquisition indefinitely.
  static func withFileLock<T>(_ container: URL, timeout: TimeInterval = 0.25,
    _ operation: () throws -> T) rethrows -> T? {
    let descriptor = open(container.appendingPathComponent("hafa-share-queue.lock").path, O_CREAT | O_RDWR, mode_t(0o600))
    guard descriptor >= 0 else { return nil }; defer { close(descriptor) }
    let deadline = ProcessInfo.processInfo.systemUptime + max(0, timeout)
    while flock(descriptor, LOCK_EX | LOCK_NB) != 0 {
      guard errno == EWOULDBLOCK || errno == EAGAIN || errno == EINTR else { return nil }
      let remaining = deadline - ProcessInfo.processInfo.systemUptime
      guard remaining > 0 else { return nil }
      Thread.sleep(forTimeInterval: min(0.01, remaining))
    }
    defer { flock(descriptor, LOCK_UN) }
    return try operation()
  }
  private static let captureWriteQueue = DispatchQueue(label: "com.shimizutechnology.hafa.capture-writes", qos: .utility)
  static func performCaptureWrite<T>(_ operation: @escaping () -> T, completion: @escaping (T) -> Void) {
    captureWriteQueue.async {
      let result = operation()
      DispatchQueue.main.async { completion(result) }
    }
  }

  static func keychainQuery() -> [String: Any]? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "HafaShareKeychainAccessGroup") as? String,
      !group.contains("$(") else { return nil }
    return [kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service, kSecAttrAccount as String: "link-import",
      kSecAttrAccessGroup as String: group]
  }

  static func readToken() -> String? {
    guard var query = keychainQuery() else { return nil }
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }

  static func writeToken(_ token: String?) throws {
    guard var query = keychainQuery() else { throw NSError(domain: service, code: 1) }
    SecItemDelete(query as CFDictionary)
    if let token {
      query[kSecValueData as String] = Data(token.utf8)
      query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      let status = SecItemAdd(query as CFDictionary, nil)
      guard status == errSecSuccess else { throw NSError(domain: service, code: Int(status)) }
    }
  }

  static func captureKey(from url: String) -> String? {
    URL(string: url)?.host?.components(separatedBy: "=").last
  }

  static func metadata(_ key: String, defaults: UserDefaults) -> [String: Any]? {
    // Upgrade captures from the previous queue version without consuming them.
    guard defaults.object(forKey: key) != nil else { return nil }
    var metadata = defaults.dictionary(forKey: "\(key).meta") ?? [
      "captureId": key.components(separatedBy: ".").last.flatMap { UUID(uuidString: $0)?.uuidString.lowercased() } ?? UUID().uuidString.lowercased(),
      "submitted": false, "requestedIsPublic": false,
    ]
    defaults.set(metadata, forKey: "\(key).meta")
    metadata["captureKey"] = key
    return metadata
  }

  // Acknowledgment is exact, never "removeFirst": a stale callback cannot
  // consume a later capture. The app calls this only after persisting intake.
  static func remainingPending(_ pending: [String], acknowledging key: String) -> [String] {
    pending.filter { captureKey(from: $0) != key }
  }

  static func acknowledge(_ key: String) -> Bool {
    locked { defaults in
      let pending = defaults.stringArray(forKey: pendingKey) ?? []
      let remaining = remainingPending(pending, acknowledging: key)
      guard remaining.count < pending.count else { return false }
      defaults.set(remaining, forKey: pendingKey)
      defaults.removeObject(forKey: key)
      defaults.removeObject(forKey: "\(key).meta")
      return true
    } ?? false
  }

  // Cancellation is idempotent, including a capture still loading attachments.
  // Run on captureWriteQueue so an earlier receipt write cannot recreate it.
  static func discardCapture(_ key: String) -> Bool {
    locked { defaults in
      let pending = defaults.stringArray(forKey: pendingKey) ?? []
      defaults.set(remainingPending(pending, acknowledging: key), forKey: pendingKey)
      defaults.removeObject(forKey: key)
      defaults.removeObject(forKey: "\(key).meta")
      return true
    } ?? false
  }

  static func validBaseURL(_ value: String) -> URL? {
    guard let url = URL(string: value), url.scheme == "https", url.host != nil,
      url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return nil }
    return url
  }

  static func networkSession() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 7
    configuration.timeoutIntervalForResource = 8
    return URLSession(configuration: configuration, delegate: HafaShareNetworkDelegate(), delegateQueue: nil)
  }

  // Capture intent is independent of the server credential's capability.
  // A private credential may defer a public capture for foreground disclosure,
  // but must never silently turn that capture into a private import.
  static func capturePreferences(session: [String: Any]?, preferences: [String: Any]?) -> [String: Any] {
    guard let session, let account = session["accountScopeId"] as? String, !account.isEmpty else {
      // Preferences can be saved before credential provisioning finishes.
      // Without a session retain that intent, but leave ownership unassigned.
      // With no saved preference a share starts private; Public is always her choice.
      return ["requestedIsPublic": preferences?["isPublic"] as? Bool ?? false,
        "location": preferences?["location"] as? String ?? "Guam"]
    }
    let source = preferences?["accountScopeId"] as? String == account ? preferences! : session
    return ["accountScopeId": account, "location": source["location"] as? String ?? "Guam",
      // A credential capability is not a saved user choice.
      "requestedIsPublic": preferences?["accountScopeId"] as? String == account
        ? preferences?["isPublic"] as? Bool ?? false : false]
  }

  static func importPayload(captureID: String, url: String, metadata: [String: Any]) -> [String: Any] {
    var payload: [String: Any] = ["capture_id": captureID, "url": url]
    if let isPublic = metadata["requestedIsPublic"] as? Bool { payload["is_public"] = isPublic }
    if let location = metadata["location"] as? String { payload["location"] = location }
    return payload
  }

  static func acceptedImport(data: Data?, response: URLResponse?, captureID: String) -> [String: Any]? {
    guard let response = response as? HTTPURLResponse, response.statusCode == 202,
      let data, let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      result["capture_id"] as? String == captureID,
      (result["job_id"] as? String != nil || result["recipe_id"] as? String != nil) else { return nil }
    return result
  }

  static func canSubmitInBackground(_ metadata: [String: Any]) -> Bool {
    // Public and legacy-unknown captures need an in-app per-recipe choice.
    metadata["requestedIsPublic"] as? Bool == false
  }

  static func enqueueLink(captureKey key: String, url: String, completion: @escaping (Bool) -> Void) {
    // Snapshot under the same lock used by configure/clear. If signed out,
    // retain the original capture locally and do not submit under any account.
    guard let state = locked({ defaults -> ([String: Any], String, [String: Any])? in
      guard let session = defaults.dictionary(forKey: sessionKey), let token = readToken(),
        let metadata = defaults.dictionary(forKey: "\(key).meta"),
        metadata["accountScopeId"] as? String == session["accountScopeId"] as? String else { return nil }
      return (session, token, metadata)
    }) ?? nil, let base = state.0["apiBaseURL"] as? String,
      let baseURL = validBaseURL(base),
      let captureID = state.2["captureId"] as? String,
      canSubmitInBackground(state.2) else {
      completion(false); return
    }
    let endpoint = baseURL.appendingPathComponent("api/share/imports")
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = 7
    request.setValue("Bearer \(state.1)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: importPayload(captureID: captureID, url: url, metadata: state.2))
    let session = networkSession()
    session.dataTask(with: request) { data, response, _ in
      defer { session.finishTasksAndInvalidate() }
      guard let result = acceptedImport(data: data, response: response, captureID: captureID) else {
        completion(false); return
      }
      // Keep the queue entry until main-app durable intake. If a main-app
      // callback already consumed this capture, do not recreate it here.
      let stored = locked { defaults -> Bool in
        guard var current = defaults.dictionary(forKey: "\(key).meta") else { return true }
        current["submitted"] = true
        if let job = result["job_id"] as? String { current["jobId"] = job }
        if let recipe = result["recipe_id"] as? String { current["recipeId"] = recipe }
        defaults.set(current, forKey: "\(key).meta")
        return true
      } ?? false
      completion(stored)
    }.resume()
  }
}

private final class HafaShareNetworkDelegate: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }
}

// Each extension invocation owns one directory. This lock covers the actual
// copy and cancellation: late provider callbacks cannot recreate discarded files.
final class HafaShareAttachmentFiles {
  private let directory: URL
  private let lock = NSLock()
  private var cancelled = false

  init(container: URL, captureID: UUID = UUID()) {
    directory = container.appendingPathComponent("hafa-share-\(captureID.uuidString)", isDirectory: true)
  }

  func withWrite<T>(_ operation: (URL) throws -> T) throws -> T? {
    lock.lock(); defer { lock.unlock() }
    guard !cancelled else { return nil }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return try operation(directory)
  }

  func copy(_ source: URL) -> URL? {
    try? withWrite { directory in
      let destination = directory.appendingPathComponent("\(UUID().uuidString).\(source.pathExtension)")
      try FileManager.default.copyItem(at: source, to: destination)
      return destination
    }
  }

  func cancelAndRemove() -> Bool {
    lock.lock(); defer { lock.unlock() }
    cancelled = true
    do {
      if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
      return true
    } catch { return false }
  }
}
