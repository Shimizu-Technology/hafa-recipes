import Darwin
import Foundation
import Security

enum HafaWidgetConstants {
  static let appGroup = "group.com.shimizutechnology.recipeextractor"
  static let widgetKind = "HafaGroceryWidget"
  static let stateFile = "grocery-widget-state-v1.json"
  static let lockFile = "grocery-widget-state-v1.lock"
  static let credentialService = "com.shimizutechnology.recipeextractor.grocery-widget"
  static let credentialAccount = "session"
}

enum HafaWidgetError: LocalizedError {
  case appGroupUnavailable
  case invalidSnapshot
  case invalidAPIBaseURL
  case keychain(OSStatus)
  case missingSession
  case invalidResponse
  case server(Int)

  var errorDescription: String? {
    switch self {
    case .appGroupUnavailable:
      return "The widget app-group container is unavailable."
    case .invalidSnapshot:
      return "The grocery widget snapshot is invalid."
    case .invalidAPIBaseURL:
      return "The grocery widget API URL is invalid."
    case .keychain(let status):
      return "The grocery widget keychain operation failed (\(status))."
    case .missingSession:
      return "Open Håfa Recipes to reconnect this widget."
    case .invalidResponse:
      return "The grocery service returned an invalid response."
    case .server(let status):
      return "The grocery service returned HTTP \(status)."
    }
  }
}

struct HafaWidgetItem: Codable, Identifiable, Hashable {
  let id: String
  let name: String
  let quantity: String?
  let unit: String?
  let notes: String?
  var checked: Bool
  let recipeID: String?
  let recipeTitle: String?
  let addedByName: String?
  let createdAt: String
  let updatedAt: String

  enum CodingKeys: String, CodingKey {
    case id, name, quantity, unit, notes, checked
    case recipeID = "recipe_id"
    case recipeTitle = "recipe_title"
    case addedByName = "added_by_name"
    case createdAt = "created_at"
    case updatedAt = "updated_at"
  }

  var detail: String? {
    let amount = [quantity, unit]
      .compactMap { value in
        guard let value, !value.trimmingCharacters(in: .whitespaces).isEmpty else {
          return nil
        }
        return value
      }
      .joined(separator: " ")
    if !amount.isEmpty { return amount }
    return recipeTitle
  }
}

struct HafaWidgetList: Codable, Hashable {
  let id: String
  let name: String
  let isShared: Bool
  let revision: Int
  let createdAt: String
  let updatedAt: String

  enum CodingKeys: String, CodingKey {
    case id, name, revision
    case isShared = "is_shared"
    case createdAt = "created_at"
    case updatedAt = "updated_at"
  }
}

struct HafaWidgetSnapshot: Codable, Hashable {
  let accountScopeID: String
  let list: HafaWidgetList
  var items: [HafaWidgetItem]
  var total: Int
  var unchecked: Int
  var checked: Int
  let serverTime: String

  enum CodingKeys: String, CodingKey {
    case list, items, total, unchecked, checked
    case accountScopeID = "account_scope_id"
    case serverTime = "server_time"
  }

  mutating func setChecked(itemID: String, checked desiredState: Bool) {
    guard let index = items.firstIndex(where: { $0.id == itemID }) else { return }
    items[index].checked = desiredState
    let uncheckedCount = items.reduce(0) { $0 + ($1.checked ? 0 : 1) }
    total = items.count
    unchecked = uncheckedCount
    checked = items.count - uncheckedCount
    items.sort {
      if $0.checked != $1.checked { return !$0.checked }
      if $0.createdAt != $1.createdAt { return $0.createdAt > $1.createdAt }
      return $0.id < $1.id
    }
  }
}

struct HafaWidgetPendingMutation: Codable, Identifiable, Hashable {
  let id: String
  let listID: String
  let itemID: String
  let checked: Bool
  let createdAt: String

  enum CodingKeys: String, CodingKey {
    case id = "mutation_id"
    case listID = "list_id"
    case itemID = "item_id"
    case checked
    case createdAt = "created_at"
  }
}

