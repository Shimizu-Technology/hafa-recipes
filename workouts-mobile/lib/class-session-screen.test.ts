vi.mock("@/components/design/foundation", () => ({ Copy: "Copy", useColors: () => ({ text: "ink" }) }));
vi.mock("@/components/design/training", () => ({ ProgressRing: "ProgressRing" }));
vi.mock("@/components/design/athletic-motion", () => ({ SetPop: "SetPop" }));
import { createElement, isValidElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrainingStore } from "./training";
import { buyInDone, endPart, skipPart, startPart, tapRound, type ClassRun } from "./class-session";
import { nov17Class as w } from "./fixtures/nov17-class";
import type { ActualSet } from "./models";

const fixture = vi.hoisted(() => ({ alert: vi.fn(), warning: vi.fn(), announce: vi.fn(), copy: vi.fn(async (_text: string) => true), fontScale: 1 }));
vi.mock("react-native", () => ({ useWindowDimensions: () => ({ width: 390, fontScale: fixture.fontScale }), View: "View", Pressable: "Pressable", Modal: "Modal",
  Alert: { alert: fixture.alert } }));
vi.mock("expo-keep-awake", () => ({ activateKeepAwakeAsync: async () => {}, deactivateKeepAwake: async () => {} }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("expo-speech", () => ({ speak: vi.fn() }));
vi.mock("expo-clipboard", () => ({ setStringAsync: fixture.copy }));
vi.mock("@/components/ui", () => ({ Screen: ({ children, footer, ...props }: any) => createElement("Screen", { ...props, footer }, children, footer), Card: "Card", Copy: "Copy", Notice: "Notice", Button: "Button", IconButton: "IconButton",
  ListRow: "ListRow", RestTimer: "RestTimer", Chip: "Chip", ChipRow: "ChipRow", Choice: "Choice", Field: "Field", Segmented: "Segmented",
  useToast: () => () => {}, Row: "Row", SectionHeader: "SectionHeader", Sheet: "Sheet",
  formatClock: (seconds: number) => { const s = Math.max(0, Math.round(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; },
  haptics: { warning: fixture.warning, success() {}, tick() {} }, useColors: () => ({ accent: "coral", onAccent: "white", muted: "grey", text: "ink", surface: "white", borderStrong: "line" }) }));
vi.mock("@/components/workout-instructions", () => ({ WorkoutInstructions: "WorkoutInstructions" }));
vi.mock("@/components/training/session-parts", () => ({ announce: fixture.announce }));
vi.mock("@/components/training/lead-in", () => ({ LeadIn: "LeadIn" }));
import { ClassSession, type ClassSessionProps } from "../components/training/class-session";

const min = 60_000;
let renderer: ReactTestRenderer | undefined, now = 0;
const store = () => {
  const data = new Map<string, string>();
  return createTrainingStore({ getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v); }, removeItem: async () => {} }, "o", 1, () => now);
};
let s: ReturnType<typeof store>;
const actions = { act: vi.fn(), log: vi.fn<(a: ActualSet) => void>(), finish: vi.fn(), roundLoad: vi.fn(), timer: vi.fn(), runDistance: vi.fn() };
async function render(at: number) {
  now = at;
  const d = s.snapshot().active!;
  const props: ClassSessionProps = { d: { ...d, class_run: d.class_run! }, now, busy: false, error: "", runEnvironment: s.snapshot().run_environment ?? "outdoor",
    activityPicker: null, act: actions.act, log: actions.log, undo() {}, timer: actions.timer, finish: actions.finish, runDistance: actions.runDistance, roundLoad: actions.roundLoad, discard() {} };
  await act(async () => { if (renderer) renderer.update(createElement(ClassSession, props)); else renderer = create(createElement(ClassSession, props)); });
}
function elements(node: unknown): Array<{ type: unknown; props: Record<string, any> }> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, any>;
  return [{ type: node.type, props }, ...elements(props.children)];
}
const screen = () => renderer!.root.findByType("Screen" as never).props;
const text = () => renderer!.root.findAllByType("Copy" as never).map((n) => n.children.filter((c) => typeof c === "string").join("")).join("\n");
const control = (title: string) => [...renderer!.root.findAll((n) => n.props?.title === title || n.props?.accessibilityLabel === title).map((n) => ({ props: n.props })),
  ...elements(screen().footer)].find((n) => n.props.title === title || n.props.accessibilityLabel === title);
/** Applies what the screen asked for, the way the training screen does. */
const apply = async () => { const [change, environment] = actions.act.mock.calls.at(-1)!; await s.classAct(change as never, now, environment as never); };

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.values(actions).forEach((f) => f.mockReset()); fixture.announce.mockReset(); fixture.fontScale = 1;
  now = 0; s = store(); await s.load(); s.setLeadIn(0);
  await s.start(w, { workout_id: w.id, workout_revision: 1 }, "class", 0);
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });

