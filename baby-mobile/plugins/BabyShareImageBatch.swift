import Foundation

// Await each provider in selection order. Nothing becomes visible to the host
// until every selected image has loaded and publication succeeds.
@MainActor
enum BabyShareImageBatch {
  enum InvalidBatch: Error { case invalid }

  static func process<Input, Output>(
    _ inputs: [Input],
    load: (Input) async throws -> Output,
    publish: ([Output]) throws -> Void,
    discard: (Output) -> Void
  ) async throws {
    guard (1...4).contains(inputs.count) else { throw InvalidBatch.invalid }
    var loaded: [Output] = []
    do {
      for input in inputs {
        try Task.checkCancellation()
        loaded.append(try await load(input))
      }
      try Task.checkCancellation()
      try publish(loaded)
    } catch {
      for output in loaded { discard(output) }
      throw error
    }
  }
}
