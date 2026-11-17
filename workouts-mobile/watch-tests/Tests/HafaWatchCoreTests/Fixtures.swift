import Foundation
@testable import HafaWatchCore

let t0 = Date(timeIntervalSinceReferenceDate: 800_000_000)

func at(_ seconds: TimeInterval) -> Date { t0.addingTimeInterval(seconds) }

func part(
  _ label: String, _ kind: WatchPlan.Part.Kind, cap: Int? = nil, rounds: Int? = nil, restAfter: Int? = nil,
  buyIn: Bool = false
) -> WatchPlan.Part {
  var moves = [WatchPlan.Move(index: 1, text: "15 wall balls", segment: nil, isRun: false, distanceM: nil)]
  if buyIn { moves.insert(.init(index: 0, text: "Run 1000 m", segment: "buy_in", isRun: true, distanceM: 1000), at: 0) }
  return WatchPlan.Part(
    blockId: "block-\(label)", label: label, kind: kind, capSeconds: cap, intervalSeconds: nil, intervals: nil,
    workSeconds: nil, restSeconds: nil, rounds: rounds, restAfterSeconds: restAfter, scored: kind != .sets, moves: moves)
}

func plan(_ parts: WatchPlan.Part...) -> WatchPlan {
  WatchPlan(planKey: "2026-11-17-unified", title: "BUILD | BRIK", activityType: 11, parts: parts)
}
