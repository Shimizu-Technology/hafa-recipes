import Darwin
import Foundation
import ImageIO

// The share card's plain content: choices, outcomes and the words for a shared link.
// Turns what a share carries (a link, and the page's title when there is one) into the words on the card.
// Uses system APIs available in the Mac tests. Keep the copies in the three apps identical.
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

// Reads only a small decoded image from the file, including EXIF orientation.
// Used on a utility queue after the source has a durable queue receipt.
enum HafaShareThumbnail {
  static func image(at url: URL) -> CGImage? {
    guard url.isFileURL,
      let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
    return CGImageSourceCreateThumbnailAtIndex(source, 0, [
      kCGImageSourceThumbnailMaxPixelSize: 180,
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceShouldCacheImmediately: true,
    ] as CFDictionary)
  }
}

// A preview is optional network activity before Save. Sensitive shares keep only
// the metadata supplied by the sender; they never enter LinkPresentation.
enum HafaSharePreviewPolicy {
  static func allows(_ url: URL) -> Bool {
    guard let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme),
      url.user == nil, url.password == nil,
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      var host = components.host?.lowercased(), !host.isEmpty else { return false }
    if containsSecrets(components.queryItems ?? []) { return false }
    if let fragment = components.fragment {
      // OAuth and signed share parameters sometimes live after #. Ordinary
      // section anchors carry no credential and keep their network preview.
      var parameters = URLComponents()
      parameters.query = String(fragment.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).last ?? "")
      if containsSecrets((parameters.queryItems ?? []).filter { $0.value != nil }) { return false }
    }
    let path = url.pathComponents
    let domain = host.trimmingCharacters(in: CharacterSet(charactersIn: "."))
    func belongsTo(_ base: String) -> Bool { domain == base || domain.hasSuffix("." + base) }
    if belongsTo("docs.google.com") || belongsTo("drive.google.com") && url.path.hasPrefix("/file/d/") ||
      belongsTo("dropbox.com") && (url.path.hasPrefix("/s/") || url.path.hasPrefix("/scl/")) { return false }
    for index in path.indices where path[index] == "r" && index + 1 < path.count {
      // Unlisted keys are bearer credentials, even on a custom Håfa domain.
      if path[index + 1].range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil { return false }
    }
    host = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]."))
    if host == "localhost" || [".localhost", ".local", ".internal", ".home", ".lan"].contains(where: host.hasSuffix) { return false }
    var v4 = in_addr()
    // inet_aton also catches shortened, decimal, octal and hex IPv4 spellings.
    if inet_aton(host, &v4) == 1 {
      let ip = UInt32(bigEndian: v4.s_addr)
      let a = ip >> 24, b = ip >> 16 & 255
      return !(a == 0 || a == 10 || a == 127 || a == 169 && b == 254 ||
        a == 172 && (16...31).contains(b) || a == 192 && b == 168 ||
        a == 100 && (64...127).contains(b) || a >= 224)
    }
    if host.contains(":") {
      var v6 = in6_addr()
      guard inet_pton(AF_INET6, host, &v6) == 1 else { return false }
      let bytes = withUnsafeBytes(of: v6) { Array($0) }
      // Only global unicast; excludes loopback, unspecified, link-local, ULA,
      // multicast, scoped addresses and IPv4-mapped/translated local literals.
      return bytes[0] & 0xe0 == 0x20 && !(bytes[0] == 0x20 && bytes[1] == 0x02)
    }
    // No single-label intranet hosts or invalid numeric address spellings.
    return host.contains(".") && host.last?.isNumber == false
  }

  private static func containsSecrets(_ items: [URLQueryItem]) -> Bool {
    let secrets: Set<String> = ["token", "key", "sig", "auth", "authorization", "accesstoken", "code", "apikey", "jwt", "password", "credential", "bearer", "session", "sessionid", "rlkey", "resourcekey", "sid", "sk", "otp", "policy", "signature", "expires"]
    return items.contains { item in
      let name = item.name.removingPercentEncoding?.lowercased().filter { $0.isLetter || $0.isNumber }
        ?? item.name.lowercased().filter { $0.isLetter || $0.isNumber }
      return secrets.contains(name) || ["token", "signature", "secret", "credential"].contains(where: name.contains)
    }
  }
}
