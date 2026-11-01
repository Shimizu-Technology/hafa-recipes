import { createElement, isValidElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTrainingStore, type SessionDraft } from "./training";
import type { ActualSet, Workout } from "./models";

const fixture = vi.hoisted(() => ({ speak: vi.fn(), warning: vi.fn(), announce: vi.fn(), fontScale: 1,
  awake: vi.fn(async (_tag?: string) => {}), asleep: vi.fn(async (_tag?: string) => {}) }));
vi.mock("react-native", () => ({ useWindowDimensions: () => ({ width: 390, fontScale: fixture.fontScale }), View: "View", Pressable: "Pressable" }));
vi.mock("expo-keep-awake", () => ({ activateKeepAwakeAsync: fixture.awake, deactivateKeepAwake: fixture.asleep }));
vi.mock("@expo/vector-icons/Ionicons", () => ({ default: "Ionicons" }));
vi.mock("expo-speech", () => ({ speak: fixture.speak }));
vi.mock("@/components/ui", () => ({ Screen: "Screen", Card: "Card", Copy: "Copy", Notice: "Notice", Button: "Button", Field: "Field",
  IconButton: "IconButton", ListRow: "ListRow", Row: "Row", SectionHeader: "SectionHeader", SetRow: "SetRow", Sheet: "Sheet",
  formatClock: (seconds: number) => { const s = Math.max(0, Math.round(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; },
  haptics: { warning: fixture.warning }, useColors: () => ({ action: "green", muted: "grey" }) }));
vi.mock("@/components/workout-instructions", () => ({ WorkoutInstructions: "WorkoutInstructions" }));
vi.mock("@/components/training/session-parts", () => ({ announce: fixture.announce }));
import { FormatSession } from "../components/training/format-session";

let renderer: ReactTestRenderer | undefined;
const log = vi.fn<(actuals: ActualSet[]) => void>(), finish = vi.fn();
function workout(block: Partial<Workout["blocks"][number]> & Pick<Workout["blocks"][number], "exercises">): Workout {
  return { id: "w", revision: 1, generation: 1, title: "Saturday conditioning", kind: "session", provenance: "source",
    blocks: [{ id: "main", label: "Main", grouping: "interval", ...block }] };
}
async function draft(w: Workout) {
  const data = new Map<string, string>();
  const store = createTrainingStore({ getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => { data.set(k, v); }, removeItem: async () => {} }, "o", 1, () => 0);
  await store.load(); await store.start(w, { workout_id: "w", workout_revision: 1 }, "s", 0);
  return store.snapshot().active! as SessionDraft & { timed_format: NonNullable<SessionDraft["timed_format"]> };
}
async function render(d: Awaited<ReturnType<typeof draft>>, now: number) {
  const props = { d, now, busy: false, error: "", activityPicker: null, log, pause() {}, undo() {}, finish, discard() {} };
  await act(async () => { if (renderer) renderer.update(createElement(FormatSession, props)); else renderer = create(createElement(FormatSession, props)); });
}
const text = () => renderer!.root.findAllByType("Copy" as never).map((node) => node.children.filter((c) => typeof c === "string").join("")).join("\n");
// Footer buttons are a prop of the mocked Screen, so walk that element tree as well as the rendered body.
function elements(node: unknown): Array<{ type: unknown; props: Record<string, any> }> {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, any>;
  return [{ type: node.type, props }, ...elements(props.children)];
}
const button = (title: string) => [...renderer!.root.findAll((n) => (n.type as unknown) === "Button"),
  ...elements(renderer!.root.findByType("Screen" as never).props.footer)].find((n) => n.type === "Button" && n.props.title === title)!;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; log.mockReset(); finish.mockReset(); fixture.warning.mockReset(); fixture.announce.mockReset();
  fixture.fontScale = 1; fixture.awake.mockClear(); fixture.asleep.mockClear(); });
const field = (label: string) => renderer!.root.findAll((n) => (n.type as unknown) === "Field").find((n) => n.props.label === label);
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });

it("shows the minute, this minute's move from the rotation and a countdown, and marks only on a tap", async () => {
  const d = await draft(workout({ execution: { mode: "emom", interval_seconds: 60, intervals: 20, rotation: "alternating" },
    exercises: [{ name: "Burpees", reps_min: 10 }, { name: "Air squats", reps_min: 15 }] }));
  await render(d, 125_000);
  expect(renderer!.root.findByType("Screen" as never).props.title).toBe("EMOM 20");
  expect(text()).toContain("Minute 3 of 20");
  expect(text()).toContain("This minute: 10 Burpees");
  expect(text()).toContain("0:55");
  expect(text()).toContain("Next · Minute 4: 15 Air squats");
  // Two minutes passed unmarked: the oldest is offered first, and nothing was recorded on its own.
  expect(text()).toContain("Not marked yet");
  expect(log).not.toHaveBeenCalled();
  await act(async () => button("Done · minute 1").props.onPress());
  expect(log).toHaveBeenCalledWith([expect.objectContaining({ round_index: 1, exercise_index: 0, reps: 10, completed: true })]);
  await act(async () => button("Missed").props.onPress());
  expect(log).toHaveBeenLastCalledWith([expect.objectContaining({ round_index: 1, completed: false, reps: null })]);
});

