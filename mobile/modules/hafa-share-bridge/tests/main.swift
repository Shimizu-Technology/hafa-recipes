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
assert(fresh["requestedIsPublic"] as? Bool == false && fresh["accountScopeId"] == nil)
let sessionWithoutChoice = HafaShareStore.capturePreferences(session: ["accountScopeId": "owner-a"], preferences: nil)
assert(sessionWithoutChoice["requestedIsPublic"] as? Bool == false)
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

// A denied public import leaves the capture queued: only a validated 202 receipt
// can reach the submitted=true write in enqueueLink.
let responseURL = URL(string: "https://example.com/api/share/imports")!
let acceptedBody = try JSONSerialization.data(withJSONObject: ["capture_id": "capture-a", "job_id": "job-a"])
for status in [200, 400, 401, 403, 409, 429, 500] {
  assert(HafaShareStore.acceptedImport(data: acceptedBody,
    response: HTTPURLResponse(url: responseURL, statusCode: status, httpVersion: nil, headerFields: nil), captureID: "capture-a") == nil)
}
assert(HafaShareStore.acceptedImport(data: acceptedBody,
  response: HTTPURLResponse(url: responseURL, statusCode: 202, httpVersion: nil, headerFields: nil), captureID: "capture-a")?["job_id"] as? String == "job-a")
assert(HafaShareStore.acceptedImport(data: acceptedBody,
  response: HTTPURLResponse(url: responseURL, statusCode: 202, httpVersion: nil, headerFields: nil), captureID: "another-capture") == nil)
print("Denied public captures (403) never become submitted receipts")

assert(HafaShareStore.canSubmitInBackground(["requestedIsPublic": false]))
assert(!HafaShareStore.canSubmitInBackground(["requestedIsPublic": true]))
assert(!HafaShareStore.canSubmitInBackground([:]))
print("Public and legacy-unknown captures stay local for foreground confirmation")

let capabilityOnly = HafaShareStore.capturePreferences(session: ["accountScopeId": "owner-a", "isPublic": true], preferences: nil)
assert(capabilityOnly["requestedIsPublic"] as? Bool == false)
let wrongAccountChoice = HafaShareStore.capturePreferences(session: ["accountScopeId": "owner-a", "isPublic": true], preferences: publicPreference.merging(["accountScopeId": "other"]) { _, new in new })
assert(wrongAccountChoice["requestedIsPublic"] as? Bool == false)
print("Unset and cross-account choices cannot inherit a public capability")

// Cancel waits for an in-flight attachment write, deletes only that capture,
// and prevents callbacks that arrive after cancellation from recreating files.
let attachmentRoot = directory.appendingPathComponent("attachments")
try FileManager.default.createDirectory(at: attachmentRoot, withIntermediateDirectories: true)
let neighbour = attachmentRoot.appendingPathComponent("another-capture.jpg")
try Data("keep".utf8).write(to: neighbour)
let files = HafaShareAttachmentFiles(container: attachmentRoot)
let entered = DispatchSemaphore(value: 0), finishWrite = DispatchSemaphore(value: 0), removed = DispatchSemaphore(value: 0)
DispatchQueue.global().async {
  try! files.withWrite { folder in
    entered.signal()
    finishWrite.wait()
    try Data("photo".utf8).write(to: folder.appendingPathComponent("photo.jpg"))
  }
}
assert(entered.wait(timeout: .now() + 2) == .success)
DispatchQueue.global().async { assert(files.cancelAndRemove()); removed.signal() }
finishWrite.signal()
assert(removed.wait(timeout: .now() + 2) == .success)
assert(files.copy(neighbour) == nil)
assert(try! FileManager.default.contentsOfDirectory(atPath: attachmentRoot.path) == ["another-capture.jpg"])
assert(try! Data(contentsOf: neighbour) == Data("keep".utf8))
assert(files.cancelAndRemove())
let cancelledEarly = HafaShareAttachmentFiles(container: attachmentRoot)
assert(cancelledEarly.cancelAndRemove() && cancelledEarly.copy(neighbour) == nil)
let kept = HafaShareAttachmentFiles(container: attachmentRoot)
let keptURL = kept.copy(neighbour)!
assert(FileManager.default.fileExists(atPath: keptURL.path))
assert(kept.cancelAndRemove())
print("Attachment cancellation: in-flight/late writes, exact ownership, idempotency and retained files passed")
