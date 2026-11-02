import { describe, expect, it } from "vitest";
import { exerciseTargets, formatPlanDate, nextPlannedSession, planWeekOptions, planWeeks, sharedEffort, workoutMeta, PLAN_WEEK_OPTIONS } from "./plan-presentation";
import type { Program, ScheduledSession } from "./models";

describe("plan presentation", () => {
  it("formats plan dates as a weekday and day, adding the year only when it differs", () => {
    const now = new Date(2026, 9, 19);
    expect(formatPlanDate("2026-11-13", now, "en-US")).toBe("Fri, Nov 13");
    expect(formatPlanDate("2027-01-02", now, "en-US")).toBe("Sat, Jan 2, 2027");
    expect(formatPlanDate("not-a-date", now, "en-US")).toBe("not-a-date");
    expect(formatPlanDate("2026-02-30", now, "en-US")).toBe("2026-02-30");
  });
  it("summarizes a workout in one line and lets an AMRAP cap replace the estimate", () => {
    expect(workoutMeta({ minutes: 45, exercises: 4, equipment: ["Dumbbells", "pull-up bar"] })).toBe("45 min · 4 exercises · Dumbbells, pull-up bar");
    expect(workoutMeta({ minutes: 25, timeCap: "20 min", exercises: 1, equipment: [] })).toBe("20 min AMRAP · 1 exercise");
    // Imports sometimes store a literal "None": say "No equipment", never "None".
    for (const none of [["None"], ["none"], ["No equipment"], ["N/A"], ["None", " "]])
      expect(workoutMeta({ exercises: 2, equipment: none })).toBe("2 exercises · No equipment");
    expect(workoutMeta({ exercises: 2, equipment: ["", "  "] })).toBe("2 exercises");
    expect(workoutMeta({ exercises: 2, equipment: ["None", "Dumbbells"] })).toBe("2 exercises · Dumbbells");
    expect(workoutMeta({ minutes: null, exercises: 0 })).toBe("0 exercises");
  });
  it("lists exercise targets compactly and keeps unknowns honest", () => {
    expect(exerciseTargets({ name: "Row", sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90 })).toBe("3 sets · 8–12 reps · 90s rest");
    expect(exerciseTargets({ name: "Plank", duration_seconds: 30 })).toBe("30s");
    expect(exerciseTargets({ name: "Walk", sets: 1, duration_seconds: 600 })).toBe("1 set · 10 min");
    expect(exerciseTargets({ name: "Swing", reps_min: 10 }, true)).toBe("10 reps");
    expect(exerciseTargets({ name: "Squat" })).toBe("");
  });
  it("shows effort once only when every exercise in the proposal shares it", () => {
    const steady = "Controlled, manageable repetitions; stop before form breaks down. Load is not inferred.";
    const workout = (efforts: (string | null)[]) => ({ blocks: [{ exercises: efforts.map((effort) => ({ effort })) }] });
    expect(sharedEffort([workout([steady, steady]), workout([steady])])).toBe(steady);
    // A saved exercise without guidance must not look like it carries the shared note.
    expect(sharedEffort([workout([steady, steady]), workout([null])])).toBeNull();
    expect(sharedEffort([workout([steady, "Easy pace"])])).toBeNull();
    expect(sharedEffort([workout([steady])])).toBeNull();
  });
  it("picks the earliest unrecorded session from today on, across ready, active plans", () => {
    const session = (id: string, date: string) => ({ id, date, purpose: id, workout: { title: id } }) as ScheduledSession;
    const plan = (id: string, sessions: ScheduledSession[], extra: Partial<Program> = {}) =>
      ({ id, status: "ready", sessions, ...extra }) as Program;
    const programs = [
      plan("past-and-recorded", [session("past", "2026-10-18"), session("recorded", "2026-10-19"), session("later", "2026-10-25")]),
      plan("paused", [session("paused", "2026-10-19")], { schedule_state: { status: "paused" } }),
      plan("archived", [session("archived", "2026-10-19")], { schedule_state: { status: "active", archived_at: "2026-10-01" } }),
      plan("review", [session("review", "2026-10-19")], { status: "needs_information" }),
      plan("other", [session("other", "2026-10-21")]),
    ];
    const recorded = (_p: Program, s: ScheduledSession) => s.id === "recorded";
    expect(nextPlannedSession(programs, "2026-10-19", recorded)?.s.id).toBe("other");
    expect(nextPlannedSession(programs, "2026-10-22", recorded)?.s.id).toBe("later");
    expect(nextPlannedSession(programs, "2026-10-26", recorded)).toBeUndefined();
    expect(nextPlannedSession(undefined, "2026-10-19", recorded)).toBeUndefined();
  });
  it("keeps a restored legacy plan length selectable and replaces invalid ones", () => {
    expect(planWeeks("3")).toBe("3"); expect(planWeekOptions("3")).toEqual(["2", "3", "4", "6", "8", "12"]);
    expect(planWeeks("20")).toBe("4"); expect(planWeeks("")).toBe("4"); expect(planWeekOptions("4")).toEqual([...PLAN_WEEK_OPTIONS]);
  });
  it("only offers plan lengths the API accepts", () => {
    expect(PLAN_WEEK_OPTIONS.every((weeks) => Number(weeks) >= 1 && Number(weeks) <= 12)).toBe(true);
  });
});

it("names timed formats on cards, Today and detail meta instead of bare minutes", async () => {
  const { durationLabel } = await import("./timed-execution");
  const { workoutCardMeta } = await import("./library-view");
  const emom = { kind: "session" as const, title: "Burpee EMOM", estimated_minutes: 20, blocks: [{ id: "b", label: "Main", grouping: "interval" as const,
    execution: { mode: "emom" as const, interval_seconds: 60, intervals: 20, rotation: null }, exercises: [{ name: "Burpees", reps_min: 10 }] }] };
  expect(workoutCardMeta(emom)).toBe("EMOM 20");
  expect(durationLabel({ ...emom, blocks: [{ ...emom.blocks[0], execution: { mode: "work_rest", work_seconds: 20, rest_seconds: 10, intervals: 8 } }] })).toBe("Tabata 4 min");
  expect(durationLabel({ ...emom, blocks: [{ ...emom.blocks[0], rounds: 3, execution: { mode: "for_time", time_cap_seconds: 1200 },
    exercises: [{ name: "Thrusters", rep_scheme: [21, 15, 9] }] }] })).toBe("For time · cap 20");
  expect(durationLabel({ ...emom, blocks: [{ ...emom.blocks[0], execution: { mode: "work_rest", work_seconds: 40, rest_seconds: 20, intervals: 8 } }] })).toBe("40/20 × 8");
  expect(workoutCardMeta({ kind: "session", title: "Plain", estimated_minutes: 25 })).toBe("25 min");
  expect(workoutMeta({ minutes: 20, format: "EMOM 20", exercises: 2 })).toBe("EMOM 20 · 2 exercises");
  expect(exerciseTargets({ name: "Thrusters", rep_scheme: [21, 15, 9] })).toBe("21-15-9 reps");
  expect(exerciseTargets({ name: "Burpees", ladder: { start: 1, step: 1, end: null } })).toBe("1, 2, 3… reps");
});
