import { expect, it } from "vitest";
import { describeChange, workoutRows } from "./coach-changes";
import type { CoachAction } from "./coach";
import type { Program, ScheduledSession, TrainingProfile, Workout } from "./models";
import { formatPlanDate } from "./plan-presentation";

const workout = (title: string, exercises: Workout["blocks"][number]["exercises"], minutes = 30) =>
  ({ id: title, revision: 1, generation: 1, title, kind: "session", provenance: "user", estimated_minutes: minutes,
    blocks: [{ id: "b", label: "Main", grouping: "sequential", exercises }] }) as Workout;
const squat = (sets: number, reps: number) => ({ name: "Goblet squat", sets, reps_min: reps, reps_max: reps });
const session = (id: string, date: string, w: Workout): ScheduledSession => ({ id, date, purpose: "Strength", workout: w });
const action = (kind: CoachAction["kind"], proposal: CoachAction["proposal"]): CoachAction =>
  ({ id: "a", kind, proposal, profile_revision: 1, target_id: "t", target_revision: 1, expires_at: "2999-01-01T00:00:00Z" });

it("shows exercise target changes, additions and removals between two versions of a workout", () => {
  const before = workout("Legs", [squat(3, 10), { name: "Lunge", sets: 2, reps_min: 8 }], 40);
  const after = workout("Legs", [squat(3, 8), { name: "Step-up", sets: 2, reps_min: 10 }], 30);
  expect(workoutRows(before, after)).toEqual([
    { label: "Length", before: "40 min", after: "30 min" },
    { label: "Goblet squat", before: "3 sets · 10 reps", after: "3 sets · 8 reps" },
    { label: "Step-up", before: "Not in this workout", after: "2 sets · 10 reps" },
    { label: "Lunge", before: "2 sets · 8 reps", after: "Removed" },
  ]);
  expect(workoutRows(before, before)).toEqual([]);
});

it("describes a preferences change against the current profile in plain words", () => {
  const profile = { primary_goal: "strength", session_minutes: 45, available_days: [0, 2] } as TrainingProfile;
  const summary = describeChange(action("profile", { status: "ready", changes: { session_minutes: 30, available_days: [1, 3] } }), { profile });
  expect(summary.title).toBe("Update your training preferences");
  expect(summary.rows).toEqual([
    { label: "Minutes per session", before: "45 min", after: "30 min" },
    { label: "Training days", before: "Monday, Wednesday", after: "Tuesday, Thursday" },
  ]);
});

it("describes moved and shortened sessions, listing a change repeated across sessions once", () => {
  const legs = workout("Legs", [squat(3, 10)]), lighter = workout("Legs", [squat(2, 10)]);
  const program = { sessions: [session("s1", "2026-11-02", legs), session("s2", "2026-11-04", legs)] } as Program;
  const moved = describeChange(action("schedule", { status: "ready", operation: "move", session_id: "s1",
    program: { title: "Plan", proposal: { sessions: [session("s1", "2026-11-05", legs), session("s2", "2026-11-04", legs)] } as never } }), { program });
  expect(moved).toEqual({ title: "Move a session", rows: [{ label: "Legs", before: formatPlanDate("2026-11-02"), after: formatPlanDate("2026-11-05") }] });
  const progressed = describeChange(action("schedule", { status: "ready", operation: "exercise_progression", session_ids: ["s1", "s2"],
    program: { title: "Plan", proposal: { sessions: [session("s1", "2026-11-02", lighter), session("s2", "2026-11-04", lighter)] } as never } }), { program });
  expect(progressed.rows).toEqual([{ label: "Legs · Goblet squat (2 sessions)", before: "3 sets · 10 reps", after: "2 sets · 10 reps" }]);
});

it("lists every resumed session with its concrete sets and reps", () => {
  const legs = workout("Legs", [squat(3, 10)]);
  const summary = describeChange(action("schedule", { status: "ready", operation: "return", confirmation_required: true, session_ids: ["s1"],
    program: { title: "Plan", proposal: { sessions: [session("s1", "2026-11-02", legs), session("past", "2026-10-01", legs)] } as never } }), {});
  expect(summary).toEqual({ title: "Resume your plan", rows: [{ label: `${formatPlanDate("2026-11-02")} · Legs`, before: "Paused", after: "Goblet squat: 3 sets · 10 reps" }] });
});

it("names a new workout copy and a new plan without inventing a before state", () => {
  const before = workout("Legs", [squat(3, 10)]), after = workout("Legs at home", [squat(3, 12)]);
  const copy = describeChange(action("adaptation", { status: "ready", workout: after }), { workout: before });
  expect(copy.title).toBe("Adjust Legs"); expect(copy.note).toContain("new copy");
  const plan = describeChange(action("program", { status: "ready", program: { title: "Spring block", proposal: { sessions: [session("s1", "2026-11-02", before)] } as never } }), {});
  expect(plan).toEqual({ title: "New plan: Spring block", rows: [{ label: "Sessions", after: `1 · starts ${formatPlanDate("2026-11-02")}` }] });
});
