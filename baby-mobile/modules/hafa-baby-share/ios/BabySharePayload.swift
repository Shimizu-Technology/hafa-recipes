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
  // The next capture the app can act on, with its files where they are now. One whose files have really gone, or that can't
  // be decoded, is set aside for Today's card and the ones behind it carry on. A locked phone never gets this far, because
  // `pending` can't open the store, so nothing is judged unreadable just for being locked.
  static func next(_ storage: BabyShareStore) throws -> [String: Any]? {
    while let saved = try storage.pending() {
      let id = String(saved.token.split(separator: ":")[0])
      var files: [[String: Any]] = [], readable = true
      var result = try? decode(saved)
      for row in result?["files"] as? [[String: Any]] ?? [] {
        guard let path = row["path"] as? String, let file = storage.ownedFile(path, capture: id),
          FileManager.default.fileExists(atPath: file.path) else { readable = false; continue }
        files.append(["path": file.absoluteString, "fileName": row["fileName"] as? String ?? file.lastPathComponent,
          "mimeType": row["mimeType"] as? String ?? "application/octet-stream"])
      }
      if readable, result != nil, saved.receipt == nil || files.count == (result?["files"] as? [[String: Any]] ?? []).count {
        result?["files"] = files
        return result
      }
      // No account has said it's theirs, so there's nothing to tell yet. The drain stops at these anyway.
      if saved.scope == nil { result?["files"] = files; return result ?? ["token": saved.token, "capture_id": id, "record_id": id, "files": files] }
      guard try storage.block(saved.token, reason: "unreadable") else { throw BabyShareStore.Failure.invalid }
      // Deliver the terminal outcome once, so a claimed card can settle and Today can refresh its refusal card.
      return ["token": saved.token, "capture_id": id.lowercased(), "record_id": id.lowercased(),
        "scope": saved.scope!, "claimed": saved.claimed, "files": [], "blocked": "unreadable"]
    }
    return nil
  }
  static func requestBody(_ capture: [String: Any]) throws -> Data {
    guard capture["claimed"] as? Bool != true else { throw BabyShareStore.Failure.invalid }
    return try JSONSerialization.data(withJSONObject: capture.filter {
      ["capture_id", "occurred_at", "url", "text", "automatic_epoch"].contains($0.key)
    })
  }
  // Enough to recognize a share kept under no account, and nothing more: no caption, no file, no address beyond its website.
  // Whoever is signed in hasn't yet said it's theirs.
  // A website's own name or nothing. Foundation will percent-decode a host into any text at all, including one that reads
  // like a private path, and whoever's signed in hasn't said this is theirs. So: an ordinary http(s) name in plain letters.
  static func website(_ link: String) -> String? {
    guard let parts = URLComponents(string: link), let scheme = parts.scheme?.lowercased(), scheme == "http" || scheme == "https",
      let host = parts.encodedHost?.lowercased(), host.utf8.count <= 253 else { return nil }
    let labels = host.split(separator: ".", omittingEmptySubsequences: false)
    guard labels.count >= 2, let last = labels.last, last.count >= 2, last.allSatisfy({ $0.isASCII && $0.isLetter }),
      labels.allSatisfy({ label in
        !label.isEmpty && label.utf8.count <= 63 && !label.hasPrefix("-") && !label.hasSuffix("-") && !label.hasPrefix("xn--")
          && label.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
      }) else { return nil }
    return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
  }
  static func summary(_ waiting: BabyShareStore.Waiting) throws -> [String: Any] {
    let saved = waiting.snapshot, capture = (try? decode(saved)) ?? [:], files = capture["files"] as? [[String: Any]] ?? []
    let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    var result: [String: Any] = ["token": saved.token, "count": files.count,
      "shared_at": format.string(from: saved.occurredAt), "kept_until": format.string(from: waiting.keptUntil)]
    result["blocked"] = waiting.blocked
    if let mime = (files.first?["mimeType"] as? String)?.lowercased() {
      result["kind"] = mime.hasPrefix("image/") ? "photo" : mime.hasPrefix("video/") ? "video" : mime.hasPrefix("audio/") ? "audio" : mime == "application/pdf" ? "pdf" : "file"
    } else if !files.isEmpty {
      result["kind"] = "file"
    } else if let link = capture["url"] as? String {
      result["kind"] = "link"
      result["host"] = website(link)
    } else {
      result["kind"] = "text"
    }
    return result
  }
  static func decode(_ saved: BabyShareStore.Snapshot) throws -> [String: Any] {
    var texts: [String] = [], link: String?, files: [[String: Any]] = []
    if let strings = saved.raw as? [String] { texts = strings }
    else if let bytes = saved.raw as? Data,
      let rows = try JSONSerialization.jsonObject(with: bytes) as? [[String: Any]] {
      for row in rows {
        guard row["url"] is String || row["text"] is String || row["path"] is String || row["meta"] is String else { throw BabyShareStore.Failure.invalid }
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
    } else { throw BabyShareStore.Failure.invalid }
    let text = texts.joined(separator: "\n")
    if link == nil {
      let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
      let links = detector?.matches(in: text, range: NSRange(text.startIndex..., in: text)) ?? []
      if links.count == 1 { link = links.first?.url?.absoluteString }
    }
    let format = ISO8601DateFormatter(); format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let id = String(saved.token.split(separator: ":")[0]).lowercased()
    var result: [String: Any] = ["token": saved.token, "capture_id": id, "record_id": (saved.recordID ?? id).lowercased(),
      "occurred_at": format.string(from: saved.occurredAt), "files": files, "automatic_epoch": saved.automaticEpoch]
    if saved.claimed { result["claimed"] = true }
    result["scope"] = saved.scope; result["url"] = link; result["text"] = text.isEmpty ? nil : text
    if let receipt = saved.receipt {
      result["status"] = receipt["status"]; result["import_id"] = receipt["import_id"]
    }
    return result
  }
}
