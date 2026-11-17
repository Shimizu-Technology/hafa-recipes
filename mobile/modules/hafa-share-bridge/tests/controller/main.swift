import Foundation
import UIKit
import Darwin

func until(_ message: String, timeout: TimeInterval = 4, _ condition: () -> Bool) {
  let deadline = Date().addingTimeInterval(timeout)
  while !condition() && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
  precondition(condition(), message)
}
final class Fixture {
  let root: URL, suite: String, defaults: UserDefaults, id: String, key: String, url: String
  let files: HafaShareAttachmentFiles, photo: URL, controller: ShareViewController
  init(delay: TimeInterval = 12, scope: String? = "scope-a") throws {
    id = UUID().uuidString.lowercased(); key = "hafarecipesShareKey.\(id)"
    url = "hafarecipes://dataUrl=\(key)#media"
    root = FileManager.default.temporaryDirectory.appendingPathComponent("hafa-controller-\(id)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    suite = "hafa-controller-\(id)"; defaults = UserDefaults(suiteName: suite)!
    HafaShareStore.testStore = (root, defaults)
    files = HafaShareAttachmentFiles(container: root, captureID: UUID(uuidString: id)!)
    photo = try files.withWrite { directory in
      let path = directory.appendingPathComponent("photo.heic")
      try Data(repeating: 42, count: 1024).write(to: path); return path
    }!
    defaults.set(try JSONSerialization.data(withJSONObject: [["path": photo.path, "type": 0]]), forKey: key)
    var metadata: [String: Any] = ["captureId": id, "confirmed": false, "createdAt": Date().timeIntervalSince1970]
    if let scope { metadata["accountScopeId"] = scope }
    defaults.set(metadata, forKey: "\(key).meta")
    defaults.set([url], forKey: HafaShareStore.pendingKey)
    if let scope { defaults.set(["accountScopeId": scope], forKey: HafaShareStore.sessionKey) }
    controller = ShareViewController()
    controller.prepareTestCapture(key: key, id: id, files: files, recoveryDelay: delay, scope: scope)
  }
  deinit { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: root) }
  var photoExists: Bool { FileManager.default.fileExists(atPath: photo.path) }
  var marker: URL { HafaShareSaveIntent.path(id, in: root)! }
  func delivery() -> URL? {
    HafaShareStore.locked { defaults in
      HafaShareCaptureSnapshot.deliveryURL(pending: defaults.stringArray(forKey: HafaShareStore.pendingKey) ?? [], fallback: url, defaults: defaults, container: root)
    } ?? nil
  }
  func checkRetained() {
    precondition(photoExists && defaults.object(forKey: key) != nil && defaults.stringArray(forKey: HafaShareStore.pendingKey) == [url], "Close destroyed capture")
  }
  func acknowledgeOnce() {
    precondition(delivery()?.absoluteString == url)
    precondition(HafaShareStore.acknowledge(key))
    precondition(!HafaShareStore.acknowledge(key))
    precondition(delivery() == nil && photoExists, "receipt resurrected or host-owned file lost")
  }
}

