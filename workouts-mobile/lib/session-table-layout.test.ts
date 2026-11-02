import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import type { ActualSet, Workout } from "./models";

const fixture = vi.hoisted(() => ({ fontScale: 1.5, width: 390 }));
vi.mock("react-native", () => ({ View: "View", useWindowDimensions: () => fixture }));
vi.mock("../components/ui", () => ({ Card: "Card", Copy: "Copy", useColors: () => ({ border: "gray" }) }));
vi.mock("./progress-insights", () => ({ exerciseName: () => "Intervals", setLabel: () => "1", formatDistance: () => "400 m", formatDuration: () => "90s", formatWeight: () => "20 kg" }));
import { SessionTable } from "../components/session-table";

it("keeps all recorded values readable at larger text sizes", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const actual = { block_id: "b", exercise_index: 0, round_index: 0, completed: true, reps: 12, duration_seconds: 90, distance_meters: 400 } as ActualSet;
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(createElement(SessionTable, { actuals: [actual], workout: {} as Workout, units: "metric" })); });
  const row = tree.root.findAllByType("View" as never).find(node => node.props.accessibilityLabel?.startsWith("Set 1:"))!;
  expect(row.props.style.paddingVertical).toBe(12);
  const values = tree.root.findAllByType("Copy" as never).flatMap(node => node.children.filter(child => typeof child === "string")).join(" ");
  expect(values).toContain("12 reps · 90s time · 400 m distance · 20 kg weight");
  act(() => tree.unmount());
});