struct HafaWidgetState: Codable, Hashable {
  var version = 1
  var apiBaseURL: String?
  var accountScopeID: String?
  var snapshot: HafaWidgetSnapshot?
  var pending: [HafaWidgetPendingMutation] = []
  // Optional so state written by older app/widget versions remains decodable.
  var pageOffsets: [String: Int]?
  var lastError: String?
  var requiresReconnect = false

  enum CodingKeys: String, CodingKey {
    case version, snapshot, pending
    case pageOffsets = "page_offsets"
    case apiBaseURL = "api_base_url"
    case accountScopeID = "account_scope_id"
    case lastError = "last_error"
    case requiresReconnect = "requires_reconnect"
  }
}

final class HafaWidgetCredentialStore {
  static let shared = HafaWidgetCredentialStore()

  private var accessGroup: String? {
    Bundle.main.object(forInfoDictionaryKey: "HafaWidgetKeychainAccessGroup") as? String
  }

  private func query() -> [CFString: Any] {
    var query: [CFString: Any] = [
      kSecClass: kSecClassGenericPassword,
      kSecAttrService: HafaWidgetConstants.credentialService,
      kSecAttrAccount: HafaWidgetConstants.credentialAccount,
    ]
    if let accessGroup, !accessGroup.isEmpty {
      query[kSecAttrAccessGroup] = accessGroup
    }
    return query
  }

  func write(_ token: String) throws {
    guard let data = token.data(using: .utf8), !data.isEmpty else {
      throw HafaWidgetError.missingSession
    }
    let base = query()
    let attributes: [CFString: Any] = [
      kSecValueData: data,
      kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let updateStatus = SecItemUpdate(base as CFDictionary, attributes as CFDictionary)
    if updateStatus == errSecSuccess { return }
    if updateStatus != errSecItemNotFound { throw HafaWidgetError.keychain(updateStatus) }

    var insert = base
    attributes.forEach { insert[$0.key] = $0.value }
    let insertStatus = SecItemAdd(insert as CFDictionary, nil)
    guard insertStatus == errSecSuccess else { throw HafaWidgetError.keychain(insertStatus) }
  }

  func read() -> String? {
    var request = query()
    request[kSecReturnData] = true
    request[kSecMatchLimit] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    guard status == errSecSuccess,
          let data = result as? Data,
          let token = String(data: data, encoding: .utf8) else {
      return nil
    }
    return token
  }

  func delete() throws {
    let status = SecItemDelete(query() as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw HafaWidgetError.keychain(status)
    }
  }
}

final class HafaWidgetStore {
  static let shared = HafaWidgetStore()

  private let encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return encoder
  }()
  private let decoder = JSONDecoder()

  private func containerURL() throws -> URL {
    guard let url = FileManager.default.containerURL(
      forSecurityApplicationGroupIdentifier: HafaWidgetConstants.appGroup
    ) else {
      throw HafaWidgetError.appGroupUnavailable
    }
    return url
  }

  private func stateURL() throws -> URL {
    try containerURL().appendingPathComponent(HafaWidgetConstants.stateFile)
  }

