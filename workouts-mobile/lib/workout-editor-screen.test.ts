import { createElement, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthoredWorkout } from "./models";
import { workoutErrors } from "./library";

vi.mock("react-native", () => ({ View: "View" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Card: "Card", Choice: "Choice", Copy: "Copy", Field: "Field", Notice: "Notice" }));
vi.mock("@/components/source-playback", () => ({ SourcePlayback: "SourcePlayback" }));
vi.mock("@/components/workout-source", () => ({ SavedSourceText: "SavedSourceText" }));
const settings = vi.hoisted(() => ({ units: "metric" as "metric" | "imperial" }));
vi.mock("@/lib/context", () => ({ useTraining: () => ({ units: settings.units }) }));
import { WorkoutEditor } from "../components/workout-editor";

let renderer: ReactTestRenderer | undefined;
let latest: AuthoredWorkout | undefined;
const field = (label: string) => renderer!.root.findAllByType("Field" as never).find(node => node.props.label === label);
const copy = () => renderer!.root.findAllByType("Copy" as never).map((n) => [n.props.children].flat().join("")).join("\n");
const button = (title: string) => renderer!.root.findAllByType("Button" as never).find(node => node.props.title === title)!;
async function render(initial: AuthoredWorkout, review = false) {
  function Editor() {
    const [value, setValue] = useState(initial);
    return createElement(WorkoutEditor, { review, value, onChange(next: AuthoredWorkout) { latest = next; setValue(next); } });
  }
  await act(async () => { renderer = create(createElement(Editor)); });
}
const workout = (): AuthoredWorkout => ({ title: "Validation recovery", kind: "session", provenance: "user",
  blocks: [{ id: "main", label: "Main", grouping: "sequential", exercises: [{ name: "Squat", reps_min: 6 }] }] });
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; settings.units = "metric"; latest = undefined; });
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });

it("keeps an automatically revealed cue mounted while replacing invalid text, until explicitly hidden", async () => {
  const initial = workout(); initial.blocks[0].exercises[0].instructions = "x".repeat(2001);
  await render(initial);
  const label = "Cues · shown when shared", original = field(label)!;
  for (const value of ["K", "Keep", "Keep control."]) {
    await act(async () => field(label)!.props.onChange(value));
    expect(field(label)).toBe(original);
    expect(field(label)!.props.value).toBe(value);
  }
  await act(async () => button("Hide details for Squat").props.onPress());
  expect(field(label)).toBeUndefined();
});

it("keeps automatically revealed block settings mounted after the first valid character", async () => {
  const initial = workout(); initial.blocks[0].label = "";
  await render(initial);
  const original = field("Block name")!;
  for (const value of ["M", "Main circuit"]) {
    await act(async () => field("Block name")!.props.onChange(value));
    expect(field("Block name")).toBe(original);
    expect(field("Block name")!.props.value).toBe(value);
  }
  await act(async () => button("Hide block settings: Main circuit").props.onPress());
  expect(field("Block name")).toBeUndefined();
});

it("keeps retained details with their exercise after removing an earlier exercise", async () => {
  const initial = workout(); initial.blocks[0].exercises = [
    { name: "First" }, { name: "Invalid", instructions: "x".repeat(2001) }, { name: "Neighbor" },
  ];
  await render(initial);
  const label = "Cues · shown when shared";
  const neighborDetails = () => renderer!.root.findAllByType("Card" as never).find(card => {
    const names = card.findAllByType("Field" as never).filter(node => node.props.label === "Exercise name");
    return names.length === 1 && names[0].props.value === "Neighbor";
  })!.findAllByType("Field" as never).filter(node => node.props.label === label);
  await act(async () => button("Remove First").props.onPress());
  expect(neighborDetails()).toHaveLength(0);
  const original = field(label)!;
  await act(async () => original.props.onChange("K"));
  expect(field(label)).toBe(original);
  expect(field(label)!.props.value).toBe("K");
  expect(neighborDetails()).toHaveLength(0);
});

