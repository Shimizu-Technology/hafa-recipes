import Foundation

// The generator test injects the actual generated lifecycle and preparation
// methods here. UIKit's presentation callbacks are driven explicitly; capture
// creation, privacy clear, and stale publication use the real shared store.
private enum BabyShareSheetState: Equatable {
  case saving, stillWorking, failed
  static let stillWorkingAfter: TimeInterval = 0.05, giveUpAfter: TimeInterval = 0.12, publishTimeout: TimeInterval = 0.2
  enum Publication: Equatable { case kept, failed, notKept, gone, slow, slowUnmarked }
}
// Advance deadlines explicitly: a busy host must not turn an 80ms wait into
// the 120ms give-up deadline before the synthetic provider can publish.
private enum TestScheduler {
  static var now: TimeInterval = 0
  static var pending: [(deadline: TimeInterval, action: () -> Void)] = []
  static func schedule(after delay: TimeInterval, execute: @escaping () -> Void) {
    pending.append((now + delay, execute))
  }
  static func advance(by seconds: TimeInterval) {
    let end = now + seconds
    while let first = pending.indices.min(by: { pending[$0].deadline < pending[$1].deadline }), pending[first].deadline <= end {
      let next = pending.remove(at: first)
      now = next.deadline
      next.action()
    }
    now = end
  }
}
private final class TestContext {
  var completed = 0
  func completeRequest(returningItems: [Any], completionHandler: ((Bool) -> Void)?) { completed += 1 }
}
private enum TestPresentation { case automatic, overFullScreen }
private class TestViewController {
  var loaded = 0, appeared = 0
  var modalPresentationStyle = TestPresentation.automatic
  func awakeFromNib() {}
  func viewDidLoad() { loaded += 1 }
  func viewDidAppear(_ animated: Bool) { appeared += 1 }
}
private final class GeneratedController: TestViewController {
  let hideView: Bool
  let storage: BabyShareStore
  let babyCaptureId = UUID().uuidString
  var babyProducer: (storage: BabyShareStore, capture: BabyShareStore.Capture)?
  var preparationFails = false
  var storeRequests = 0, providerStarts = 0, errors = 0, painted = 0, paintedBeforeStore = false
  var shown: [BabyShareSheetState] = []
  var captureConfirmationFinished = false
  let extensionContext: TestContext? = TestContext()
  init(hideView: Bool, storage: BabyShareStore) { self.hideView = hideView; self.storage = storage }
  func showBabySheet(_ state: BabyShareSheetState) { painted += 1; paintedBeforeStore = storeRequests == 0; shown.append(state) }
  func babyShareStore() throws -> BabyShareStore {
    storeRequests += 1
    if preparationFails { throw BabyShareStore.Failure.unavailable }
    return storage
  }
  func dismissWithError(message: String) { errors += 1 }
  var cardClosed = 0
  func closeBabyCard(then done: @escaping () -> Void) { cardClosed += 1; done() }
  var babyPayload: Any?
  // The generator test checks that staging never publishes; here it only needs to hold the payload.
  func stageBabyPayload(_ raw: Any) throws { babyPayload = raw }
  // Publication held until the test lets it run, as a slow disk or a busy lock would.
  // Each step of Save's write is held until the test lets it run, as a slow disk or a busy lock would.
  var held: [() -> Void] = []
  func babyPublishOffMain(_ work: @escaping () -> BabyShareSheetState.Publication, then done: @escaping (BabyShareSheetState.Publication) -> Void) {
    held.append { done(work()) }
  }
  func runStep() { if !held.isEmpty { held.removeFirst()() } }
  func runAll() { while !held.isEmpty { held.removeFirst()() } }
  var alreadySaved = 0
  func babyAlreadySaved() { alreadySaved += 1 }
  func handleViewLoad() {
    guard prepareBabyShare() else { return }
    providerStarts += 1
  }
  /* GENERATED_PREPARATION */
  /* GENERATED_LIFECYCLE */
}

