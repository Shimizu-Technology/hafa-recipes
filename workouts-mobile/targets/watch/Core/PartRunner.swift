import Foundation

enum SegmentKind: String, Codable { case buyIn = "buy_in", round, set }

/// A buy-in, round or set inside a part. Saved as HKWorkoutEvent segments when the class ends.
struct Segment: Codable, Equatable {
  var kind: SegmentKind
  var part: Int
  var start: Date
  var end: Date
}

/// What the Health recording must follow. Dates are when it happened, which can be in the past
/// after the runner catches up from a suspended or relaunched app.
enum RunnerEvent: Equatable {
  case partBegan(Int, Date)
  case partEnded(Int, Date)
  case paused(Date)
  case resumed(Date)
  case finished(Date)
}

/// Pure state machine for one class: lead-in, each part's clock, and rest between parts.
/// Every mutation first catches up on time-driven transitions, so the order of calls doesn't matter.
struct PartRunner: Codable, Equatable {
  enum Phase: Codable, Equatable {
    case ready
    case leadIn(until: Date)
    case running
    case resting(until: Date)
    case finished(Date)
  }

  struct PartRun: Codable, Equatable {
    var span: Span?
    var taps: [Date] = []
    var buyInDoneAt: Date?
    var skipped = false
    var score: PartScore?
  }

  enum Advance: Equatable { case startedPart, buyInDone, round(Int), setDone(Int), partDone }
  enum Ignored: Equatable { case tooSoon, paused, clockDriven, nothingToAdvance, stateChanged }
  enum AdvanceResult: Equatable { case applied(Advance), ignored(Ignored) }

  static let debounce: TimeInterval = 0.6
  static let undoWindow: TimeInterval = 10

  let plan: WatchPlan
  let leadIn: TimeInterval
  private(set) var phase: Phase = .ready
  private(set) var cursor = 0
  private(set) var runs: [PartRun]
  private(set) var pausedAt: Date?
  private(set) var lastAdvanceAt: Date?
  private(set) var lastTapAt: Date?

  init(plan: WatchPlan, leadIn: TimeInterval) {
    self.plan = plan
    self.leadIn = leadIn
    runs = Array(repeating: PartRun(), count: plan.parts.count)
  }

  var part: WatchPlan.Part? { plan.parts.indices.contains(cursor) ? plan.parts[cursor] : nil }

  mutating func setScore(_ score: PartScore, for index: Int) {
    guard runs.indices.contains(index), plan.parts[index].scored else { return }
    runs[index].score = score
  }

  mutating func extendRest(by seconds: TimeInterval) {
    guard case .resting(let until) = phase, seconds > 0 else { return }
    phase = .resting(until: until.addingTimeInterval(seconds))
  }

  func setRestRemaining(at now: Date) -> TimeInterval {
    guard phase == .running, part?.kind == .sets, let tap = runs[cursor].taps.last else { return 0 }
    let elapsed = activeSeconds(of: cursor, at: now) - activeSeconds(of: cursor, at: tap)
    return max(0, TimeInterval(part?.restSeconds ?? 0) - elapsed)
  }

  func activeSeconds(of index: Int, at now: Date) -> TimeInterval { runs[index].span?.active(at: now) ?? 0 }

  /// Time left on the current part's clock, or nil when it counts up.
  func remaining(at now: Date) -> TimeInterval? {
    guard phase == .running, let limit = part?.timeLimit else { return nil }
    return max(0, limit - activeSeconds(of: cursor, at: now))
  }

  mutating func start(at now: Date) -> [RunnerEvent] {
    guard phase == .ready, !plan.parts.isEmpty else { return [] }
    var events: [RunnerEvent] = []
    leadInOrBegin(at: now, &events)
    return events
  }

  mutating func tick(at now: Date) -> [RunnerEvent] {
    guard pausedAt == nil else { return [] }
    var events: [RunnerEvent] = []
    while true {
      switch phase {
      case .leadIn(let until) where now >= until:
        begin(at: until, &events)
      case .resting(let until) where now >= until:
        leadInOrBegin(at: until, &events)
      case .running:
        guard let limit = part?.timeLimit, let span = runs[cursor].span else { return events }
        let overshoot = span.active(at: now) - limit
        guard overshoot >= 0 else { return events }
        close(at: now.addingTimeInterval(-overshoot), &events)
      default:
        return events
      }
    }
  }

  /// One press of the advance target or the Action button (design §5.3).
  mutating func advance(at now: Date) -> (AdvanceResult, [RunnerEvent]) {
    let events = tick(at: now)
    // The clock just moved the class on (cap reached, rest over), so this press was meant for the old screen.
    if !events.isEmpty { return (.ignored(.stateChanged), events) }
    if pausedAt != nil { return (.ignored(.paused), []) }
    if let last = lastAdvanceAt, now.timeIntervalSince(last) < Self.debounce { return (.ignored(.tooSoon), []) }
    var applied: [RunnerEvent] = []
    let result: AdvanceResult
    switch phase {
    case .leadIn:
      begin(at: now, &applied)
      result = .applied(.startedPart)
    case .resting:
      leadInOrBegin(at: now, &applied)
      result = .applied(.startedPart)
    case .running:
      result = tap(at: now, &applied)
    case .ready, .finished:
      result = .ignored(.nothingToAdvance)
    }
    if case .applied = result { lastAdvanceAt = now }
    return (result, applied)
  }

