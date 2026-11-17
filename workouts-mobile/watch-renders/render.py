#!/usr/bin/env python3
"""Compile real view source into an isolated macOS SwiftUI render executable. No app target edits."""
import pathlib, tempfile, subprocess, sys, os
root = pathlib.Path(__file__).resolve().parents[1]
out = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/Users/leonshimizu/Desktop/ShimizuTechnology/output/hafa-review-2026-11-15/qa/watch-renders')
out.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix='hafa-render-') as tmp:
 p=pathlib.Path(tmp)
 for f in (root/'targets/watch/Core').glob('*.swift'):
  if f.name not in ['WorkoutEngine.swift','PlanLibrary.swift']:
   (p/f.name).write_text(f.read_text())
 for name in ['Theme','SamplePlan','FinishView','HomeView']:
  s=(root/f'targets/watch/Views/{name}.swift').read_text()
  s=s.replace('private struct ActionHelp','struct ActionHelp').replace('private struct ScoreCard','struct ScoreCard')
  s=s.replace('.digitalCrownRotation($reps, from: 0, through: 9999, by: 1, sensitivity: .low, isContinuous: false)','')
  if name == 'FinishView':
   footer=s[s.index('        if let average'):s.index('\n      }\n    }')]
   (p/'Footer.swift').write_text('import SwiftUI\nstruct FinishFooter: View { @EnvironmentObject var engine: WorkoutEngine; @State var discard = false; func save(withoutHealth: Bool = false) {} ; var body: some View { RenderScroll { VStack(spacing: 12) {\n'+footer+'\n} } } }')
  if name == 'HomeView':
   helpbody=s[s.index('        ScrollView {', s.index('struct ActionHelp')):s.index('\n      }\n  }', s.index('struct ActionHelp'))]
   (p/'Help.swift').write_text('import SwiftUI\nstruct HelpContent: View { @EnvironmentObject var runtime: WatchRuntime; var body: some View {\n'+helpbody.replace('ScrollView {', 'RenderScroll {')+'\n} }')
  (p/f'{name}.swift').write_text(s.replace('ScrollView {', 'RenderScroll {'))
 s=(root/'targets/watch/Views/WatchRootView.swift').read_text()
 # Reuse the exact live/clock/helper implementations; omit only watch lifecycle, haptics and paging container.
 helpers=s[s.index('  @ViewBuilder private func live'):s.index('  private func cue(')]
 helpers=helpers.replace('private func','func').replace('.handGestureShortcut(.primaryAction)','')
 rootview=s[s.index('struct WatchRootView'):s.index('struct ClassView')]
 (p/'Live.swift').write_text('import SwiftUI\n'+rootview.replace('ScrollView {', 'RenderScroll {')+'struct ClassView: View {\n @EnvironmentObject var engine: WorkoutEngine\n @EnvironmentObject var runtime: WatchRuntime\n var body: some View { live(engine.runner!, now: renderNow) }\n'+helpers.replace('ScrollView {', 'RenderScroll {')+'}\n')
 (p/'Harness.swift').write_text((root/'watch-renders/Harness.swift').read_text())
 (p/'Package.swift').write_text('// swift-tools-version:5.9\nimport PackageDescription\nlet package = Package(name: "WatchRenders", platforms: [.macOS(.v14)], targets: [.executableTarget(name: "WatchRenders", path: ".", exclude: ["Package.swift"])])\n')
 subprocess.run(['swift','run','--package-path',str(p),'--scratch-path',str(p/'build'),'--jobs','2','WatchRenders',str(out),str(root/'targets/watch/Fonts/BarlowCondensed_700Bold.ttf')],check=True)
 subprocess.run(['magick','montage',*map(str,sorted(out.glob('[0-9]*.png'))),'-set','label','%f','-label','%f','-font',str(root/'targets/watch/Fonts/BarlowCondensed_700Bold.ttf'),'-pointsize','18','-geometry','205x251+8+24','-tile','4x','-background','#242424','-fill','white',str(out/'contact-sheet.png')],check=True)