@main
private struct BabyShareLifecycleTests {
  static func main() throws {
    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Håfa lifecycle " + UUID().uuidString)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: folder) }
    var checks = 0
    func check(_ condition: @autoclosure () throws -> Bool, _ label: String) throws {
      guard try condition() else { throw NSError(domain: label, code: checks) }
      checks += 1
    }
    for hideView in [true, false] {
      let suite = "hafa.lifecycle." + UUID().uuidString
      let defaults = UserDefaults(suiteName: suite)!
      defer { defaults.removePersistentDomain(forName: suite) }
      let store = BabyShareStore(container: folder.appendingPathComponent(suite), defaults: defaults)
      let controller = GeneratedController(hideView: hideView, storage: store)
      controller.viewDidLoad()
      try check(controller.loaded == 1, "super load remains called")
      try check(controller.providerStarts == 0, "no provider starts during presentation")
      try check(controller.babyProducer != nil && controller.storeRequests == 1, "capture epoch acquired synchronously")
      try check(controller.painted == 1 && controller.paintedBeforeStore, "the sheet is painted before anything can take time")
      controller.viewDidAppear(true)
      controller.viewDidAppear(false)
      try check(controller.providerStarts == 1, "provider runs once after completed presentation")
      try check(controller.appeared == 2, "super appear remains called every time")
      try check(controller.storeRequests == 1, "provider reuses earliest capture")
      try store.abort(controller.babyProducer!.capture)

      let cleared = GeneratedController(hideView: hideView, storage: store)
      cleared.viewDidLoad()
      let earlyCapture = cleared.babyProducer!.capture
      try store.clear()
      cleared.viewDidAppear(true)
      try check(cleared.storeRequests == 1, "clear before appear cannot acquire a new epoch")
      do {
        try store.publish(["delayed synthetic source"], capture: earlyCapture)
        throw NSError(domain: "retired producer published", code: 1)
      } catch BabyShareStore.Failure.stale {}
      try check(try store.pending() == nil, "clear before appear cannot resurrect a receipt")
      try check(!FileManager.default.fileExists(atPath: earlyCapture.directory.path), "retired capture directory remains absent")

      let failed = GeneratedController(hideView: hideView, storage: store)
      failed.preparationFails = true
      failed.viewDidLoad()
      failed.preparationFails = false
      failed.viewDidAppear(true)
      failed.viewDidAppear(false)
      try check(failed.storeRequests == 1 && failed.errors == 1, "failed load preparation is never retried late")
      try check(failed.babyProducer == nil && failed.providerStarts == 0, "failed early preparation cannot process")
    }
    func turn(_ seconds: TimeInterval) { TestScheduler.advance(by: seconds) }
    do {
      // A provider that never answers. The clocks here are the short ones at the top of this file.
      let suite = "hafa.lifecycle." + UUID().uuidString, defaults = UserDefaults(suiteName: suite)!
      defer { defaults.removePersistentDomain(forName: suite) }
      let store = BabyShareStore(container: folder.appendingPathComponent(suite), defaults: defaults)
      let stuck = GeneratedController(hideView: true, storage: store)
      stuck.viewDidLoad(); stuck.viewDidAppear(true)
      let capture = stuck.babyProducer!.capture
      try check(stuck.shown == [.saving], "nothing is offered yet")
      turn(0.08)
      try check(stuck.shown == [.saving, .stillWorking], "a way out is offered, with no word of saving")
      try check(stuck.extensionContext!.completed == 0, "and nothing's been closed for her")
      stuck.finishConfirmation()
      stuck.finishConfirmation()
      try check(stuck.extensionContext!.completed == 1, "Stop completes the request exactly once")
      try check(!FileManager.default.fileExists(atPath: capture.directory.path), "and keeps none of what was staged")
      do { try store.publish(["late"], capture: capture); throw NSError(domain: "a stopped capture published", code: 1) }
      catch BabyShareStore.Failure.stale {}
      try check(try store.pending() == nil, "a provider answering late can't bring it back")
      turn(0.1)
      try check(stuck.shown == [.saving, .stillWorking], "the clock after Stop changes nothing")

      let hung = GeneratedController(hideView: true, storage: store)
      hung.viewDidLoad(); hung.viewDidAppear(true)
      let hungCapture = hung.babyProducer!.capture
      turn(0.18)
      try check(hung.shown == [.saving, .stillWorking, .failed], "with no answer at all, the wait ends and says it couldn't save")
      try check(!FileManager.default.fileExists(atPath: hungCapture.directory.path), "nothing is staged after giving up")
      try check(hung.extensionContext!.completed == 0, "and Done is hers to press")
      hung.finishConfirmation()
      try check(hung.extensionContext!.completed == 1, "which completes it once")

      let slow = GeneratedController(hideView: true, storage: store)
      slow.viewDidLoad(); slow.viewDidAppear(true)
      let slowCapture = slow.babyProducer!.capture
      turn(0.08)
      try slow.stageBabyPayload(["slow but fine"])
      slow.babyStaged = true
      turn(0.1)
      try check(slow.shown == [.saving, .stillWorking], "a slow provider that does answer isn't cut off")
      try check(try store.pending() == nil, "staged isn't saved: nothing's in the queue before Save")
      slow.finishConfirmation()
      try check(!FileManager.default.fileExists(atPath: slowCapture.directory.path), "closing before Save keeps nothing")
      try check(slow.extensionContext!.completed == 1 && slow.cardClosed == 1, "and the card closes once")

      let kept = GeneratedController(hideView: true, storage: store)
      kept.viewDidLoad(); kept.viewDidAppear(true)
      let keptCapture = kept.babyProducer!.capture
      try kept.stageBabyPayload(["saved"])
      kept.babyStaged = true
      try store.publish(kept.babyPayload!, capture: keptCapture)
      kept.finishConfirmation()
      try check(try store.pending()?.token.hasPrefix(keptCapture.id) == true, "Save is what keeps it")
      try check(FileManager.default.fileExists(atPath: keptCapture.directory.path), "and closing after Save leaves it for the app")
      try check(kept.extensionContext!.completed == 1, "and completes once")
      _ = try store.acknowledge(try store.published(keptCapture.id)!.token)

      // Close while Save is still publishing: nothing is aborted, and the capture it was writing survives.
      let saving = GeneratedController(hideView: true, storage: store)
      saving.viewDidLoad(); saving.viewDidAppear(true)
      let savingCapture = saving.babyProducer!.capture
      try Data("staged photo".utf8).write(to: savingCapture.directory.appendingPathComponent("photo.jpg"))
      try saving.stageBabyPayload(["saving"])
      saving.babyStaged = true
      var result: BabyShareSheetState.Publication?
      saving.publishBabyCapture(collection: nil) { result = $0 }
      try check(!saving.held.isEmpty && result == nil, "publication is under way")
      saving.finishConfirmation()
      try check(saving.extensionContext!.completed == 0 && saving.cardClosed == 0, "Close waits while Save publishes")
      try check(FileManager.default.fileExists(atPath: savingCapture.directory.appendingPathComponent("photo.jpg").path), "and its staged files are untouched")
      saving.runAll()
      try check(result == .kept, "publication then completes")
      try check(try store.published(savingCapture.id) != nil, "and the capture is kept")
      saving.finishConfirmation()
      try check(saving.extensionContext!.completed == 1, "after which Close works")
      try check(FileManager.default.fileExists(atPath: savingCapture.directory.appendingPathComponent("photo.jpg").path), "and leaves the capture for the app")
      _ = try store.acknowledge(try store.published(savingCapture.id)!.token)

      // Slow: the write never answers in time. Close is allowed again and keeps the capture; the late answer changes nothing.
      let slow2 = GeneratedController(hideView: true, storage: store)
      slow2.viewDidLoad(); slow2.viewDidAppear(true)
      let slowCapture2 = slow2.babyProducer!.capture
      try Data("staged photo".utf8).write(to: slowCapture2.directory.appendingPathComponent("photo.jpg"))
      try slow2.stageBabyPayload(["slow write"])
      slow2.babyStaged = true
      var answers: [BabyShareSheetState.Publication] = []
      try check(slow2.publishBabyCapture(collection: nil) { answers.append($0) }, "Save's write starts")
      // The mark goes down at once, then the publish stalls: slow, and a promise.
      slow2.runStep()
      turn(0.1)
      try check(answers.isEmpty, "still saving")
      turn(0.15)
      try check(answers == [.slow], "after the timeout it's slow, said once, with the mark down")
      try check(!slow2.publishBabyCapture(collection: nil) { answers.append($0) }, "and there's no second write while the first may still land")
      slow2.finishConfirmation()
      try check(slow2.extensionContext!.completed == 1, "Close is allowed again")
      try check(FileManager.default.fileExists(atPath: slowCapture2.directory.appendingPathComponent("photo.jpg").path), "and keeps the capture")
      slow2.runAll()
      try check(answers == [.slow], "the late answer isn't reported twice")
      try check(try store.published(slowCapture2.id) != nil, "what it wrote is the app's")
      try check(FileManager.default.fileExists(atPath: slowCapture2.directory.appendingPathComponent("photo.jpg").path), "and nothing was deleted")
      _ = try store.acknowledge(try store.published(slowCapture2.id)!.token)

      // A forced write failure after Save: nothing is deleted. Close keeps the files; only Discard removes them.
      for discards in [false, true] {
        let failing = GeneratedController(hideView: true, storage: store)
        failing.viewDidLoad(); failing.viewDidAppear(true)
        let failingCapture = failing.babyProducer!.capture
        let photo = failingCapture.directory.appendingPathComponent("photo.jpg")
        try Data("staged photo".utf8).write(to: photo)
        try failing.stageBabyPayload(["will fail"])
        failing.babyStaged = true
        var failed: BabyShareSheetState.Publication?
        failing.publishBabyCapture(collection: nil) { failed = $0 }
        // Nothing in the capture's folder can be written now, so neither the mark nor the manifest lands.
        try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: failingCapture.directory.path)
        failing.runAll()
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: failingCapture.directory.path)
        try check(failed == .notKept, "a mark that can't be written is reported as not kept")
        try check(FileManager.default.fileExists(atPath: photo.path), "and the staged photo is still there")
        if discards {
          failing.discardBabyShare()
          try check(failing.alreadySaved == 0, "nothing was saved, so Discard really discards")
          try check(!FileManager.default.fileExists(atPath: failingCapture.directory.path), "Discard is the one choice that deletes it")
        } else {
          failing.finishConfirmation()
          try check(FileManager.default.fileExists(atPath: photo.path) && FileManager.default.fileExists(atPath: failingCapture.directory.appendingPathComponent("manifest.json").path), "Close keeps the photo and manifest")
          try check(try store.pending() == nil, "with no mark it promises nothing, and isn't delivered")
        }
        try check(failing.extensionContext!.completed == 1, "and the card closes once")
      }

