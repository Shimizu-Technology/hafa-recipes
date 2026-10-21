import Foundation

// The exact immutable payload is used by both host recovery and direct intake.
enum BabySharePayload {
  static func merging(_ raw: Any, caption: String) throws -> Any {
    guard !caption.isEmpty else { return raw }
    if var strings = raw as? [String] {
      if !strings.contains(caption) { strings.append(caption) }; return strings
    }
    guard let bytes = raw as? Data,
      var rows = try JSONSerialization.jsonObject(with: bytes) as? [[String: Any]] else {
      throw BabyShareStore.Failure.invalid
    }
    rows.append(["text": caption]); return try JSONSerialization.data(withJSONObject: rows)
  }
  static func requestBody(_ capture: [String: Any]) throws -> Data {
    try JSONSerialization.data(withJSONObject: capture.filter {
      ["capture_id", "occurred_at", "url", "text", "automatic_epoch"].contains($0.key)
    })
  }
  static func decode(_ saved: BabyShareStore.Snapshot) throws -> [String: Any] {
    var texts: [String] = [], link: String?, files: [[String: Any]] = []
    if let strings = saved.raw as? [String] { texts = strings }
    else if let bytes = saved.raw as? Data,
      let rows = try JSONSerialization.jsonObject(with: bytes) as? [[String: Any]] {
      for row in rows {
        if let url = row["url"] as? String { link = link ?? url }
        if let text = row["text"] as? String, !texts.contains(text) { texts.append(text) }
        if let meta = row["meta"] as? String, let data = meta.data(using: .utf8),
          let fields = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
          for key in ["description", "og:description"] {
            if let text = fields[key] as? String, !texts.contains(text) { texts.append(text) }
          }
        }
        if row["path"] is String { files.append(row) }
      }
    }
    let text = texts.joined(separator: "\n")
    if link == nil {
      let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
      let links = detector?.matches(in: text, range: NSRange(text.startIndex..., in: text)) ?? []
      if links.count == 1 { link = links.first?.url?.absoluteString }
    }
    let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let id = String(saved.token.split(separator: ":")[0]).lowercased()
    var result: [String: Any] = ["token": saved.token, "capture_id": id, "record_id": id,
      "occurred_at": format.string(from: saved.occurredAt), "files": files, "automatic_epoch": saved.automaticEpoch]
    result["scope"] = saved.scope; result["url"] = link; result["text"] = text.isEmpty ? nil : text
    if let receipt = saved.receipt {
      result["status"] = receipt["status"]; result["import_id"] = receipt["import_id"]
    }
    return result
  }
}
