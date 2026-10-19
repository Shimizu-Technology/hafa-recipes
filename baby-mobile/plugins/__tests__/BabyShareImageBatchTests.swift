import Foundation

@MainActor
private final class Gate {
  private var completed: Set<Int> = []
  private var waiters: [Int: [CheckedContinuation<Void, Never>]] = [:]
  func wait(_ id: Int) async {
    if completed.contains(id) { return }
    await withCheckedContinuation { waiters[id, default: []].append($0) }
  }
  func finish(_ id: Int) {
    completed.insert(id)
    for waiter in waiters.removeValue(forKey: id) ?? [] { waiter.resume() }
  }
}

@main
struct BabyShareImageBatchTests {
  @MainActor
  static func main() async throws {
    var cases = 0
    func check(_ condition: Bool) throws {
      guard condition else { throw NSError(domain: "ImageBatchContract", code: cases) }
    }
    enum Failure: Error { case provider, publication }

    // Simulate later providers already ready while the first remains delayed.
    // The actual helper must await it before asking for the next image or
    // making any receipt visible to the host.
    do {
      let ready = Gate(), started = Gate()
      var loads: [Int] = [], receipts: [[String]] = [], discarded: [String] = []
      let task = Task { @MainActor in
        try await BabyShareImageBatch.process([0, 1, 2, 3], load: { id in
          loads.append(id)
          started.finish(id)
          await ready.wait(id)
          return "image-\(id)"
        }, publish: { receipts.append($0) }, discard: { discarded.append($0) })
      }
      await started.wait(0)
      ready.finish(3); ready.finish(1); ready.finish(2)
      await Task.yield()
      try check(loads == [0] && receipts.isEmpty && discarded.isEmpty)
      ready.finish(0)
      try await task.value
      try check(loads == [0, 1, 2, 3])
      try check(receipts == [["image-0", "image-1", "image-2", "image-3"]] && discarded.isEmpty)
      cases += 1
    }
    // Neither a first-provider failure nor a middle-provider failure may
    // produce a final receipt. Only successfully staged images are discarded.
    for failed in [0, 1, 3] {
      var loads: [Int] = [], receipts: [[Int]] = [], discarded: [Int] = []
      do {
        try await BabyShareImageBatch.process([0, 1, 2, 3], load: { id in
          loads.append(id)
          if id == failed { throw Failure.provider }
          return id
        }, publish: { receipts.append($0) }, discard: { discarded.append($0) })
        throw NSError(domain: "UnexpectedImageBatchSuccess", code: failed)
      } catch Failure.provider { }
      try check(receipts.isEmpty)
      try check(loads == Array(0...failed) && discarded == Array(0..<failed))
      cases += 1
    }
    // Encoding/defaults publication failure must roll back all staged files.
    do {
      var discarded: [Int] = [], published = false
      do {
        try await BabyShareImageBatch.process([0, 1], load: { $0 }, publish: { _ in
          throw Failure.publication
        }, discard: { discarded.append($0) })
        published = true
      } catch Failure.publication { }
      try check(!published && discarded == [0, 1])
      cases += 1
    }
    for input in [[], [0, 1, 2, 3, 4]] {
      var loaded = false, published = false
      do {
        try await BabyShareImageBatch.process(input, load: { id in loaded = true; return id },
          publish: { _ in published = true }, discard: { _ in })
        throw NSError(domain: "UnexpectedImageCountSuccess", code: cases)
      } catch BabyShareImageBatch.InvalidBatch.invalid { }
      try check(!loaded && !published)
      cases += 1
    }
    // Cancellation while a provider is loading also retires staged output.
    do {
      let started = Gate(), ready = Gate()
      var receipts: [[Int]] = [], discarded: [Int] = []
      let task = Task { @MainActor in
        try await BabyShareImageBatch.process([0, 1], load: { id in
          started.finish(id)
          await ready.wait(id)
          return id
        }, publish: { receipts.append($0) }, discard: { discarded.append($0) })
      }
      await started.wait(0)
      task.cancel()
      ready.finish(0)
      do { try await task.value; throw NSError(domain: "UnexpectedCancelledSuccess", code: cases) }
      catch is CancellationError { }
      try check(receipts.isEmpty && discarded == [0])
      cases += 1
    }
    print("Baby image batch: \(cases) native asynchronous cases passed")
  }
}
