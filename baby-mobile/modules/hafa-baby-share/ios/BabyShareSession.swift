import Foundation
import Security

// Never stores a Clerk JWT. All token and account metadata lives in Baby's
// separate shared Keychain group, serialized with the capture privacy fence.
enum BabyShareSession {
  static let service = "com.shimizutechnology.hafababy.share.v1"
  static func query() throws -> [String: Any] {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "BabyShareKeychainGroup") as? String,
      !group.contains("$(") else { throw BabyShareStore.Failure.unavailable }
    return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "capture", kSecAttrAccessGroup as String: group]
  }
  static func read() throws -> [String: Any]? {
    var query = try query(); query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data,
      let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw BabyShareStore.Failure.unavailable
    }
    return value
  }
  // The credential is only readable while unlocked. No credential on the phone reads as not found, not as locked.
  static func protectedDataClosed() -> Bool {
    guard var query = try? query() else { return false }
    query[kSecReturnData as String] = false
    return SecItemCopyMatching(query as CFDictionary, nil) == errSecInteractionNotAllowed
  }
  static func write(_ value: [String: Any]?) throws {
    var query = try query()
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw BabyShareStore.Failure.unavailable }
    // Her category names go with the credential, whenever it goes.
    if value == nil { try writeCategories(nil) }
    if let value {
      query[kSecValueData as String] = try JSONSerialization.data(withJSONObject: value)
      query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
      guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else { throw BabyShareStore.Failure.unavailable }
    }
  }
  // The categories the app last listed for this credential's space, so the share sheet can offer them. Names and ids,
  // nothing in them. Kept beside the credential, under the same lock and protection, and only read for the same tag.
  private static func categoryQuery() throws -> [String: Any] {
    var query = try query(); query[kSecAttrAccount as String] = "categories"; return query
  }
  private static func writeCategories(_ value: [String: Any]?) throws {
    var query = try categoryQuery()
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw BabyShareStore.Failure.unavailable }
    guard let value else { return }
    query[kSecValueData as String] = try JSONSerialization.data(withJSONObject: value)
    query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else { throw BabyShareStore.Failure.unavailable }
  }
  // Only for the credential that's here now: a list fetched for another space or account is dropped, not kept for later.
  static func publishCategories(storage: BabyShareStore, _ items: [[String: String]], owner: String, generation: Int, destination: String?) throws {
    let scope = destination.map { "\(owner):\(generation):\($0)" } ?? "\(owner):\(generation)"
    let rows = BabyShareCategories.clean(items)
    try storage.locked {
      guard try read()?["scope"] as? String == scope else { throw BabyShareStore.Failure.stale }
      try writeCategories(["scope": scope, "items": rows])
    }
  }
  static func categories(for scope: String?) -> [[String: String]] {
    guard let scope, var query = try? categoryQuery() else { return [] }
    query[kSecReturnData as String] = true; query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data,
      let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any], value["scope"] as? String == scope
    else { return [] }
    return BabyShareCategories.clean(value["items"] as? [[String: String]] ?? [])
  }
  static func baseURL(_ value: String) -> URL? {
    guard let url = URL(string: value), url.host != nil, url.user == nil, url.password == nil,
      url.query == nil, url.fragment == nil else { return nil }
    var allowed = url.scheme == "https"
    #if targetEnvironment(simulator)
    allowed = allowed || (url.scheme == "http" && url.host == "127.0.0.1")
    #endif
    return allowed ? url : nil
  }
  static func network() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 7; config.timeoutIntervalForResource = 8
    return URLSession(configuration: config, delegate: BabyShareNetworkDelegate(), delegateQueue: nil)
  }
  static func configure(storage: BabyShareStore, token: String, base: String, expires: String, owner: String, generation: Int, automaticEpoch: Int = 0, destination: String? = nil) throws {
    let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let expiry = format.date(from: expires) ?? ISO8601DateFormatter().date(from: expires)
    guard token.hasPrefix("hfbs_v1."), baseURL(base) != nil, !owner.isEmpty, generation > 0, automaticEpoch >= 0,
      let expiry, expiry > Date(), destination == nil || destination == "personal" || UUID(uuidString: destination ?? "") != nil
    else { throw BabyShareStore.Failure.invalid }
    let scope = destination.map { "\(owner):\(generation):\($0)" } ?? "\(owner):\(generation)"
    try storage.bind(scope, automaticEpoch: automaticEpoch) {
      try write(["token": token, "base": base, "expires": expiry.timeIntervalSince1970,
        "scope": scope, "generation": generation, "auto_process_epoch": automaticEpoch])
    }
  }
  static func disable(storage: BabyShareStore, preserveUnassigned: Bool = false, recoveringOwner: String? = nil) throws -> [String: Any]? {
    var old: [String: Any]?
    try storage.clear(preserveUnassigned: preserveUnassigned, recoveringOwner: recoveringOwner) { old = try? read(); try write(nil) }
    return old
  }
  static func clear(storage: BabyShareStore, preserveUnassigned: Bool = false, lapse: Bool = false) async throws {
    var old: [String: Any]?
    if lapse { try storage.suspend { old = try? read(); try write(nil) } }
    else { old = try disable(storage: storage, preserveUnassigned: preserveUnassigned) }
    guard let old, let token = old["token"] as? String, let base = old["base"] as? String,
      let url = baseURL(base) else { return }
    var request = URLRequest(url: url.appendingPathComponent("api/v1/baby/share/session"))
    request.httpMethod = "DELETE"; request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
    let network = network(); defer { network.finishTasksAndInvalidate() }
    _ = try? await network.data(for: request)
  }
  static func enqueue(_ id: String, storage: BabyShareStore, completion: @escaping (_ status: String?, _ filed: Bool) -> Void) {
    do {
      let state = try storage.locked { try read() }
      guard let state, let saved = try storage.published(id), saved.scope == state["scope"] as? String else { completion(nil, false); return }
      let capture = try BabySharePayload.decode(saved)
      guard let expiry = state["expires"] as? Double, expiry > Date().timeIntervalSince1970,
        let token = state["token"] as? String, let base = state["base"] as? String, let url = baseURL(base),
        (capture["files"] as? [[String: Any]] ?? []).isEmpty else {
        try? storage.release(saved.token); completion(nil, false); return
      }
      var request = URLRequest(url: url.appendingPathComponent("api/v1/baby/share/captures"))
      request.httpMethod = "POST"; request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try BabySharePayload.requestBody(capture)
      let network = network()
      network.dataTask(with: request) { data, response, _ in
        defer { try? storage.release(saved.token); network.finishTasksAndInvalidate() }
        guard (response as? HTTPURLResponse)?.statusCode == 202, let data,
          let receipt = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          receipt["capture_id"] as? String == capture["capture_id"] as? String,
          receipt["record_id"] as? String == capture["record_id"] as? String,
          receipt["generation"] as? Int == state["generation"] as? Int,
          let status = receipt["status"] as? String, ["saved", "deferred", "queued"].contains(status),
          status != "queued" || receipt["import_id"] as? String == capture["capture_id"] as? String else { completion(nil, false); return }
        var value = ["status": status]; value["import_id"] = receipt["import_id"] as? String
        let accepted = (try? storage.accept(saved.token, receipt: value)) == true
        // The API's word that it went in her category. An older API never says so, and it's just saved.
        let category = capture["collection_id"] as? String
        completion(accepted ? status : nil, accepted && category != nil && (receipt["collection_id"] as? String)?.lowercased() == category)
      }.resume()
    } catch { completion(nil, false) }
  }
}
private final class BabyShareNetworkDelegate: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

