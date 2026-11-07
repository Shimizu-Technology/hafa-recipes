import Foundation

// The generator test injects the actual generated lifecycle and preparation
// methods here. UIKit's presentation callbacks are driven explicitly; capture
// creation, privacy clear, and stale publication use the real shared store.
private enum BabyShareSheetState: Equatable {
  case saving, stillWorking, failed
  static let stillWorkingAfter: TimeInterval = 0.05, giveUpAfter: TimeInterval = 0.12
}
private final class TestContext {
  var completed = 0
  func completeRequest(returningItems: [Any], completionHandler: ((Bool) -> Void)?) { completed += 1 }
}
private class TestViewController {
  var loaded = 0, appeared = 0
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
    func turn(_ seconds: TimeInterval) { RunLoop.main.run(until: Date().addingTimeInterval(seconds)) }
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
      try store.publish(["slow but fine"], capture: slowCapture)
      slow.babyPublished = true
      turn(0.1)
      try check(slow.shown == [.saving, .stillWorking], "a slow provider that does answer isn't cut off")
      try check(try store.pending()?.token.hasPrefix(slowCapture.id) == true, "and what it saved is kept")
      slow.finishConfirmation()
      try check(FileManager.default.fileExists(atPath: slowCapture.directory.path), "closing after publication keeps it")
      try check(slow.extensionContext!.completed == 1, "and completes once")
    }
    print("\(checks) native generated lifecycle cases passed")
  }
}
