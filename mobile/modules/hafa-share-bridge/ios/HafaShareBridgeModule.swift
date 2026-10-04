import ExpoModulesCore
import Foundation

public final class HafaShareBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HafaShareBridge")
    AsyncFunction("getInstallationId") { () throws -> String in
      guard let value = HafaShareStore.locked({ defaults -> String in
        if let existing = defaults.string(forKey: "hafa.share.installation.v1") { return existing }
        let value = UUID().uuidString
        defaults.set(value, forKey: "hafa.share.installation.v1")
        return value
      }) else { throw NSError(domain: HafaShareStore.service, code: 2) }
      return value
    }
    AsyncFunction("configureSession") { (token: String, apiBaseURL: String, accountScopeId: String, expiresAt: String, location: String, isPublic: Bool) throws in
      guard token.hasPrefix("hfs_v1."), HafaShareStore.validBaseURL(apiBaseURL) != nil, !accountScopeId.isEmpty else { throw NSError(domain: HafaShareStore.service, code: 3) }
      guard try HafaShareStore.locked({ defaults -> Bool in
        // Disable before writing: if Keychain access fails, old credentials
        // cannot remain paired with a newly switched account's preferences.
        defaults.removeObject(forKey: HafaShareStore.sessionKey)
        try HafaShareStore.writeToken(token)
        defaults.set(["apiBaseURL": apiBaseURL, "accountScopeId": accountScopeId, "expiresAt": expiresAt, "location": location, "isPublic": isPublic], forKey: HafaShareStore.sessionKey)
        return true
      }) != nil else { throw NSError(domain: HafaShareStore.service, code: 2) }
    }
    AsyncFunction("readCaptureMetadata") { (key: String) -> String? in
      HafaShareStore.locked { defaults -> String? in
        guard let metadata = HafaShareStore.metadata(key, defaults: defaults), let data = try? JSONSerialization.data(withJSONObject: metadata) else { return nil }
        return String(data: data, encoding: .utf8)
      } ?? nil
    }
    AsyncFunction("getCurrentCaptureMetadata") { () -> String? in
      HafaShareStore.locked { defaults -> String? in
        guard let first = defaults.stringArray(forKey: HafaShareStore.pendingKey)?.first, let key = HafaShareStore.captureKey(from: first), let metadata = HafaShareStore.metadata(key, defaults: defaults), let data = try? JSONSerialization.data(withJSONObject: metadata) else { return nil }
        return String(data: data, encoding: .utf8)
      } ?? nil
    }
    AsyncFunction("acknowledgeCapture") { (key: String) -> Bool in HafaShareStore.acknowledge(key) }
    AsyncFunction("clearSession") { (revoke: Bool) async throws -> Bool in
      let previous = try HafaShareStore.locked { defaults -> ([String: Any]?, String?) in
        let state = defaults.dictionary(forKey: HafaShareStore.sessionKey)
        let token = HafaShareStore.readToken()
        defaults.removeObject(forKey: HafaShareStore.sessionKey)
        try HafaShareStore.writeToken(nil)
        return (state, token)
      }
      guard revoke, let state = previous?.0, let token = previous?.1, let base = state["apiBaseURL"] as? String, let url = HafaShareStore.validBaseURL(base) else { return false }
      var request = URLRequest(url: url.appendingPathComponent("api/share/session"))
      request.httpMethod = "DELETE"
      request.timeoutInterval = 5
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      let session = HafaShareStore.networkSession()
      defer { session.finishTasksAndInvalidate() }
      do {
        let (_, response) = try await session.data(for: request)
        return [204, 401].contains((response as? HTTPURLResponse)?.statusCode ?? 0)
      } catch { return false }
    }
  }
}
