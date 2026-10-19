// macOS: swift scripts/check-share-activation.swift <generated-or-built extension Info.plist>
// Evaluate the actual shipped predicate with Apple's UTI-aware Foundation engine.
import Foundation

guard CommandLine.arguments.count == 2,
      let data = FileManager.default.contents(atPath: CommandLine.arguments[1]),
      let info = try PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any],
      let ext = info["NSExtension"] as? [String: Any],
      let attrs = ext["NSExtensionAttributes"] as? [String: Any],
      let rule = attrs["NSExtensionActivationRule"] as? String,
      !rule.contains("TRUEPREDICATE") else {
  fatalError("Expected a bounded activation predicate in the supplied extension Info.plist")
}
let predicate = NSPredicate(format: rule)
func payload(_ providers: [[String]], items: Int = 1) -> [String: Any] {
  ["extensionItems": Array(repeating: ["attachments": providers.map {
    ["registeredTypeIdentifiers": $0]
  }], count: items)]
}
let image = ["public.jpeg", "public.file-url"]
let cases: [(String, [String: Any], Bool)] = [
  ("Safari preprocessing", payload([["com.apple.property-list"]]), true),
  ("PDF alternatives", payload([["com.adobe.pdf", "public.file-url"]]), true),
  ("four images", payload(Array(repeating: image, count: 4)), true),
  ("three images and PDF", payload([image, image, image, ["com.adobe.pdf"]]), false),
  ("image then preprocessing", payload([image, ["com.apple.property-list"]]), false),
  ("preprocessing then image", payload([["com.apple.property-list"], image]), false),
  ("URL alternatives", payload([["public.url", "public.plain-text"]]), true),
  ("text", payload([["public.plain-text"]]), true),
  ("audio file URL", payload([["public.audio", "public.file-url"]]), true),
  ("movie", payload([["public.movie"]]), true),
  ("five images", payload(Array(repeating: image, count: 5)), false),
  ("two PDFs", payload([["com.adobe.pdf"], ["com.adobe.pdf"]]), false),
  ("two non-image providers", payload([["public.url"], ["public.plain-text"]]), false),
  ("audio without file URL", payload([["public.audio"]]), false),
  ("unsupported bytes", payload([["public.data"]]), false),
  ("unsupported provider alongside image", payload([image, ["public.data"]]), false),
  ("multiple extension items", payload([image], items: 2), false),
  ("no providers", payload([]), false),
  ("no items", payload([], items: 0), false),
]
for (name, input, expected) in cases {
  precondition(predicate.evaluate(with: input) == expected, "Share activation mismatch: \(name)")
}
print("\(cases.count) native share activation cases passed")