it("shows and saves distance in miles for imperial users without changing an untouched distance", async () => {
  settings.units = "imperial";
  const initial = workout(); initial.blocks[0].exercises[0] = { name: "Run", distance_meters: 400 };
  await render(initial);
  expect(field("Distance · metres")).toBeUndefined();
  expect(field("Distance · miles")!.props.value).toBe("0.249");
  await act(async () => field("Exercise name")!.props.onChange("Easy run"));
  expect(latest!.blocks[0].exercises[0].distance_meters).toBe(400);
  await act(async () => field("Distance · miles")!.props.onChange("1"));
  expect(latest!.blocks[0].exercises[0].distance_meters).toBe(1609);
  expect(field("Distance · miles")!.props.value).toBe("1");
  await act(async () => field("Distance · miles")!.props.onChange(""));
  expect(latest!.blocks[0].exercises[0].distance_meters).toBeNull();
});

it("keeps metres for metric users", async () => {
  const initial = workout(); initial.blocks[0].exercises[0] = { name: "Run", distance_meters: 400 };
  await render(initial);
  expect(field("Distance · miles")).toBeUndefined();
  await act(async () => field("Distance · metres")!.props.onChange("800"));
  expect(latest!.blocks[0].exercises[0].distance_meters).toBe(800);
});

it("tucks empty instructions, notes and equipment behind one disclosure and opens it when they have content", async () => {
  await render(workout());
  expect(field("Instructions · shown when shared")).toBeUndefined();
  await act(async () => button("Show instructions, notes and equipment").props.onPress());
  expect(field("Instructions · shown when shared")).toBeDefined();
  expect(field("Equipment · separate with commas")).toBeDefined();
  await act(async () => renderer!.unmount()); renderer = undefined;
  await render({ ...workout(), equipment_required: ["Bench"] });
  expect(field("Equipment · separate with commas")!.props.value).toBe("Bench");
});

it("starts a new weight in the person's units, counted as the total", async () => {
  settings.units = "imperial";
  await render(workout());
  await act(async () => button("More details for Squat").props.onPress());
  await act(async () => field("Weight · select a unit")!.props.onChange("135"));
  expect(latest!.blocks[0].exercises[0]).toMatchObject({ load: 135, load_unit: "lb", load_convention: "total" });
  expect(field("Weight · lb")).toBeDefined();
});

it("keeps oversized workout notes visible for correction even after the disclosure is toggled", async () => {
  await render({ ...workout(), notes: ["x".repeat(4001)] });
  expect(field("Private notes · only you")).toBeDefined();
  await act(async () => button("Hide instructions, notes and equipment").props.onPress());
  expect(field("Private notes · only you")).toBeDefined();
});

it("reviews the exact unknown exercise with source evidence, permits leaving it blank and retains the full editor", async () => {
  const initial = workout(); initial.blocks[0].grouping = "circuit";
  initial.blocks[0].exercises.push({ name: "Lunge", evidence: [{ field: "name", wording: "Then lunges", location: "caption" }] });
  await render(initial, true);
  expect(field("Exercise name")).toBeUndefined();
  await act(async () => button("Lunge: reps, time or distance not specified").props.onPress());
  expect(field("Exercise name")!.props.value).toBe("Lunge");
  expect(field("Rest · seconds")).toBeDefined();
  expect(renderer!.root.findAllByType("Copy" as never).map(n => n.props.children.flat?.() ?? n.props.children).flat().join(" ")).toContain("Then lunges");
  await act(async () => button("Leave unknown").props.onPress());
  expect(latest).toBeUndefined();
  await act(async () => button("Main: rounds not specified").props.onPress());
  expect(field("Rounds")).toBeDefined();
  expect(field("Exercise name")).toBeUndefined();
  await act(async () => field("Rounds")!.props.onChange("3"));
  expect(latest!.blocks[0].rounds).toBe(3);
  expect(latest!.blocks[0].exercises[1].reps_min).toBeUndefined();
  await act(async () => button("Open full editor").props.onPress());
  expect(renderer!.root.findAllByType("Field" as never).filter(n => n.props.label === "Exercise name")).toHaveLength(2);
});

