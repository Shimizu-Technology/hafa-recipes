import Foundation

let suite = "hafa-share-atomic-tests.\(UUID().uuidString)"
let defaults = UserDefaults(suiteName: suite)!
defer { defaults.removePersistentDomain(forName: suite) }
let keyA = "hafarecipesShareKey.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
let keyB = "hafarecipesShareKey.bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
let payloadA = "{\"text\":\"https://example.com/a\",\"type\":\"weburl\"}"
let payloadB = "{\"text\":\"https://example.com/b\",\"type\":\"weburl\"}"
func snapshot(_ payload: String, _ key: String) -> [String: Any] {
    let serialized = HafaShareCaptureSnapshot.serialize(payloadJSON: payload, captureKey: key, defaults: defaults)!
    return try! JSONSerialization.jsonObject(with: Data(serialized.utf8)) as! [String: Any]
}
// A refresh can emit A2 while intake A is still awaiting persistence. Both
// already-emitted payloads must retain A's identity after A is acknowledged.
let eventA = snapshot(payloadA, keyA)
let eventA2 = snapshot(payloadA, keyA)
let idA = (eventA["_hafa"] as! [String: Any])["captureId"] as! String
assert((eventA2["_hafa"] as! [String: Any])["captureId"] as! String == idA)
defaults.removeObject(forKey: "\(keyA).meta") // exact acknowledgment of A
let eventB = snapshot(payloadB, keyB)
let idB = (eventB["_hafa"] as! [String: Any])["captureId"] as! String
assert(idA != idB)
assert((eventA2["_hafa"] as! [String: Any])["captureKey"] as! String == keyA)
assert(eventA2["text"] as! String == "https://example.com/a")
assert((eventB["_hafa"] as! [String: Any])["captureKey"] as! String == keyB)
assert(defaults.dictionary(forKey: "\(keyB).meta")?["captureId"] as? String == idB)
let queueB = ["hafarecipes://dataUrl=\(keyB)#weburl"]
assert(HafaShareStore.remainingPending(queueB, acknowledging: (eventA2["_hafa"] as! [String: Any])["captureKey"] as! String) == queueB)
// Pre-UUID legacy keys are upgraded once; a repeated refresh must not give a
// second identity. Accepted-server job metadata is included in the same event.
let legacyA = snapshot(payloadA, "hafarecipesShareKey.legacy")
let legacyA2 = snapshot(payloadA, "hafarecipesShareKey.legacy")
assert((legacyA["_hafa"] as! [String: Any])["captureId"] as! String == (legacyA2["_hafa"] as! [String: Any])["captureId"] as! String)
defaults.set(["captureId": idB, "accountScopeId": "scope-b", "submitted": true, "jobId": "job-b", "location": "Guam", "requestedIsPublic": false], forKey: "\(keyB).meta")
let accepted = snapshot(payloadB, keyB)["_hafa"] as! [String: Any]
assert(accepted["jobId"] as? String == "job-b" && accepted["accountScopeId"] as? String == "scope-b")
assert(accepted["submitted"] as? Bool == true)
assert(HafaShareCaptureSnapshot.serialize(payloadJSON: "error", captureKey: keyA, defaults: defaults) == nil)
print("Atomic native capture fixtures passed: A/A2 stay A after acknowledgment advances B")

// Reproduce the pre-provider failure with a preference flush that reports
// failure. The journal must commit the receipt before reporting success,
// independently of cfprefsd's cache, and survive a separate reader/restart.
final class FailedFlushDefaults: UserDefaults {
    override func synchronize() -> Bool { false }
}
let workoutSuite = "hafa-workout-journal-tests.\(UUID().uuidString)"
let failedFlush = FailedFlushDefaults(suiteName: workoutSuite)!
let container = FileManager.default.temporaryDirectory.appendingPathComponent(workoutSuite)
try FileManager.default.createDirectory(at: container, withIntermediateDirectories: true)
defer {
    failedFlush.removePersistentDomain(forName: workoutSuite)
    try? FileManager.default.removeItem(at: container)
}
let workoutA = "hafaworkoutsShareKey.\(UUID().uuidString)"
let workoutB = "hafaworkoutsShareKey.\(UUID().uuidString)"
let malformed = "hafaworkoutsShareKey.\(UUID().uuidString)"
let expired = "hafaworkoutsShareKey.\(UUID().uuidString)"
let sessionA: [String: Any] = ["ownerId": "owner-a", "generation": 2,
    "accountScopeId": "scope-a", "isPublic": false]
let captureA: [String: Any] = ["captureId": "capture-a", "url": "https://example.com/a",
    "ownerId": "owner-a", "generation": 2, "isPublic": false, "files": [[String: Any]]()]
