import Darwin
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

// Lock contention is bounded and never stalls UIKit or mutates a timed-out receipt.
let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: directory) }
let lock = open(directory.appendingPathComponent("hafa-share-queue.lock").path, O_CREAT | O_RDWR, mode_t(0o600))
assert(lock >= 0 && flock(lock, LOCK_EX) == 0)
defer { close(lock) }
let receipt = directory.appendingPathComponent("fixture.plist")
let original = Data("capture-a:private:unconfirmed".utf8)
try original.write(to: receipt)
var completed = false
var operationRan = false
let start = ProcessInfo.processInfo.systemUptime
HafaShareStore.performCaptureWrite({
  HafaShareStore.withFileLock(directory) {
    operationRan = true
    try! Data("wrong".utf8).write(to: receipt)
    return true
  }
}) { result in
  assert(Thread.isMainThread && result == nil)
  completed = true
}
assert(ProcessInfo.processInfo.systemUptime - start < 0.1)
var mainTicks = 0
while !completed && ProcessInfo.processInfo.systemUptime - start < 2 {
  RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.01)); mainTicks += 1
}
assert(completed && mainTicks > 2 && !operationRan)
assert(ProcessInfo.processInfo.systemUptime - start < 0.8)
let afterTimeout = try Data(contentsOf: receipt)
assert(afterTimeout == original)
flock(lock, LOCK_UN)
completed = false
HafaShareStore.performCaptureWrite({
  HafaShareStore.withFileLock(directory) { try! Data("capture-a:private:confirmed".utf8).write(to: receipt); return true }
}) { result in
  assert(Thread.isMainThread && result == true); completed = true
}
let retryStart = ProcessInfo.processInfo.systemUptime
while !completed && ProcessInfo.processInfo.systemUptime - retryStart < 2 { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.01)) }
let afterRetry = try Data(contentsOf: receipt)
assert(completed && String(data: afterRetry, encoding: .utf8) == "capture-a:private:confirmed")
var serial: [Int] = []
for value in 1...2 {
  HafaShareStore.performCaptureWrite({ value }) { result in assert(Thread.isMainThread); serial.append(result) }
}
let serialStart = ProcessInfo.processInfo.systemUptime
while serial.count < 2 && ProcessInfo.processInfo.systemUptime - serialStart < 2 { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.01)) }
assert(serial == [1, 2])
print("Bounded capture lock: main responsive, timeout preserved bytes, same capture retry and serial completions passed")
