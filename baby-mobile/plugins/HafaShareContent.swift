import Foundation

// The share card's plain content: choices, outcomes and the words for a shared link.
// Turns what a share carries (a link, and the page's title when there is one) into the words on the card.
// Foundation only, so it runs in the Mac tests. Keep the copies in the three apps identical.
enum HafaSharePreviewText {
  struct Described: Equatable {
    let title: String
    let subtitle: String?
  }

  private static let sites = [
    "instagram.com": "Instagram", "tiktok.com": "TikTok", "youtube.com": "YouTube", "youtu.be": "YouTube",
    "facebook.com": "Facebook", "fb.watch": "Facebook", "pinterest.com": "Pinterest", "pin.it": "Pinterest",
    "x.com": "X", "twitter.com": "X", "threads.net": "Threads", "threads.com": "Threads",
  ]
  // Titles a site gives every page, which say nothing about this one.
  private static let empty: Set<String> = [
    "instagram", "login • instagram", "tiktok", "tiktok - make your day", "youtube", "facebook", "log in or sign up to view",
    "pinterest", "x", "threads",
  ]

  static func host(_ url: URL) -> String? {
    guard let host = url.host?.lowercased(), !host.isEmpty else { return nil }
    return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
  }

  // "Instagram" for instagram.com and its subdomains, otherwise the bare host.
  static func site(_ url: URL) -> String? {
    guard let host = host(url) else { return nil }
    for (domain, name) in sites where host == domain || host.hasSuffix("." + domain) { return name }
    return host
  }

  // A creator handle that the link itself names, such as tiktok.com/@cook/video/1.
  static func handle(_ url: URL) -> String? {
    let first = url.pathComponents.dropFirst().first ?? ""
    guard first.hasPrefix("@"), first.count > 1, first.count <= 40 else { return nil }
    return first
  }

  // Whether the phone may ask a link for its own title and picture. Never one that carries a sign-in, a token or a
  // signature, nor a private address or a Håfa link, which could be someone's unlisted recipe. Anything else stays
  // with what the share itself said.
  static func mayFetchPreview(_ url: URL) -> Bool {
    guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false), ["http", "https"].contains(parts.scheme?.lowercased() ?? ""),
      parts.user == nil, parts.password == nil, let host = parts.host?.lowercased(), host.contains("."), !host.hasSuffix(".")
    else { return false }
    // An address, not a name: local networks, and anything that can't be told apart from them.
    if host.contains(":") || host.split(separator: ".").allSatisfy({ $0.allSatisfy(\.isNumber) }) { return false }
    for suffix in [".local", ".localhost", ".internal", ".lan", ".home.arpa", ".test", ".invalid", ".example"] where host.hasSuffix(suffix) { return false }
    for domain in ["hafa-recipes.com", "hafarecipes.com", "shimizu-technology.com"] where host == domain || host.hasSuffix("." + domain) { return false }
    let names = (parts.queryItems ?? []).map { $0.name.lowercased() } + (parts.fragment ?? "").split(separator: "&").map { $0.split(separator: "=").first.map { String($0).lowercased() } ?? "" }
    for name in names {
      if ["key", "apikey", "api_key", "sig", "code", "auth", "session", "sessionid", "jwt", "otp", "state"].contains(name)
        || ["token", "secret", "password", "signature", "credential", "x-amz-", "x-goog-"].contains(where: name.contains) { return false }
    }
    return true
  }

  static func describe(url: URL?, pageTitle: String?, fallback: (String?) -> String) -> Described {
    let site = url.flatMap(site)
    var creator = url.flatMap(handle)
    var title = clean(pageTitle ?? "")
    // Instagram: `Cook Name on Instagram: "Garlic noodles 🍜 …"`.
    if let range = title.range(of: " on Instagram: ") {
      let name = String(title[..<range.lowerBound]).trimmingCharacters(in: .whitespaces)
      if creator == nil, !name.isEmpty { creator = name }
      title = clean(String(title[range.upperBound...]).trimmingCharacters(in: CharacterSet(charactersIn: "\"“”' ")))
    }
    for suffix in [" | TikTok", " - YouTube", " | Instagram", " • Instagram", " | Facebook", " | Pinterest"] where title.hasSuffix(suffix) {
      title = String(title.dropLast(suffix.count))
    }
    title = firstLine(title)
    if empty.contains(title.lowercased()) { title = "" }
    let subtitle = [creator, site].compactMap { $0 }.joined(separator: " · ")
    return Described(title: title.isEmpty ? fallback(site) : title, subtitle: subtitle.isEmpty ? nil : subtitle)
  }

  private static func clean(_ text: String) -> String {
    text.replacingOccurrences(of: "\u{00A0}", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
  }

  // Captions run long; the card shows the first line, at most about two lines' worth.
  private static func firstLine(_ text: String) -> String {
    let line = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
    let trimmed = clean(line)
    guard trimmed.count > 90 else { return trimmed }
    return String(trimmed.prefix(89)).trimmingCharacters(in: .whitespaces) + "…"
  }
}

struct HafaShareOption: Identifiable, Equatable {
  let id: String
  let title: String
  var detail: String? = nil
  var symbol: String? = nil
}

struct HafaShareChoice: Identifiable, Equatable {
  enum Style { case cards, chips }
  let id: String
  let label: String
  let style: Style
  var options: [HafaShareOption]
  var selected: String?
}

struct HafaShareOutcome: Equatable {
  // `close` is the X, a tap outside the card, or the card closing itself.
  enum Button { case primary, secondary, close }
  let symbol: String
  var isProblem = false
  let title: String
  let detail: String?
  let primary: String
  var secondary: String? = nil
  // The button that opens the app, if one does.
  var opens: Button? = nil
  // Only an answer with nothing left to do closes on its own. Anything with a next step waits for a tap.
  var closesItself = false
}
