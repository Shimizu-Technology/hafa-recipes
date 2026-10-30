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

var widgetFailures = 0
func checkWidget(_ value: Bool, _ message: String) {
  if !value { widgetFailures += 1; FileHandle.standardError.write(Data("FAIL: \(message)\n".utf8)) }
}
// Real widget store and locks, isolated from the app group and Keychain.
let directory = FileManager.default.temporaryDirectory.appendingPathComponent("hafa-widget-tests-\(UUID().uuidString)")
try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: directory) }
let widget = HafaWidgetStore(directory: directory)
func widgetSnapshot(_ list: String) -> HafaWidgetSnapshot {
  HafaWidgetSnapshot(accountScopeID: "scope-a", list: HafaWidgetList(id: list, name: "Test", isShared: false, revision: 1, createdAt: "", updatedAt: ""), items: [], total: 0, unchecked: 0, checked: 0, serverTime: "")
}
func seed(_ pending: [HafaWidgetPendingMutation]) throws {
  try widget.mutateState { state in
    state.snapshot = widgetSnapshot("list-1"); state.accountScopeID = "scope-a"; state.pending = pending
  }
}
func mutation(_ id: String, _ list: String) -> HafaWidgetPendingMutation {
  HafaWidgetPendingMutation(id: id, listID: list, itemID: "item", checked: true, createdAt: "")
}
func archive(_ owner: String) -> URL {
  directory.appendingPathComponent("grocery-pending-owner-" + owner.utf8.map { String(format: "%02x", $0) }.joined() + ".json")
}
let archiveReached = DispatchSemaphore(value: 0), releaseArchive = DispatchSemaphore(value: 0)
let retired = DispatchSemaphore(value: 0), enqueueFinished = DispatchSemaphore(value: 0), enqueueStarted = DispatchSemaphore(value: 0)
try seed([mutation("accepted-before-retirement", "list-1")])
widget.afterArchive = { archiveReached.signal(); releaseArchive.wait() }
DispatchQueue.global().async { try! widget.clearSession(archivingOwner: "owner-a"); retired.signal() }
assert(archiveReached.wait(timeout: .now() + 2) == .success)
DispatchQueue.global().async {
  enqueueStarted.signal()
  _ = try? widget.enqueue(listID: "list-1", itemID: "item", checked: false)
  enqueueFinished.signal()
}
assert(enqueueStarted.wait(timeout: .now() + 2) == .success)
let enqueueBlocked = enqueueFinished.wait(timeout: .now() + 0.1) == .timedOut
releaseArchive.signal()
assert(retired.wait(timeout: .now() + 2) == .success)
if enqueueBlocked { assert(enqueueFinished.wait(timeout: .now() + 2) == .success) }
checkWidget(enqueueBlocked, "an enqueue accepted between archive and clear can be lost")
widget.afterArchive = nil
let clearedState = try widget.readState()
assert(clearedState.pending.isEmpty)
let archived = try JSONDecoder().decode([HafaWidgetPendingMutation].self, from: Data(contentsOf: archive("owner-a")))
assert(archived.map { $0.id } == ["accepted-before-retirement"])
print("Widget atomic retirement: concurrent enqueue rejected, accepted journal retained")
try seed([mutation("one", "list-1"), mutation("two", "list-2")])
try widget.archivePending(owner: "owner-lists")
try seed([])
try widget.restorePending(owner: "owner-lists")
let attributes = try FileManager.default.attributesOfItem(atPath: archive("owner-lists").path)
checkWidget((attributes[.posixPermissions] as! NSNumber).intValue == 0o600, "restored archive permissions must be 0600")
let remaining = try JSONDecoder().decode([HafaWidgetPendingMutation].self, from: Data(contentsOf: archive("owner-lists")))
assert(remaining.map { $0.id } == ["two"])
try widget.mutateState { $0.snapshot = widgetSnapshot("list-2"); $0.pending = [] }
try widget.restorePending(owner: "owner-lists")
checkWidget(!FileManager.default.fileExists(atPath: archive("owner-lists").path), "an empty private archive must be removed")
print("Widget archive restore: other list retained with 0600, exhausted archive removed")
try seed([mutation("pending", "list-1")])
do { try widget.clearSession(archivingOwner: String(repeating: "x", count: 300)); assertionFailure("expected archive failure") } catch {}
let failedArchiveState = try widget.readState()
checkWidget(failedArchiveState.snapshot == nil, "archive failure must still retire readable state")
print("Widget archive failure: readable state retired")

assert(widgetFailures == 0, "widget regression failures: \(widgetFailures)")
