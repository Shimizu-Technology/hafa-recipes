import Foundation

// Execute with swiftc HafaShareShared.swift tests/main.swift -o /tmp/hafa-share-tests.
// These assertions exercise the exact reducer used inside the AppGroup lock.
let a = "hafarecipes://dataUrl=hafarecipesShareKey.a#weburl"
let b = "hafarecipes://dataUrl=hafarecipesShareKey.b#text"
let c = "hafarecipes://dataUrl=hafarecipesShareKey.c#media"
assert(HafaShareStore.remainingPending([a, b, c], acknowledging: "hafarecipesShareKey.b") == [a, c])
assert(HafaShareStore.remainingPending([b, c], acknowledging: "hafarecipesShareKey.a") == [b, c])
assert(HafaShareStore.remainingPending([a, b, c], acknowledging: "hafarecipesShareKey") == [a, b, c])
assert(HafaShareStore.remainingPending([a, b, c], acknowledging: "hafarecipesShareKey.a") == [b, c])
assert(HafaShareStore.validBaseURL("https://recipe-api-x5na.onrender.com") != nil)
for bad in ["http://example.com", "https://secret@example.com", "file:///etc/passwd", "https://example.com?token=secret", "https://example.com#secret"] {
  assert(HafaShareStore.validBaseURL(bad) == nil)
}
print("Native share reducer and HTTPS capability boundaries passed")
