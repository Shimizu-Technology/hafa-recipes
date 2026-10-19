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
    Function("clear") { try self.safely { try self.store().clear() } }
  }

  private func snapshot() throws -> [String: Any]? {
    let storage = try store()
    guard let saved = try storage.pending() else { return nil }
    var result: [String: Any] = ["token": saved.token, "files": [[String: Any]]()]
    if let strings = saved.raw as? [String] {
      result["text"] = strings.joined(separator: "\n")
    } else if let data = saved.raw as? Data,
      let rows = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] {
      var files: [[String: Any]] = []
      for row in rows {
        if let url = row["url"] as? String { result["url"] = url }
        if let path = row["path"] as? String, let file = storage.ownedFile(path) {
          files.append(["path": file.absoluteString, "fileName": row["fileName"] as? String ?? file.lastPathComponent,
                        "mimeType": row["mimeType"] as? String ?? "application/octet-stream"])
        }
      }
      result["files"] = files
    } else { return nil }
    return result
  }
}
