import Foundation

// What the Baby share card says before Save, and what it shows of the share. Foundation only, so it runs in the Mac tests.
enum BabyShareWords {
  static let action = "Save"
  static let loading = "Getting it ready…"
  static let category = "category"
  static let later = "later"

  struct Share: Equatable {
    var title: String
    var subtitle: String?
    var symbol: String
    // Asked for its own title, if the rules allow. Only a link the share is about.
    var link: URL?
    // The first photo, already on this phone, for the thumbnail.
    var photo: URL?
  }

  static func fallbackTitle(site: String?) -> String { site.map { "Post from \($0)" } ?? "Shared link" }

  // The same reading as BabySharePayload.decode: the first link, or the only link in the text, and the files.
  static func describe(_ payload: Any) -> Share {
    var texts: [String] = [], link: String?, pageTitle: String?, files: [[String: Any]] = []
    if let strings = payload as? [String] { texts = strings }
    else if let bytes = payload as? Data, let rows = (try? JSONSerialization.jsonObject(with: bytes)) as? [[String: Any]] {
      for row in rows {
        if let url = row["url"] as? String, link == nil {
          link = url
          let tags = (row["meta"] as? String)?.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
          pageTitle = tags?["og:title"] as? String ?? tags?["title"] as? String
        }
        if let text = row["text"] as? String { texts.append(text) }
        if row["path"] is String { files.append(row) }
      }
    }
    let text = texts.joined(separator: "\n"), caption = firstLine(text)
    if let first = files.first {
      let mime = (first["mimeType"] as? String ?? "").lowercased(), name = first["fileName"] as? String
      let named = name.map { ($0 as NSString).deletingPathExtension }.flatMap { $0.isEmpty ? nil : $0 }
      if mime.hasPrefix("image/") {
        return Share(title: files.count == 1 ? "1 photo" : "\(files.count) photos", subtitle: caption, symbol: "photo.on.rectangle",
          photo: (first["path"] as? String).flatMap(URL.init(string:)).flatMap { $0.isFileURL ? $0 : nil })
      }
      if mime == "application/pdf" { return Share(title: named ?? "PDF", subtitle: "PDF", symbol: "doc.text") }
      if mime.hasPrefix("video/") { return Share(title: named ?? "Video", subtitle: "Video", symbol: "video") }
      if mime.hasPrefix("audio/") { return Share(title: named ?? "Audio", subtitle: "Audio", symbol: "waveform") }
      return Share(title: named ?? "File", subtitle: nil, symbol: "doc")
    }
    if link == nil {
      let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
      let matches = detector?.matches(in: text, range: NSRange(text.startIndex..., in: text)) ?? []
      if matches.count == 1, let url = matches.first?.url, ["http", "https"].contains(url.scheme?.lowercased() ?? "") { link = url.absoluteString }
    }
    if let link, let url = URL(string: link) {
      let described = HafaSharePreviewText.describe(url: url, pageTitle: pageTitle, fallback: fallbackTitle)
      return Share(title: described.title, subtitle: described.subtitle, symbol: "link", link: url)
    }
    return Share(title: caption ?? "Shared text", subtitle: "Text", symbol: "text.alignleft")
  }

  private static func firstLine(_ text: String) -> String? {
    let line = text.split(whereSeparator: \.isNewline).first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
    guard !line.isEmpty else { return nil }
    return line.count > 90 ? String(line.prefix(89)).trimmingCharacters(in: .whitespaces) + "…" : line
  }

  // Offered only when the app has listed this account's categories for this space. Organize later is always first.
  static func categoryChoice(_ items: [[String: String]], selected: String) -> HafaShareChoice? {
    let options = items.compactMap { item in
      item["id"].flatMap { id in item["title"].map { HafaShareOption(id: id, title: $0, symbol: "folder") } }
    }
    guard !options.isEmpty else { return nil }
    return HafaShareChoice(id: category, label: "Category", style: .chips,
      options: [HafaShareOption(id: later, title: "Organize later", symbol: "tray")] + options, selected: selected)
  }

  // Under the choice: who can see it, and where it goes. A share with no owner has the notice instead.
  static func note(scope: String?, category: String?) -> String? {
    guard let scope else { return nil }
    let who = BabyShareSheetState.isFamily(scope) ? "Parents in your family can see it." : "Only you can see it."
    return who + " " + (category.map { "It’ll go in \($0)." } ?? "You can organize it later.")
  }

  static func notice(scope: String?, signedIn: Bool) -> (symbol: String, text: String)? {
    guard scope == nil else { return nil }
    return signedIn
      ? ("iphone", "Open Håfa Baby once to finish setting up sharing. We’ll keep this on your phone for 30 days.")
      : ("person.crop.circle.badge.exclamationmark", "You’re not signed in. We’ll keep this on your phone for 30 days, in no one’s account.")
  }
}
