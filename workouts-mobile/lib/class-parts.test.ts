import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { vi } from "vitest";
import { nov17Class } from "./fixtures/nov17-class";
import { prescriptionLine } from "./discover";
import { authoredWorkout } from "./api";
import { benchmarkLine, instructionsTitle, partTags, programmingLine, relativeLoadSuggestion, restAfterText, segmentLabel } from "./class-parts";
import type { ExercisePrescription } from "./models";

vi.mock("@/components/ui", () => ({ Copy: "Copy", ListGroup: "ListGroup", ListRow: "ListRow" }));
import { WorkoutExerciseList } from "../components/workout-exercise-list";

const [a, b, c, d] = nov17Class.blocks;

describe("class part presentation (Nov 17)", () => {
  it("describes ranges, load choices and relative loads", () => {
    expect(prescriptionLine(a.exercises[0])).toBe("800–1000 m · Under 6:30");
    expect(prescriptionLine(a.exercises[1])).toBe("15 reps · 75% bodyweight");
    expect(prescriptionLine(a.exercises[3])).toBe("300–400 m");
    expect(prescriptionLine(b.exercises[1])).toBe("30 reps · 20 / 14 lb");
    expect(prescriptionLine(d.exercises[0])).toBe("30–40s · 30s rest");
    expect(prescriptionLine(d.exercises[1])).toBe("10–12 reps · 30s rest · Tempo 3010 · RIR 2-3");
    expect(prescriptionLine({ name: "Hold", duration_seconds: 60, duration_seconds_max: 90 })).toBe("1 min–1m 30s");
    expect(prescriptionLine({ name: "Thruster", load_options: [{ load: 95, load_unit: "lb", label: "Rx men" }, { load: 30, load_unit: "kg", label: "Rx women" }] }))
      .toBe("Rx men 95 lb / Rx women 30 kg");
    expect(prescriptionLine({ name: "Squat", sets: 5, reps_min: 3, relative_load: { basis: "one_rep_max", percent: 80 } })).toBe("5 × 3 reps · 80% 1RM");
  });
  it("leaves older prescriptions exactly as before", () => {
    const old: ExercisePrescription = { name: "Row", distance_meters: 500, duration_seconds: 120, load: 20, load_unit: "kg", load_convention: "total", effort: "Hard" };
    expect(prescriptionLine(old)).toBe("2 min · 500 m · Load: 20 kg total · Hard");
  });
  it("suggests a weight from the profile for a %-bodyweight load", () => {
    expect(relativeLoadSuggestion(a.exercises[1], 85, "metric")).toBe("≈ 64 kg (75% of 85 kg)");
    expect(relativeLoadSuggestion(a.exercises[1], 85, "imperial")).toBe("≈ 141 lb (75% of 187 lb)");
    expect(relativeLoadSuggestion(a.exercises[1], null, "metric")).toBeNull();
    expect(relativeLoadSuggestion({ relative_load: { basis: "one_rep_max", percent: 80 } }, 85, "metric")).toBeNull();
  });
  it("labels buy-ins, roles, scoring and rest between parts", () => {
    expect(segmentLabel(a.exercises[0])).toBe("Buy-in, once");
    expect(segmentLabel(a.exercises[1])).toBeNull();
    expect(partTags(a)).toEqual([]);
    expect(partTags(c)).toEqual(["Cool-down", "Not scored"]);
    expect(partTags(d)).toEqual(["Accessory", "Not scored"]);
    expect(restAfterText(a)).toBe("Rest 3 min");
    expect(restAfterText(b)).toBeNull();
  });
  it("shows the gym, track and date, the benchmark, and coach notes", () => {
    expect(programmingLine(nov17Class)).toMatch(/^Unified · BUILD \| BRIK · HYBRID · Tue,? Nov 17$/);
    expect(benchmarkLine(nov17Class)).toBe("Benchmark · Everest · progression 2 of 3");
    expect(instructionsTitle(nov17Class)).toBe("Coach notes");
    expect(instructionsTitle({ programming: null })).toBe("Workout instructions");
    expect(programmingLine({ programming: null })).toBeNull();
  });
  it("saving an edit keeps every class field the editor doesn't know about", () => {
    const edited = { ...nov17Class, title: "Tue class", blocks: nov17Class.blocks.map((block) => ({ ...block, label: `Part ${block.label}` })) };
    const body = authoredWorkout(edited);
    expect(body.programming).toEqual(nov17Class.programming);
    expect(body.benchmark).toEqual(nov17Class.benchmark);
    expect(body.blocks[0]).toMatchObject({ role: "main", rest_after_seconds: 180, label: "Part A" });
    expect(body.blocks[0].exercises[0]).toMatchObject({ segment: "buy_in", distance_meters_min: 800 });
    expect(body.blocks[1].exercises[1].load_options).toHaveLength(2);
    expect(body.blocks[3].exercises[0].duration_seconds_max).toBe(40);
  });
});

describe("WorkoutExerciseList", () => {
  it("numbers only repeating moves, quotes part notes first and shows the rest to the next part", async () => {
    let tree: ReturnType<typeof create> | undefined;
    await act(async () => { tree = create(createElement(() => WorkoutExerciseList({ blocks: nov17Class.blocks, formatChip: null, weightKg: 85 }) as never)); });
    const rows = tree!.root.findAllByType("ListRow" as never);
    expect(rows.slice(0, 4).map((row) => row.props.leading)).toEqual(["•", "1", "2", "3"]);
    expect(rows[0].props.detail).toBe("Buy-in, once · 800–1000 m · Under 6:30");
    expect(rows[1].props.detail).toBe("15 reps · 75% bodyweight\n≈ 64 kg (75% of 85 kg)\nUnbroken");
    const copy = tree!.root.findAllByType("Copy" as never).map((node) => node.children.join(""));
    expect(copy).toContain("Rest 3 min, then B");
    expect(copy).toContain("Active recovery.");
    const headers = tree!.root.findAllByType("ListGroup" as never).map((group) => group.props.header);
    expect(headers[2]).toBe("C · Cool-down · Not scored · Straight sets");
  });
});
