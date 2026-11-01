import { createElement, isValidElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTrainingStore, type SessionDraft } from "./training";
import type { ActualSet, Workout } from "./models";

const fixture = vi.hoisted(() => ({ speak: vi.fn(), warning: vi.fn(), announce: vi.fn() }));
vi.mock("react-native", () => ({ useWindowDimensions: () => ({ width: 390, fontScale: 1 }), View: "View", Pressable: "Pressable" }));
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
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; log.mockReset(); finish.mockReset(); fixture.warning.mockReset(); });
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
  expect(renderer!.root.findAllByType("SectionHeader" as never)[0].props.title).toBe("Time cap reached · tick what you finished");
  await act(async () => renderer!.root.findAll((n) => (n.type as unknown) === "Field")[0].props.onChange("12"));
  await act(async () => button("Save capped result").props.onPress());
  expect(finish).toHaveBeenCalledWith("partial", [expect.objectContaining({ exercise_index: 0, reps: 12, completed: false })]);
});
