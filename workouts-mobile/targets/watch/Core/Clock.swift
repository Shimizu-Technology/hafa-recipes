import Foundation

protocol Clock {
  var now: Date { get }
}

struct SystemClock: Clock {
  var now: Date { Date() }
}

/// A part's running time, anchored to wall-clock dates. Elapsed time is always computed from
/// these dates, never accumulated from timer ticks, so a suspended or relaunched app stays correct.
struct Span: Codable, Equatable {
  struct Pause: Codable, Equatable {
    var at: Date
    var until: Date?
  }

  var start: Date
  var end: Date?
  var pauses: [Pause] = []

  func active(at now: Date) -> TimeInterval {
    let stop = end ?? now
    let paused = pauses.reduce(0.0) { sum, pause in
      let from = max(pause.at, start), to = min(pause.until ?? stop, stop)
      return sum + max(0, to.timeIntervalSince(from))
    }
    return max(0, stop.timeIntervalSince(start) - paused)
  }

  mutating func closePause(at now: Date) {
    guard let last = pauses.indices.last, pauses[last].until == nil else { return }
    pauses[last].until = now
  }
}
