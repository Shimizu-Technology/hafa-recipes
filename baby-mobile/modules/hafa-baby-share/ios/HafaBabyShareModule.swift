import ExpoModulesCore
import CryptoKit
import Foundation

public final class HafaBabyShareModule: Module {
  private let group = "group.com.shimizutechnology.hafababy"
  private let sharedKey = "hafababyShareKey"
  private let receiptKey = "babyCaptureId"

  public func definition() -> ModuleDefinition {
    Name("HafaBabyShare")
    AsyncFunction("pending") { () -> [String: Any]? in self.snapshot() }
    Function("acknowledge") { (token: String) -> Bool in self.acknowledge(token) }
    Function("clear") { if let capture = self.snapshot(), let token = capture["token"] as? String { _ = self.acknowledge(token) } }
  }

  private func defaults() -> UserDefaults? { UserDefaults(suiteName: group) }
  private func snapshot() -> [String: Any]? {
    guard let raw = defaults()?.object(forKey: sharedKey) else { return nil }
    var result: [String: Any] = ["files": [[String: Any]]()]
    let payload: Data
    if let strings = raw as? [String] {
      result["text"] = strings.joined(separator: "\n")
      payload = Data(strings.joined(separator: "\n").utf8)
    } else if let data = raw as? Data,
              let rows = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] {
      payload = data
      var files: [[String: Any]] = []
      for row in rows {
        if let url = row["url"] as? String { result["url"] = url }
        if let path = row["path"] as? String, let file = ownedFile(path) {
          files.append(["path": file.absoluteString, "fileName": row["fileName"] as? String ?? file.lastPathComponent,
                        "mimeType": row["mimeType"] as? String ?? "application/octet-stream"])
        }
      }
      result["files"] = files
    } else { return nil }
    result["token"] = defaults()?.string(forKey: receiptKey) ?? SHA256.hash(data: payload).map { String(format: "%02x", $0) }.joined()
    return result
  }

  private func ownedFile(_ path: String) -> URL? {
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else { return nil }
    let parsed = URL(string: path)
    let file = ((parsed?.isFileURL == true) ? parsed! : root.appendingPathComponent(URL(fileURLWithPath: path).lastPathComponent)).standardizedFileURL.resolvingSymlinksInPath()
    let canonicalRoot = root.standardizedFileURL.resolvingSymlinksInPath()
    let parent = file.deletingLastPathComponent()
    guard parent == canonicalRoot || parent == canonicalRoot.appendingPathComponent("thumbnail") else { return nil }
    return file
  }

  private func acknowledge(_ token: String) -> Bool {
    guard let saved = snapshot(), saved["token"] as? String == token else { return false }
    // Clear only this exact receipt. A newer share is never acknowledged by an older screen.
    if let data = defaults()?.data(forKey: sharedKey),
       let rows = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] {
      for row in rows { for field in ["path", "thumbnail"] {
        if let path = row[field] as? String, let file = ownedFile(path) { if FileManager.default.fileExists(atPath: file.path) { do { try FileManager.default.removeItem(at: file) } catch { return false } } }
      } }
    }
    defaults()?.removeObject(forKey: sharedKey)
    defaults()?.removeObject(forKey: receiptKey)
    defaults()?.synchronize()
    return true
  }
}
