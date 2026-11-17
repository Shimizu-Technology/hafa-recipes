import SwiftUI
import WatchKit

struct WatchRootView: View {
  @EnvironmentObject private var engine: WorkoutEngine
  var body: some View {
    Group {
      switch engine.state {
      case .idle: HomeView()
      case .starting, .saving: ProgressView()
      case .saved:
        ScrollView {
          VStack(spacing: 12) {
            Text("Saved").font(Theme.display(32))
            Text("Sending to iPhone…").font(.footnote).foregroundStyle(Theme.muted)
            Text("Queued on your watch until iPhone sync is available.")
              .font(.footnote).foregroundStyle(Theme.muted)
            Button("Done") { Task { await engine.discard() } }.buttonStyle(WatchButton())
          }
        }
      case .running, .failed:
        if engine.runner != nil {
          ClassView()
        }
      }
    }
    .foregroundStyle(Theme.text).background(Theme.background)
    .alert("Couldn't start", isPresented: Binding(get: { engine.startError != nil }, set: { if !$0 { engine.startError = nil } })) {
      Button("OK") { engine.startError = nil }
    } message: { Text(engine.startError ?? "") }
  }
}

struct ClassView: View {
  @EnvironmentObject private var engine: WorkoutEngine
  @EnvironmentObject private var runtime: WatchRuntime
  @Environment(\.isLuminanceReduced) private var dimmed
  @State private var page = 1
  @State private var lastCue = ""

  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { context in
      if let runner = engine.runner {
        let now = runner.pausedAt ?? context.date
        Group {
          if case .finished = runner.phase {
            FinishView()
          } else if dimmed {
            clock(runner, now: now)
          } else {
            TabView(selection: $page) {
              ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                  Text("Movements").font(Theme.display(26))
                  ForEach(runner.part?.moves ?? [], id: \.index) { Text($0.text).font(.body) }
                }
              }.tag(0)
              live(runner, now: now).tag(1)
              ScrollView {
                VStack(spacing: 8) {
                  Button(runner.pausedAt == nil ? "Pause" : "Resume") {
                    runner.pausedAt == nil ? engine.pause() : engine.resume()
                  }.buttonStyle(WatchButton(role: .secondary))
                  Button("End class") { engine.request(.end) }.buttonStyle(WatchButton(role: .destructive))
                  Button("Skip part") { engine.request(.skip) }.buttonStyle(WatchButton(role: .destructive))
                }.buttonStyle(WatchButton())
              }.tag(2)
            }.tabViewStyle(.page(indexDisplayMode: .never))
          }
        }
        .onChange(of: context.date) { _, _ in
          engine.tick()
          cue(runner, now: Date())
        }
        .onChange(of: runner.phase) { _, phase in
          if case .running = phase { page = 1 }
        }
        .onChange(of: runner.cursor) { _, _ in
          page = 1
          if engine.pendingControl == .skip { engine.pendingControl = nil }
        }
      }
    }
    .sheet(item: Binding(get: { engine.sheet }, set: { if $0 == nil { engine.dismissSheet() } }), onDismiss: {
      engine.sheetDismissed()
    }) { sheet in
      switch sheet {
      case .capReps(let index): RepSheet(index: index)
      case .confirmation: ControlConfirmation()
      }
    }
    .safeAreaInset(edge: .bottom, spacing: 2) {
      if !dimmed {
        if let runner = engine.runner, runner.canUndo(at: Date()) {
          UndoPill { _ = engine.undo() }
        } else if let notice = runtime.notice {
          Text(notice).font(.caption).padding(6).background(Theme.surface, in: Capsule())
        }
      }
    }
    .onChange(of: engine.runner) { old, new in
      guard let old, let new, old.phase == .running,
        new.cursor != old.cursor || new.phase != old.phase,
        let cap = old.part?.timeLimit, (old.part?.kind == .forTime || old.part?.kind == .amrap),
        new.runs[old.cursor].span?.end != nil,
        new.activeSeconds(of: old.cursor, at: Date()) >= cap else { return }
      engine.presentCapReps(for: old.cursor)
    }
  }

  @ViewBuilder private func live(_ runner: PartRunner, now: Date) -> some View {
    switch runner.phase {
    case .leadIn(let until):
      VStack {
        Text("GET READY").font(.headline).foregroundStyle(Theme.accent)
        Text("\(max(1, Int(ceil(until.timeIntervalSince(now)))))").font(Theme.display(80))
        Button("Start now") { advance() }.buttonStyle(WatchButton())
      }
    case .resting(let until):
      ScrollView {
        VStack(spacing: 6) {
          Text("REST").foregroundStyle(Theme.muted)
          Text(watchTime(until.timeIntervalSince(now))).font(Theme.display(68)).monospacedDigit()
          Text("Next: \(runner.part?.label ?? "") · \(title(runner))").font(.footnote).lineLimit(1)
          if runner.part?.hasBuyIn == true { Text("\(runner.part?.moves.first?.text ?? "") first").font(.footnote) }
          HStack(spacing: 8) {
            Button("+15 s") { engine.extendRest() }.buttonStyle(WatchButton(role: .secondary))
            Button("Start next") { advance() }.buttonStyle(WatchButton())
          }
        }.buttonStyle(WatchButton())
      }
    case .running:
      GeometryReader { geometry in
        VStack(spacing: 0) {
          HStack {
            Text(runner.pausedAt != nil ? "PAUSED" : title(runner)).foregroundStyle(Theme.accent)
            Spacer()
            Text(engine.metrics.heartRate.map { "♥ \(Int($0))" } ?? "♥ —").foregroundStyle(Theme.muted)
          }.font(.system(size: 15, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.7)
          clock(runner, now: now).frame(height: geometry.size.height * 0.32)
          Button { advance() } label: {
            VStack(spacing: 2) {
              if runner.part?.hasBuyIn == true && runner.runs[runner.cursor].buyInDoneAt == nil {
                Text("BUY-IN").font(.caption).foregroundStyle(Theme.accent)
                Text(runner.part?.moves.first(where: { $0.segment == "buy_in" })?.text ?? "").font(.headline).lineLimit(1)
                Text("Buy-in done").font(.footnote)
              } else if runner.part?.kind == .sets {
                Text(setMove(runner)).font(.footnote).lineLimit(2)
                Text("Set \(runner.runs[runner.cursor].taps.count / max(1, runner.part?.moves.filter { $0.segment != "buy_in" }.count ?? 1) + 1) of \(runner.part?.rounds ?? 1)").font(.headline)
                Text(runner.setRestRemaining(at: now) > 0
                  ? "Rest \(watchTime(runner.setRestRemaining(at: now)))" : "Set done").font(.footnote)
              } else if runner.part?.kind == .emom || runner.part?.kind == .workRest {
                Text(interval(runner, now: now)).font(Theme.display(28)).lineLimit(1)
                Text("Clock advances").font(.footnote).foregroundStyle(Theme.muted)
              } else {
                if runner.part?.kind == .forTime && runner.isOpenPart {
                  Text("OPEN EFFORT").font(.caption).foregroundStyle(Theme.muted)
                  Text("Finish when ready").font(.headline)
                } else {
                  Text("ROUND").font(.system(size: 13)).foregroundStyle(Theme.muted)
                  Text("\(runner.runs[runner.cursor].taps.count)").font(Theme.display(52)).monospacedDigit()
                  Text("+1 round").font(.footnote).foregroundStyle(Theme.accent)
                }
                Text("Up: \(runner.part?.moves.filter { $0.segment != "buy_in" }.map(\.text).joined(separator: " · ") ?? "")")
                  .font(.system(size: 14)).lineLimit(1).foregroundStyle(Theme.muted)
              }
            }.frame(maxWidth: .infinity, maxHeight: .infinity).contentShape(Rectangle())
          }.buttonStyle(.plain).frame(maxHeight: .infinity)
            .accessibilityLabel("Advance \(title(runner))")
            .handGestureShortcut(.primaryAction)
          if runner.isOpenPart {
            Button("Part done") { engine.completePart() }.buttonStyle(WatchButton(compact: true))
              .disabled(runner.pausedAt != nil)
              .opacity(runner.pausedAt == nil ? 1 : 0.4)
          }
        }.padding(.bottom, 4)
      }
    case .ready, .finished: EmptyView()
    }
  }

  private func clock(_ runner: PartRunner, now: Date) -> some View {
    let seconds: TimeInterval
    switch runner.phase {
    case .leadIn(let until), .resting(let until): seconds = max(0, until.timeIntervalSince(now))
    default:
      let inBuyIn = runner.part?.hasBuyIn == true && runner.runs.indices.contains(runner.cursor)
        && runner.runs[runner.cursor].buyInDoneAt == nil
      seconds = inBuyIn ? runner.activeSeconds(of: runner.cursor, at: now)
        : runner.remaining(at: now) ?? runner.activeSeconds(of: runner.cursor, at: now)
    }
    return Text(watchTime(seconds)).font(Theme.display(76)).monospacedDigit().minimumScaleFactor(0.6)
      .foregroundStyle(runner.remaining(at: now).map { $0 <= 10 } == true ? Theme.accent : Theme.text)
      .lineLimit(1)
  }
  private func advance() { runtime.advance() }
  private func title(_ runner: PartRunner) -> String {
    if runner.plan.planKey == "open-timer" { return "OPEN TIMER" }
    switch runner.part?.kind {
    case .amrap:
      guard let cap = runner.part?.capSeconds else { return "AMRAP" }
      return "AMRAP \(cap % 60 == 0 ? String(cap / 60) : watchTime(TimeInterval(cap)))"
    case .forTime: return "FOR TIME"
    case .emom: return "EMOM"
    case .workRest: return "INTERVAL"
    case .sets: return "SETS"
    case nil: return "CLASS"
    }
  }
  private func setMove(_ runner: PartRunner) -> String {
    let moves = runner.part?.moves.filter { $0.segment != "buy_in" } ?? []
    guard !moves.isEmpty else { return "Set done" }
    return moves[runner.runs[runner.cursor].taps.count % moves.count].text
  }
  private func interval(_ runner: PartRunner, now: Date) -> String {
    let elapsed = Int(runner.activeSeconds(of: runner.cursor, at: now))
    let part = runner.part!
    let cycle = max(1, part.intervalSeconds ?? ((part.workSeconds ?? 1) + (part.restSeconds ?? 0)))
    let rest = part.kind == .workRest && elapsed % cycle >= (part.workSeconds ?? cycle)
    return "\(rest ? "REST" : "WORK") \(elapsed / cycle + 1)/\(part.intervals ?? part.rounds ?? 1)"
  }
  private func cue(_ runner: PartRunner, now: Date) {
    guard runner.pausedAt == nil else { return }
    let seconds: Int
    if case .leadIn(let until) = runner.phase { seconds = Int(ceil(until.timeIntervalSince(now))) }
    else { seconds = Int(ceil(runner.remaining(at: now) ?? 99)) }
    let key = "\(runner.cursor)-\(seconds)"
    if (1...3).contains(seconds), lastCue != key {
      lastCue = key; WKInterfaceDevice.current().play(.click)
    }
  }
}

struct UndoPill: View {
  var undo: () -> Void
  var body: some View {
    Button("Undo", action: undo)
      .font(.system(size: 14, weight: .semibold))
      .buttonStyle(.plain)
      .foregroundStyle(Theme.text)
      .frame(width: 96, height: 32)
      .background(Theme.surface, in: Capsule())
  }
}

struct ControlConfirmation: View {
  @EnvironmentObject private var engine: WorkoutEngine
  @EnvironmentObject private var runtime: WatchRuntime
  var body: some View {
    VStack(spacing: 8) {
      Text(engine.pendingControl == .end ? "End this class?" : "Skip this part?")
        .font(Theme.display(26))
      Button("Keep going") { engine.pendingControl = nil }.buttonStyle(WatchButton())
      Button(engine.pendingControl == .end ? "End class" : "Skip part") {
        engine.confirmControl()
      }.buttonStyle(WatchButton(role: .destructive))
      if let notice = runtime.notice { Text(notice).font(.caption).foregroundStyle(Theme.muted) }
    }
  }
}
