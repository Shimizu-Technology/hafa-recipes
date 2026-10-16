import { createElement, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthoredWorkout } from "./models";

vi.mock("react-native", () => ({ View: "View" }));
vi.mock("@/components/ui", () => ({ Button: "Button", Card: "Card", Choice: "Choice", Copy: "Copy", Field: "Field", Notice: "Notice" }));
vi.mock("@/components/workout-source", () => ({ SavedSourceText: "SavedSourceText" }));
import { WorkoutEditor } from "../components/workout-editor";

let renderer: ReactTestRenderer | undefined;
const field = (label: string) => renderer!.root.findAllByType("Field" as never).find(node => node.props.label === label);
const button = (title: string) => renderer!.root.findAllByType("Button" as never).find(node => node.props.title === title)!;
async function render(initial: AuthoredWorkout) {
  function Editor() {
    const [value, onChange] = useState(initial);
    return createElement(WorkoutEditor, { value, onChange });
  }
  await act(async () => { renderer = create(createElement(Editor)); });
}
const workout = (): AuthoredWorkout => ({ title: "Validation recovery", kind: "session", provenance: "user",
  blocks: [{ id: "main", label: "Main", grouping: "sequential", exercises: [{ name: "Squat", reps_min: 6 }] }] });
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });

it("keeps an automatically revealed cue mounted while replacing invalid text, until explicitly hidden", async () => {
  const initial = workout(); initial.blocks[0].exercises[0].instructions = "x".repeat(2001);
  await render(initial);
  const label = "Instructions or cues · included when sharing", original = field(label)!;
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
