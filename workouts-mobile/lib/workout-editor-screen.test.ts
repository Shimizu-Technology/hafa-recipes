import { createElement, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthoredWorkout } from "./models";

vi.mock("react-native", () => ({ View: "View" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Card: "Card", Choice: "Choice", Copy: "Copy", Field: "Field", Notice: "Notice" }));
vi.mock("@/components/workout-source", () => ({ SavedSourceText: "SavedSourceText" }));
const settings = vi.hoisted(() => ({ units: "metric" as "metric" | "imperial" }));
vi.mock("@/lib/context", () => ({ useTraining: () => ({ units: settings.units }) }));
import { WorkoutEditor } from "../components/workout-editor";

let renderer: ReactTestRenderer | undefined;
let latest: AuthoredWorkout | undefined;
const field = (label: string) => renderer!.root.findAllByType("Field" as never).find(node => node.props.label === label);
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
