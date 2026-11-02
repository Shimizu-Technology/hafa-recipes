import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import type { Workout } from "./models";

vi.mock("@/components/ui", () => ({ ListGroup: "ListGroup", ListRow: "ListRow" }));
import { WorkoutExerciseList } from "../components/workout-exercise-list";

it("renders numbered rows with a group header and all secondary details", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const blocks = [{ id: "week-1", label: "Week 1", grouping: "sequential", exercises: [
    { name: "Intervals with a long name", distance_meters: 400, instructions: "with 200 m easy jog", notes: "Keep an easy effort" },
    { name: "Long run", duration_seconds: 2100 },
  ] }] as Workout["blocks"];
  let tree!: ReturnType<typeof create>;
  act(() => { tree = create(createElement(WorkoutExerciseList, { blocks, formatChip: null })); });
  const group = tree.root.findByType("ListGroup" as never);
  expect(group.props.header).toContain("Week 1");
  expect(group.props.separatorInset).toBe(38);
  const rows = tree.root.findAllByType("ListRow" as never);
  expect(rows.map(row => row.props.leading)).toEqual(["1", "2"]);
  expect(rows[0].props.detail).toContain("400 m");
  expect(rows[0].props.detail).toContain("with 200 m easy jog");
  expect(rows[0].props.detail).toContain("Private note · Keep an easy effort");
  act(() => tree.unmount());
});
