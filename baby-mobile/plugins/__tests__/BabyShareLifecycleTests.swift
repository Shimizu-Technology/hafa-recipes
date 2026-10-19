import Foundation

// The generator test injects the actual generated lifecycle and preparation
// methods here. UIKit's presentation callbacks are driven explicitly; capture
// creation, privacy clear, and stale publication use the real shared store.
private enum TestColor { case clear }
private final class TestView {
  var backgroundColor: TestColor?
  var isOpaque = true
}
private class TestViewController {
  let view = TestView()
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
  var storeRequests = 0, providerStarts = 0, errors = 0
  init(hideView: Bool, storage: BabyShareStore) { self.hideView = hideView; self.storage = storage }
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
      try check(controller.view.isOpaque == !hideView, "hidden extension appearance retained")
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
    print("\(checks) native generated lifecycle cases passed")
  }
}