it("returns to the review summary after deleting the selected exercise", async () => {
  const initial = workout(); initial.blocks[0].exercises = [{ name: "First" }, { name: "Next" }];
  await render(initial, true);
  await act(async () => button("First: reps, time or distance not specified").props.onPress());
  await act(async () => button("Remove First").props.onPress());
  expect(field("Exercise name")).toBeUndefined();
  expect(button("Next: reps, time or distance not specified")).toBeDefined();
});
it("labels evidence by field and exposes a safe original-source action beside unknown controls", async () => {
  const initial = workout(); initial.source_url = "https://example.com/workout";
  initial.blocks[0].exercises[0].evidence = [{ field: "rest_seconds", wording: "Rest 30 seconds", location: "caption" }];
  await render(initial, true);
  await act(async () => button("Squat: rest not specified").props.onPress());
  expect(renderer!.root.findAllByType("Copy" as never).map(n => n.props.children).flat().join(" ")).toContain("rest_seconds");
  expect(renderer!.root.findByType("SourcePlayback" as never).props.url).toBe(initial.source_url);
});
it("explains when no usable original-source link is available", async () => {
  const initial = workout(); initial.source_url = "javascript:alert(1)";
  await render(initial, true);
  await act(async () => button("Squat: rest not specified").props.onPress());
  expect(renderer!.root.findAllByType("SourcePlayback" as never)).toHaveLength(0);
  expect(renderer!.root.findAllByType("Copy" as never).map(n => n.props.children).flat().join(" ")).toContain("Original source link unavailable");
});

it("edits EMOM, work/rest and for-time timers with simple fields and keeps the workout length in step", async () => {
  const initial = workout(); initial.blocks[0].exercises.push({ name: "Burpees", reps_min: 10 });
  await render(initial);
  await act(async () => button("Show block settings: Main").props.onPress());
  const choice = (label: string) => renderer!.root.findAllByType("Choice" as never).find((n) => n.props.label === label)!;
  await act(async () => choice("Every minute (EMOM)").props.onPress());
  // Two moves: one per minute or both each minute is the person's choice, never assumed.
  expect(latest!.blocks[0]).toMatchObject({ grouping: "interval", rounds: null, execution: { mode: "emom", interval_seconds: 60, intervals: null, rotation: null } });
  expect(choice("Alternate the moves").props.selected).toBe(false);
  expect(choice("Every move each interval").props.selected).toBe(false);
  expect(copy()).toContain("Choose whether to alternate the moves or do every move each interval.");
  expect(workoutErrors(latest!)).toContain("Choose whether to alternate the moves or do every move each interval.");
  expect(field("Rounds")).toBeUndefined();
  await act(async () => field("How many intervals")!.props.onChange("20"));
  expect(latest!.blocks[0].execution).toMatchObject({ intervals: 20 });
  expect(latest!.estimated_minutes).toBe(20);
  await act(async () => choice("Every move each interval").props.onPress());
  expect(latest!.blocks[0].execution).toMatchObject({ rotation: "together" });
  expect(workoutErrors(latest!)).toEqual([]);
  await act(async () => choice("Work and rest (Tabata)").props.onPress());
  expect(latest!.blocks[0].execution).toEqual({ mode: "work_rest", work_seconds: 20, rest_seconds: 10, intervals: 8 });
  await act(async () => field("Work · seconds")!.props.onChange("40"));
  await act(async () => field("Rest · seconds")!.props.onChange("20"));
  expect(latest!.blocks[0].execution).toEqual({ mode: "work_rest", work_seconds: 40, rest_seconds: 20, intervals: 8 });
  expect(latest!.estimated_minutes).toBe(8);
  await act(async () => choice("For time").props.onPress());
  expect(latest!.blocks[0]).toMatchObject({ grouping: "circuit", execution: { mode: "for_time", time_cap_seconds: null } });
  await act(async () => field("Time cap · minutes")!.props.onChange("12"));
  expect(latest!.estimated_minutes).toBe(12);
  // Clearing the field and typing again keeps the length in step.
  await act(async () => field("Time cap · minutes")!.props.onChange(""));
  await act(async () => field("Time cap · minutes")!.props.onChange("1"));
  expect(latest!.estimated_minutes).toBe(1);
  await act(async () => field("Time cap · minutes")!.props.onChange("12"));
  expect(latest!.blocks[0].execution).toEqual({ mode: "for_time", time_cap_seconds: 720 });
  await act(async () => field("Rounds")!.props.onChange("3"));
  const scheme = renderer!.root.findAllByType("Field" as never).filter((n) => n.props.label === "Reps per round · e.g. 21-15-9");
  await act(async () => scheme[0].props.onChange("21-15-9"));
  expect(latest!.blocks[0].exercises[0]).toMatchObject({ rep_scheme: [21, 15, 9], reps_min: null, reps_max: null });
  await act(async () => scheme[1].props.onChange("21-15-9"));
  expect(workoutErrors(latest!)).toEqual([]);
  // An entry that can't be read replaces the old scheme in the workout, so Save is blocked with a visible error.
  await act(async () => renderer!.root.findAllByType("Field" as never).filter((n) => n.props.label === "Reps per round · e.g. 21-15-9")[1].props.onChange("21-15-x"));
  expect(latest!.blocks[0].exercises[1].rep_scheme).toEqual([21, 15, NaN]);
  expect(renderer!.root.findAllByType("Field" as never).filter((n) => n.props.label === "Reps per round · e.g. 21-15-9")[1].props.value).toBe("21-15-x");
  expect(copy()).toContain("Use 2 to 100 whole numbers from 1 to 1000, like 21-15-9.");
  expect(workoutErrors(latest!)).toContain("Burpees: reps per round need 2 to 100 whole numbers from 1 to 1000.");
  await act(async () => renderer!.root.findAllByType("Field" as never).filter((n) => n.props.label === "Reps per round · e.g. 21-15-9")[1].props.onChange("21-15-9"));
  expect(workoutErrors(latest!)).toEqual([]);
  // Rounds that don't match the reps per round are an error, not a silent mismatch.
  await act(async () => field("Rounds")!.props.onChange("5"));
  expect(workoutErrors(latest!)).toContain("Reps per round list 3 rounds, but the block has 5 rounds. Make them match.");
  expect(copy()).toContain("Reps per round list 3 rounds, but the block has 5 rounds. Make them match.");
  await act(async () => field("Rounds")!.props.onChange("3"));
  await act(async () => choice("Set number of rounds").props.onPress());
  expect(latest!.blocks[0].execution).toBeUndefined();
  expect(latest!.blocks[0].rounds).toBe(3);
  // No timer keeps the length: without a clock there is nothing to derive a new one from.
  expect(latest!.estimated_minutes).toBe(12);
});

