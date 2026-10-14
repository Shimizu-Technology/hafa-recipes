import ExpoModulesCore
import Foundation

public final class HafaWorkoutsShareModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HafaWorkoutsShare")
    AsyncFunction("installationId") { () throws -> String in
      guard let id = WorkoutsShareStore.locked({ d -> String in
        if let id = d.string(forKey: "workouts.share.installation") { return id }
        let id = UUID().uuidString; d.set(id, forKey: "workouts.share.installation"); return id
      }) else { throw NSError(domain: WorkoutsShareStore.service, code: 2) }
      return id
    }
    AsyncFunction("configureSession") { (token: String, base: String, scope: String, expires: String, owner: String, generation: Int, isPublic: Bool) throws in
      let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
      let expiry = format.date(from: expires) ?? ISO8601DateFormatter().date(from: expires)
      guard token.hasPrefix("hfws_v1."), WorkoutsShareStore.baseURL(base) != nil, !scope.isEmpty,
        !owner.isEmpty, generation > 0, let expiry, expiry > Date() else { throw NSError(domain: WorkoutsShareStore.service, code: 3) }
      guard try WorkoutsShareStore.locked({ d -> Bool in
        guard WorkoutsShareStore.reconcileStages(d) else { throw NSError(domain: WorkoutsShareStore.service, code: 4) }
        d.removeObject(forKey: WorkoutsShareStore.sessionKey)
        try WorkoutsShareStore.setToken(token)
        d.set(["apiBaseURL": base, "accountScopeId": scope, "expiresAt": expiry.timeIntervalSince1970,
          "ownerId": owner, "generation": generation, "isPublic": isPublic], forKey: WorkoutsShareStore.sessionKey)
        return true
      }) != nil else { throw NSError(domain: WorkoutsShareStore.service, code: 2) }
    }
    AsyncFunction("captures") { () throws -> String in
      let entries = try WorkoutsShareStore.locked { d in
        guard WorkoutsShareStore.reconcileStages(d) else { throw NSError(domain: WorkoutsShareStore.service, code: 4) }
        return (d.stringArray(forKey: WorkoutsShareStore.pending) ?? []).compactMap { d.dictionary(forKey: $0 + ".capture") }
      } ?? []
      return String(data: try JSONSerialization.data(withJSONObject: entries), encoding: .utf8)!
    }
    AsyncFunction("sessionOwner") { () -> String? in
      WorkoutsShareStore.locked { d -> String? in
        guard let state = d.dictionary(forKey: WorkoutsShareStore.sessionKey),
          let owner = state["ownerId"] as? String, let generation = state["generation"] as? Int else { return nil }
        return "\(owner):\(generation)"
      } ?? nil
    }
    AsyncFunction("acknowledge") { (key: String) -> Bool in WorkoutsShareStore.acknowledge(key) }
    AsyncFunction("discardCaptures") { (owner: String) throws in
      guard WorkoutsShareStore.discardOwner(owner) else { throw NSError(domain: WorkoutsShareStore.service, code: 4) }
    }
    AsyncFunction("clearSession") { () async throws in
      let old = try WorkoutsShareStore.locked { d -> ([String: Any]?, String?) in
        let state = d.dictionary(forKey: WorkoutsShareStore.sessionKey); let token = WorkoutsShareStore.token()
        d.removeObject(forKey: WorkoutsShareStore.sessionKey); try WorkoutsShareStore.setToken(nil)
        return (state, token)
      }
      guard let state = old?.0, let token = old?.1, let base = state["apiBaseURL"] as? String,
        let url = WorkoutsShareStore.baseURL(base) else { return }
      var request = URLRequest(url: url.appendingPathComponent("api/v1/workouts/share/session"))
      request.httpMethod = "DELETE"; request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
      let session = WorkoutsShareStore.network(); defer { session.finishTasksAndInvalidate() }
      _ = try? await session.data(for: request)
    }
  }
}
