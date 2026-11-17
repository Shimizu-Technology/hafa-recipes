import SwiftUI
import AppKit
import CoreText

// Test-only injected services. No HealthKit, persistence, intents or session side effects.
let renderNow = Date()
@MainActor final class WorkoutEngine: ObservableObject {
 enum State { case idle, starting, running, saving, saved, failed(String) }
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
}
@MainActor final class WatchRuntime: ObservableObject {
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
  try shot("12-controls", RenderScroll { VStack(spacing: 8) { Button("Pause") {}; Button("End") {}; Button("Skip part") {} }.buttonStyle(WatchButton()) })
  r = runner(0); _ = r.finish(at: renderNow); engine.runner = r
  try shot("13-finish", FinishView())
  engine.state = .saved; try shot("14-saved", WatchRootView())
  engine.state = .failed("Couldn't save workout. Try again.")
  try shot("15-save-failure", FinishView())
  engine.runner = runner(0); try shot("16-always-on", ClassView().clock(engine.runner!, now: renderNow))
  r = runner(0); _ = r.advance(at: renderNow); engine.runner = r
  try shot("17-undo", ClassView().overlay(alignment: .bottom) { Button("Undo") {}.buttonStyle(WatchButton()) })
  engine.runner = runner(2)
  try shot("18-ignored-press", ClassView().overlay(alignment: .bottom) { Text("Clock advances this part").font(.footnote).padding(8).background(Theme.surface) })
  health.status = .notAsked; try shot("19-first-run", HomeView())
  try shot("20-action-help", HelpContent())
  try shot("15-save-failure-actions", FinishFooter())
  engine.runner = r
  try shot("13-score-a", RenderScroll { ScoreCard(index: 0) })
  try shot("13-score-b", RenderScroll { ScoreCard(index: 1) })
 }
}
