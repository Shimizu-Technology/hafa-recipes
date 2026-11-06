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
      // A build-34 phone updates, then a family is created: nothing of its older captures goes.
      let (_, defaults, store, suite) = try fixture("rebind")
      defer { defaults.removePersistentDomain(forName: suite) }
      let family = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222"
      let waiting = UUID().uuidString, received = UUID().uuidString, shared = UUID().uuidString
      try store.bind("owner-a:1", automaticEpoch: 3)
      try store.publish(["no receipt yet"], id: waiting)
      try store.publish(["its receipt came back"], id: received)
      let open = try store.published(received)!
      try check(try store.accept(open.token, receipt: ["status": "deferred", "import_id": received]), "an older build's receipt is written")
      try store.release(open.token)
      try store.bind("owner-a:1:personal")
      try check(store.scope() == "owner-a:1:personal", "the destination now says it's personal")
      try check(try store.pending()?.token.hasPrefix(waiting) == true, "the update keeps a pending capture")
      try store.bind("owner-a:1:\(family)")
      var seen = try store.pending()
      try check(seen?.token.hasPrefix(waiting) == true && seen?.scope == "owner-a:1", "Create family keeps a pending capture with its own destination")
      try check(seen?.automaticEpoch == 3, "and what it was allowed to do then")
      try check(try store.acknowledge(seen!.token), "the host can still hand it off")
      seen = try store.pending()
      try check(seen?.token.hasPrefix(received) == true && seen?.receipt?["status"] == "deferred" && seen?.receipt?["import_id"] == received, "the receipt survives with its id")
      try check(try store.acknowledge(seen!.token), "and that one too")
      try store.publish(["new capture"], id: shared)
      try check(try store.pending()?.scope == "owner-a:1:\(family)", "a new capture is tagged with the new destination")
      // Leaving rebinds to personal, and what was bound for the family stays until the host routes it.
      try store.bind("owner-a:1:personal")
      try check(try store.pending()?.token.hasPrefix(shared) == true, "leaving keeps a capture made for the family")
      try store.bind("owner-a:1:\(other)")
      try check(try store.pending()?.token.hasPrefix(shared) == true, "so does joining another")
    }
    do {
      // Rebinding stops at privacy: another account's phone, or this space's own data being cleared.
      let family = "11111111-1111-4111-8111-111111111111"
      for (first, second, label) in [("owner-a:1", "owner-b:1", "another account"), ("owner-a:1:\(family)", "owner-b:1:\(family)", "another account in the family"),
        ("owner-a:1", "owner-a:2:personal", "a cleared personal space, from a legacy tag"), ("owner-a:1:personal", "owner-a:2:personal", "a cleared personal space"),
        ("owner-a:1:\(family)", "owner-a:2:\(family)", "a cleared family")] {
        let (_, defaults, store, suite) = try fixture("rebind-clears" + label)
        defer { defaults.removePersistentDomain(forName: suite) }
        try store.bind(first)
        try store.publish(["private"], id: UUID().uuidString)
        try store.bind(second)
        try check(try store.pending() == nil, label + " retires captures")
      }
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
    do {
      // An account's own space being cleared takes its captures, and leaves what was shared under no account.
      let (_, defaults, store, suite) = try fixture("retire-keeps-waiting")
      defer { defaults.removePersistentDomain(forName: suite) }
      let waiting = try store.begin()
      try store.publish(["no one's"], capture: waiting)
      try store.bind("owner-a:1:personal")
      let mine = UUID().uuidString
      try store.publish(["hers"], id: mine)
      try store.bind("owner-a:2:personal")
      try check(try store.pending() == nil, "her cleared capture is gone")
      try check(try store.unassignedCount() == 1, "the waiting one isn't")
      try store.bind("owner-b:1:personal")
      try check(try store.unassignedCount() == 0, "another account's binding still retires everything")
    }
    do {
      // Asking how many from the sign-in screen must not get in the way of carrying over an older build's share.
      let (_, defaults, store, suite) = try fixture("count-before-upgrade")
      defer { defaults.removePersistentDomain(forName: suite) }
      defaults.set(["legacy saved original"], forKey: "hafababyShareKey")
      try check(try store.unassignedCount() == 0, "nothing carried over yet")
      try store.clear(preserveUnassigned: true)
      try check(try store.unassignedCount() == 1, "the guard still carries it over afterwards")
    }
    do {
      // Listing, and the one door out of no-owner.
      let (root, defaults, store, suite) = try fixture("claim")
      defer { defaults.removePersistentDomain(forName: suite) }
      let family = "11111111-1111-4111-8111-111111111111"
      let tiktok = try store.begin(), file = try store.begin(), other = try store.begin()
      let original = file.directory.appendingPathComponent("photo.jpg")
      try Data("private".utf8).write(to: original)
      let link = #"[{"url":"https://www.TikTok.com/@someone/video/1?a=b","text":"a private caption"}]"#
      try store.publish(Data(link.utf8), capture: tiktok)
      try store.publish(JSONSerialization.data(withJSONObject: [["path": original.absoluteString, "mimeType": "image/jpeg"], ["path": original.absoluteString, "mimeType": "image/jpeg"]]), capture: file)
      try store.publish(["just some words"], capture: other)
      try check(try store.unassignedCount() == 3, "signed out, the count is all there is")
      try check(try store.unassigned(owner: "owner-a").isEmpty, "with no account connected, nothing is listed")
      try check(try store.claim(tiktok.id + ":nothing", owner: "owner-a", generation: 2) == .refused, "with no account connected, nothing can be claimed")
      try store.bind("owner-a:7:\(family)", automaticEpoch: 4)
      try check(try store.pending() == nil, "connecting doesn't deliver any of them")
      try check(try store.unassigned(owner: "owner-b").isEmpty, "another account isn't shown them")
      let rows = try store.unassigned(owner: "owner-a"), summaries = try rows.map(BabySharePayload.summary)
      try check(summaries.map { $0["kind"] as? String } == ["link", "photo", "text"], "listed in the order they were shared, by kind")
      try check(summaries[0]["host"] as? String == "tiktok.com", "a link shows only its website")
      try check(summaries[1]["count"] as? Int == 2, "photos are counted")
      let shown = try JSONSerialization.data(withJSONObject: summaries)
      for leak in ["private", "someone", "/video/", "just some words", "photo.jpg", "file:"] {
        try check(!String(decoding: shown, as: UTF8.self).contains(leak), "the listing doesn't show \(leak)")
      }
      let token = rows[0].snapshot.token
      try check(try store.claim(token, owner: "owner-b", generation: 2) == .refused, "another account can't claim it")
      try check(try store.claim(token + "x", owner: "owner-a", generation: 2) == .refused, "a stale token can't claim it")
      try check(try store.claim(token, owner: "owner-a", generation: 0) == .refused, "nor with no generation")
      try check(try store.claim(token, owner: "owner-a", generation: 2) == .claimed, "its owner, connected, can")
      try check(try store.claim(token, owner: "owner-a", generation: 2) == .refused, "and only once")
      let claimed = try store.pending()!
      try check(claimed.token == token && claimed.scope == "owner-a:2:personal", "the capture is now delivered to its personal space, not the connected family")
      try check(claimed.automaticEpoch == 0 && claimed.claimed, "and carries no permission for AI")
      let decoded = try BabySharePayload.decode(claimed)
      try check(decoded["claimed"] as? Bool == true && decoded["scope"] as? String == "owner-a:2:personal", "the app is told so")
      try check(decoded["automatic_epoch"] as? Int == 0, "the epoch stays 0 in the handoff")
      try check(try !store.discard(token), "a claimed capture isn't \"not mine\" any more")
      try check(try store.acknowledge(token), "it hands off as usual")
      try check(try store.pending() == nil, "and the others stay waiting")
      try check(try store.unassignedCount() == 2, "two left")
      let photo = try store.unassigned(owner: "owner-a")[0].snapshot.token
      try check(FileManager.default.fileExists(atPath: original.path), "its file is there")
      try check(try store.discard(photo), "not mine removes that exact one")
      try check(!FileManager.default.fileExists(atPath: file.directory.path), "with its files")
      try check(try store.unassignedCount() == 1, "and only it")
      let owned = UUID().uuidString
      try store.publish(["mine"], id: owned)
      let ownedToken = try store.pending()!.token
      try check(try !store.discard(ownedToken), "not mine can't touch a capture under an account")
      try check(try store.claim(ownedToken, owner: "owner-a", generation: 3) == .refused, "claim can't retag one either")
      try check(try store.acknowledge(ownedToken), "that one's still whole")
      // A claim that's raced by sign-out finds nothing to act on, and sign-out still clears what's left.
      let last = try store.unassigned(owner: "owner-a")[0].snapshot.token
      try store.clear(preserveUnassigned: true)
      try check(try store.claim(last, owner: "owner-a", generation: 2) == .refused, "once the connection's gone, no claim")
      try store.bind("owner-a:7:personal")
      try store.clear()
      try check(try store.unassignedCount() == 0, "an explicit sign-out clears them")
      try check(!FileManager.default.fileExists(atPath: path(root, other.id).path), "from disk")
    }
    do {
      // Kept for 30 days, from when it was shared or from when this build first saw an older one.
      var clock = Date(timeIntervalSince1970: 1_800_000_000)
      let root = folder.appendingPathComponent("expiry"), suite = "hafa.share.test." + UUID().uuidString
      try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
      let defaults = UserDefaults(suiteName: suite)!
      defer { defaults.removePersistentDomain(forName: suite) }
      let store = BabyShareStore(container: root, defaults: defaults, now: { clock })
      let day: TimeInterval = 24 * 60 * 60
      let capture = try store.begin()
      let file = capture.directory.appendingPathComponent("photo.jpg")
      try Data("private".utf8).write(to: file)
      try store.publish(JSONSerialization.data(withJSONObject: [["path": file.absoluteString, "mimeType": "image/jpeg"]]), capture: capture)
      try store.bind("owner-a:1:personal")
      let waiting = try store.unassigned(owner: "owner-a")[0]
      try check(waiting.keptUntil == clock.addingTimeInterval(30 * day), "kept until says 30 days from sharing")
      clock.addTimeInterval(30 * day - 1)
      try check(try store.unassignedCount() == 1, "still here the second before")
      // The card's still open across the moment it ran out.
      clock.addTimeInterval(1)
      try check(try store.claim(waiting.snapshot.token, owner: "owner-a", generation: 1) == .expired, "tapping Add on an open card finds it's run out")
      try check(try store.pending() == nil, "and it isn't delivered")
      try check(try store.unassignedCount() == 0, "it can't be seen at 30 days")
      try check(try store.unassigned(owner: "owner-a").isEmpty, "or listed")
      try check(FileManager.default.fileExists(atPath: capture.directory.path), "and goes from disk only once the clock has held")
      clock.addTimeInterval(day)
      _ = try store.unassignedCount()
      try check(!FileManager.default.fileExists(atPath: capture.directory.path), "a day later it's gone")
      // A clock a year ahead when it was shared, then put right: not stuck for a year, and not gone early.
      try store.clear(preserveUnassigned: true)
      let real = clock
      clock = real.addingTimeInterval(365 * day)
      let ahead = try store.begin()
      try store.publish(["shared with the clock ahead"], capture: ahead)
      clock = real
      try store.bind("owner-a:1:personal")
      try check(try store.unassigned(owner: "owner-a").first?.keptUntil == real.addingTimeInterval(30 * day), "its 30 days start from the corrected clock")
      clock.addTimeInterval(31 * day)
      try check(try store.unassignedCount() == 0, "so it does run out")
      clock.addTimeInterval(day)
      _ = try store.unassignedCount()
      try check(!FileManager.default.fileExists(atPath: ahead.directory.path), "and does go")
      // A clock jumped ahead with no sweep in between still resets rather than deleting.
      try store.clear(preserveUnassigned: true)
      let unseen = try store.begin()
      try store.publish(["never swept"], capture: unseen)
      let manifestURL = unseen.directory.appendingPathComponent("manifest.json")
      // Ahead of a clock that's now behind it, by a year.
      var fields = try JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as! [String: Any]
      fields["heldSince"] = clock.addingTimeInterval(365 * day).timeIntervalSinceReferenceDate
      try JSONSerialization.data(withJSONObject: fields).write(to: manifestURL)
      try store.bind("owner-a:1:personal")
      try check(try store.claim(store.unassigned(owner: "owner-a")[0].snapshot.token, owner: "owner-a", generation: 1) == .claimed, "a future share time resets, and can still be added")
      try check(try store.pending() != nil && store.acknowledge(store.pending()!.token), "and handed over")
      // A forward jump, seen by a sweep, then corrected: hidden meanwhile, never deleted.
      try store.clear(preserveUnassigned: true)
      let jumped = try store.begin()
      try store.publish(["clock jumps ahead later"], capture: jumped)
      let beforeJump = clock
      clock.addTimeInterval(365 * day)
      try check(try store.unassignedCount() == 0, "a jump ahead hides it")
      try check(FileManager.default.fileExists(atPath: jumped.directory.path), "without deleting it")
      clock = beforeJump.addingTimeInterval(day)
      try check(try store.unassignedCount() == 1, "putting the clock right brings it back")
      clock.addTimeInterval(365 * day)
      _ = try store.unassignedCount()
      clock.addTimeInterval(day)
      _ = try store.unassignedCount()
      try check(!FileManager.default.fileExists(atPath: jumped.directory.path), "a clock that stays ahead is believed after a day")
      // The same capture as an older build wrote it: published, no owner, no clock of its own, and old.
      try store.clear(preserveUnassigned: true)
      let old = try store.begin()
      try store.publish(["an older share"], capture: old)
      try store.bind("owner-a:1:personal")
      let manifest = old.directory.appendingPathComponent("manifest.json")
      fields = try JSONSerialization.jsonObject(with: Data(contentsOf: manifest)) as! [String: Any]
      fields.removeValue(forKey: "heldSince")
      try JSONSerialization.data(withJSONObject: fields).write(to: manifest)
      clock.addTimeInterval(365 * day)
      let current = root.appendingPathComponent(".hafa-baby-share-store-v1/current.json")
      try check(FileManager.default.fileExists(atPath: current.path), "it's the current one")
      try check(try store.unassignedCount() == 1, "a year-old share isn't removed on first sight")
      try check(try store.unassigned(owner: "owner-a")[0].keptUntil == clock.addingTimeInterval(30 * day), "its 30 days start now")
      clock.addTimeInterval(30 * day)
      try store.abort(try store.begin())
      clock.addTimeInterval(day)
      try store.abort(try store.begin())
      try check(!FileManager.default.fileExists(atPath: old.directory.path), "a later share's sweep removes it")
      try check(!FileManager.default.fileExists(atPath: current.path), "and doesn't leave the pointer behind")
      try check(defaults.object(forKey: "hafababyShareKey") == nil, "or the old copy in defaults")
      // Under an account nothing has this clock: decision 6 leaves those as they are.
      let mine = UUID().uuidString
      try store.publish(["mine"], id: mine)
      clock.addTimeInterval(400 * day)
      try check(try store.pending()?.token.hasPrefix(mine) == true, "a capture under an account doesn't expire")
    }
    do {
      // Only an ordinary website's name is ever shown, because whoever's signed in hasn't said this is theirs.
      let website = BabySharePayload.website
      try check(website("https://www.TikTok.com/@someone/video/1?a=b") == "tiktok.com", "an ordinary link shows its website")
      try check(website("http://sub.example.co.uk/x") == "sub.example.co.uk", "http and subdomains are fine")
      try check(website("https://user:secret@tiktok.com/x") == "tiktok.com", "credentials never come through")
      try check(website("https://example.com:8443/x") == "example.com", "nor the port")
      for bad in ["https://example.com%2Fprivate%2Fpregnancy-record", "https://exa%20mple.com/x", "https://%70regnancy%2Erecord/x", "https://例え.jp/x", "https://xn--r8jz45g.jp/x",
        "https://[::1]/x", "http://192.168.1.2/x", "https://localhost/x", "ftp://example.com/x", "file:///private/record.pdf", "mailto:someone@example.com", "not a link", "https:///x", "https://-bad.example/x", "https://a..b.com/x"] {
        try check(website(bad) == nil, "\(bad) falls back to Link")
      }
      let (_, defaults, store, suite) = try fixture("suspicious-link")
      defer { defaults.removePersistentDomain(forName: suite) }
      try store.publish(Data(#"[{"url":"https://example.com%2Fprivate%2Fpregnancy-record"}]"#.utf8), id: UUID().uuidString)
      try store.bind("owner-a:1:personal")
      let summary = try BabySharePayload.summary(store.unassigned(owner: "owner-a")[0])
      try check(summary["kind"] as? String == "link" && summary["host"] == nil, "the card says Link")
      try check(!String(decoding: try JSONSerialization.data(withJSONObject: summary), as: UTF8.self).contains("pregnancy"), "and nothing of the path reaches the app")
    }
    do {
      // A claim from a card that's fallen behind the connection.
      let (_, defaults, store, suite) = try fixture("claim-generation")
      defer { defaults.removePersistentDomain(forName: suite) }
      try store.publish(["waiting"], id: UUID().uuidString)
      try store.bind("owner-a:1:personal")
      try store.bind("owner-a:2:personal")
      let token = try store.unassigned(owner: "owner-a")[0].snapshot.token
      try check(try store.claim(token, owner: "owner-a", generation: 1) == .refused, "an obsolete personal generation can't claim it")
      try check(try store.unassignedCount() == 1, "and it's still waiting")
      try check(try store.claim(token, owner: "owner-a", generation: 2) == .claimed, "the current one can")
    }
    do {
      // A restore or device transfer gives the app group a new path. The files are still there, and still found.
      let suite = "hafa.share.test." + UUID().uuidString, defaults = UserDefaults(suiteName: suite)!
      defer { defaults.removePersistentDomain(forName: suite) }
      let before = folder.appendingPathComponent("AppGroup/11111111-AAAA-4AAA-8AAA-111111111111"), after = folder.appendingPathComponent("AppGroup/22222222-BBBB-4BBB-8BBB-222222222222")
      try FileManager.default.createDirectory(at: before, withIntermediateDirectories: true)
      let old = BabyShareStore(container: before, defaults: defaults)
      try old.bind("owner-a:1:personal")
      let photo = try old.begin(), gone = try old.begin(), foreign = try old.begin(), legacy = try old.begin()
      let photoFile = photo.directory.appendingPathComponent("photo.jpg"), goneFile = gone.directory.appendingPathComponent("gone.jpg"), legacyFile = before.appendingPathComponent("legacy.jpg")
      for file in [photoFile, goneFile, legacyFile] { try Data("private".utf8).write(to: file) }
      func row(_ file: URL) throws -> Data { try JSONSerialization.data(withJSONObject: [["path": file.absoluteString, "fileName": file.lastPathComponent, "mimeType": "image/jpeg"]]) }
      try old.publish(row(photoFile), capture: photo)
      try old.publish(row(goneFile), capture: gone)
      // Names another capture's folder, which no real capture does.
      try old.publish(row(photoFile), capture: foreign)
      try old.publish(row(legacyFile), capture: legacy)
      let waiting = UUID().uuidString
      try old.publish(["the one behind"], id: waiting)
      try FileManager.default.removeItem(at: goneFile)
      try FileManager.default.moveItem(at: before, to: after)
      let moved = BabyShareStore(container: after, defaults: defaults)
      var capture = try BabySharePayload.next(moved)!
      var files = capture["files"] as! [[String: Any]]
      let found = URL(string: files[0]["path"] as! String)!
      try check(found.path.hasPrefix(after.standardizedFileURL.resolvingSymlinksInPath().path) && FileManager.default.fileExists(atPath: found.path), "a moved container's file is found where it is now")
      try check(files[0]["fileName"] as? String == "photo.jpg", "under its own name")
      try check(try moved.acknowledge(capture["token"] as! String), "and it hands off")
      capture = try BabySharePayload.next(moved)!
      files = capture["files"] as! [[String: Any]]
      try check(capture["capture_id"] as? String == legacy.id.lowercased(), "a file gone and one naming another capture's folder are both set aside, and the queue moves on")
      try check(FileManager.default.fileExists(atPath: URL(string: files[0]["path"] as! String)!.path), "an old container-root file is found too")
      try check(try moved.acknowledge(capture["token"] as! String), "and hands off")
      capture = try BabySharePayload.next(moved)!
      try check(capture["capture_id"] as? String == waiting.lowercased(), "the one behind arrives")
      try check(try moved.acknowledge(capture["token"] as! String), "and hands off")
      try check(try BabySharePayload.next(moved) == nil, "and the queue is empty, without throwing")
      let aside = try moved.blocked(owner: "owner-a")
      try check(aside.count == 2 && aside.allSatisfy { $0.blocked == "unreadable" }, "the two unreadable ones wait for Today's card")
      try check(try moved.removeBlocked(aside[0].snapshot.token, owner: "owner-a"), "which can remove them")
      try check(moved.ownedFile("file:///etc/passwd") == nil, "a path outside the store is still refused")
      try check(moved.ownedFile(photoFile.deletingLastPathComponent().appendingPathComponent("../../../../secret").absoluteString) == nil, "and a climb out of it")
      // A locked phone isn't a missing file.
      let lock = after.appendingPathComponent(".hafa-baby-share-store-v1/store.lock")
      try moved.publish(["kept through a lock"], id: UUID().uuidString)
      try FileManager.default.setAttributes([.posixPermissions: 0], ofItemAtPath: lock.path)
      var threw = false
      do { _ = try BabySharePayload.next(moved) } catch { threw = true }
      try check(threw, "with the store closed nothing is judged")
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: lock.path)
      try check(try moved.blocked(owner: "owner-a").count == 1, "and nothing was set aside for it")
      try check(try BabySharePayload.next(moved) != nil, "it's still there afterwards")
    }
    do {
      // A capture that can never be delivered doesn't hold up the ones behind it.
      let (_, defaults, store, suite) = try fixture("blocked")
      defer { defaults.removePersistentDomain(forName: suite) }
      try store.bind("owner-a:1:personal")
      let big = UUID().uuidString, next = UUID().uuidString
      try store.publish(["too big"], id: big)
      try store.publish(["next"], id: next)
      let first = try store.pending()!
      try check(first.token.hasPrefix(big), "it comes up first")
      try check(try !store.block(first.token, reason: "anything else"), "only the app's own refusals set one aside")
      try check(try !store.block(first.token + "x", reason: "file_too_large"), "and only the exact capture")
      try check(try store.block(first.token, reason: "file_too_large"), "it's set aside")
      let second = try store.pending()!
      try check(second.token.hasPrefix(next), "the next one comes through")
      try check(try store.acknowledge(second.token), "and is delivered")
      try check(try store.pending() == nil, "nothing keeps retrying the blocked one")
      try check(try store.blocked(owner: "owner-b").isEmpty, "another account isn't shown it")
      let rows = try store.blocked(owner: "owner-a")
      try check(rows.count == 1 && rows[0].blocked == "file_too_large", "its owner is, with why")
      try check(try BabySharePayload.summary(rows[0])["blocked"] as? String == "file_too_large", "the card is told why")
      try check(try !store.discard(first.token), "not mine can't touch it")
      try check(try !store.removeBlocked(first.token, owner: "owner-b"), "another account can't remove it")
      try check(try store.removeBlocked(first.token, owner: "owner-a"), "its owner can")
      try check(try store.blocked(owner: "owner-a").isEmpty, "and it's gone")
      try store.publish(["big again"], id: UUID().uuidString)
      try check(try store.block(store.pending()!.token, reason: "unsupported_file"), "set aside again")
      try store.clear()
      try check(try store.blocked(owner: "owner-a").isEmpty, "sign-out clears these too")
    }
    print("\(count) native capture store cases passed")
  }
}
