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
      let current = try store.pending()!
      try check(!store.acknowledge(a + ":wrong-digest"), "wrong payload cannot acknowledge")
      try check(try store.acknowledge(old.token), "superseded leased receipt can acknowledge")
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
      let later = BabyShareStore(container: root, defaults: defaults, now: { future })
      _ = try later.pending()
      try check(FileManager.default.fileExists(atPath: writer!.directory.path), "active producer survives expiry")
      writer = nil; _ = try later.pending()
      try check(!FileManager.default.fileExists(atPath: path(root, writerID).path), "inactive interrupted producer expires")
      let a = UUID().uuidString, b = UUID().uuidString
      try store.publish(["leased old payload"], id: a); let old = try store.pending()!
      try store.publish(["current payload"], id: b); _ = try later.pending()
      try check(FileManager.default.fileExists(atPath: path(root, a).path), "active superseded reader survives expiry")
      try check(try store.acknowledge(old.token), "superseded reader can release after expiry")
      try check(FileManager.default.fileExists(atPath: path(root, b).path), "sweep retains referenced current capture")
      let unreferenced = UUID().uuidString
      try store.publish(["unleased"], id: unreferenced); try store.publish(["new current"], id: UUID().uuidString)
      _ = try later.pending()
      try check(!FileManager.default.fileExists(atPath: path(root, unreferenced).path), "inactive superseded capture expires")
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
      try check(try store.pending()!.token.hasPrefix(newerID + ":"), "retired producer cannot abort a newer publication")
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
    print("\(count) native capture store cases passed")
  }
}