  private func withFileLock<T>(_ operation: () throws -> T) throws -> T {
    let lockURL = try containerURL().appendingPathComponent(HafaWidgetConstants.lockFile)
    let descriptor = open(lockURL.path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
    guard descriptor >= 0 else { throw POSIXError(.EIO) }
    defer { close(descriptor) }
    guard flock(descriptor, LOCK_EX) == 0 else { throw POSIXError(.EIO) }
    defer { flock(descriptor, LOCK_UN) }
    return try operation()
  }

  private func readUnlocked() throws -> HafaWidgetState {
    let url = try stateURL()
    guard FileManager.default.fileExists(atPath: url.path) else {
      return HafaWidgetState()
    }
    do {
      return try decoder.decode(HafaWidgetState.self, from: Data(contentsOf: url))
    } catch {
      try? FileManager.default.removeItem(at: url)
      return HafaWidgetState(lastError: "Open Håfa Recipes to reconnect.", requiresReconnect: true)
    }
  }

  private func writeUnlocked(_ state: HafaWidgetState) throws {
    let url = try stateURL()
    try encoder.encode(state).write(to: url, options: [.atomic])
    try? FileManager.default.setAttributes(
      [
        .protectionKey: FileProtectionType.completeUntilFirstUserAuthentication,
        .posixPermissions: NSNumber(value: S_IRUSR | S_IWUSR),
      ],
      ofItemAtPath: url.path
    )
  }

  func readState() throws -> HafaWidgetState {
    try withFileLock { try readUnlocked() }
  }

  @discardableResult
  func mutateState<T>(_ mutation: (inout HafaWidgetState) throws -> T) throws -> T {
    try withFileLock {
      var state = try readUnlocked()
      let result = try mutation(&state)
      try writeUnlocked(state)
      return result
    }
  }

  func configureSession(token: String, apiBaseURL: String, snapshotData: Data) throws {
    guard let baseURL = URL(string: apiBaseURL),
          let scheme = baseURL.scheme?.lowercased(),
          let host = baseURL.host,
          (scheme == "https" || (scheme == "http" && Self.isLocalDevelopmentHost(host))),
          baseURL.user == nil,
          baseURL.password == nil,
          baseURL.query == nil,
          baseURL.fragment == nil else {
      throw HafaWidgetError.invalidAPIBaseURL
    }
    let snapshot = try decodeSnapshot(snapshotData)
    try HafaWidgetCredentialStore.shared.write(token)
    try mutateState { state in
      let scopeChanged = state.accountScopeID != snapshot.accountScopeID
        || state.snapshot?.list.id != snapshot.list.id
      state.apiBaseURL = baseURL.absoluteString
      state.accountScopeID = snapshot.accountScopeID
      if scopeChanged {
        state.pending = []
        state.pageOffsets = nil
      }
      state.snapshot = merging(snapshot, into: state)
      state.lastError = nil
      state.requiresReconnect = false
    }
  }

  func mergeServerSnapshot(_ data: Data) throws {
    let snapshot = try decodeSnapshot(data)
    var scopeChanged = false
    try mutateState { state in
      if let accountScopeID = state.accountScopeID,
         accountScopeID != snapshot.accountScopeID {
        state.snapshot = nil
        state.pending = []
        state.pageOffsets = nil
        state.accountScopeID = nil
        state.apiBaseURL = nil
        state.requiresReconnect = true
        state.lastError = "Open Håfa Recipes to reconnect."
        scopeChanged = true
        return
      }
      if let currentListID = state.snapshot?.list.id, currentListID != snapshot.list.id {
        state.requiresReconnect = true
        state.lastError = "Open Håfa Recipes to reconnect."
        return
      }
      state.accountScopeID = snapshot.accountScopeID
      state.snapshot = merging(snapshot, into: state)
      state.lastError = nil
      state.requiresReconnect = false
    }
    if scopeChanged {
      try? HafaWidgetCredentialStore.shared.delete()
    }
  }

  func enqueue(listID: String, itemID: String, checked: Bool) throws -> String {
    let mutationID = UUID().uuidString.lowercased()
    let createdAt = ISO8601DateFormatter().string(from: Date())
    try mutateState { state in
      guard state.snapshot?.list.id == listID else { throw HafaWidgetError.missingSession }
      state.pending.append(
        HafaWidgetPendingMutation(
          id: mutationID,
          listID: listID,
          itemID: itemID,
          checked: checked,
          createdAt: createdAt
        )
      )
      state.snapshot?.setChecked(itemID: itemID, checked: checked)
      state.lastError = nil
    }
    return mutationID
  }

  func complete(mutationID: String, snapshot: HafaWidgetSnapshot) throws {
    try mutateState { state in
      guard state.accountScopeID == snapshot.accountScopeID,
            state.snapshot?.list.id == snapshot.list.id else {
        throw HafaWidgetError.invalidResponse
      }
      state.pending.removeAll { $0.id == mutationID }
      state.accountScopeID = snapshot.accountScopeID
      state.snapshot = applying(state.pending, to: snapshot)
      state.lastError = nil
      state.requiresReconnect = false
    }
  }

  func drop(mutationID: String, message: String?) {
    try? mutateState { state in
      state.pending.removeAll { $0.id == mutationID }
      state.lastError = message
    }
  }

  func recordRetryableError(_ message: String) {
    try? mutateState { state in state.lastError = message }
  }

  func requireReconnect(clearScope: Bool) {
    try? HafaWidgetCredentialStore.shared.delete()
    try? mutateState { state in
      state.requiresReconnect = true
      state.lastError = "Open Håfa Recipes to reconnect."
      if clearScope {
        state.snapshot = nil
        state.pending = []
        state.pageOffsets = nil
        state.accountScopeID = nil
        state.apiBaseURL = nil
      }
    }
  }

  func clearSession() throws {
    var firstError: Error?
    do {
      try HafaWidgetCredentialStore.shared.delete()
    } catch {
      firstError = error
    }
    do {
      try withFileLock {
        let url = try stateURL()
        if FileManager.default.fileExists(atPath: url.path) {
          try FileManager.default.removeItem(at: url)
        }
      }
    } catch {
      if firstError == nil { firstError = error }
    }
    if let firstError { throw firstError }
  }

  private func decodeSnapshot(_ data: Data) throws -> HafaWidgetSnapshot {
    do {
      let snapshot = try decoder.decode(HafaWidgetSnapshot.self, from: data)
      guard !snapshot.accountScopeID.isEmpty, !snapshot.list.id.isEmpty else {
        throw HafaWidgetError.invalidSnapshot
      }
      return snapshot
    } catch let error as HafaWidgetError {
      throw error
    } catch {
      throw HafaWidgetError.invalidSnapshot
    }
  }

  private func applying(
    _ pending: [HafaWidgetPendingMutation],
    to serverSnapshot: HafaWidgetSnapshot
  ) -> HafaWidgetSnapshot {
    var snapshot = serverSnapshot
    for mutation in pending where mutation.listID == snapshot.list.id {
      snapshot.setChecked(itemID: mutation.itemID, checked: mutation.checked)
    }
    return snapshot
  }

  private func merging(
    _ incoming: HafaWidgetSnapshot,
    into state: HafaWidgetState
  ) -> HafaWidgetSnapshot {
    // App and widget requests run in separate processes. An app fetch can
    // begin before a widget mutation commits and arrive afterward, so only
    // advance confirmed state monotonically by the server-owned list revision.
    let confirmed: HafaWidgetSnapshot
    if let current = state.snapshot,
       current.accountScopeID == incoming.accountScopeID,
       current.list.id == incoming.list.id,
       current.list.revision > incoming.list.revision {
      confirmed = current
    } else {
      confirmed = incoming
    }
    return applying(state.pending, to: confirmed)
  }

  private static func isLocalDevelopmentHost(_ host: String) -> Bool {
    let normalized = host.lowercased()
    if normalized == "localhost" || normalized == "::1" { return true }
    let parts = normalized.split(separator: ".").compactMap { Int($0) }
    guard parts.count == 4, parts.allSatisfy({ (0...255).contains($0) }) else {
      return false
    }
    return parts[0] == 127
      || parts[0] == 10
      || (parts[0] == 192 && parts[1] == 168)
      || (parts[0] == 172 && (16...31).contains(parts[1]))
  }
}

private struct HafaWidgetSetCheckedRequest: Encodable {
  let mutationID: String
  let listID: String
  let itemID: String
  let checked: Bool