      // The mark is held when the timer fires: nothing is promised. It lands later: now it is. The publish answers late: unsaid.
      let unmarked = GeneratedController(hideView: true, storage: store)
      unmarked.viewDidLoad(); unmarked.viewDidAppear(true)
      try unmarked.stageBabyPayload(["held mark"])
      unmarked.babyStaged = true
      var said: [BabyShareSheetState.Publication] = []
      unmarked.publishBabyCapture(collection: nil) { said.append($0) }
      turn(0.25)
      try check(said == [.slowUnmarked], "slow with no mark promises nothing")
      unmarked.runStep()
      try check(said == [.slowUnmarked, .slow], "the mark landing turns it into the promise")
      unmarked.runStep()
      try check(said == [.slowUnmarked, .slow], "and the publish answering late isn't reported")
      _ = try store.acknowledge(try store.published(unmarked.babyProducer!.capture.id)!.token)

      // The mark is held when the timer fires, then fails: slow is corrected to the honest failure, and Try again is open.
      let lateFail = GeneratedController(hideView: true, storage: store)
      lateFail.viewDidLoad(); lateFail.viewDidAppear(true)
      let lateCapture = lateFail.babyProducer!.capture
      try Data("staged photo".utf8).write(to: lateCapture.directory.appendingPathComponent("photo.jpg"))
      try lateFail.stageBabyPayload(["mark fails late"])
      lateFail.babyStaged = true
      var lateSaid: [BabyShareSheetState.Publication] = []
      lateFail.publishBabyCapture(collection: nil) { lateSaid.append($0) }
      turn(0.25)
      try FileManager.default.setAttributes([.posixPermissions: 0o500], ofItemAtPath: lateCapture.directory.path)
      lateFail.runStep()
      try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: lateCapture.directory.path)
      try check(lateSaid == [.slowUnmarked, .notKept], "a mark that fails after slow says so")
      try check(lateFail.held.isEmpty, "and no publish follows a failed mark")
      try check(lateFail.publishBabyCapture(collection: nil) { lateSaid.append($0) }, "Try again can start")
      lateFail.runAll()
      try check(lateSaid.last == .kept, "and saves it")
      _ = try store.acknowledge(try store.published(lateCapture.id)!.token)

      // Failed, then the app finished it before Discard: she's told it's already saved, and nothing is deleted.
      let raced = GeneratedController(hideView: true, storage: store)
      raced.viewDidLoad(); raced.viewDidAppear(true)
      let racedCapture = raced.babyProducer!.capture
      try Data("staged photo".utf8).write(to: racedCapture.directory.appendingPathComponent("photo.jpg"))
      try raced.stageBabyPayload(["app wins"])
      raced.babyStaged = true
      var racedSaid: BabyShareSheetState.Publication?
      raced.publishBabyCapture(collection: nil) { racedSaid = $0 }
      raced.runStep()
      // The publish fails: its manifest can't be read for the moment.
      let racedManifest = racedCapture.directory.appendingPathComponent("manifest.json")
      try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: racedManifest.path)
      raced.runStep()
      try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: racedManifest.path)
      try check(racedSaid == .failed, "the publish failed after the mark")
      try check(try store.pending()?.token.hasPrefix(racedCapture.id) == true, "the app's intake finishes it")
      raced.discardBabyShare()
      try check(raced.alreadySaved == 1 && raced.extensionContext!.completed == 0, "Discard then says it's already saved, and doesn't just close")
      try check(FileManager.default.fileExists(atPath: racedCapture.directory.appendingPathComponent("photo.jpg").path), "and deletes nothing")
    }
    print("\(checks) native generated lifecycle cases passed")
  }
}