// Forced real flock failure during confirmation. The controller must transition
// itself to Failed, and its actual destructive cancellation entry must retain.
do {
  let f = try Fixture()
  let fd = open(f.root.appendingPathComponent("hafa-share-queue.lock").path, O_CREAT | O_RDWR, 0o600)
  precondition(fd >= 0 && flock(fd, LOCK_EX | LOCK_NB) == 0)
  f.controller.tapTestSave()
  precondition(f.controller.testState == .saving && !f.controller.testCanLeave)
  f.controller.tapTestClose(); precondition(!f.controller.testClosed)
  until("confirmation must fail from actual lock contention") { f.controller.testState == .failed }
  precondition(FileManager.default.fileExists(atPath: f.marker.path), "Save intent missing on failure")
  f.controller.tapTestClose(); precondition(f.controller.testClosed); f.checkRetained()
  flock(fd, LOCK_UN); close(fd)
  f.acknowledgeOnce()
  print("PASS: failed confirmation -> real Close preserves files; native recovery delivers exactly once")
}
// Pause the production capture-write queue so the 12s watchdog (shortened only
// in this fixture) fires while confirmation is genuinely pending.
do {
  let f = try Fixture(delay: 0.05)
  let started = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
  HafaShareStore.performCaptureWrite({ started.signal(); release.wait() }, completion: { _ in })
  precondition(started.wait(timeout: .now() + 2) == .success)
  f.controller.tapTestSave()
  until("Slow must allow a bounded escape") { f.controller.testState == .slow }
  until("intent must exist before pending confirmation") { FileManager.default.fileExists(atPath: f.marker.path) }
  f.controller.tapTestClose(); precondition(f.controller.testClosed); f.checkRetained()
  precondition(f.delivery() != nil) // re-confirm while extension write is paused
  release.signal()
  var settled = false
  HafaShareStore.performCaptureWrite({ true }, completion: { _ in settled = true })
  until("late confirmation must settle") { settled }
  f.checkRetained(); f.acknowledgeOnce()
  print("PASS: Slow -> Close -> intake recovery + late success retains one exact receipt")
}
do {
  let f = try Fixture()
  // Force atomic marker creation itself to fail, without changing controller state.
  try FileManager.default.createDirectory(at: f.marker, withIntermediateDirectories: false)
  f.controller.tapTestSave()
  until("marker failure should be honest and retryable") { f.controller.testState == .failed }
  precondition(f.controller.testNote.contains("Couldn’t record Save"))
  precondition(f.delivery() == nil)
  f.controller.tapTestClose(); f.checkRetained()
  print("PASS: marker write failure never promises or authorizes recovery")
}
do {
  let f = try Fixture()
  precondition(f.delivery() == nil, "never-saved capture leaked")
  try HafaShareSaveIntent.write(.init(captureKey: f.key, captureId: f.id, accountScopeId: "scope-b", isPublic: true), in: f.root)
  precondition(f.delivery() == nil, "foreign-account marker leaked")
  f.controller.tapTestClose()
  until("Cancel before Save must discard") { f.defaults.object(forKey: f.key) == nil && !f.photoExists }
  print("PASS: no marker / foreign marker hidden; actual Cancel before Save removes owned files")
}
do {
  let f = try Fixture()
  try FileManager.default.createDirectory(at: f.marker, withIntermediateDirectories: false)
  f.controller.tapTestSave()
  until("marker write failure") { f.controller.testState == .failed }
  f.controller.tapTestDiscard()
  until("explicit Discard must delete failed unconfirmed capture") { f.defaults.object(forKey: f.key) == nil && !f.photoExists }
  print("PASS: explicit Discard after Failed removes only unconfirmed capture")
}
do {
  let f = try Fixture()
  let fd = open(f.root.appendingPathComponent("hafa-share-queue.lock").path, O_CREAT | O_RDWR, 0o600)
  precondition(fd >= 0 && flock(fd, LOCK_EX | LOCK_NB) == 0)
  f.controller.tapTestClose()
  until("failed cancellation must remain retryable") { f.controller.testNote.contains("Couldn’t cancel") }
  precondition(!f.controller.testClosed); f.checkRetained()
  flock(fd, LOCK_UN); close(fd)
  f.controller.tapTestDiscard()
  until("retry cancellation must delete owned files") { !f.photoExists && f.defaults.object(forKey: f.key) == nil }
  print("PASS: real cancellation lock failure retains files and explicit retry succeeds")
}
do {
  let f = try Fixture()
  let fd = open(f.root.appendingPathComponent("hafa-share-queue.lock").path, O_CREAT | O_RDWR, 0o600)
  precondition(fd >= 0 && flock(fd, LOCK_EX | LOCK_NB) == 0)
  f.controller.tapTestSave()
  until("forced confirmation failure") { f.controller.testState == .failed }
  flock(fd, LOCK_UN); close(fd)
  precondition(f.delivery() != nil) // host has adopted the capture
  f.controller.tapTestDiscard()
  until("discard must show host ownership") { f.controller.testOutcome == "Already saved to Håfa Recipes" }
  precondition(!f.controller.testClosed)
  f.checkRetained(); f.acknowledgeOnce()
  print("PASS: explicit Discard cannot delete attachments after host recovery")
}
do {
  let f = try Fixture(delay: 0.05)
  let started = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
  HafaShareStore.performCaptureWrite({ started.signal(); release.wait() }, completion: { _ in })
  precondition(started.wait(timeout: .now() + 2) == .success)
  f.controller.tapTestSave()
  until("pending Save should become Slow") { f.controller.testState == .slow }
  until("intent recorded before confirmation") { FileManager.default.fileExists(atPath: f.marker.path) }
  f.controller.tapTestClose(); f.acknowledgeOnce()
  release.signal()
  var settled = false
  HafaShareStore.performCaptureWrite({ true }, completion: { _ in settled = true })
  until("late confirmation after acknowledgment must settle") { settled }
  precondition(f.delivery() == nil && f.photoExists, "late write resurrected or discarded host capture")
  print("PASS: late confirmation after acknowledgment never recreates the receipt")
}
do {
  let f = try Fixture(delay: 0.05)
  let started = DispatchSemaphore(value: 0), release = DispatchSemaphore(value: 0)
  HafaShareSaveIntent.beforeWrite = { started.signal(); release.wait() }
  f.controller.tapTestSave()
  precondition(started.wait(timeout: .now() + 2) == .success)
  until("pending marker must allow Slow Close without promising recovery") { f.controller.testState == .slow }
  precondition(f.controller.testCanLeave && f.controller.testNote.contains("Save has not been recorded yet"))
  precondition(!FileManager.default.fileExists(atPath: f.marker.path))
  f.controller.tapTestClose(); precondition(f.controller.testClosed); f.checkRetained()
  release.signal()
  until("late marker should still preserve the tap") { FileManager.default.fileExists(atPath: f.marker.path) }
  HafaShareSaveIntent.beforeWrite = nil
  f.acknowledgeOnce()
  print("PASS: Slow before journal completion makes no false recovery promise and permits Close")
}
do {
  let f = try Fixture()
  let fd = open(f.root.appendingPathComponent("hafa-share-queue.lock").path, O_CREAT | O_RDWR, 0o600)
  precondition(fd >= 0 && flock(fd, LOCK_EX | LOCK_NB) == 0)
  f.controller.tapTestSave()
  until("forced confirmation failure") { f.controller.testState == .failed }
  flock(fd, LOCK_UN); close(fd)
  f.acknowledgeOnce()
  f.controller.tapTestDiscard()
  until("acknowledged import must show Already saved") { f.controller.testOutcome == "Already saved to Håfa Recipes" }
  precondition(f.photoExists && f.delivery() == nil)
  print("PASS: Discard after exact acknowledgment reports Already saved and keeps host files")
}
do {
  let f = try Fixture(scope: nil)
  let fd = open(f.root.appendingPathComponent("hafa-share-queue.lock").path, O_CREAT | O_RDWR, 0o600)
  precondition(fd >= 0 && flock(fd, LOCK_EX | LOCK_NB) == 0)
  f.controller.tapTestSave()
  until("unassigned Save should fail confirmation under real lock contention") { f.controller.testState == .failed }
  f.controller.tapTestClose(); precondition(f.controller.testClosed); f.checkRetained()
  flock(fd, LOCK_UN); close(fd)
  f.defaults.set(["accountScopeId": "signed-in-scope"], forKey: HafaShareStore.sessionKey)
  precondition(f.delivery()?.absoluteString == f.url, "sign-in stranded an unassigned saved capture")
  let metadata = f.defaults.dictionary(forKey: "\(f.key).meta")!
  precondition(metadata["confirmed"] as? Bool == true && metadata["accountScopeId"] == nil, "recovery auto-assigned the capture")
  let intent = try JSONDecoder().decode(HafaShareSaveIntent.Intent.self, from: Data(contentsOf: f.marker))
  precondition(intent.accountScopeId == nil, "recovery changed the durable owner tag")
  f.acknowledgeOnce()
  print("PASS: unassigned Save + real failed confirmation + Close -> sign-in recovers once without assigning ownership")
}
print("All generated-controller save/recovery regressions passed")
