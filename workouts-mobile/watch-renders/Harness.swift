import SwiftUI
import AppKit
import CoreText

// Test-only injected services. No HealthKit, persistence, intents or session side effects.
let renderNow = Date()
@MainActor final class WorkoutEngine: ObservableObject {
 enum State {
  case idle, starting, running, saving, saved, failed(String)
  var isFailure: Bool { if case .failed = self { return true }; return false }
 }
 enum Control { case end, skip }
 @Published var pendingControl: Control?
 var canSaveScoresOnly = true
 func request(_ control: Control) { pendingControl = control }
 func confirmControl() {}
 @Published var state: State = .idle
 @Published var runner: PartRunner?
 @Published var startError: String?
 var metrics = LiveMetrics()
 func start(_ plan: WatchPlan, leadIn: TimeInterval) async throws {}
 func discard() async {}
 func pause() {}; func resume() {}; func stop() {}; func endPart() {}; func extendRest() {}
 func undo() -> Bool { false }
 func setScore(_ score: PartScore, for index: Int) {}
 func finish(withoutHealth: Bool = false) async {}
 func tick() {}
 func completePart() {}
 func recover() async {}
}
enum WorkoutStyle { case todaysClass, openTimer }
@MainActor final class WatchRuntime: ObservableObject {
 static let shared = WatchRuntime()
 var startedStyle = WorkoutStyle.todaysClass
 var notice: String?; var donationFailed = false
 func advance() {}
}
@MainActor final class HealthAuthorization: ObservableObject {
 enum Status { case checking, asking, unavailable, answered, notAsked, failed }
 var status: Status = .answered
 func refresh() async {}; func request() async {}
}
enum PlanLibrary {
 static var plans: [WatchPlan] = []
 static let openTimer = SamplePlan.plan
}
// ImageRenderer cannot rasterize AppKit-backed ScrollView. Render its top viewport.
struct RenderScroll<Content: View>: View {
 let content: Content
 init(@ViewBuilder content: () -> Content) { self.content = content() }
 var body: some View { Color.clear.overlay(alignment: .top) {
  content.frame(width: 205).fixedSize(horizontal: false, vertical: true)
 }.clipped() }
}
@main struct Render {
 @MainActor static func main() throws {
  let args = CommandLine.arguments
  CTFontManagerRegisterFontsForURL(URL(fileURLWithPath: args[2]) as CFURL, .process, nil)
  let engine = WorkoutEngine(), runtime = WatchRuntime(), health = HealthAuthorization()
  func shot<V: View>(_ name: String, _ view: V) throws {
   let renderer = ImageRenderer(content: view.environmentObject(engine).environmentObject(runtime).environmentObject(health)
    .environment(\.colorScheme, .dark).environment(\.sizeCategory, .large)
    .foregroundStyle(Theme.text).frame(width: 205, height: 251).background(Theme.background))
   renderer.scale = 2
   guard let cg = renderer.cgImage else { fatalError("No image: \(name)") }
   let rep = NSBitmapImageRep(cgImage: cg)
   try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[1]).appendingPathComponent(name + ".png"))
   print(name)
  }
  func runner(_ index: Int, elapsed: Double = 4) -> PartRunner {
   var plan = SamplePlan.plan; plan.parts = Array(plan.parts[index...])
   var r = PartRunner(plan: plan, leadIn: 0); _ = r.start(at: renderNow.addingTimeInterval(-elapsed)); return r
  }
  try shot("01-empty", HomeView())
  PlanLibrary.plans = [SamplePlan.plan]
  try shot("02-plan-list", HomeView())
  for n in [3,2,1] {
   var r = PartRunner(plan: SamplePlan.plan, leadIn: Double(n)); _ = r.start(at: renderNow)
   engine.runner = r; try shot("03-lead-in-\(n)", ClassView())
  }
  engine.runner = runner(0); try shot("04-buy-in", ClassView())
  var r = runner(0); _ = r.advance(at: renderNow.addingTimeInterval(-3)); _ = r.advance(at: renderNow.addingTimeInterval(-1))
  engine.runner = r; try shot("05-amrap", ClassView())
  engine.runner = runner(1); try shot("06-for-time", ClassView())
  try shot("07-cap-reps", RepSheet(index: 0))
  engine.runner = runner(2); try shot("08-emom", ClassView())
  engine.runner = runner(3); try shot("09-work", ClassView())
  engine.runner = runner(3, elapsed: 7); try shot("09-rest", ClassView())
  r = runner(4); _ = r.advance(at: renderNow.addingTimeInterval(-2)); engine.runner = r
  try shot("10-sets-rest", ClassView())
  r = runner(0, elapsed: 35); _ = r.tick(at: renderNow); engine.runner = r
  try shot("11-between-parts", ClassView())
  try shot("12-movements", RenderScroll { VStack(alignment: .leading, spacing: 12) { Text("Movements").font(Theme.display(26)); ForEach(r.part?.moves ?? [], id: \.index) { Text($0.text).font(.body) } } })
  try shot("12-controls", RenderScroll { VStack(spacing: 8) {
   Button("Pause") {}.buttonStyle(WatchButton(role: .secondary))
   Button("End class") {}.buttonStyle(WatchButton(role: .destructive))
   Button("Skip part") {}.buttonStyle(WatchButton(role: .destructive))
  } })
  r = runner(0, elapsed: 100)
  _ = r.tick(at: renderNow)
  _ = r.finish(at: renderNow)
  r.setScore(PartScore(rounds: 3, reps: 7, seconds: 30), for: 0)
  r.setScore(PartScore(rounds: 1, reps: 4, seconds: 30), for: 1)
  let finished = r
  engine.runner = r
  try shot("13-finish", FinishView())
  engine.state = .saved; try shot("14-saved", WatchRootView())
  engine.state = .failed("Couldn't save workout. Try again.")
  try shot("15-save-failure", FinishView())
  engine.runner = runner(0); try shot("16-always-on", ClassView().clock(engine.runner!, now: renderNow))
  r = runner(0); _ = r.advance(at: renderNow); engine.runner = r
  try shot("17-undo", ClassView().safeAreaInset(edge: .bottom, spacing: 2) { UndoPill {} })
  engine.runner = runner(2)
  try shot("18-ignored-press", ClassView().overlay(alignment: .bottom) { Text("Clock advances this part").font(.footnote).padding(8).background(Theme.surface) })
  health.status = .notAsked; try shot("19-first-run", HomeView())
  try shot("20-action-help", HelpContent())
  engine.runner = finished
  engine.state = .failed("Couldn't save workout. Try again.")
  try shot("15-save-failure-actions", FinishView())
  engine.state = .running
  engine.runner = finished
  try shot("13-score-a", RenderScroll { ScoreCard(index: 0) })
  try shot("13-score-b", RenderScroll { ScoreCard(index: 1) })
  try shot("13-edit-rounds", ScoreEditor(index: 0))
  try shot("13-edit-time", ScoreEditor(index: 1))
  var skipped = finished; _ = skipped.endPart(at: renderNow)
  var skipRunner = runner(1); _ = skipRunner.endPart(at: renderNow); engine.runner = skipRunner
  try shot("13-skipped", RenderScroll { ScoreCard(index: 0) })
  var openPlan = SamplePlan.plan
  openPlan.parts = [WatchPlan.Part(blockId: "open", label: "Open effort", kind: .forTime, scored: true,
    moves: [.init(index: 0, text: "6 air squats", isRun: false)])]
  var open = PartRunner(plan: openPlan, leadIn: 0); _ = open.start(at: renderNow.addingTimeInterval(-42))
  engine.runner = open; try shot("21-part-done", ClassView())
  _ = open.pause(at: renderNow); engine.runner = open
  try shot("21-part-done-paused", ClassView())
  _ = open.resume(at: renderNow); _ = open.completePart(at: renderNow); engine.runner = open
  try shot("21-part-done-undo", FinishView().safeAreaInset(edge: .bottom, spacing: 2) { UndoPill {} })
  engine.pendingControl = .end; try shot("22-end-confirmation", ControlConfirmation())
  engine.pendingControl = .skip; try shot("23-skip-confirmation", ControlConfirmation())
  runtime.notice = "Confirm or cancel first"
  try shot("24-confirmation-action", ControlConfirmation())
 }
}