describe("class runner (Nov 17)", () => {
  it("shows A with its moves and a big Start", async () => {
    await render(0);
    expect(screen().title).toBe("A · AMRAP 15");
    expect(text()).toContain("A · AMRAP 15");
    control("Start A")!.props.onPress();
    expect(actions.act.mock.calls[0][0]).toBe(startPart);
  });
  it("does the buy-in once with a one-tap Outdoor/Treadmill, then counts rounds with undo", async () => {
    await s.classAct(startPart, 0);
    await render(5 * min);
    expect(text()).toContain("10:00");
    expect(text()).toContain("Buy-in · 1000 m Run");
    const runToggle = control("1000 m Run: Outdoor")!;
    runToggle.props.onPress();
    await apply();
    expect(s.snapshot().run_environment).toBe("treadmill");
    expect(s.snapshot().active!.class_run!.parts[0].runs?.[0].environment).toBe("treadmill");
    control("Buy-in done")!.props.onPress();
    expect(actions.act.mock.calls.at(-1)![0]).toBe(buyInDone);
    await apply();
    await s.classAct(tapRound, 8 * min); await s.classAct(tapRound, 11 * min);
    await render(11 * min);
    expect(text()).toContain("2 rounds");
    expect(text()).toContain("This round · 15 Deadlift · 20 Burpee · 400 m Run");
    // The round's own run remembers Treadmill.
    expect(control("400 m Run: Treadmill")).toBeDefined();
    expect(control("+1 round")).toBeDefined();
    expect(control("Undo")).toBeDefined();
  });
  it("rests 3:00 between A and B with ±15 s and Start B now, announcing the cap", async () => {
    await s.classAct(startPart, 0);
    await render(14 * min);
    await render(16 * min);
    expect(text()).toContain("2:00");
    expect(text()).toContain("Rest · then B · AMRAP 15");
    expect(screen()).toMatchObject({ title: "Rest", subtitle: "then B · AMRAP 15" });
    const parts = renderer!.root.findAllByType("ListRow" as never);
    expect(parts.find((n) => n.props.title === "A · AMRAP 15")!.props.detail).toBe("Done");
    expect(parts.find((n) => n.props.title === "B · AMRAP 15")!.props.detail).toBe("Up next");
    expect(fixture.announce).toHaveBeenCalledWith("Time. Rest, then B · AMRAP 15");
    expect(control("Start B now")).toBeDefined();
    expect(control("+15 s")).toBeDefined();
  });
  it("runs D's alternating sets with a big Done and logs a hold's time", async () => {
    for (let i = 0; i < 3; i++) await s.classAct(skipPart, 0);
    await render(1000);
    expect(screen().title).toBe("D · Accessory");
    expect(text()).toContain("D1 · round 1 of 2");
    control("Done · D1")!.props.onPress();
    expect(actions.log.mock.calls[0][0]).toMatchObject({ block_id: "d", exercise_index: 0, completed: true, duration_seconds: 30 });
  });
  it("reviews each score with Rx or Scaled chosen explicitly, copies it for WodUp, and saves it", async () => {
    await s.classAct(startPart, 0);
    await s.classAct(buyInDone, 6 * min);
    await s.classAct(tapRound, 10 * min); await s.classAct(tapRound, 14 * min);
    for (let i = 0; i < 3; i++) await s.classAct(skipPart, 18 * min);
    await render(18 * min);
    expect(renderer!.root.findAll((n) => (n.type as unknown) === "SectionHeader").map((n) => n.props.title)).toContain("Your scores");
    const save = () => control("Save class")!;
    expect(save().props.disabled).toBe(true);
    // The hint stays small enough at the largest text size to leave the score cards room to scroll.
    const hint = elements(screen().footer).find((n) => n.props.children === "Choose Rx or Scaled for each score to save.")!;
    expect(hint.props.maxScale).toBe(1.5);
    const editor = renderer!.root.findAll((n) => n.props?.block?.id === "a" && typeof n.props.onChange === "function")[0];
    expect(editor.props.result).toMatchObject({ kind: "rounds_reps", rounds: 2, reps: 0, buy_in_done: true, buy_in_seconds: 360 });
    await act(async () => editor.props.onChange({ ...editor.props.result, reps: 12, scaling: "rx" }));
    expect(save().props.disabled).toBe(false);
    await act(async () => control("Copy for WodUp")!.props.onPress());
    expect(fixture.copy.mock.calls[0][0]).toBe("BUILD | BRIK · Tue Nov 17\nA: 2 rounds + 12 reps · Rx\n  Buy-in 6:00 · Rounds 4:00, 4:00");
    save().props.onPress();
    expect(actions.finish).toHaveBeenCalledWith("partial", [expect.objectContaining({ block_id: "a", rounds: 2, reps: 12, scaling: "rx" })]);
  });
  it("ends with the parts listed and saves a partial class when parts were skipped", async () => {
    for (let i = 0; i < 4; i++) await s.classAct(skipPart, 0);
    await render(1000);
    expect(text()).toContain("Class done");
    control("Save class")!.props.onPress();
    expect(actions.finish).toHaveBeenCalledWith("partial", []);
  });
  it("offers Buy-in done on a for-time part with a buy-in, then counts its rounds", async () => {
    const forTime = { ...w, blocks: [{ ...w.blocks[0], rounds: 3, execution: { mode: "for_time" as const, time_cap_seconds: 1200 } }] };
    s = store(); await s.load();
    await s.start(forTime, { workout_id: w.id, workout_revision: 1 }, "ft", 0);
    await s.classAct(startPart, 0);
    await render(min);
    expect(control("Buy-in done")).toBeDefined();
    await s.classAct(buyInDone, 5 * min);
    await render(6 * min);
    expect(control("+1 round")).toBeDefined();
    expect(control("Done · stop the clock")).toBeDefined();
  });
  it("pins the clock above the body at the largest text and keeps Pause and Undo whole words", async () => {
    fixture.fontScale = 3.1;
    await s.classAct(startPart, 0);
    await s.classAct(buyInDone, min);
    await s.classAct(tapRound, 4 * min);
    await render(5 * min);
    const clock = renderer!.root.findByType("Screen" as never).props.pinned;
    expect(clock.props).toMatchObject({ compact: true, text: "10:00" });
    for (const title of ["Pause", "Undo"]) {
      const button = control(title)!.props;
      expect(button.icon).toBeUndefined();
      expect(button.maxScale).toBeGreaterThanOrEqual(1);
      expect(button.maxScale).toBeLessThan(3.1);
    }
    await s.classAct(endPart, 6 * min);
    await render(6 * min);
    expect(renderer!.root.findByType("Screen" as never).props.pinned.props).toMatchObject({ compact: true, text: "3:00" });
    fixture.fontScale = 1;
    await render(6 * min);
    expect(renderer!.root.findByType("Screen" as never).props.pinned).toBeUndefined();
  });
});

