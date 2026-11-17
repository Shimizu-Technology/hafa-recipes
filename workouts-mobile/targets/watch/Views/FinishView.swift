import SwiftUI

struct FinishView: View {
  @EnvironmentObject private var engine: WorkoutEngine
  @State private var discard = false

  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        Text("Class done").font(Theme.display(28))
        if case .failed(let message) = engine.state {
          Text(message).font(.footnote).foregroundStyle(Color.red)
          Button("Retry") { Task { await engine.finish() } }.buttonStyle(WatchButton())
          if engine.canSaveScoresOnly {
            Button("Save scores only") { Task { await engine.finish(withoutHealth: true) } }
              .buttonStyle(WatchButton(role: .secondary))
          }
        }
        if let runner = engine.runner {
          ForEach(runner.plan.parts.indices.filter { runner.plan.parts[$0].scored }, id: \.self) { index in
            ScoreCard(index: index)
          }
        }
        HStack(spacing: 8) {
          Button("Discard") { discard = true }.buttonStyle(WatchButton(role: .destructive))
          if !engine.state.isFailure {
            Button("Save") { Task { await engine.finish() } }.buttonStyle(WatchButton())
          }
        }
        if let average = engine.metrics.average, let maximum = engine.metrics.maximum {
          Text("♥ avg \(Int(average)) · max \(Int(maximum))").font(.footnote).foregroundStyle(Theme.muted)
        }
        if let energy = engine.metrics.kilocalories {
          Text("\(Int(energy)) kcal").font(.footnote).foregroundStyle(Theme.muted)
        }
      }
    }
    .confirmationDialog("Discard this class?", isPresented: $discard) {
      Button("Discard class", role: .destructive) { Task { await engine.discard() } }
    }
  }
}

private struct ScoreCard: View {
  @EnvironmentObject private var engine: WorkoutEngine
  let index: Int
  @State private var repsSheet = false
  @State private var editing = false

  var body: some View {
    if let runner = engine.runner {
      let part = runner.plan.parts[index]
      var score: PartScore {
        var value = PartScore.initial(runner, index: index, at: Date())
        if runner.runs[index].score == nil {
          value.scaled = UserDefaults.standard.bool(forKey: "scaled-\(runner.plan.planKey)-\(part.blockId)")
        }
        return value
      }
      let capped = score.isCapped(for: part)
      Button { editing = true } label: {
        HStack(spacing: 8) {
          VStack(alignment: .leading, spacing: 2) {
            Text("\(part.label) · \(part.kind == .forTime ? "For time" : "AMRAP")").font(.footnote)
            Text(runner.runs[index].skipped ? "Skipped" : part.kind == .forTime ? "Time · mm:ss" : "Rounds + extra reps")
              .font(.caption2).foregroundStyle(Theme.muted)
          }
          Spacer(minLength: 0)
          if !runner.runs[index].skipped {
            Text(capped ? "CAP + \(score.reps)" : part.kind == .forTime ? watchTime(TimeInterval(score.seconds)) : "\(score.rounds) + \(score.reps)")
              .font(Theme.display(26)).monospacedDigit()
          }
        }.padding(.horizontal, 8)
      }.buttonStyle(WatchButton(role: .secondary))
        .disabled(runner.runs[index].skipped)
        .accessibilityLabel("\(part.label), \(runner.runs[index].skipped ? "Skipped" : "Edit score")")
        .sheet(isPresented: $editing) {
          ScrollView {
            VStack(spacing: 8) {
              Text("\(part.label) · \(part.kind == .forTime ? "Time · mm:ss" : "Rounds")").font(.headline)
              Text(part.kind == .forTime ? watchTime(TimeInterval(score.seconds)) : "\(score.rounds)")
                .font(Theme.display(44)).monospacedDigit()
              HStack(spacing: 8) {
                adjustment("−", by: -1, score: score, timed: part.kind == .forTime)
                adjustment("+", by: 1, score: score, timed: part.kind == .forTime)
              }
              Button("Extra reps: \(score.reps)") { repsSheet = true }
                .buttonStyle(WatchButton(role: .secondary, compact: true))
              HStack(spacing: 8) {
                scale("Rx", scaled: false, score: score)
                scale("Scaled", scaled: true, score: score)
              }
              Button("Done") { editing = false }.buttonStyle(WatchButton())
            }
          }.sheet(isPresented: $repsSheet) { RepSheet(index: index) }
        }
    }
  }
  private func adjustment(_ label: String, by amount: Int, score: PartScore, timed: Bool) -> some View {
    Button(label) {
      var next = score
      if timed { next.seconds = max(0, next.seconds + amount) }
      else { next.rounds = max(0, next.rounds + amount) }
      engine.setScore(next, for: index)
    }.buttonStyle(WatchButton(role: .secondary, compact: true)).accessibilityLabel(amount > 0 ? "Increase score" : "Decrease score")
  }
  private func scale(_ label: String, scaled: Bool, score: PartScore) -> some View {
    Button(label) {
      var next = score; next.scaled = scaled; engine.setScore(next, for: index)
      if let runner = engine.runner {
        UserDefaults.standard.set(scaled, forKey: "scaled-\(runner.plan.planKey)-\(runner.plan.parts[index].blockId)")
      }
    }.buttonStyle(WatchButton(role: .secondary, compact: true))
      .overlay(alignment: .bottom) {
        if score.scaled == scaled { Capsule().fill(Theme.accent).frame(width: 24, height: 3).padding(.bottom, 8) }
      }
      .accessibilityAddTraits(score.scaled == scaled ? .isSelected : [])
  }
}

struct RepSheet: View {
  @EnvironmentObject private var engine: WorkoutEngine
  @Environment(\.dismiss) private var dismiss
  var index: Int = 0
  @State private var reps = 0.0
  var body: some View {
    ScrollView {
      VStack(spacing: 8) {
        Text("Extra reps").font(.headline)
        Text("\(Int(reps))").font(Theme.display(52)).monospacedDigit()
          .focusable()
          .digitalCrownRotation($reps, from: 0, through: 9999, by: 1, sensitivity: .low, isContinuous: false)
        HStack(spacing: 8) {
          Button("−") { reps = max(0, reps - 1) }
          Button("+") { reps = min(9999, reps + 1) }
        }.buttonStyle(WatchButton(role: .secondary))
        Button("Done") { dismiss() }.buttonStyle(WatchButton())
      }
    }
    .onAppear {
      if let runner = engine.runner { reps = Double(PartScore.initial(runner, index: index, at: Date()).reps) }
    }
    .onChange(of: reps) { _, value in
      guard let runner = engine.runner else { return }
      var score = PartScore.initial(runner, index: index, at: Date())
      score.reps = Int(value); engine.setScore(score, for: index)
    }
  }
}
