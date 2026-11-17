#if DEBUG
import Foundation

/// Synthetic layout fixture, never real class programming. Not compiled into Release.
enum SamplePlan {
  static var plan: WatchPlan {
    let move = WatchPlan.Move(index: 0, text: "6 air squats", isRun: false)
    return WatchPlan(planKey: "debug-sample", title: "Sample class", activityType: 11, parts: [
      .init(blockId: "demo-a", label: "A", kind: .amrap, capSeconds: 30, restAfterSeconds: 20,
        scored: true, moves: [.init(index: 1, text: "Walk 20 m", segment: "buy_in", isRun: false), move]),
      .init(blockId: "demo-b", label: "B", kind: .forTime, capSeconds: 30, rounds: 2, scored: true, moves: [move]),
      .init(blockId: "demo-c", label: "C", kind: .emom, intervalSeconds: 10, intervals: 2, scored: false, moves: [move]),
      .init(blockId: "demo-d", label: "D", kind: .workRest, workSeconds: 5, restSeconds: 5, rounds: 2,
        scored: false, moves: [move]),
      .init(blockId: "demo-e", label: "E", kind: .sets, restSeconds: 10, rounds: 2, scored: false,
        moves: [.init(index: 0, text: "E · Air squat · 6 · 3010", isRun: false)])
    ])
  }
}
#endif
