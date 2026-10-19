import Foundation

// Foundation-only decoder shared by the generated extension and native tests.
enum BabySharePreprocessing {
  static let maxURLBytes = 8_192
  static let maxMetadataBytes = 65_536

  struct Page {
    let url: String
    let metadata: String
  }

  enum InvalidPage: Error { case invalid }

  static func decode(_ item: Any?, resultsKey: String) throws -> Page {
    guard let item = item as? NSDictionary,
      let results = item[resultsKey] as? NSDictionary,
      let rawURL = results["baseURI"] as? String,
      !rawURL.isEmpty, rawURL.utf8.count <= maxURLBytes,
      rawURL.rangeOfCharacter(from: .whitespacesAndNewlines.union(.controlCharacters)) == nil,
      let components = URLComponents(string: rawURL),
      let scheme = components.scheme?.lowercased(), ["http", "https"].contains(scheme),
      let host = components.host, !host.isEmpty,
      components.user == nil, components.password == nil,
      components.url != nil,
      let metadata = results["meta"] as? String,
      metadata.utf8.count <= maxMetadataBytes,
      let bytes = metadata.data(using: .utf8)
    else { throw InvalidPage.invalid }

    // Only JSON objects are accepted. Never pass arbitrary property-list values
    // or malformed/oversized JSON through to the receiving app.
    let value = try JSONSerialization.jsonObject(with: bytes)
    guard let object = value as? [String: Any], JSONSerialization.isValidJSONObject(object)
    else { throw InvalidPage.invalid }
    let normalized = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    guard normalized.count <= maxMetadataBytes,
      let safeMetadata = String(data: normalized, encoding: .utf8)
    else { throw InvalidPage.invalid }
    return Page(url: rawURL, metadata: safeMetadata)
  }
}
