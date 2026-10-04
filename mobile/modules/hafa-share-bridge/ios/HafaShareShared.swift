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
    let descriptor = open(container.appendingPathComponent("hafa-share-queue.lock").path, O_CREAT | O_RDWR, mode_t(0o600))
    guard descriptor >= 0 else { return nil }
    defer { close(descriptor) }
    guard flock(descriptor, LOCK_EX) == 0 else { return nil }
    defer { flock(descriptor, LOCK_UN) }
    defaults.synchronize()
    defer { defaults.synchronize() }
    let value = try operation(defaults)
    return value
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
      return ["requestedIsPublic": preferences?["isPublic"] as? Bool ?? true,
        "location": preferences?["location"] as? String ?? "Guam"]
    }
    let source = preferences?["accountScopeId"] as? String == account ? preferences! : session
    return ["accountScopeId": account, "location": source["location"] as? String ?? "Guam",
      "requestedIsPublic": source["isPublic"] as? Bool ?? true]
  }

  static func importPayload(captureID: String, url: String, metadata: [String: Any]) -> [String: Any] {
    var payload: [String: Any] = ["capture_id": captureID, "url": url]
    if let isPublic = metadata["requestedIsPublic"] as? Bool { payload["is_public"] = isPublic }
    if let location = metadata["location"] as? String { payload["location"] = location }
    return payload
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
      let captureID = state.2["captureId"] as? String else {
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
      guard let response = response as? HTTPURLResponse, response.statusCode == 202,
        let data, let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        result["capture_id"] as? String == captureID,
        (result["job_id"] as? String != nil || result["recipe_id"] as? String != nil) else {
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
