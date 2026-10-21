import Foundation
import Darwin

@MainActor
private final class DelayedProvider {
  private var continuation: CheckedContinuation<Void, Never>?
  private(set) var started = false
  func load() async {
    started = true
    await withCheckedContinuation { continuation = $0 }
  }
  func deliver() { continuation?.resume(); continuation = nil }
}

@main
struct BabyShareStoreTests {
  @MainActor
  static func main() async throws {
    let args = CommandLine.arguments
    if args.count > 1 {
      let root = URL(fileURLWithPath: args[2]), defaults = UserDefaults(suiteName: args[3])!
      let store = BabyShareStore(container: root, defaults: defaults)
      try Data().write(to: root.appendingPathComponent("child-started-" + args[1]))
      if args[1] == "publish" { try store.publish(["new child payload"], id: args[4]) }
      else if args[1] == "ack" {
        guard try store.acknowledge(args[4]) else { exit(2) }
      }
      else if args[1] == "stage" {
        let capture = try store.begin(id: args[4])
        for name in ["image.jpg", "document.pdf", "video.mov", "thumbnail.jpg"] {
          try Data("interrupted private source".utf8).write(to: capture.directory.appendingPathComponent(name))
        }
        // Exit without rollback, exactly as an extension killed before publication.
        withExtendedLifetime(capture) { exit(0) }
      }
      return
    }
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Håfa store tests " + UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    var count = 0
    func check(_ condition: @autoclosure () throws -> Bool, _ label: String) throws {
      guard try condition() else { throw NSError(domain: label, code: count) }; count += 1
    }
    func fixture(_ name: String, now: Date = Date()) throws -> (URL, UserDefaults, BabyShareStore, String) {
      let root = folder.appendingPathComponent(name), suite = "hafa.share.test." + UUID().uuidString
      try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
      let defaults = UserDefaults(suiteName: suite)!
      return (root, defaults, BabyShareStore(container: root, defaults: defaults, now: { now }), suite)
    }
    func path(_ root: URL, _ id: String) -> URL { root.appendingPathComponent(".hafa-baby-share-store-v1/captures/" + id) }
    func spawn(_ mode: String, root: URL, suite: String, id: String) throws -> Process {
      let child = Process(); child.executableURL = URL(fileURLWithPath: args[0])
      child.arguments = [mode, root.path, suite, id]; try child.run(); return child
    }

    do {
      let (root, defaults, store, suite) = try fixture("receipt")
      defer { defaults.removePersistentDomain(forName: suite) }
      let a = UUID().uuidString, b = UUID().uuidString
      try store.publish(["first payload"], id: a)
      let old = try store.pending()!
      try check(old.token.hasPrefix(a + ":"), "receipt includes payload digest")
      // Torn compatibility-key writes cannot alter an immutable native receipt.
      defaults.set(["replacement compatibility payload"], forKey: "hafababyShareKey")
      defaults.set(a, forKey: "babyCaptureId")
      try check(try store.pending()!.token == old.token, "legacy keys cannot relabel current payload")
      try store.publish(["second payload"], id: b)
      try check(try store.pending()!.token == old.token, "queue returns oldest until acknowledged")
      try check(try store.acknowledge(old.token), "first receipt handed off")
      let current = try store.pending()!
      try check(!store.acknowledge(a + ":wrong-digest"), "wrong payload cannot acknowledge")
      try check(!store.acknowledge(old.token), "exact receipt is acknowledged only once")
      try check(!FileManager.default.fileExists(atPath: path(root, a).path), "old namespace removed")
      try check(try store.pending()!.token == current.token, "new receipt survives older acknowledgement")
      try check(try store.acknowledge(current.token), "current receipt can acknowledge")
      try check(try store.pending() == nil, "current acknowledgement clears pointer and compatibility keys")
    }
    do {
      let (root, defaults, store, suite) = try fixture("batch-files")
      defer { defaults.removePersistentDomain(forName: suite) }
      var capture: BabyShareStore.Capture? = try store.begin()
      let image = capture!.directory.appendingPathComponent("image.jpg")
      try Data("image bytes".utf8).write(to: image)
      let payload = try JSONSerialization.data(withJSONObject: [["path": image.absoluteString, "mimeType": "image/jpeg"]])
      try store.publish(payload, capture: capture!)
      capture = nil
      let saved = try store.pending()!
      try check(store.ownedFile(image.absoluteString) == image.standardizedFileURL.resolvingSymlinksInPath(), "host can read a manifested batch image")
      try check(store.ownedFile(image.deletingLastPathComponent().appendingPathComponent("manifest.json").absoluteString) == nil, "metadata is never exposed as an image")
      let outside = root.deletingLastPathComponent().appendingPathComponent("outside.jpg")
      try Data().write(to: outside)
      let symlink = image.deletingLastPathComponent().appendingPathComponent("escaped.jpg")
      try FileManager.default.createSymbolicLink(at: symlink, withDestinationURL: outside)
      try check(store.ownedFile(symlink.absoluteString) == nil, "symlink cannot escape capture ownership")
      try check(try store.acknowledge(saved.token), "copied batch can acknowledge")
      try check(!FileManager.default.fileExists(atPath: image.path), "acknowledgement removes complete batch namespace")
      let failedMetadata = try store.begin()
      for name in ["document.pdf", "video.mov", "thumbnail.jpg"] {
        try Data("unpublished bytes".utf8).write(to: failedMetadata.directory.appendingPathComponent(name))
      }
      try store.abort(failedMetadata)
      try check(!FileManager.default.fileExists(atPath: failedMetadata.directory.path), "file or video metadata failure rolls back every staged asset")
    }
    do {
      let (root, defaults, store, suite) = try fixture("cross-process")
      defer { defaults.removePersistentDomain(forName: suite) }
      let oldID = UUID().uuidString, newID = UUID().uuidString
      try store.publish(["old"], id: oldID); let old = try store.pending()!
      let lock = Darwin.open(root.appendingPathComponent(".hafa-baby-share-store-v1/store.lock").path, O_RDWR)
      guard lock >= 0, flock(lock, LOCK_EX) == 0 else { fatalError("test lock unavailable") }
      let child = try spawn("publish", root: root, suite: suite, id: newID)
      let signal = root.appendingPathComponent("child-started-publish")
      let deadline = Date().addingTimeInterval(5)
      while !FileManager.default.fileExists(atPath: signal.path) && Date() < deadline { try await Task.sleep(nanoseconds: 10_000_000) }
      try check(FileManager.default.fileExists(atPath: signal.path), "child reached mutation boundary")
      try await Task.sleep(nanoseconds: 50_000_000)
      try check(child.isRunning && !FileManager.default.fileExists(atPath: path(root, newID).path), "publisher waits for the interprocess transaction lock")
      flock(lock, LOCK_UN); Darwin.close(lock); child.waitUntilExit()
      try check(child.terminationStatus == 0, "child publication finished")
      try check(try store.acknowledge(old.token), "old acknowledgement after competing process publish")
      try check(try store.pending()!.token.hasPrefix(newID + ":"), "competing process receipt remains readable")
    }
    // Queue a real acknowledgement and replacement publication in separate
    // processes behind the same lock. Either acquisition order must retain B.
    for order in ["ack-first", "publish-first"] {
      let (root, defaults, store, suite) = try fixture(order)
      defer { defaults.removePersistentDomain(forName: suite) }
      let oldID = UUID().uuidString, newID = UUID().uuidString
      try store.publish(["old capture"], id: oldID)
      var reader: BabyShareStore? = BabyShareStore(container: root, defaults: defaults)
      let oldToken = try reader!.pending()!.token
      reader = nil
      let descriptor = Darwin.open(root.appendingPathComponent(".hafa-baby-share-store-v1/store.lock").path, O_RDWR)
      guard descriptor >= 0, flock(descriptor, LOCK_EX) == 0 else { fatalError("test lock unavailable") }
      let modes = order == "ack-first" ? ["ack", "publish"] : ["publish", "ack"]
      let children = try modes.map { mode in try spawn(mode, root: root, suite: suite, id: mode == "ack" ? oldToken : newID) }
      let deadline = Date().addingTimeInterval(5)
      while modes.contains(where: { !FileManager.default.fileExists(atPath: root.appendingPathComponent("child-started-" + $0).path) }) && Date() < deadline {
        try await Task.sleep(nanoseconds: 10_000_000)
      }
      try check(children.allSatisfy { $0.isRunning }, "both cross-process mutations wait for transaction lock")
      flock(descriptor, LOCK_UN); Darwin.close(descriptor)
      for child in children { child.waitUntilExit(); try check(child.terminationStatus == 0, "competing acknowledgement and publication succeed") }
      try check(try store.pending()!.token.hasPrefix(newID + ":"), "new capture survives either cross-process ordering")
    }
    do {
      let start = Date(timeIntervalSince1970: 1_000_000), future = start.addingTimeInterval(BabyShareStore.expiry + 1)
      let (root, defaults, store, suite) = try fixture("leases", now: start)
      defer { defaults.removePersistentDomain(forName: suite) }
      let writerID = UUID().uuidString
      var writer: BabyShareStore.Capture? = try store.begin(id: writerID)
      var later: BabyShareStore? = BabyShareStore(container: root, defaults: defaults, now: { future })
      _ = try later!.pending()
      try check(FileManager.default.fileExists(atPath: writer!.directory.path), "active producer survives expiry")
      writer = nil; _ = try later!.pending()
      try check(!FileManager.default.fileExists(atPath: path(root, writerID).path), "inactive interrupted producer expires")
      let a = UUID().uuidString, b = UUID().uuidString
      try store.publish(["leased old payload"], id: a); let old = try store.pending()!
      try store.publish(["current payload"], id: b); _ = try later!.pending()
      try check(FileManager.default.fileExists(atPath: path(root, a).path), "active superseded reader survives expiry")
      later = nil
      try check(try store.acknowledge(old.token), "superseded reader can release after expiry")
      later = BabyShareStore(container: root, defaults: defaults, now: { future })
      try check(FileManager.default.fileExists(atPath: path(root, b).path), "sweep retains referenced current capture")
      let unreferenced = UUID().uuidString
      try store.publish(["unleased"], id: unreferenced); try store.publish(["new current"], id: UUID().uuidString)
      _ = try later!.pending()
      try check(FileManager.default.fileExists(atPath: path(root, unreferenced).path), "published unacknowledged captures never expire")
    }
    do {
      let (root, defaults, _, suite) = try fixture("crash")
      defer { defaults.removePersistentDomain(forName: suite) }
      let id = UUID().uuidString, child = try spawn("stage", root: root, suite: suite, id: id)
      child.waitUntilExit(); try check(child.terminationStatus == 0, "interrupted producer process ended")
      let later = BabyShareStore(container: root, defaults: defaults, now: { Date().addingTimeInterval(BabyShareStore.expiry + 60) })
      _ = try later.pending()
      try check(!FileManager.default.fileExists(atPath: path(root, id).path), "OS-released producer lease permits orphan recovery")
    }
    // The controller captures this producer before any provider await. Deliver
    // actual asynchronous Safari/text/PDF/video results only after privacy clear.
    for kind in ["Safari", "text", "PDF", "video"] {
      let (_, defaults, store, suite) = try fixture("delayed-" + kind)
      defer { defaults.removePersistentDomain(forName: suite) }
      let capture = try store.begin(), provider = DelayedProvider()
      let source = folder.appendingPathComponent(UUID().uuidString)
      try Data("private provider bytes".utf8).write(to: source)
      let late = Task { @MainActor in
        await provider.load()
        var rejectedCopy = false
        if kind == "PDF" || kind == "video" {
          do { try FileManager.default.copyItem(at: source, to: capture.directory.appendingPathComponent("input")) }
          catch { rejectedCopy = true }
          do { try Data("thumbnail".utf8).write(to: capture.directory.appendingPathComponent("thumbnail.jpg")) }
          catch { /* The same removed namespace rejects delayed thumbnail writes. */ }
        }
        let payload: Any = kind == "text" ? ["private text"] : try JSONSerialization.data(withJSONObject: [["url": "https://example.com/private", "type": kind]])
        do { try store.publish(payload, capture: capture); return (false, rejectedCopy) }
        catch BabyShareStore.Failure.stale { return (true, rejectedCopy) }
      }
      while !provider.started { await Task.yield() }
      try store.clear()
      provider.deliver()
      let result = try await late.value
      try check(result.0, "delayed " + kind + " cannot acquire a new publication epoch")
      if kind == "PDF" || kind == "video" { try check(result.1, "delayed file copy cannot recreate a cleared namespace") }
      try check(try store.pending() == nil, "delayed " + kind + " leaves no receipt after clear")
      try check(!FileManager.default.fileExists(atPath: capture.directory.path), "delayed " + kind + " leaves no staged bytes")
    }
    do {
      let (_, defaults, store, suite) = try fixture("immutable-publication")
      defer { defaults.removePersistentDomain(forName: suite) }
      let capture = try store.begin()
      try store.publish(["first immutable payload"], capture: capture)
      let saved = try store.pending()!
      do { try store.publish(["replacement"], capture: capture); fatalError("same capture published twice") }
      catch BabyShareStore.Failure.stale { count += 1 }
      let newerID = UUID().uuidString
      try store.publish(["newer receipt"], id: newerID)
      try store.abort(capture)
      try check(try store.pending()!.token == saved.token, "retired producer cannot remove an earlier queued publication")
      try check(try store.acknowledge(saved.token), "superseded immutable publication releases producer lease and survives abort")
    }
    do {
      let (root, defaults, store, suite) = try fixture("privacy")
      defer { defaults.removePersistentDomain(forName: suite) }
      let arbitrary = root.appendingPathComponent("unrelated-file")
      try Data("unrelated".utf8).write(to: arbitrary)
      let legacy = root.appendingPathComponent(UUID().uuidString + ".jpg")
      try Data("legacy private bytes".utf8).write(to: legacy)
      let raw = try JSONSerialization.data(withJSONObject: [["path": legacy.absoluteString]])
      defaults.set(raw, forKey: "hafababyShareKey"); defaults.set("old-receipt", forKey: "babyCaptureId")
      let migrated = try store.pending()!
      try check(migrated.token.contains(":"), "legacy payload migrates with digest binding")
      try store.publish(["newer share"], id: UUID().uuidString)
      let active = try store.begin()
      for name in ["image.jpg", "document.pdf", "video.mov", "thumbnail.jpg"] {
        try Data("staged private source".utf8).write(to: active.directory.appendingPathComponent(name))
      }
      try store.clear()
      try check(!FileManager.default.fileExists(atPath: legacy.path), "privacy clear removes superseded declared legacy files")
      try check(!FileManager.default.fileExists(atPath: active.directory.path), "privacy clear removes active and superseded namespaces")
      do { try store.publish(["must not return"], capture: active); fatalError("stale producer published after clear") }
      catch BabyShareStore.Failure.stale { count += 1 }
      try check(try store.pending() == nil, "privacy clear leaves no pending receipt")
      defaults.set(raw, forKey: "hafababyShareKey")
      try check(try store.pending() == nil, "stale legacy defaults cannot resurrect a cleared store")
      try check(FileManager.default.fileExists(atPath: arbitrary.path), "cleanup never sweeps arbitrary app-group files")
    }
    do {
      let (_, defaults, store, suite) = try fixture("scope")
      defer { defaults.removePersistentDomain(forName: suite) }
      try store.bind("owner-a:1")
      let late = try store.begin()
      try store.publish(["A"], id: UUID().uuidString)
      let a = try store.pending()!
      try check(a.scope == "owner-a:1", "receipt bound to stable owner and generation")
      try store.bind("owner-a:1")
      try check(try store.pending()!.token == a.token, "same scope refresh preserves pending captures")
      try store.bind("owner-a:2")
      try check(try store.pending() == nil, "generation change clears exact prior namespace")
      do { try store.publish(["late A"], capture: late); fatalError("late generation accepted") }
      catch BabyShareStore.Failure.stale { count += 1 }
      try store.publish(["new generation"], id: UUID().uuidString)
      try store.bind("owner-b:1")
      try check(try store.pending() == nil, "account change cannot borrow previous captures")
      try check(!store.acknowledge(a.token), "old exact receipt cannot acknowledge new scope")
    }
    do {
      let (_, defaults, store, suite) = try fixture("receipt-handoff")
      defer { defaults.removePersistentDomain(forName: suite) }
      try store.publish(["unbound"], id: UUID().uuidString)
      try store.bind("owner-a:1")
      let id = UUID().uuidString
      let raw = try BabySharePayload.merging(
        JSONSerialization.data(withJSONObject: [["url": "http://example.com/post"], ["text": "Caption"]]),
        caption: "Extra accompanying text")
      try store.publish(raw, id: id)
      let saved = try store.pending()!
      try check(saved.scope == "owner-a:1", "unbound old capture cannot block or borrow scoped queue")
      let payload = try BabySharePayload.decode(saved)
      try check(payload["capture_id"] as? String == id.lowercased(), "server identity is canonical capture UUID")
      try check(payload["record_id"] as? String == id.lowercased(), "host and server use one original identity")
      try check(payload["url"] as? String == "http://example.com/post", "HTTP original link retained")
      try check(payload["text"] as? String == "Caption\nExtra accompanying text", "link never drops accompanying text")
      try check(try BabySharePayload.decode(store.pending()!)["occurred_at"] as? String == payload["occurred_at"] as? String,
        "recovery preserves immutable occurrence timestamp")
      try check(!store.accept(id + ":wrong", receipt: ["status": "queued"]), "wrong exact payload refuses server receipt")
      try check(try store.accept(saved.token, receipt: ["status": "deferred"]), "durable saved-original handoff receipt accepted")
      try check(try store.pending()!.receipt?["status"] == "deferred", "receipt survives subsequent host recovery")
      try check(try store.published(id)?.token == saved.token, "direct submission addresses exact queued capture")
      try store.clear()
      try check(!store.accept(saved.token, receipt: ["status": "queued"]), "late network response cannot resurrect cleared owner")
    }
    do {
      let (root, defaults, store, suite) = try fixture("automatic-permission-version")
      defer { defaults.removePersistentDomain(forName: suite) }
      try store.bind("owner-a:1", automaticEpoch: 0)
      let a = try store.begin()
      // Same owner/generation, permission withdrawn while provider A is loading.
      try store.bind("owner-a:1", automaticEpoch: 1)
      let otherProcess = BabyShareStore(container: root, defaults: defaults)
      let b = try otherProcess.begin()
      try otherProcess.publish(["B"], capture: b)
      let bSaved = try otherProcess.published(b.id)!
      try check(bSaved.automaticEpoch == 1, "new producer reads configured permission version across instances")
      try store.publish(["A"], capture: a)
      let aSaved = try store.published(a.id)!
      try check(aSaved.automaticEpoch == 0, "late publication retains permission version from begin")
      let payload = try BabySharePayload.decode(aSaved)
      try check(payload["automatic_epoch"] as? Int == 0, "host payload includes immutable permission version")
      let aRequest = try JSONSerialization.jsonObject(with: BabySharePayload.requestBody(payload)) as! [String: Any]
      let bRequest = try JSONSerialization.jsonObject(with: BabySharePayload.requestBody(BabySharePayload.decode(bSaved))) as! [String: Any]
      try check(aRequest["automatic_epoch"] as? Int == 0 && bRequest["automatic_epoch"] as? Int == 1,
        "direct network intake carries each original's permission version")
      try check(Set(aRequest.keys) == Set(["capture_id", "occurred_at", "text", "automatic_epoch"]),
        "network request excludes bridge-only metadata")
      try store.bind("owner-a:1", automaticEpoch: 2)
      try check(try store.published(a.id)!.token == aSaved.token && store.published(a.id)!.automaticEpoch == 0,
        "permission refresh never changes source digest or backfills queued version")
      try check(try store.accept(aSaved.token, receipt: ["status": "saved"]), "older permission version still accepts exact receipt")
      try check(try store.acknowledge(aSaved.token), "older version still acknowledges exactly")
      try check(try store.pending()!.token == bSaved.token, "acknowledgement leaves other permission version queued")
      try otherProcess.release(bSaved.token)
      // Existing manifests predate this optional field, even under a newer profile.
      let file = path(root, b.id).appendingPathComponent("manifest.json")
      var legacy = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as! [String: Any]
      legacy.removeValue(forKey: "automaticEpoch")
      try JSONSerialization.data(withJSONObject: legacy).write(to: file, options: .atomic)
      try check(try store.pending()!.automaticEpoch == 0, "legacy manifest defaults to zero rather than latest configured permission")
    }
    do {
      let (root, defaults, store, suite) = try fixture("unassigned-authority-revocation")
      defer { defaults.removePersistentDomain(forName: suite) }
      let unassigned = try store.begin()
      let original = unassigned.directory.appendingPathComponent("original.pdf")
      try Data("saved original".utf8).write(to: original)
      try store.bind("owner-a:1", automaticEpoch: 4)
      try store.publish(JSONSerialization.data(withJSONObject: [["path": original.absoluteString]]), capture: unassigned)
      try check(try store.pending() == nil, "configure during provider load cannot assign an unowned original")
      let bound = try store.begin()
      try store.publish(["bound"], capture: bound)
      let boundToken = try store.pending()!.token
      let late = try store.begin()
      var retired = false
      try store.clear(preserveUnassigned: true) { retired = true }
      let saved = try store.pending()!
      try check(retired && store.scope() == nil, "initial signed-out revocation retires authority")
      try check(saved.scope == nil && saved.automaticEpoch == 0, "preserved original retains nil scope and begin permission version")
      try check(FileManager.default.fileExists(atPath: original.path), "confirmed unassigned original bytes survive authority revocation")
      try check(!FileManager.default.fileExists(atPath: bound.directory.path), "revocation removes previous bound capture")
      try check(!store.acknowledge(boundToken), "revoked bound exact receipt cannot touch retained original")
      do { try store.publish(["late"], capture: late); fatalError("revoked producer published") }
      catch BabyShareStore.Failure.stale { count += 1 }
      try store.clear(preserveUnassigned: true)
      try check(try store.pending()!.token == saved.token, "repeated signed-out guard preserves exact original")
      try store.bind("owner-b:1", automaticEpoch: 5)
      try check(try store.pending() == nil, "retained unassigned originals remain quarantined from next account")
      try store.clear()
      try check(!FileManager.default.fileExists(atPath: path(root, unassigned.id).path), "explicit account cleanup still removes all captures")
    }
    for configureFirst in [false, true] {
      let (_, defaults, store, suite) = try fixture("legacy-unassigned-\(configureFirst)")
      defer { defaults.removePersistentDomain(forName: suite) }
      defaults.set(["legacy saved original"], forKey: "hafababyShareKey")
      if configureFirst {
        try store.bind("owner-a:1", automaticEpoch: 6)
        try check(try store.pending() == nil, "legacy defaults never inherit a later configured account")
      }
      try store.clear(preserveUnassigned: true)
      let saved = try store.pending()!
      try check(saved.scope == nil && saved.automaticEpoch == 0, "initial revocation preserves legacy original without later permission version")
      try check((saved.raw as? [String]) == ["legacy saved original"], "legacy original content survives initial signed-out guard")
    }
    print("\(count) native capture store cases passed")
  }
}