failedFlush.set([workoutA], forKey: WorkoutsShareStore.pending)
failedFlush.set(captureA, forKey: workoutA + ".capture")
failedFlush.set(sessionA, forKey: WorkoutsShareStore.sessionKey)
failedFlush.set("original-installation", forKey: WorkoutsShareStore.installationKey)
failedFlush.set([malformed, expired], forKey: WorkoutsShareStore.staging)
failedFlush.set(["paths": ["file:///unrelated/must-remain"], "ownerId": "owner-a"], forKey: malformed + ".stage")
failedFlush.set(["createdAt": 0.0, "paths": ["file:///unrelated/must-remain"], "ownerId": "owner-a"], forKey: expired + ".stage")
failedFlush.set("never-migrate-a-token", forKey: "unrelated-secret")
assert(failedFlush.synchronize() == false) // build 11's beginStage returned this.
let journal = try WorkoutsShareDefaults(defaults: failedFlush, container: container)
assert(WorkoutsShareStore.beginStage(workoutB, journal))
let reopened = try WorkoutsShareDefaults(defaults: failedFlush, container: container)
assert(reopened.dictionary(forKey: workoutA + ".capture")?["captureId"] as? String == "capture-a")
assert(reopened.stringArray(forKey: WorkoutsShareStore.pending) == [workoutA])
assert(reopened.string(forKey: WorkoutsShareStore.installationKey) == "original-installation")
assert(reopened.dictionary(forKey: workoutB + ".stage")?["ownerId"] as? String == "owner-a")
assert(reopened.dictionary(forKey: workoutB + ".stage")?["generation"] as? Int == 2)
assert(reopened.dictionary(forKey: workoutB + ".stage")?["isPublic"] as? Bool == false)
assert(reopened.dictionary(forKey: malformed + ".stage") != nil)
assert(reopened.dictionary(forKey: expired + ".stage") != nil)
assert(failedFlush.dictionary(forKey: workoutA + ".capture") != nil) // migration preserves originals
let journalURL = container.appendingPathComponent(WorkoutsShareDefaults.journalName)
let persisted = try Data(contentsOf: journalURL)
let plist = try PropertyListSerialization.propertyList(from: persisted, format: nil) as! [String: Any]
assert((plist["receipts"] as! [String: Any])["unrelated-secret"] == nil)
let journalAttributes = try FileManager.default.attributesOfItem(atPath: journalURL.path)
assert(journalAttributes[.posixPermissions] as? Int == 0o600)
// Account B affects only later captures; A's receipt/privacy never changes.
reopened.set(["ownerId": "owner-b", "generation": 4, "accountScopeId": "scope-b", "isPublic": true], forKey: WorkoutsShareStore.sessionKey)
assert(reopened.synchronize())
let workoutC = "hafaworkoutsShareKey.\(UUID().uuidString)"
assert(WorkoutsShareStore.beginStage(workoutC, reopened))
let rotated = try WorkoutsShareDefaults(defaults: failedFlush, container: container)
assert(rotated.dictionary(forKey: workoutB + ".stage")?["ownerId"] as? String == "owner-a")
assert(rotated.dictionary(forKey: workoutC + ".stage")?["ownerId"] as? String == "owner-b")
assert(WorkoutsShareStore.acknowledge(workoutA, rotated))
let acknowledged = try WorkoutsShareDefaults(defaults: failedFlush, container: container)
assert(acknowledged.dictionary(forKey: workoutA + ".capture") == nil)
assert(acknowledged.dictionary(forKey: workoutB + ".stage") != nil)
assert(acknowledged.dictionary(forKey: workoutC + ".stage") != nil)
// A failed actual file commit must never become a "saved" confirmation.
let savedURL = container.appendingPathComponent("saved.plist")
try FileManager.default.moveItem(at: journalURL, to: savedURL)
try FileManager.default.createDirectory(at: journalURL, withIntermediateDirectories: false)
let refused = "hafaworkoutsShareKey.\(UUID().uuidString)"
assert(!WorkoutsShareStore.beginStage(refused, acknowledged))
let savedBeforeFailure = try Data(contentsOf: savedURL)
assert(savedBeforeFailure != persisted) // contains the exact acknowledgement/account rotation
try FileManager.default.removeItem(at: journalURL)
try FileManager.default.moveItem(at: savedURL, to: journalURL)
let retry = try WorkoutsShareDefaults(defaults: failedFlush, container: container)
assert(retry.dictionary(forKey: refused + ".stage") == nil)
assert(WorkoutsShareStore.beginStage(refused, retry))
// Existing unreadable/corrupt journals fail closed instead of overwriting
// queued sources with stale preferences or a new account.
let beforeCorruption = try Data(contentsOf: journalURL)
try Data("corrupt".utf8).write(to: journalURL)
do {
    _ = try WorkoutsShareDefaults(defaults: failedFlush, container: container)
    assertionFailure("A corrupt journal must not be replaced")
} catch {}
let corruptData = try Data(contentsOf: journalURL)
assert(corruptData == Data("corrupt".utf8))
try beforeCorruption.write(to: journalURL)
print("Workouts native journal fixtures passed: failed preference flush, migration, recovery, account isolation, exact ack and failed write")
