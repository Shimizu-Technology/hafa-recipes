import Foundation

/// Corrections are separate from recorded taps and survive checkpoint/retry before X5 sync.
struct PartScore: Codable, Equatable {
  var rounds = 0
  var reps = 0
  var seconds = 0
  var scaled = false

  static func initial(_ runner: PartRunner, index: Int, at date: Date) -> PartScore {
    runner.runs[index].score ?? PartScore(
      rounds: runner.runs[index].taps.count,
      seconds: Int(runner.activeSeconds(of: index, at: date)))
  }
}
