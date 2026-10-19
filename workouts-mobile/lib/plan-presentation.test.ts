import { describe, expect, it } from "vitest";
import { exerciseTargets, formatPlanDate, sharedEffort, workoutMeta, PLAN_WEEK_OPTIONS } from "./plan-presentation";

describe("plan presentation", () => {
  it("formats plan dates as a weekday and day, adding the year only when it differs", () => {
    const now = new Date(2026, 9, 19);
    expect(formatPlanDate("2026-11-13", now, "en-US")).toBe("Fri, Nov 13");
    expect(formatPlanDate("2027-01-02", now, "en-US")).toBe("Sat, Jan 2, 2027");
    expect(formatPlanDate("not-a-date", now, "en-US")).toBe("not-a-date");
  });
  it("summarizes a workout in one line and lets an AMRAP cap replace the estimate", () => {
    expect(workoutMeta({ minutes: 45, exercises: 4, equipment: ["Dumbbells", "pull-up bar"] })).toBe("45 min · 4 exercises · Dumbbells, pull-up bar");
    expect(workoutMeta({ minutes: 25, timeCap: "20 min", exercises: 1, equipment: [] })).toBe("20 min AMRAP · 1 exercise");
    expect(workoutMeta({ minutes: null, exercises: 0 })).toBe("0 exercises");
  });
  it("lists exercise targets compactly and keeps unknowns honest", () => {
    expect(exerciseTargets({ name: "Row", sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90 })).toBe("3 sets · 8–12 reps · 90s rest");
    expect(exerciseTargets({ name: "Plank", duration_seconds: 30 })).toBe("Sets not specified · 30s target time");
    expect(exerciseTargets({ name: "Swing", reps_min: 10 }, true)).toBe("10 reps");
    expect(exerciseTargets({ name: "Squat" })).toBe("Sets not specified · Reps not specified");
  });
  it("finds effort guidance shared across a proposal so it is shown once", () => {
    const steady = "Controlled, manageable repetitions; stop before form breaks down. Load is not inferred.";
    const workout = (efforts: (string | null)[]) => ({ blocks: [{ exercises: efforts.map((effort) => ({ effort })) }] });
    expect(sharedEffort([workout([steady, steady]), workout([steady, "Easy pace"])])).toBe(steady);
    expect(sharedEffort([workout(["Easy pace", null])])).toBeNull();
  });
  it("only offers plan lengths the API accepts", () => {
    expect(PLAN_WEEK_OPTIONS.every((weeks) => Number(weeks) >= 1 && Number(weeks) <= 12)).toBe(true);
  });
});