  /// Takes back the latest buy-in, round or set within 10 seconds while its part is still running.
  mutating func undo(at now: Date) -> Bool {
    guard phase == .running, let at = lastTapAt, now.timeIntervalSince(at) <= Self.undoWindow else { return false }
    if runs[cursor].taps.last == at {
      runs[cursor].taps.removeLast()
    } else if runs[cursor].buyInDoneAt == at {
      runs[cursor].buyInDoneAt = nil
    } else {
      return false
    }
    lastTapAt = nil
    return true
  }

  mutating func pause(at now: Date) -> [RunnerEvent] {
    var events = tick(at: now)
    guard pausedAt == nil else { return events }
    switch phase {
    case .ready, .finished: return events
    case .running: runs[cursor].span?.pauses.append(.init(at: now))
    case .leadIn, .resting: break
    }
    pausedAt = now
    events.append(.paused(now))
    return events
  }

  mutating func resume(at now: Date) -> [RunnerEvent] {
    guard let pausedAt else { return [] }
    self.pausedAt = nil
    switch phase {
    case .running: runs[cursor].span?.closePause(at: now)
    case .resting(let until): phase = .resting(until: until.addingTimeInterval(now.timeIntervalSince(pausedAt)))
    case .leadIn: phase = .leadIn(until: now.addingTimeInterval(leadIn))
    case .ready, .finished: break
    }
    return [.resumed(now)] + tick(at: now)
  }

  /// Ends the running part now, or skips the part whose lead-in or rest is showing.
  mutating func endPart(at now: Date) -> [RunnerEvent] {
    var events = tick(at: now) + resume(at: now)
    switch phase {
    case .running:
      close(at: now, &events)
    case .leadIn, .resting:
      runs[cursor].skipped = true
      next(after: now, rest: 0, &events)
    case .ready, .finished: break
    }
    return events
  }

  mutating func finish(at now: Date) -> [RunnerEvent] {
    var events = tick(at: now)
    if case .finished = phase { return events }
    events += resume(at: now)
    if phase == .running {
      runs[cursor].span?.end = now
      events.append(.partEnded(cursor, now))
    }
    for index in runs.indices where runs[index].span == nil { runs[index].skipped = true }
    phase = .finished(now)
    events.append(.finished(now))
    return events
  }

  func segments() -> [Segment] {
    plan.parts.indices.flatMap { index -> [Segment] in
      guard let start = runs[index].span?.start else { return [] }
      var out: [Segment] = []
      var from = start
      if let buyIn = runs[index].buyInDoneAt {
        out.append(Segment(kind: .buyIn, part: index, start: from, end: buyIn))
        from = buyIn
      }
      let kind: SegmentKind = plan.parts[index].kind == .sets ? .set : .round
      for tap in runs[index].taps {
        out.append(Segment(kind: kind, part: index, start: from, end: tap))
        from = tap
      }
      return out
    }
  }

  private mutating func tap(at now: Date, _ events: inout [RunnerEvent]) -> AdvanceResult {
    guard let part else { return .ignored(.nothingToAdvance) }
    if part.hasBuyIn && runs[cursor].buyInDoneAt == nil {
      runs[cursor].buyInDoneAt = now
      lastTapAt = now
      return .applied(.buyInDone)
    }
    switch part.kind {
    case .emom, .workRest:
      return .ignored(.clockDriven)
    case .sets:
      runs[cursor].taps.append(now)
      lastTapAt = now
      let count = runs[cursor].taps.count
      if let rounds = part.rounds, count >= rounds * max(1, part.moves.count) {
        close(at: now, &events)
        return .applied(.partDone)
      }
      return .applied(.setDone(count))
    case .amrap, .forTime:
      runs[cursor].taps.append(now)
      lastTapAt = now
      let count = runs[cursor].taps.count
      if part.kind == .forTime, let rounds = part.rounds, count >= rounds {
        close(at: now, &events)
        return .applied(.partDone)
      }
      return .applied(.round(count))
    }
  }

  private mutating func leadInOrBegin(at date: Date, _ events: inout [RunnerEvent]) {
    if leadIn > 0 { phase = .leadIn(until: date.addingTimeInterval(leadIn)) } else { begin(at: date, &events) }
  }

  private mutating func begin(at date: Date, _ events: inout [RunnerEvent]) {
    runs[cursor].span = Span(start: date)
    phase = .running
    lastTapAt = nil
    events.append(.partBegan(cursor, date))
  }

  private mutating func close(at date: Date, _ events: inout [RunnerEvent]) {
    runs[cursor].span?.end = date
    events.append(.partEnded(cursor, date))
    next(after: date, rest: plan.parts[cursor].restAfter, &events)
  }

  private mutating func next(after date: Date, rest: TimeInterval, _ events: inout [RunnerEvent]) {
    guard cursor + 1 < plan.parts.count else {
      phase = .finished(date)
      events.append(.finished(date))
      return
    }
    cursor += 1
    if rest > 0 { phase = .resting(until: date.addingTimeInterval(rest)) } else { leadInOrBegin(at: date, &events) }
  }
}