it("reviews a part auto-started while locked from the resolved run", async () => {
  const workout = { ...w, blocks: [w.blocks[0], w.blocks[1]] };
  s = store(); await s.load();
  await s.start(workout, { workout_id: w.id, workout_revision: 1 }, "locked", 0);
  await s.classAct(startPart, 0); await render(34 * min);
  const editors = renderer!.root.findAll((n) => typeof n.props.onChange === "function" && n.props.result?.block_id);
  expect(editors.map((n) => n.props.result.block_id)).toEqual(["a", "b"]);
  expect(control("Save class")!.props.disabled).toBe(true);
});
it("typing an explicit load uses the kg unit already displayed", async () => {
  const { ScoreEditor } = await import("../components/training/score-editor");
  const { scoreProblem } = await import("./class-scores");
  const change = vi.fn();
  await act(async () => { renderer = create(createElement(ScoreEditor, { block: w.blocks[3],
    result: { block_id: "d", kind: "load", origin: "manual", scaling: "rx" }, onChange: change })); });
  await act(async () => renderer!.root.findAllByType("Field" as never).find((n) => n.props.label === "Weight")!.props.onChange("100"));
  expect(change.mock.calls[0][0]).toMatchObject({ load: 100, load_unit: "kg" });
  expect(scoreProblem(change.mock.calls[0][0])).toBeNull();
});

it("keeps the run choice in the fixed footer and lets the athlete set the next round weight", async () => {
  await s.classAct(startPart, 0); await s.classAct(buyInDone, min); await render(2 * min);
  const footerRuns = elements(screen().footer).filter((n) => n.props.label === "400 m Run");
  expect(footerRuns).toHaveLength(1);
  expect(renderer!.root.findAllByType("Copy" as never).find((n) => n.props.children === "Outdoor")!.props.maxScale).toBe(1.5);
  await act(async () => control("Round weights")!.props.onPress());
  const field = () => renderer!.root.findAllByType("Field" as never).find((n) => n.props.label === "Deadlift weight")!;
  await act(async () => field().props.onChange("60"));
  expect(actions.roundLoad).toHaveBeenLastCalledWith("a", 1, 60, "kg");
  await act(async () => field().props.onChange("60.."));
  expect(control("+1 round")!.props.disabled).toBe(true);
});