it("fills blank for-time rounds from the reps per round", async () => {
  const initial = workout(); initial.blocks[0].exercises.push({ name: "Pull-ups" });
  await render(initial);
  await act(async () => button("Show block settings: Main").props.onPress());
  await act(async () => renderer!.root.findAllByType("Choice" as never).find((n) => n.props.label === "For time")!.props.onPress());
  expect(latest!.blocks[0].rounds ?? null).toBeNull();
  await act(async () => renderer!.root.findAllByType("Field" as never).filter((n) => n.props.label === "Reps per round · e.g. 21-15-9")[0].props.onChange("21-15-9"));
  expect(latest!.blocks[0].rounds).toBe(3);
  expect(field("Rounds")!.props.value).toBe("3");
  // A block switched to for time picks up rounds from an existing scheme too.
  const schemed = workout(); schemed.blocks[0].exercises[0] = { name: "Thrusters", rep_scheme: [15, 12, 9, 6] };
  await act(async () => renderer!.unmount()); renderer = undefined;
  await render(schemed);
  await act(async () => button("Show block settings: Main").props.onPress());
  await act(async () => renderer!.root.findAllByType("Choice" as never).find((n) => n.props.label === "For time")!.props.onPress());
  expect(latest!.blocks[0].rounds).toBe(4);
});

it("keeps a timer from a newer app version until the person replaces or clears it", async () => {
  const initial = workout();
  initial.blocks[0].execution = { mode: "ladder_clock", minutes: 9 } as never;
  await render(initial);
  await act(async () => button("Show block settings: Main").props.onPress());
  const choices = renderer!.root.findAllByType("Choice" as never).filter((n) => n.props.role === "radio" && ["No timer", "Set number of rounds", "Every minute (EMOM)", "For time"].includes(n.props.label));
  expect(choices.some((n) => n.props.selected)).toBe(false);
  expect(copy()).toContain("uses a timer this app version doesn’t know");
  expect(workoutErrors({ ...initial })).toEqual([]);
  await act(async () => renderer!.root.findAllByType("Choice" as never).find((n) => n.props.label === "No timer")!.props.onPress());
  expect(latest!.blocks[0].execution).toBeUndefined();
});