it("cues the change between work and rest and logs typed reps for the interval", async () => {
  const d = await draft(workout({ execution: { mode: "work_rest", work_seconds: 20, rest_seconds: 10, intervals: 8 }, exercises: [{ name: "Squats" }] }));
  await render(d, 5_000);
  expect(text()).toContain("Work");
  expect(text()).toContain("Interval 1 of 8");
  await render(d, 21_000);
  expect(text()).toContain("Rest");
  expect(fixture.warning).toHaveBeenCalledOnce();
  expect(fixture.announce).toHaveBeenCalledWith("Rest");
  await act(async () => renderer!.root.findAll((n) => (n.type as unknown) === "Field")[0].props.onChange("14"));
  await act(async () => button("Log interval 1").props.onPress());
  expect(log).toHaveBeenCalledWith([expect.objectContaining({ round_index: 1, reps: 14, duration_seconds: 20, completed: true })]);
});

it("counts up for time, shows this round's reps from the scheme, and records reps at the cap", async () => {
  const w = workout({ grouping: "circuit", rounds: 3, execution: { mode: "for_time", time_cap_seconds: 720 },
    exercises: [{ name: "Thrusters", rep_scheme: [21, 15, 9] }, { name: "Pull-ups", rep_scheme: [21, 15, 9] }] });
  const d = await draft(w);
  await render(d, 65_000);
  expect(text()).toContain("1:05");
  expect(text()).toContain("Cap 12:00 · Round 1 of 3");
  expect(text()).toContain("21 Thrusters");
  await act(async () => button("Round 1 done").props.onPress());
  expect(log).toHaveBeenCalledWith([expect.objectContaining({ exercise_index: 0, reps: 21 }), expect.objectContaining({ exercise_index: 1, reps: 21 })]);
  await render({ ...d, paused: true, active_started_at: null, active_milliseconds: 720_000 }, 800_000);
  // Reaching the cap is cued once, like an interval change.
  expect(fixture.warning).toHaveBeenCalledOnce();
  expect(fixture.announce).toHaveBeenCalledWith("Time");
  expect(renderer!.root.findAllByType("SectionHeader" as never)[0].props.title).toBe("Time cap reached · tick what you finished");
  await act(async () => renderer!.root.findAll((n) => (n.type as unknown) === "Field")[0].props.onChange("12"));
  await act(async () => button("Save capped result").props.onPress());
  expect(finish).toHaveBeenCalledWith("partial", [expect.objectContaining({ exercise_index: 0, reps: 12, completed: false })]);
});

it("asks for reps only on the EMOM move with no dose, names it, and keeps the prescribed reps on the others", async () => {
  const d = await draft(workout({ execution: { mode: "emom", interval_seconds: 60, intervals: 10, rotation: "together" },
    exercises: [{ name: "Burpees", reps_min: 10 }, { name: "Air squats" }, { name: "Lunges", per_side: true }] }));
  await render(d, 5_000);
  expect(field("Reps in minute 1")).toBeUndefined();
  expect(field("Burpees reps in minute 1")).toBeUndefined();
  expect(field("Air squats reps in minute 1")).toBeDefined();
  expect(field("Lunges reps in minute 1, each side")).toBeDefined();
  // Each dose-less move needs its count before Done.
  expect(button("Done · minute 1").props.disabled).toBe(true);
  await act(async () => field("Air squats reps in minute 1")!.props.onChange("12"));
  expect(button("Done · minute 1").props.disabled).toBe(true);
  await act(async () => field("Lunges reps in minute 1, each side")!.props.onChange("8"));
  expect(button("Done · minute 1").props.disabled).toBe(false);
  await act(async () => button("Done · minute 1").props.onPress());
  expect(log).toHaveBeenCalledWith([
    expect.objectContaining({ exercise_index: 0, reps: 10, completed: true }),
    expect.objectContaining({ exercise_index: 1, reps: 12, completed: true }),
    expect.objectContaining({ exercise_index: 2, side: "left", reps: 8, completed: true }),
    expect.objectContaining({ exercise_index: 2, side: "right", reps: 8, completed: true }),
  ]);
  // A miss keeps only what was typed, on the move it was typed for.
  await act(async () => field("Air squats reps in minute 1")!.props.onChange("5"));
  await act(async () => field("Lunges reps in minute 1, each side")!.props.onChange(""));
  await act(async () => button("Missed").props.onPress());
  expect(log).toHaveBeenLastCalledWith([
    expect.objectContaining({ exercise_index: 0, reps: null, completed: false }),
    expect.objectContaining({ exercise_index: 1, reps: 5, completed: false }),
    expect.objectContaining({ exercise_index: 2, side: "left", reps: null }),
    expect.objectContaining({ exercise_index: 2, side: "right", reps: null }),
  ]);
});