  enum CodingKeys: String, CodingKey {
    case mutationID = "mutation_id"
    case listID = "list_id"
    case itemID = "item_id"
    case checked
  }
}

private struct HafaWidgetMutationResponse: Decodable {
  let mutationID: String
  let replayed: Bool
  let snapshot: HafaWidgetSnapshot

  enum CodingKeys: String, CodingKey {
    case mutationID = "mutation_id"
    case replayed, snapshot
  }
}

actor HafaWidgetSyncClient {
  static let shared = HafaWidgetSyncClient()

  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()
  private let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 15
    configuration.timeoutIntervalForResource = 20
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.urlCache = nil
    return URLSession(configuration: configuration)
  }()

  func setChecked(listID: String, itemID: String, checked: Bool) async {
    do {
      _ = try HafaWidgetStore.shared.enqueue(
        listID: listID,
        itemID: itemID,
        checked: checked
      )
      await flushPending()
    } catch {
      HafaWidgetStore.shared.recordRetryableError("Open Håfa Recipes to reconnect.")
    }
  }

  func flushPending() async {
    for _ in 0..<20 {
      let state: HafaWidgetState
      do {
        state = try HafaWidgetStore.shared.readState()
      } catch {
        return
      }
      guard let mutation = state.pending.first else { return }
      guard let request = makeRequest(
        path: "api/grocery/widget/set-checked",
        method: "POST",
        state: state,
        body: try? encoder.encode(
          HafaWidgetSetCheckedRequest(
            mutationID: mutation.id,
            listID: mutation.listID,
            itemID: mutation.itemID,
            checked: mutation.checked
          )
        )
      ) else {
        HafaWidgetStore.shared.recordRetryableError("Open Håfa Recipes to reconnect.")
        return
      }

      do {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
          throw HafaWidgetError.invalidResponse
        }
        switch http.statusCode {
        case 200..<300:
          let result = try decoder.decode(HafaWidgetMutationResponse.self, from: data)
          guard result.mutationID == mutation.id,
                result.snapshot.accountScopeID == state.accountScopeID,
                result.snapshot.list.id == mutation.listID else {
            throw HafaWidgetError.invalidResponse
          }
          try HafaWidgetStore.shared.complete(
            mutationID: mutation.id,
            snapshot: result.snapshot
          )
        case 401:
          HafaWidgetStore.shared.requireReconnect(clearScope: false)
          return
        case 409:
          HafaWidgetStore.shared.requireReconnect(clearScope: true)
          return
        case 400, 404, 422:
          HafaWidgetStore.shared.drop(
            mutationID: mutation.id,
            message: "That item changed. Refreshing your list."
          )
          await refreshSnapshot(flushFirst: false)
        default:
          throw HafaWidgetError.server(http.statusCode)
        }
      } catch {
        HafaWidgetStore.shared.recordRetryableError("Will sync when the connection returns.")
        return
      }
    }
  }

  func refreshSnapshot(flushFirst: Bool = true) async {
    if flushFirst { await flushPending() }
    let state: HafaWidgetState
    do {
      state = try HafaWidgetStore.shared.readState()
    } catch {
      return
    }
    guard let request = makeRequest(
      path: "api/grocery/widget/snapshot",
      method: "GET",
      state: state,
      body: nil
    ) else { return }

    do {
      let (data, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else {
        throw HafaWidgetError.invalidResponse
      }
      switch http.statusCode {
      case 200..<300:
        try HafaWidgetStore.shared.mergeServerSnapshot(data)
      case 401:
        HafaWidgetStore.shared.requireReconnect(clearScope: false)
      case 409:
        HafaWidgetStore.shared.requireReconnect(clearScope: true)
      default:
        throw HafaWidgetError.server(http.statusCode)
      }
    } catch {
      HafaWidgetStore.shared.recordRetryableError("Showing the last saved list.")
    }
  }

  func revokeAndClearSession() async throws -> Bool {
    let state = try? HafaWidgetStore.shared.readState()
    let request = state.flatMap {
      makeRequest(
        path: "api/grocery/widget/session",
        method: "DELETE",
        state: $0,
        body: nil
      )
    }
    // Privacy boundary: remove the bearer and rendered list before waiting on
    // a best-effort network revocation. The already-built request retains only
    // the in-memory capability needed to revoke itself.
    try HafaWidgetStore.shared.clearSession()
    guard let request else { return false }
    do {
      let (_, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else { return false }
      return (200..<300).contains(http.statusCode) || http.statusCode == 401
    } catch {
      return false
    }
  }

  private func makeRequest(
    path: String,
    method: String,
    state: HafaWidgetState,
    body: Data?
  ) -> URLRequest? {
    guard let rawBaseURL = state.apiBaseURL,
          let baseURL = URL(string: rawBaseURL),
          let token = HafaWidgetCredentialStore.shared.read() else {
      return nil
    }
    var url = baseURL
    for component in path.split(separator: "/") {
      url.appendPathComponent(String(component))
    }
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.httpBody = body
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if body != nil {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    request.setValue(UUID().uuidString, forHTTPHeaderField: "X-Request-ID")
    return request
  }
}
