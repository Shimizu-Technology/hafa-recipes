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
