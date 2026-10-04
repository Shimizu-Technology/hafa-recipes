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
let privateSession: [String: Any] = ["accountScopeId": "owner-a", "isPublic": false, "location": "Guam"]
let publicPreference: [String: Any] = ["accountScopeId": "owner-a", "isPublic": true, "location": "Hawaii"]
let snapshot = HafaShareStore.capturePreferences(session: privateSession, preferences: publicPreference)
assert(snapshot["requestedIsPublic"] as? Bool == true)
assert(snapshot["location"] as? String == "Hawaii")
assert(snapshot["accountScopeId"] as? String == "owner-a")
let anotherAccount: [String: Any] = ["accountScopeId": "owner-b", "isPublic": true, "location": "United Kingdom"]
let mismatched = HafaShareStore.capturePreferences(session: privateSession, preferences: anotherAccount)
assert(mismatched["requestedIsPublic"] as? Bool == false)
assert(mismatched["location"] as? String == "Guam")
let signedOut = HafaShareStore.capturePreferences(session: nil, preferences: publicPreference)
assert(signedOut["requestedIsPublic"] as? Bool == true)
assert(signedOut["accountScopeId"] == nil)
let fresh = HafaShareStore.capturePreferences(session: nil, preferences: nil)
assert(fresh["requestedIsPublic"] as? Bool == true && fresh["accountScopeId"] == nil)
let notYetProvisioned = HafaShareStore.capturePreferences(session: nil, preferences: privateSession)
assert(notYetProvisioned["requestedIsPublic"] as? Bool == false)
assert(notYetProvisioned["accountScopeId"] == nil)
// Later account settings cannot broaden or relocate an existing capture.
let oldPrivateCapture: [String: Any] = ["requestedIsPublic": false, "location": "Guam"]
let request = HafaShareStore.importPayload(captureID: "original-id", url: "https://example.com/recipe", metadata: oldPrivateCapture)
assert(request["is_public"] as? Bool == false)
assert(request["location"] as? String == "Guam")
let legacy = HafaShareStore.importPayload(captureID: "legacy-id", url: "https://example.com/recipe", metadata: [:])
assert(legacy["is_public"] == nil && legacy["location"] == nil)
print("Native share reducer and HTTPS capability boundaries passed")
