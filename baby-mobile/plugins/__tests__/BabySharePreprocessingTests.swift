import Foundation

@main
struct BabySharePreprocessingTests {
  static func main() throws {
    let key = "NSExtensionJavaScriptPreprocessingResultsKey"
    var cases = 0
    func payload(_ url: Any = "https://example.test/baby.pdf", _ meta: Any = "{}") -> NSDictionary {
      [key: ["baseURI": url, "meta": meta]]
    }
    func rejects(_ value: Any?) throws {
      do {
        _ = try BabySharePreprocessing.decode(value, resultsKey: key)
      } catch {
        cases += 1
        return
      }
      throw NSError(domain: "ShareDecoderUnexpectedAcceptance", code: cases)
    }
    for url in ["https://example.test/baby.pdf?download=1#page=2", "http://example.test/article", "https://例え.test/guide"] {
      let page = try BabySharePreprocessing.decode(payload(url, "{\"title\":\"A parent’s guide\",\"images\":[],\"nested\":{\"ok\":true}}"), resultsKey: key)
      guard page.url == url,
        let bytes = page.metadata.data(using: .utf8),
        let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
        object["title"] as? String == "A parent’s guide"
      else { throw NSError(domain: "ShareDecoderLostPage", code: cases) }
      cases += 1
    }
    try rejects(nil)
    try rejects("not a property list")
    try rejects(NSDictionary())
    try rejects([key: "wrong results"] as NSDictionary)
    try rejects([key: ["meta": "{}"]] as NSDictionary)
    try rejects([key: ["baseURI": "https://example.test"]] as NSDictionary)
    try rejects(payload(42))
    try rejects(payload("https://example.test", NSDictionary()))
    for url in ["", "https://", "https:///path", "file:///private/page.pdf", "javascript:alert(1)",
                "https://user:secret@example.test/a", "https://user@example.test", "https://@example.test", "https://user%3Asecret@example.test",
                "https://example.test/with space", "https://example.test/\n", "https://example.test/\u{0000}"] {
      try rejects(payload(url))
    }
    try rejects(payload("https://example.test/" + String(repeating: "a", count: BabySharePreprocessing.maxURLBytes)))
    try rejects(payload("https://example.test/" + String(repeating: "界", count: 3_000)))
    for metadata in ["", "{", "[]", "null", "true", "\"text\"", "{\"value\":NaN}",
                     "{\"title\":\"" + String(repeating: "x", count: BabySharePreprocessing.maxMetadataBytes) + "\"}",
                     "{\"title\":\"" + String(repeating: "界", count: 25_000) + "\"}"] {
      try rejects(payload("https://example.test/page", metadata))
    }
    print("Baby Safari decoder: \(cases) native Foundation cases passed")
  }
}