it("logs work/rest reps on both sides of a per-side move", async () => {
  const d = await draft(workout({ execution: { mode: "work_rest", work_seconds: 20, rest_seconds: 10, intervals: 8 }, exercises: [{ name: "Lunges", per_side: true }] }));
  await render(d, 5_000);
  await act(async () => field("Reps in interval 1, each side")!.props.onChange("6"));
  await act(async () => button("Log interval 1").props.onPress());
  expect(log).toHaveBeenCalledWith([expect.objectContaining({ side: "left", reps: 6, duration_seconds: 20 }),
    expect.objectContaining({ side: "right", reps: 6, duration_seconds: 20 })]);
});

it("keeps the screen awake only while the clock runs", async () => {
  const d = await draft(workout({ execution: { mode: "emom", interval_seconds: 60, intervals: 20, rotation: null }, exercises: [{ name: "Burpees", reps_min: 10 }] }));
  await render(d, 5_000);
  expect(fixture.awake).toHaveBeenCalledWith("format-session:s");
  expect(fixture.asleep).not.toHaveBeenCalled();
  await render({ ...d, paused: true, active_started_at: null, active_milliseconds: 5_000 }, 9_000);
  expect(fixture.asleep).toHaveBeenCalledWith("format-session:s");
  await render(d, 10_000);
  expect(fixture.awake).toHaveBeenCalledTimes(2);
  // The clock has run out: nothing is left to cue, so the screen may sleep again.
  await render({ ...d, paused: true, active_started_at: null, active_milliseconds: 1_200_000 }, 1_300_000);
  expect(fixture.asleep).toHaveBeenCalledTimes(2);
  await act(async () => renderer!.unmount()); renderer = undefined;
  expect(fixture.asleep).toHaveBeenCalledTimes(2);
});

it("caps the clock's growth at the largest text size so it stays on one line inside the card", async () => {
  const d = await draft(workout({ grouping: "circuit", rounds: 1, execution: { mode: "for_time", time_cap_seconds: null }, exercises: [{ name: "Burpees", reps_min: 100 }] }));
  fixture.fontScale = 3.1;
  await render(d, 3_599_000);
  const clock = renderer!.root.findAllByType("Copy" as never).find((n) => n.props.kind === "numeric")!;
  expect(clock.props.children).toBe("59:59");
  expect(clock.props.numberOfLines).toBe(1);
  expect(clock.props.allowFontScaling).toBe(false);
  expect(clock.props.style.fontSize * 5 * 0.62).toBeLessThanOrEqual(390 - 96);
  expect(clock.props.style.fontSize).toBeLessThanOrEqual(56 * 1.6);
  fixture.fontScale = 1;
  await render(d, 65_000);
  expect(renderer!.root.findAllByType("Copy" as never).find((n) => n.props.kind === "numeric")!.props.style.fontSize).toBe(56);
});

it("exposes for-time moves as checkboxes", async () => {
  const d = await draft(workout({ grouping: "circuit", rounds: 5, execution: { mode: "for_time", time_cap_seconds: null },
    exercises: [{ name: "Burpees", reps_min: 10 }, { name: "Air squats", reps_min: 20 }] }));
  await render({ ...d, actuals: [{ block_id: "main", exercise_index: 0, set_index: 1, round_index: 1, side: null, completed: true, reps: 10 }], cursor: 1 }, 30_000);
  const rows = renderer!.root.findAll((n) => (n.type as unknown) === "Pressable");
  expect(rows.map((r) => [r.props.accessibilityRole, r.props.accessibilityLabel, r.props.accessibilityState.checked]))
    .toEqual([["checkbox", "10 Burpees", true], ["checkbox", "20 Air squats", false]]);
});

it("caps the footer labels at the largest text sizes so the clock stays in view", async () => {
  const d = await draft(workout({ execution: { mode: "emom", interval_seconds: 120, intervals: 6, rotation: null }, exercises: [{ name: "Power clean", reps_min: 5 }] }));
  fixture.fontScale = 3.1;
  await render(d, 5_000);
  const footer = elements(renderer!.root.findByType("Screen" as never).props.footer).filter((n) => n.type === "Button");
  expect(footer.map((n) => n.props.title)).toEqual(["Done · interval 1", "Missed", "Pause", "Finish"]);
  expect(footer.every((n) => n.props.maxScale === 1.6)).toBe(true);
});

it("caps the work/rest phase word and caption at large text so the clock stays above the footer", async () => {
  const d = await draft(workout({ execution: { mode: "work_rest", work_seconds: 20, rest_seconds: 10, intervals: 8 }, exercises: [{ name: "Squats" }] }));
  fixture.fontScale = 3.1;
  await render(d, 5_000);
  const copies = renderer!.root.findAllByType("Copy" as never);
  expect(copies.find((n) => n.props.accessibilityLabel === "Work phase")!.props.maxScale).toBe(1.6);
  expect(copies.find((n) => n.props.kind === "caption")!.props.maxScale).toBe(2);
  expect(copies.find((n) => n.props.kind === "numeric")!.props.style.fontSize).toBeCloseTo(56 * 1.6);
});
