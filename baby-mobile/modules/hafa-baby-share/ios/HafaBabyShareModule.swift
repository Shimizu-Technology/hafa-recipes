import ExpoModulesCore
import Foundation

public final class HafaBabyShareModule: Module {
  private let group = "group.com.shimizutechnology.hafababy"
  private let storageLock = NSLock()
  private var storage: BabyShareStore?

  private func store() throws -> BabyShareStore {
    storageLock.lock(); defer { storageLock.unlock() }
    if let storage { return storage }
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
      let defaults = UserDefaults(suiteName: group) else { throw BabyShareStore.Failure.unavailable }
    let value = BabyShareStore(container: root, defaults: defaults)
    storage = value; return value
  }

  private func safely<T>(_ work: () throws -> T) throws -> T {
    do { return try work() }
    catch { throw NSError(domain: "HafaBabyShare", code: 1,
      userInfo: [NSLocalizedDescriptionKey: "Your shared source needs another attempt."]) }
  }

  public func definition() -> ModuleDefinition {
    Name("HafaBabyShare")
    AsyncFunction("pending") { () throws -> [String: Any]? in try self.safely { try self.snapshot() } }
    Function("acknowledge") { (token: String) throws -> Bool in try self.safely { try self.store().acknowledge(token) } }
    Function("clear") { try self.safely { _ = try BabyShareSession.disable(storage: self.store()) } }
    AsyncFunction("clearSession") { (preserveUnassigned: Bool?) async throws in
      try await BabyShareSession.clear(storage: self.store(), preserveUnassigned: preserveUnassigned ?? false)
    }
    AsyncFunction("sessionOwner") { () throws -> String? in
      try self.store().locked { try BabyShareSession.read()?["scope"] as? String }
    }
    AsyncFunction("installationId") { () throws -> String in
      try self.store().locked {
        guard let defaults = UserDefaults(suiteName: self.group) else { throw BabyShareStore.Failure.unavailable }
        let key = "baby.share.installation.v1"
        let id = defaults.string(forKey: key) ?? UUID().uuidString
        defaults.set(id, forKey: key); defaults.synchronize(); return id
      }
    }
    AsyncFunction("configureSession") { (token: String, base: String, expires: String, owner: String, generation: Int, automaticEpoch: Int?) throws in
      try BabyShareSession.configure(storage: self.store(), token: token, base: base, expires: expires, owner: owner, generation: generation, automaticEpoch: automaticEpoch ?? 0)
    }
  }

  private func snapshot() throws -> [String: Any]? {
    let storage = try store()
    guard let saved = try storage.pending() else { return nil }
    var result = try BabySharePayload.decode(saved)
    var files: [[String: Any]] = []
    for row in result["files"] as? [[String: Any]] ?? [] {
      guard let path = row["path"] as? String, let file = storage.ownedFile(path) else { throw BabyShareStore.Failure.invalid }
      files.append(["path": file.absoluteString, "fileName": row["fileName"] as? String ?? file.lastPathComponent,
        "mimeType": row["mimeType"] as? String ?? "application/octet-stream"])
    }
    result["files"] = files
    return result
  }
}
