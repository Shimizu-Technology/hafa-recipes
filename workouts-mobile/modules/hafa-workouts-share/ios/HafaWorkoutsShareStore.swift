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
  static let staging = "workouts.share.staging.v1"
  static func locked<T>(_ operation: (UserDefaults) throws -> T) rethrows -> T? {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
      let defaults = UserDefaults(suiteName: group) else { return nil }
    let fd = open(container.appendingPathComponent("workouts-share.lock").path, O_CREAT | O_RDWR, mode_t(0o600))
    guard fd >= 0 else { return nil }; defer { close(fd) }
    guard flock(fd, LOCK_EX) == 0 else { return nil }; defer { flock(fd, LOCK_UN) }
    defaults.synchronize(); defer { defaults.synchronize() }
    return try operation(defaults)
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
  static func abortStage(_ key: String, _ d: UserDefaults) -> Bool {
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
    return true
  }
  static func abortStage(_ key: String) -> Bool { locked { abortStage(key, $0) } ?? false }
  static func reconcileStages(_ d: UserDefaults) -> Bool {
    let cutoff = Date().timeIntervalSince1970 - 24 * 60 * 60
    for key in d.stringArray(forKey: staging) ?? [] {
      guard let stage = d.dictionary(forKey: key + ".stage") else {
        guard abortStage(key, d) else { return false }; continue
      }
      guard let created = stage["createdAt"] as? Double else { return false }
      if created <= cutoff && !abortStage(key, d) { return false }
    }
    return true
  }
  static func beginStage(_ key: String) -> Bool {
    locked { d in
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
    } ?? false
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
  static func promoteStage(_ key: String, payload: [String: Any]) -> Bool {
    locked { d in
      guard let stage = d.dictionary(forKey: key + ".stage"), let paths = stage["paths"] as? [String],
        let files = payload["files"] as? [[String: Any]],
        d.object(forKey: key + ".capture") == nil else { return false }
      let capturedPaths = files.compactMap { $0["path"] as? String }
      guard capturedPaths.count == files.count, capturedPaths.count == paths.count,
        Set(capturedPaths) == Set(paths), paths.allSatisfy({ path in
          guard let url = shareFile(path) else { return false }
          return FileManager.default.fileExists(atPath: url.path)
        }) else { return false }
      var capture = payload
      capture["ownerId"] = stage["ownerId"]; capture["generation"] = stage["generation"]
      capture["accountScopeId"] = stage["accountScopeId"]; capture["isPublic"] = stage["isPublic"]
      d.set(capture, forKey: key + ".capture")
      let keys = d.stringArray(forKey: pending) ?? []
      d.set(keys.contains(key) ? keys : keys + [key], forKey: pending)
      // Durably publish capture+queue before retiring its staging receipt.
      // A crash at either boundary is reconciled without deleting final files.
      guard d.synchronize() else {
        d.removeObject(forKey: key + ".capture"); d.set(keys, forKey: pending); return false
      }
      d.removeObject(forKey: key + ".stage")
      d.set((d.stringArray(forKey: staging) ?? []).filter { $0 != key }, forKey: staging)
      return true
    } ?? false
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
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["capture_id": capture, "url": source,
      "is_public": state.2["isPublic"] as? Bool ?? false])
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
        d.set(current, forKey: key + ".capture"); return true
      } ?? false
      completion(persisted)
    }.resume()
  }
  static func acknowledge(_ key: String) -> Bool {
    locked { acknowledge(key, $0) } ?? false
  }
  static func acknowledge(_ key: String, _ d: UserDefaults) -> Bool {
      let keys = d.stringArray(forKey: pending) ?? []
      guard keys.contains(key) else { return false }
      // Delete only files copied into this app's own shared container.
      if let files = d.dictionary(forKey: key + ".capture")?["files"] as? [[String: Any]] {
        let paths = files.compactMap { $0["path"] as? String }
        guard paths.count == files.count, removeFiles(paths) else { return false }
      }
      d.set(keys.filter { $0 != key }, forKey: pending)
      d.removeObject(forKey: key); d.removeObject(forKey: key + ".capture"); return true
  }
}
private final class WorkoutsShareNetworkDelegate: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
